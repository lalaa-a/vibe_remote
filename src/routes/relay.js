import { Router } from 'express'
import { db } from '../supabase.js'
import { requireMachineAuth } from '../middleware/auth.js'
import { syncAgentPendingCount } from '../utils.js'
import { notifyMachine } from '../notify.js'
import { broadcastSession } from '../realtime.js'

const router = Router()

// POST /relay/sessions-alive
// Called by the heartbeat every ~15s with the session IDs whose harness CLI is
// still running on this machine. We mark those agents cli_alive=true and every
// other agent on the machine cli_alive=false (their CLI was closed). Mobile reads
// cli_alive to block prompting a closed session.
router.post('/sessions-alive', requireMachineAuth, async (req, res) => {
  const ids = Array.isArray(req.body.aliveSessionIds)
    ? req.body.aliveSessionIds.filter(s => typeof s === 'string' && s.length)
    : []

  // Mark the live ones alive
  if (ids.length) {
    await db.from('agents')
      .update({ cli_alive: true })
      .eq('machine_id', req.machine.id)
      .in('session_id', ids)
  }

  // Mark everything else on this machine as closed
  let dead = db.from('agents')
    .update({ cli_alive: false })
    .eq('machine_id', req.machine.id)
    .eq('cli_alive', true)
  if (ids.length) {
    // PostgREST "not in" list — session IDs are uuids / ses_* (no special chars)
    dead = dead.not('session_id', 'in', `(${ids.join(',')})`)
  }
  const { error } = await dead
  if (error) {
    console.error('[relay/sessions-alive]', error.message)
    return res.status(500).json({ error: error.message })
  }

  res.json({ ok: true })
})

// POST /relay/agent-ping
// Called by hook.js on every tool call to upsert the agent row and refresh last_activity_at
router.post('/agent-ping', requireMachineAuth, async (req, res) => {
  const { sessionId, cwd, harness } = req.body

  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' })
  }

  const { data, error } = await db
    .from('agents')
    .upsert(
      {
        session_id:       sessionId,
        machine_id:       req.machine.id,
        cwd:              cwd || null,
        harness:          harness ?? 'claude-code',
        cli_alive:        true,   // a session that just acted is definitely open
        last_activity_at: new Date().toISOString(),
      },
      { onConflict: 'session_id' }
    )
    .select('id')
    .single()

  if (error) {
    console.error('[relay/agent-ping]', error.message)
    return res.status(500).json({ error: 'Agent ping failed' })
  }

  res.json({ agentId: data.id })
})

// POST /relay/agent-touch
// Lightweight keepalive: refresh ONLY last_activity_at for a session whose turn is in
// flight. Unlike /agent-ping (an upsert that would clobber cwd/harness with nulls and
// could create phantom rows), this is a plain UPDATE scoped to an existing agent row.
// The heartbeat calls this while a session is busy (busy flag present, or fresh reasoning
// streaming) so deriveStatus stays 'active' through long reasoning phases and long single
// tool runs — closing the window where mobile briefly saw 'idle' mid-turn and unlocked
// the composer, letting a prompt slip in while the agent was still working.
router.post('/agent-touch', requireMachineAuth, async (req, res) => {
  const { sessionId } = req.body

  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' })
  }

  const { error } = await db
    .from('agents')
    .update({ last_activity_at: new Date().toISOString() })
    .eq('machine_id', req.machine.id)
    .eq('session_id', sessionId)

  if (error) {
    console.error('[relay/agent-touch]', error.message)
    return res.status(500).json({ error: 'Agent touch failed' })
  }

  res.json({ ok: true })
})

// POST /relay/usage
// Live token usage for a session's CURRENT turn (see TOKEN_USAGE_STREAMING_DESIGN.md).
// The desktop harnesses send ABSOLUTE running totals (never deltas), so a dropped update
// self-heals on the next one. We (1) persist the totals on the agent row — durable across a
// mobile remount — and (2) broadcast a lightweight 'usage' event on the session topic for
// the live compose-bar counter. Token counts are non-sensitive integers, so unlike the feed
// nudge they ride the broadcast payload directly (no refetch round-trip).
router.post('/usage', requireMachineAuth, async (req, res) => {
  const { sessionId, turnInput = 0, turnOutput = 0, sessionInput, sessionOutput, cost } = req.body

  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' })
  }

  const patch = {
    turn_tokens_input:  Math.max(0, Math.round(turnInput)),
    turn_tokens_output: Math.max(0, Math.round(turnOutput)),
    tokens_updated_at:  new Date().toISOString(),
  }
  if (sessionInput  != null) patch.session_tokens_input  = Math.max(0, Math.round(sessionInput))
  if (sessionOutput != null) patch.session_tokens_output = Math.max(0, Math.round(sessionOutput))

  const { error } = await db
    .from('agents')
    .update(patch)
    .eq('machine_id', req.machine.id)
    .eq('session_id', sessionId)

  if (error) {
    console.error('[relay/usage]', error.message)
    return res.status(500).json({ error: 'Usage update failed' })
  }

  broadcastSession(sessionId, 'usage', {
    turnInput:     patch.turn_tokens_input,
    turnOutput:    patch.turn_tokens_output,
    sessionInput:  patch.session_tokens_input,
    sessionOutput: patch.session_tokens_output,
    cost:          cost ?? null,
  })

  res.json({ ok: true })
})

// POST /relay/upload
// Called by hook.js when Claude Code fires a tool-use event
router.post('/upload', requireMachineAuth, async (req, res) => {
  const { payload } = req.body

  if (!payload) {
    return res.status(400).json({ error: 'payload is required' })
  }

  // Resolve agent_id from session_id so the request is linked to the session
  let agentId = null
  if (payload.session_id) {
    const { data: agent } = await db
      .from('agents')
      .select('id')
      .eq('session_id', payload.session_id)
      .single()
    agentId = agent?.id ?? null
  }

  const { data, error } = await db
    .from('pending_requests')
    .insert({
      ...payload,
      harness:    payload.harness ?? 'claude-code',
      agent_id:   agentId,
      machine_id: req.machine.id,
      user_id:    req.machine.user_id,
      status:     'pending',
      created_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) {
    console.error('[relay/upload]', error.message)
    return res.status(500).json({ error: 'Upload failed' })
  }

  await syncAgentPendingCount(agentId)

  // Nudge any open chat so the new request card streams in live (not on the 30s poll)
  broadcastSession(payload.session_id, 'feed')

  // Fire-and-forget: notify only the phone paired to this machine
  notifyMachine(req.machine.id, {
    title:     payload.kind === 'question'
      ? 'Claude is asking a question'
      : `${payload.tool_name} needs approval`,
    body:      payload.summary ?? 'A request is waiting',
    requestId: data.id,
  })

  res.json({ id: data.id })
})

// POST /relay/decide
// Called by relay.cjs when the PC terminal approves or denies a request
router.post('/decide', requireMachineAuth, async (req, res) => {
  const { requestId, decision } = req.body

  if (!requestId || !decision) {
    return res.status(400).json({ error: 'requestId and decision are required' })
  }
  if (!['approved', 'denied'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be approved or denied' })
  }

  // Fetch agent_id + session_id first so we can sync count and nudge the chat
  const { data: reqRow } = await db
    .from('pending_requests')
    .select('agent_id, session_id')
    .eq('id', requestId)
    .eq('machine_id', req.machine.id)
    .single()

  const { error } = await db
    .from('pending_requests')
    .update({
      status:     decision,
      decided_at: new Date().toISOString(),
      decided_by: 'pc',
    })
    .eq('id', requestId)
    .eq('machine_id', req.machine.id)
    .eq('status', 'pending')

  if (error) {
    console.error('[relay/decide]', error.message)
    return res.status(500).json({ error: 'Decision update failed' })
  }

  await syncAgentPendingCount(reqRow?.agent_id)

  // Nudge any open chat so the card flips to approved/denied live
  broadcastSession(reqRow?.session_id, 'feed')

  res.json({ ok: true })
})

// POST /relay/answer
// Called by relay.cjs `answer <n>` when the PC terminal answers a question request.
router.post('/answer', requireMachineAuth, async (req, res) => {
  const { requestId, answers } = req.body

  if (!requestId || !Array.isArray(answers) || answers.length === 0) {
    return res.status(400).json({ error: 'requestId and answers are required' })
  }

  const { data: reqRow } = await db
    .from('pending_requests')
    .select('agent_id, session_id')
    .eq('id', requestId)
    .eq('machine_id', req.machine.id)
    .single()

  const { error } = await db
    .from('pending_requests')
    .update({
      status:           'answered',
      selected_options: answers,
      decided_at:       new Date().toISOString(),
      decided_by:       'pc',
    })
    .eq('id', requestId)
    .eq('machine_id', req.machine.id)
    .eq('kind', 'question')
    .eq('status', 'pending')

  if (error) {
    console.error('[relay/answer]', error.message)
    return res.status(500).json({ error: 'Answer update failed' })
  }

  await syncAgentPendingCount(reqRow?.agent_id)
  broadcastSession(reqRow?.session_id, 'feed')

  res.json({ ok: true })
})

// POST /relay/terminal-event
// Called by postHook.js, notifyHook.js, stopHook.js on the desktop
router.post('/terminal-event', requireMachineAuth, async (req, res) => {
  const { session_id, event_type, tool_name, summary, detail, status } = req.body

  if (!session_id || !event_type) {
    return res.status(400).json({ error: 'session_id and event_type are required' })
  }

  const { error } = await db
    .from('terminal_events')
    .insert({
      session_id,
      machine_id: req.machine.id,
      user_id:    req.machine.user_id,
      event_type,
      harness:    req.body.harness ?? 'claude-code',
      tool_name:  tool_name ?? null,
      summary:    summary   ?? null,
      detail:     detail    ?? null,
      status:     status    ?? null,
    })

  if (error) {
    console.error('[relay/terminal-event]', error.message)
    return res.status(500).json({ error: error.message })
  }

  // A 'stop' event means the turn ended. The agent-touch keepalive holds a busy session
  // 'active'; without an explicit turn-end signal it would linger 'active' for the full
  // 30s window before decaying. Backdate last_activity_at just past that window so
  // deriveStatus flips to 'idle' immediately and mobile unlocks the composer the moment
  // "Task complete" shows. Keep this threshold in sync with deriveStatus() in utils.js.
  if (event_type === 'stop') {
    await db
      .from('agents')
      .update({ last_activity_at: new Date(Date.now() - 31_000).toISOString() })
      .eq('machine_id', req.machine.id)
      .eq('session_id', session_id)
  }

  // Nudge any open chat so new reasoning/activity streams in live
  broadcastSession(session_id, 'feed')

  res.json({ ok: true })
})

// GET /relay/stop-requests — poll backstop for the stop_requested broadcast.
// Called by heartbeat.js (claude-code/opencode) and by the gemini-cli PTY wrapper
// process (vibe run gemini-cli), which can't receive heartbeat's in-process
// broadcast handler since it's a separate OS process. harness is captured on the
// row at insert time (POST /mobile/sessions/:id/stop), so no join is needed here.
router.get('/stop-requests', requireMachineAuth, async (req, res) => {
  const { session } = req.query
  let q = db.from('stop_requests')
    .select('id, session_id, harness')
    .eq('machine_id', req.machine.id)
    .eq('status', 'pending')
  if (session) q = q.eq('session_id', session)

  const { data, error } = await q
  if (error) {
    console.error('[relay/stop-requests]', error.message)
    return res.status(500).json({ error: error.message })
  }

  res.json({ requests: data ?? [] })
})

// POST /relay/stop-ack — mark stop request(s) delivered so they stop showing in polls.
router.post('/stop-ack', requireMachineAuth, async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : []
  if (!ids.length) return res.json({ ok: true })

  const { error } = await db.from('stop_requests')
    .update({ status: 'delivered', delivered_at: new Date().toISOString() })
    .in('id', ids)
    .eq('machine_id', req.machine.id)

  if (error) {
    console.error('[relay/stop-ack]', error.message)
    return res.status(500).json({ error: error.message })
  }

  res.json({ ok: true })
})

// GET /relay/status/:requestId
// Polling fallback — relay daemon polls this if Realtime is unavailable
router.get('/status/:requestId', requireMachineAuth, async (req, res) => {
  const { data, error } = await db
    .from('pending_requests')
    .select('status, decided_by, decided_at, selected_options')
    .eq('id', req.params.requestId)
    .eq('machine_id', req.machine.id)
    .single()

  if (error || !data) {
    return res.status(404).json({ error: 'Request not found' })
  }

  res.json(data)
})

export default router
