import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { db } from '../supabase.js'
import { requireMachineAuth, requireUserAuthFast, attachDevice } from '../middleware/auth.js'
import { syncAgentPendingCount, deriveStatus } from '../utils.js'
import { broadcastSession, broadcastMachine } from '../realtime.js'
import { rateLimit } from 'express-rate-limit'

// Backstop for the derived online state (presence is the instant path — see
// INSTANT_OFFLINE_AND_HARNESS_UPDATES.md). Kept at ~3× the 15s machine heartbeat so a single
// missed heartbeat doesn't flip a live machine offline.
const ONLINE_THRESHOLD_MS = 45_000

const router = Router()

// Per-router user-keyed rate limiter — applied after auth so req.user is set
const mobileLimiter = rateLimit({
  windowMs: 60_000, max: 300,
  keyGenerator: (req) => req.user?.id ?? req.ip,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many requests, slow down' },
})

// All /mobile/* routes (except command/next) use user JWT auth
router.use(requireUserAuthFast, attachDevice, mobileLimiter)

// ── In-process pair cache — bust on pair/unpair/device-delete ─────────────────
const _pairCache = new Map()

export async function pairedMachineIds(userId, deviceId) {
  const key = `${userId}:${deviceId}`
  const hit  = _pairCache.get(key)
  if (hit && hit.exp > Date.now()) return hit.ids
  let q = db.from('machines').select('id').eq('user_id', userId)
  if (deviceId) q = q.eq('paired_device_id', deviceId)
  const { data } = await q
  const ids = (data ?? []).map(m => m.id)
  _pairCache.set(key, { ids, exp: Date.now() + 60_000 })
  return ids
}

export function bustPairCache(userId, deviceId) {
  if (deviceId) _pairCache.delete(`${userId}:${deviceId}`)
}

// GET /mobile/me — basic identity check (replaces old /mobile/machine)
router.get('/me', (req, res) => {
  res.json({ userId: req.user.id, email: req.user.email })
})

// POST /mobile/realtime-token — sign a Supabase JWT for Realtime auth
// Uses the same SUPABASE_JWT_SECRET — local HS256 sign, no round-trip
router.post('/realtime-token', async (req, res) => {
  const secret = process.env.SUPABASE_JWT_SECRET
  if (!secret) {
    return res.status(500).json({ error: 'SUPABASE_JWT_SECRET not configured' })
  }
  const nowSec = Math.floor(Date.now() / 1000)
  const token  = jwt.sign(
    { sub: req.user.id, role: 'authenticated', iat: nowSec, exp: nowSec + 60 * 60 * 12 },
    secret,
    { algorithm: 'HS256' }
  )
  res.json({ token, expiresAt: nowSec + 60 * 60 * 12 })
})

// ── Sessions ──────────────────────────────────────────────────────────────────

// GET /mobile/sessions — all sessions across paired machines (Pattern A: single join)
router.get('/sessions', async (req, res) => {
  if (!req.deviceId) return res.json([])

  const { data: agents, error } = await db
    .from('agents')
    .select('*, machines!inner(id, label, last_seen, user_id, paired_device_id)')
    .eq('machines.user_id', req.user.id)
    .eq('machines.paired_device_id', req.deviceId)
    .order('last_activity_at', { ascending: false, nullsFirst: false })

  if (error) {
    console.error('[mobile/sessions]', error.message)
    return res.status(500).json({ error: 'Failed to fetch sessions' })
  }

  // Which (machine, harness) pairs currently have mobile support toggled on. The
  // app reads this to disable the composer for a session whose harness isn't
  // enabled on the desktop (mirrors the authoritative block in POST /prompt).
  const machineIds = [...new Set((agents ?? []).map(a => a.machine_id))]
  const enabledSet = new Set()
  if (machineIds.length) {
    const { data: hRows } = await db
      .from('machine_harnesses')
      .select('machine_id, harness, mobile_enabled')
      .in('machine_id', machineIds)
      .eq('mobile_enabled', true)
    for (const h of hRows ?? []) enabledSet.add(`${h.machine_id}:${h.harness}`)
  }

  const now = Date.now()
  const sessions = (agents ?? []).map(agent => ({
    id:                agent.id,
    machine_id:        agent.machine_id,
    machine_label:     agent.machines?.label ?? 'Unknown',
    machine_is_online: agent.machines?.last_seen
      ? (now - new Date(agent.machines.last_seen).getTime()) < ONLINE_THRESHOLD_MS
      : false,
    session_id:        agent.session_id,
    cwd:               agent.cwd,
    harness:           agent.harness ?? 'claude-code',
    cli_alive:         agent.cli_alive !== false,
    harness_enabled:   enabledSet.has(`${agent.machine_id}:${agent.harness ?? 'claude-code'}`),
    status:            deriveStatus(agent.last_activity_at),
    pending_count:     agent.pending_count ?? 0,
    last_activity_at:  agent.last_activity_at,
    started_at:        agent.started_at,
    // Live token usage — durable seed for the mobile compose-bar counter on remount; the
    // live path is the 'usage' broadcast. See TOKEN_USAGE_STREAMING_DESIGN.md.
    turn_tokens_input:    agent.turn_tokens_input    ?? 0,
    turn_tokens_output:   agent.turn_tokens_output   ?? 0,
    session_tokens_input: agent.session_tokens_input ?? 0,
    session_tokens_output:agent.session_tokens_output?? 0,
  }))

  res.json(sessions)
})

// GET /mobile/sessions/:sessionId/requests
router.get('/sessions/:sessionId/requests', async (req, res) => {
  if (!req.deviceId) return res.json([])

  const ids = await pairedMachineIds(req.user.id, req.deviceId)
  if (!ids.length) return res.json([])

  let query = db
    .from('pending_requests')
    .select('*, machines(id, label, is_online)')
    .in('machine_id', ids)
    .eq('session_id', req.params.sessionId)
    .order('created_at', { ascending: false })

  if (req.query.pending === 'true') {
    query = query.eq('status', 'pending')
  }

  const { data, error } = await query.limit(100)

  if (error) {
    console.error('[mobile/sessions/:sessionId/requests]', error.message)
    return res.status(500).json({ error: 'Failed to fetch session requests' })
  }

  res.json((data ?? []).reverse())
})

// GET /mobile/sessions/:sessionId/feed — cursor-paginated unified chat feed
router.get('/sessions/:sessionId/feed', async (req, res) => {
  const sessionId = req.params.sessionId
  const userId    = req.user.id
  const limit     = Math.min(Number(req.query.limit) || 40, 100)

  let beforeTs = null
  let beforeId = null
  if (req.query.before) {
    const cur = String(req.query.before)
    const idx = cur.lastIndexOf('|')
    if (idx > 0) { beforeTs = cur.slice(0, idx); beforeId = cur.slice(idx + 1) }
    else         { beforeTs = cur }
  }

  const { data, error } = await db.rpc('get_session_feed', {
    p_session_id: sessionId,
    p_user_id:    userId,
    p_before_ts:  beforeTs,
    p_before_id:  beforeId,
    p_limit:      limit,
  })

  if (error) {
    console.error('[mobile/feed]', error.message)
    return res.status(500).json({ error: 'Failed to fetch feed' })
  }

  const rowsDesc  = data ?? []
  const hasMore   = rowsDesc.length === limit
  const oldest    = rowsDesc[rowsDesc.length - 1]
  const nextCursor = hasMore && oldest ? `${oldest.created_at}|${oldest.id}` : null

  const items = rowsDesc.slice().reverse().map(r => ({
    source:     r.source,
    id:         r.id,
    created_at: r.created_at,
    row:        r.payload,
  }))

  res.json({ items, nextCursor, hasMore })
})

// ── Requests ──────────────────────────────────────────────────────────────────

// GET /mobile/requests — all pending requests across paired machines
router.get('/requests', async (req, res) => {
  if (!req.deviceId) return res.json([])

  const { data, error } = await db
    .from('pending_requests')
    .select('*, machines!inner(id, label, is_online, user_id, paired_device_id)')
    .eq('machines.user_id', req.user.id)
    .eq('machines.paired_device_id', req.deviceId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[mobile/requests]', error.message)
    return res.status(500).json({ error: 'Failed to fetch requests' })
  }

  res.json(data ?? [])
})

// GET /mobile/requests/:id — single request detail
router.get('/requests/:id', async (req, res) => {
  if (!req.deviceId) return res.status(404).json({ error: 'Request not found' })

  const ids = await pairedMachineIds(req.user.id, req.deviceId)
  if (!ids.length) return res.status(404).json({ error: 'Request not found' })

  const { data, error } = await db
    .from('pending_requests')
    .select('*, machines(id, label, is_online)')
    .eq('id', req.params.id)
    .in('machine_id', ids)
    .single()

  if (error || !data) {
    return res.status(404).json({ error: 'Request not found' })
  }

  res.json(data)
})

// GET /mobile/history — recently decided requests
router.get('/history', async (req, res) => {
  if (!req.deviceId) return res.json([])

  const limit = Math.min(parseInt(req.query.limit) || 50, 200)

  const { data, error } = await db
    .from('pending_requests')
    .select('*, machines!inner(id, label, is_online, user_id, paired_device_id)')
    .eq('machines.user_id', req.user.id)
    .eq('machines.paired_device_id', req.deviceId)
    .in('status', ['approved', 'denied', 'timeout', 'cli_pending', 'answered'])
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[mobile/history]', error.message)
    return res.status(500).json({ error: 'Failed to fetch history' })
  }

  res.json(data ?? [])
})

// POST /mobile/decide — approve or deny a request
// Pattern B: PostgREST UPDATEs cannot join, so scope via cached id list
router.post('/decide', async (req, res) => {
  const { requestId, decision } = req.body

  if (!requestId || !decision) {
    return res.status(400).json({ error: 'requestId and decision are required' })
  }
  if (!['approved', 'denied'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be approved or denied' })
  }
  if (!req.deviceId) {
    return res.status(400).json({ error: 'x-device-id header required' })
  }

  const ids = await pairedMachineIds(req.user.id, req.deviceId)
  if (!ids.length) return res.status(404).json({ error: 'No paired machines' })

  // One round-trip: write + read agent_id back, guarded by status='pending' so a
  // double-decide (race between phone and PC terminal) can't flip it twice. The
  // sooner this UPDATE commits, the sooner Supabase Realtime notifies the desktop
  // hook and other viewers.
  const { data: updated, error } = await db
    .from('pending_requests')
    .update({
      status:     decision,
      decided_at: new Date().toISOString(),
      decided_by: 'mobile',
    })
    .eq('id', requestId)
    .in('machine_id', ids)
    .eq('status', 'pending')
    .select('agent_id, session_id')
    .single()

  if (error && error.code !== 'PGRST116') {
    // PGRST116 = no row matched (already decided / not yours) — treat as 409 below.
    console.error('[mobile/decide]', error.message)
    return res.status(500).json({ error: 'Failed to update decision' })
  }
  if (!updated) {
    return res.status(409).json({ error: 'Already decided or not found' })
  }

  // Respond immediately; keep the pending-count maintenance off the critical path.
  res.json({ ok: true })
  syncAgentPendingCount(updated.agent_id).catch(() => {})
  // Nudge other viewers of this session so the card flips live for them too.
  broadcastSession(updated.session_id, 'feed')
})

// POST /mobile/answer — submit the chosen option(s) for a question request
// Mirrors /mobile/decide, but the "decision" is the picked option(s) instead of
// approved/denied. The status='pending' + kind='question' guards make a double
// answer (phone vs PC terminal) a 409 — first write wins.
router.post('/answer', async (req, res) => {
  const { requestId, answers } = req.body
  // answers: [ { question_index, selected:[{index,label}], custom_text? } ]

  if (!requestId || !Array.isArray(answers) || answers.length === 0) {
    return res.status(400).json({ error: 'requestId and answers are required' })
  }
  if (!req.deviceId) {
    return res.status(400).json({ error: 'x-device-id header required' })
  }

  const ids = await pairedMachineIds(req.user.id, req.deviceId)
  if (!ids.length) return res.status(404).json({ error: 'No paired machines' })

  const { data: updated, error } = await db
    .from('pending_requests')
    .update({
      status:           'answered',
      selected_options: answers,
      decided_at:       new Date().toISOString(),
      decided_by:       'mobile',
    })
    .eq('id', requestId)
    .in('machine_id', ids)
    .eq('kind', 'question')
    .eq('status', 'pending')
    .select('agent_id, session_id')
    .single()

  if (error && error.code !== 'PGRST116') {
    // PGRST116 = no row matched (already answered / not yours) — treat as 409 below.
    console.error('[mobile/answer]', error.message)
    return res.status(500).json({ error: 'Failed to save answer' })
  }
  if (!updated) {
    return res.status(409).json({ error: 'Already answered or not found' })
  }

  res.json({ ok: true })
  syncAgentPendingCount(updated.agent_id).catch(() => {})
  broadcastSession(updated.session_id, 'feed')
})

// GET /mobile/machines — paired machines with inline connection state
router.get('/machines', async (req, res) => {
  const { data, error } = await db
    .from('machines')
    .select('id, label, is_online, last_seen, created_at, paired_device_id, paired_at, mobile_devices(id, device_name, platform)')
    .eq('user_id', req.user.id)
    .order('last_seen', { ascending: false })

  if (error) {
    console.error('[mobile/machines]', error.message)
    return res.status(500).json({ error: 'Failed to fetch machines' })
  }

  const now = Date.now()
  const machines = (data ?? []).map(m => ({
    id:          m.id,
    label:       m.label,
    is_online:   m.last_seen
      ? (now - new Date(m.last_seen).getTime()) < ONLINE_THRESHOLD_MS
      : false,
    last_seen:   m.last_seen,
    created_at:  m.created_at,
    paired_device_id: m.paired_device_id,
    paired_at:   m.paired_at,
    connection:  !m.paired_device_id
      ? 'none'
      : m.paired_device_id === req.deviceId
        ? 'this'
        : 'other',
    paired_device: m.mobile_devices ?? null,
  }))

  res.json(machines)
})

// POST /mobile/push-token — register/update FCM token, now device-scoped
router.post('/push-token', async (req, res) => {
  const { token, platform } = req.body

  if (!token) {
    return res.status(400).json({ error: 'token is required' })
  }
  if (!req.deviceId) {
    return res.status(400).json({ error: 'x-device-id header required' })
  }

  const { error } = await db
    .from('push_tokens')
    .upsert(
      {
        device_id:  req.deviceId,
        user_id:    req.user.id,
        token,
        platform:   platform || 'android',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'token' }
    )

  if (error) {
    console.error('[mobile/push-token]', error.message)
    return res.status(500).json({ error: 'Failed to save push token' })
  }

  // Also keep the device-level push_token up to date
  await db
    .from('mobile_devices')
    .update({ push_token: token, last_active_at: new Date().toISOString() })
    .eq('id', req.deviceId)
    .eq('user_id', req.user.id)

  res.json({ ok: true })
})

// ── Stop (interrupt an in-flight turn) ──────────────────────────────────────────
// This does NOT kill the harness CLI process — it only interrupts the current
// turn (ESC for Claude Code, session.abort() for OpenCode, ESC into the PTY for
// Gemini CLI), same as pressing Esc yourself. See STOP_AGENT_DESIGN.md.

// POST /mobile/sessions/:sessionId/stop — interrupt an active turn
router.post('/sessions/:sessionId/stop', async (req, res) => {
  const { sessionId } = req.params

  const ids = req.deviceId ? await pairedMachineIds(req.user.id, req.deviceId) : []
  const { data: agent } = await db
    .from('agents')
    .select('machine_id, cli_alive, harness')
    .eq('session_id', sessionId)
    .single()

  if (!agent || (ids.length && !ids.includes(agent.machine_id))) {
    return res.status(403).json({ error: 'Session not found or access denied' })
  }
  if (agent.cli_alive === false) {
    return res.status(409).json({ error: 'CLI closed', code: 'cli_closed' })
  }

  const { data, error } = await db
    .from('stop_requests')
    .insert({
      session_id: sessionId,
      machine_id: agent.machine_id,
      user_id:    req.user.id,
      harness:    agent.harness ?? 'claude-code',
    })
    .select('id')
    .single()

  if (error) {
    console.error('[mobile/stop]', error.message)
    return res.status(500).json({ error: 'Failed to queue stop request' })
  }

  // Same fast-path used for prompt delivery — wakes heartbeat.js in ~1s.
  // Payload carries harness so heartbeat can dispatch without an extra round trip.
  broadcastMachine(agent.machine_id, 'stop_requested', { sessionId, harness: agent.harness })

  res.json({ id: data.id })
})

// ── Prompt injection ──────────────────────────────────────────────────────────

// POST /mobile/prompt — queue a prompt for delivery
router.post('/prompt', async (req, res) => {
  const { prompt, sessionId } = req.body

  if (!prompt) {
    return res.status(400).json({ error: 'prompt is required' })
  }

  const ids = req.deviceId ? await pairedMachineIds(req.user.id, req.deviceId) : []

  let targetMachineId = ids[0] ?? null
  if (sessionId) {
    const { data: agent } = await db
      .from('agents')
      .select('machine_id, cli_alive, harness, last_activity_at')
      .eq('session_id', sessionId)
      .single()

    if (!agent || (ids.length && !ids.includes(agent.machine_id))) {
      return res.status(403).json({ error: 'Session not found or access denied' })
    }

    if (agent.cli_alive === false) {
      return res.status(409).json({ error: 'CLI closed', code: 'cli_closed' })
    }

    // Mobile support for this harness must be toggled ON on the desktop. If the
    // user never enabled (or has since disabled) mobile mode for this harness, the
    // desktop hasn't installed the hooks that inject prompts — so a queued prompt
    // would silently go nowhere. Block here with a clear reason instead.
    const harness = agent.harness ?? 'claude-code'
    const { data: hRow } = await db
      .from('machine_harnesses')
      .select('mobile_enabled')
      .eq('machine_id', agent.machine_id)
      .eq('harness', harness)
      .maybeSingle()

    if (!hRow?.mobile_enabled) {
      return res.status(409).json({
        error: `Mobile support for ${harness} is turned off on the desktop`,
        code:  'harness_disabled',
      })
    }

    // Block sending into a session that's mid-turn — the only mobile action while
    // busy is Stop (POST /mobile/sessions/:id/stop), not queuing a follow-up prompt.
    // Reuses the same recency heuristic already exposed to mobile as agents.status.
    if (deriveStatus(agent.last_activity_at) === 'active') {
      return res.status(409).json({
        error: 'Agent is currently working — stop it or wait before sending a new prompt',
        code:  'session_busy',
      })
    }

    targetMachineId = agent.machine_id
  }

  if (!targetMachineId) {
    return res.status(400).json({ error: 'No paired machine found' })
  }

  const { data, error } = await db
    .from('mobile_commands')
    .insert({
      machine_id: targetMachineId,
      user_id:    req.user.id,
      session_id: sessionId ?? null,
      prompt,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[mobile/prompt]', error.message)
    return res.status(500).json({ error: 'Failed to queue prompt' })
  }

  // Nudge the chat so the sent prompt bubble appears live for any viewer.
  broadcastSession(sessionId, 'feed')

  // Wake the desktop relay instantly. Broadcast is reliable where postgres_changes is
  // silently dropped on this self-hosted Supabase, so the daemon claims + injects in
  // ~1s instead of waiting for its backstop poll. Payload carries only the sessionId
  // (never prompt text) on the un-RLS'd topic. See FAST_PROMPT_DELIVERY_DESIGN.md.
  broadcastMachine(targetMachineId, 'command_available', { sessionId: sessionId ?? null })

  res.json({ id: data.id })
})

// GET /mobile/prompts — list recent prompts
router.get('/prompts', async (req, res) => {
  if (!req.deviceId) return res.json([])

  const ids = await pairedMachineIds(req.user.id, req.deviceId)
  if (!ids.length) return res.json([])

  const { data, error } = await db
    .from('mobile_commands')
    .select('id, session_id, prompt, status, created_at, delivered_at')
    .in('machine_id', ids)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    console.error('[mobile/prompts]', error.message)
    return res.status(500).json({ error: 'Failed to fetch prompts' })
  }

  res.json(data ?? [])
})

// DELETE /mobile/prompt/:id — cancel a prompt
router.delete('/prompt/:id', async (req, res) => {
  const { error } = await db
    .from('mobile_commands')
    .update({ status: 'cancelled' })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .eq('status', 'pending')

  if (error) {
    console.error('[mobile/prompt DELETE]', error.message)
    return res.status(500).json({ error: 'Failed to cancel prompt' })
  }

  res.json({ ok: true })
})

// GET /mobile/command/next — relay daemon (STAYS machine-key auth)
// This is called by heartbeat.js — we break out of the user-auth middleware above
// by defining this route on a separate mini-router mounted at the same path.
// Note: the router.use(requireUserAuthFast) at top covers all routes defined on
// this router — so we need the relay daemon to call a different endpoint.
// The route is intentionally kept here as a reminder; the actual machine-key
// route is registered BELOW after the export, by index.js mounting it separately
// at /mobile/command/next via relayRouter. See index.js comment.

// GET /mobile/terminal
router.get('/terminal', async (req, res) => {
  const { session_id, limit = 60 } = req.query

  if (!req.deviceId) return res.json({ events: [] })

  const ids = await pairedMachineIds(req.user.id, req.deviceId)
  if (!ids.length) return res.json({ events: [] })

  let query = db
    .from('terminal_events')
    .select('*')
    .eq('user_id', req.user.id)
    .in('machine_id', ids)
    .order('created_at', { ascending: false })
    .limit(Math.min(Number(limit), 200))

  if (session_id) query = query.eq('session_id', session_id)

  const { data, error } = await query

  if (error) {
    console.error('[mobile/terminal]', error.message)
    return res.status(500).json({ error: 'Failed to fetch terminal events' })
  }

  res.json({ events: (data ?? []).reverse() })
})

// ── File browser ──────────────────────────────────────────────────────────────

// POST /mobile/fs/request
router.post('/fs/request', async (req, res) => {
  const { path = '.', sessionId } = req.body

  if (!req.deviceId) return res.status(400).json({ error: 'x-device-id header required' })

  const ids = await pairedMachineIds(req.user.id, req.deviceId)
  let targetMachineId = ids[0] ?? null

  if (sessionId) {
    const { data: agent } = await db
      .from('agents')
      .select('machine_id')
      .eq('session_id', sessionId)
      .single()

    if (agent && ids.includes(agent.machine_id)) {
      targetMachineId = agent.machine_id
    }
  }

  if (!targetMachineId) {
    return res.status(400).json({ error: 'No paired machine found' })
  }

  const { data, error } = await db
    .from('fs_requests')
    .insert({
      machine_id: targetMachineId,
      session_id: sessionId ?? null,
      path,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[mobile/fs/request]', error.message)
    return res.status(500).json({ error: 'Failed to create fs request' })
  }

  res.json({ requestId: data.id })
})

// GET /mobile/fs/result/:requestId
router.get('/fs/result/:requestId', async (req, res) => {
  if (!req.deviceId) return res.status(404).json({ error: 'Request not found' })

  const ids = await pairedMachineIds(req.user.id, req.deviceId)
  if (!ids.length) return res.status(404).json({ error: 'Request not found' })

  const { data, error } = await db
    .from('fs_requests')
    .select('status, result, error')
    .eq('id', req.params.requestId)
    .in('machine_id', ids)
    .single()

  if (error || !data) {
    return res.status(404).json({ error: 'Request not found' })
  }

  res.json(data)
})

// DELETE /mobile/sessions/:sessionId — the router is mounted at /mobile, so the path here is
// RELATIVE (`/sessions/...`), matching the sibling routes above (e.g. /sessions/:sessionId/stop).
// Removes the session row plus its related feed / requests / queued prompts, all user-scoped.
router.delete('/sessions/:sessionId', async (req, res) => {
  const { sessionId } = req.params
  const userId = req.user.id

  try {
    // Best-effort cleanup of the session's related rows so nothing lingers after deletion.
    for (const table of ['terminal_events', 'pending_requests', 'mobile_commands']) {
      const { error } = await db.from(table).delete()
        .eq('user_id', userId)
        .eq('session_id', sessionId)
      if (error) console.error(`[mobile/delete-session] ${table}:`, error.message)
    }

    // Authoritative: remove the agent/session row (this is what the sessions list is built from).
    const { error } = await db.from('agents').delete()
      .eq('session_id', sessionId)
    if (error) throw error

    return res.json({ ok: true })
  } catch (err) {
    console.error('[mobile/delete-session]', err.message)
    return res.status(500).json({ error: err.message })
  }
})

export { _pairCache }
export default router
