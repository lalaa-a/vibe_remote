import { createClient } from '@supabase/supabase-js'
import { config }        from './config.js'

// Anon client — used only for Realtime subscriptions (read-only)
export const supabase = createClient(config.supabaseUrl, config.supabaseKey, {
  auth:     { persistSession: false },
  realtime: { params: { eventsPerSecond: 10 } },
})

// ── VPS API helpers ───────────────────────────────────────────────────────────
// All writes go through the VPS backend. The service key never lives on this machine.

async function apiPost(path, body) {
  const res = await fetch(`${config.apiUrl}${path}`, {
    method:  'POST',
    headers: {
      'Content-Type':       'application/json',
      'x-machine-api-key':  config.machineApiKey,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.status)
    throw new Error(`VPS ${path} failed: ${text}`)
  }
  return res.json()
}

async function apiGet(path) {
  const res = await fetch(`${config.apiUrl}${path}`, {
    headers: { 'x-machine-api-key': config.machineApiKey },
  })
  if (!res.ok) return null
  return res.json()
}

// ── Upsert agent/session row ──────────────────────────────────────────────────
export async function agentPing(sessionId, cwd, toolName) {
  return apiPost('/relay/agent-ping', { sessionId, cwd, toolName })
}

// ── Keepalive: refresh only last_activity_at (no upsert) ──────────────────────
// Called by the heartbeat while a turn is in flight so the server keeps deriving
// status='active' through long reasoning phases and long single tools — the window
// where mobile used to briefly see 'idle' and unlock the composer mid-turn. Unlike
// agentPing this never touches cwd/harness, so it can't clobber them with nulls.
export async function agentTouch(sessionId) {
  return apiPost('/relay/agent-touch', { sessionId })
}

// ── Live token usage for the current turn ─────────────────────────────────────
// Absolute running totals (never deltas) so a dropped POST/broadcast self-heals on the
// next one. The server persists them on the agent row and broadcasts a 'usage' event for
// the mobile compose-bar counter. See TOKEN_USAGE_STREAMING_DESIGN.md.
export async function postUsage(usage) {
  return apiPost('/relay/usage', usage)
}

// ── Fetch next pending mobile command (idle-gated on server) ─────────────────
// Pass a sessionId to scope the claim to that session — the desktop does this when it
// knows that CLI is idle. command/next atomically marks the row delivered, so we must
// only claim what we can inject right now. See FAST_PROMPT_DELIVERY_DESIGN.md.
export async function getNextCommand(sessionId) {
  const qs = sessionId ? `?session=${encodeURIComponent(sessionId)}` : ''
  return apiGet(`/mobile/command/next${qs}`)
}

// ── File tree ─────────────────────────────────────────────────────────────────
export async function getPendingFsRequest() {
  return apiGet('/machines/fs/pending')
}

export async function respondFsRequest(requestId, treeOrError) {
  return apiPost('/machines/fs/respond', { requestId, ...treeOrError })
}

// ── Upload a pending request row ──────────────────────────────────────────────
export async function uploadRequest(row) {
  return apiPost('/relay/upload', { payload: row })
}

// ── Mark a request decided — used when PC terminal responds first ─────────────
export async function markDecided(requestId, status, decidedBy = null) {
  return apiPost('/relay/decide', { requestId, decision: status })
}

// ── Stop requests (interrupt an in-flight turn) ───────────────────────────────
// Poll backstop for the stop_requested broadcast — see STOP_AGENT_DESIGN.md.
// Pass a sessionId to scope the poll to a single session; omit for an unscoped
// sweep of every pending stop request on this machine.
export async function pollStopRequests(sessionId) {
  const qs = sessionId ? `?session=${encodeURIComponent(sessionId)}` : ''
  const data = await apiGet(`/relay/stop-requests${qs}`)
  return data?.requests ?? []
}

export async function ackStopRequests(ids) {
  if (!ids?.length) return
  return apiPost('/relay/stop-ack', { ids })
}

// ── Update machine heartbeat ──────────────────────────────────────────────────
export async function heartbeat() {
  return apiPost('/machines/heartbeat', {})
}

// ── Report which session CLIs are still alive on this machine ─────────────────
export async function reportSessionsAlive(aliveSessionIds) {
  return apiPost('/relay/sessions-alive', { aliveSessionIds })
}

// ── Mark machine offline (called on clean shutdown) ───────────────────────────
export async function markOffline() {
  return apiPost('/machines/offline', {})
}

// ── Post a terminal lifecycle event (tool_start/tool_end/notification/stop) ──
// A turn-end `stop` is the ONE event the mobile can't recover on its own — if it's lost (the
// desktop was offline at the instant the turn ended) the phone is stuck showing "working". So
// when a `stop` POST fails, we persist it to a local queue and the heartbeat re-sends it on
// reconnect (STALE_WORKING_ON_DISCONNECT_DESIGN.md §3-C). Other event types are transient and
// not worth queueing. writeFileSync is synchronous so the queue survives even if the calling
// process (a short-lived Claude hook) exits immediately after.
const PENDING_DIR = () => runtimePath('pending-events')

export async function postTerminalEvent(payload) {
  try {
    return await apiPost('/relay/terminal-event', payload)
  } catch (err) {
    if (payload?.event_type === 'stop') {
      try {
        mkdirSync(PENDING_DIR(), { recursive: true })
        writeFileSync(join(PENDING_DIR(), `${randomUUID()}.json`), JSON.stringify(payload))
      } catch {}
    }
    throw err
  }
}

// Re-send any queued turn-end events. Called by the heartbeat on a timer; a delivered event is
// removed, a still-failing one is left for the next flush.
export async function flushPendingEvents() {
  let files
  try { files = readdirSync(PENDING_DIR()) } catch { return }
  for (const f of files) {
    if (!f.endsWith('.json')) continue
    const full = join(PENDING_DIR(), f)
    let payload
    try { payload = JSON.parse(readFileSync(full, 'utf8')) }
    catch { try { unlinkSync(full) } catch {}; continue }      // corrupt → drop
    try {
      await apiPost('/relay/terminal-event', payload)
      try { unlinkSync(full) } catch {}                        // delivered
    } catch { /* still offline — keep it for the next flush */ }
  }
}

// ── Block until someone approves / denies, or timeout ────────────────────────
// Returns { decision: 'approved'|'denied'|'timeout', decidedBy: 'pc'|'mobile'|null }
//
// Realtime is the fast path. Polling runs in parallel as a guaranteed fallback
// because Supabase Realtime can silently drop events (RLS on anon key, replication
// not enabled on the table, transient WebSocket issues) without ever emitting
// CHANNEL_ERROR — meaning the old "poll only on error" approach never triggered.
export function waitForDecision(requestId) {
  return new Promise((resolve) => {
    let settled    = false
    let pollInterval = null

    function finish(decision, decidedBy = null) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearInterval(pollInterval)
      try { channel.unsubscribe() } catch {}
      resolve({ decision, decidedBy })
    }

    const timer = setTimeout(() => finish('timeout', null), config.timeoutMs)

    // Realtime — fast path, fires immediately when the event is delivered
    const channel = supabase
      .channel('decision:' + requestId)
      .on(
        'postgres_changes',
        {
          event:  'UPDATE',
          schema: 'public',
          table:  'pending_requests',
          filter: `id=eq.${requestId}`,
        },
        (payload) => {
          const status    = payload.new?.status
          const decidedBy = payload.new?.decided_by || 'mobile'
          if (status === 'approved' || status === 'denied') {
            finish(status, decidedBy)
          }
        },
      )
      .subscribe()

    // Polling — reconnect backstop only. Realtime above is the primary path and
    // lands the decision in <1s on a healthy socket; this 25s poll just covers a
    // silently-dropped WebSocket. (Was 3s — that hammered the API for no benefit
    // while Realtime was working.)
    pollInterval = setInterval(async () => {
      try {
        const res = await fetch(
          `${config.apiUrl}/relay/status/${requestId}`,
          { headers: { 'x-machine-api-key': config.machineApiKey } }
        )
        if (!res.ok) return
        const data = await res.json()
        if (data?.status === 'approved' || data?.status === 'denied') {
          finish(data.status, data.decided_by || 'mobile')
        }
      } catch {}
    }, 25_000)
  })
}

// ── Block until the user picks an option for a question request, or timeout ───
// Sibling to waitForDecision, for kind='question' rows. Resolves when the row's
// status flips to 'answered' (carrying selected_options), or when the PC terminal
// drops a local signal file (relay.cjs answer <n>). Returns:
//   { selected_options: [...] }  — the picked option(s)
//   { timeout: true }            — no answer within config.timeoutMs
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, readdirSync } from 'fs'
import { join }                                            from 'path'
import { randomUUID }                                      from 'crypto'
import { runtimePath }                                     from './paths.js'

const QUESTION_PENDING_DIR = runtimePath('relay-pending')

export function waitForAnswer(requestId) {
  return new Promise((resolve) => {
    let settled = false, pollInterval = null, filePoll = null
    const answerFile = join(QUESTION_PENDING_DIR, `${requestId}.answer.json`)

    function finish(payload) {
      if (settled) return
      settled = true
      clearTimeout(timer); clearInterval(pollInterval); clearInterval(filePoll)
      try { channel.unsubscribe() } catch {}
      try { unlinkSync(answerFile) } catch {}
      resolve(payload)
    }

    const timer = setTimeout(() => finish({ timeout: true }), config.timeoutMs)

    // Realtime — fast path: the row flips to status='answered'.
    const channel = supabase
      .channel('decision:' + requestId)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'pending_requests', filter: `id=eq.${requestId}` },
        (payload) => {
          if (payload.new?.status === 'answered') {
            finish({ selected_options: payload.new.selected_options })
          }
        })
      .subscribe()

    // Backstop poll — covers a silently-dropped WebSocket. /relay/status now
    // returns selected_options (server migration 011 + route change).
    pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`${config.apiUrl}/relay/status/${requestId}`,
          { headers: { 'x-machine-api-key': config.machineApiKey } })
        if (!res.ok) return
        const data = await res.json()
        if (data?.status === 'answered') finish({ selected_options: data.selected_options })
      } catch {}
    }, 25_000)

    // Local terminal fallback — relay.cjs writes {id}.answer.json (selected_options).
    try {
      mkdirSync(QUESTION_PENDING_DIR, { recursive: true })
      filePoll = setInterval(() => {
        try {
          if (!existsSync(answerFile)) return
          const parsed = JSON.parse(readFileSync(answerFile, 'utf8'))
          finish({ selected_options: parsed.selected_options ?? parsed })
        } catch {}
      }, 150)
    } catch {}
  })
}
