/**
 * harness-sdk/transport.js — the ONE place adapters talk to the outside world.
 *
 * Every harness, regardless of its interception mechanism, uses these helpers so
 * that the VPS contract (/relay/*, /harness/*) lives in exactly one file. The
 * Supabase service key never touches this machine — all writes carry the machine
 * API key and go through the Express backend (insight25.lk).
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { machineCtx } from './env.js'

const pexec = promisify(execFile)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── CLI detection helpers ───────────────────────────────────────────────────────
// shell:true is required on Windows so that npm-global bins (%APPDATA%\npm) are
// found. Without it, execFile inherits a stripped PATH from the Node/Electron
// process and returns ENOENT for any CLI not on the system PATH.
const SHELL_OPTS = { timeout: 8000, windowsHide: true, shell: process.platform === 'win32' }

export async function commandExists(cmd, args = ['--version']) {
  try { await pexec(cmd, args, SHELL_OPTS); return true }
  catch { return false }
}

export async function getVersion(cmd, args = ['--version']) {
  try {
    const { stdout } = await pexec(cmd, args, SHELL_OPTS)
    return (stdout || '').trim().split('\n')[0] || null
  } catch { return null }
}

// ── HTTP to the VPS ──────────────────────────────────────────────────────────────
async function apiPost(path, body) {
  const { apiUrl, machineApiKey } = machineCtx()
  if (!apiUrl) throw new Error('No API_URL configured (machine not registered)')
  const res = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-machine-api-key': machineApiKey },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.status)
    throw new Error(`POST ${path} failed: ${text}`)
  }
  return res.json().catch(() => ({}))
}

async function apiGet(path) {
  const { apiUrl, machineApiKey } = machineCtx()
  if (!apiUrl) return null
  const res = await fetch(`${apiUrl}${path}`, { headers: { 'x-machine-api-key': machineApiKey } })
  if (!res.ok) return null
  return res.json().catch(() => null)
}

// ── Canonical operations every strategy may use ──────────────────────────────────

/** Upload a normalized RelayRequest. Returns the server-assigned id. */
export async function uploadRequest(row) {
  const { id } = await apiPost('/relay/upload', { payload: row })
  return id ?? row.id
}

/**
 * Block until a request is approved/denied, or timeout.
 * Plain polling (no Realtime dependency) so it works from any process — including
 * a short-lived PTY proxy. Returns 'approved' | 'denied'.
 */
export async function pollDecision(requestId, opts = {}) {
  const { timeoutMs = 300000, intervalMs = 1500, failOpen = true } = opts
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await sleep(intervalMs)
    const s = await apiGet(`/relay/status/${requestId}`).catch(() => null)
    if (s?.status === 'approved') return 'approved'
    if (s?.status === 'denied')   return 'denied'
  }
  return failOpen ? 'approved' : 'denied'   // fail-open/closed is per-strategy policy
}

/** Stream a narrative/terminal event. */
export async function postNarrative(evt) {
  return apiPost('/relay/terminal-event', evt)
}

/** Push the machine's harness inventory + state to the server (mobile reads it). */
export async function reportHarness(harnesses) {
  return apiPost('/harness/report', { harnesses })
}

/** Read any phone-requested toggle (desired_enabled) for this machine. */
export async function getDesired() {
  return (await apiGet('/harness/desired')) || []
}

// ── Stop requests (interrupt an in-flight turn) ───────────────────────────────
// Used by strategies that run outside heartbeat.js's process (e.g. the PTY-proxy
// wrapper for Gemini CLI) and need to poll for a stop themselves. See
// STOP_AGENT_DESIGN.md. Pass a sessionId to scope the poll to a single session.
export async function pollStopRequests(sessionId) {
  const qs = sessionId ? `?session=${encodeURIComponent(sessionId)}` : ''
  const data = await apiGet(`/relay/stop-requests${qs}`)
  return data?.requests ?? []
}

export async function ackStopRequests(ids) {
  if (!ids?.length) return
  return apiPost('/relay/stop-ack', { ids })
}
