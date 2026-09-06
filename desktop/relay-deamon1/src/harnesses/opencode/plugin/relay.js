/**
 * Vibe Remote — OpenCode relay plugin.
 *
 * Installed into ~/.config/opencode/plugin/vibe-relay.js — OpenCode auto-loads it.
 * Three responsibilities:
 *   1. Gate gated tool calls through the phone (tool.execute.before → approve/deny)
 *   2. Stream reasoning text to the phone as terminal_events (event hook)
 *   3. Post tool_start / tool_end events so activity bubbles appear in the chat
 *
 * The SDK event stream in the daemon (opencode/provider.js narrator) was the original
 * narrative path, but it is never started because the heartbeat only handles Claude
 * Code. Emitting narrative directly from the plugin is simpler and self-contained.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'

const PLUGIN_DIR = path.join(os.homedir(), '.config', 'opencode', 'plugin')
const FLAG_FILE  = path.join(os.homedir(), '.config', 'opencode', '.vibe-mobile-on')
const ENV_FILE   = path.join(PLUGIN_DIR, 'vibe-relay.env.json')

function env() {
  try { return JSON.parse(fs.readFileSync(ENV_FILE, 'utf8')) } catch { return {} }
}

// Map OpenCode tool names → canonical schema + a short summary.
function summarize(tool, args = {}) {
  switch (tool) {
    case 'bash':
      return { tool_name: 'bash', display_type: 'command', command: args.command || '',
               summary: (args.command || '').slice(0, 120) }
    case 'edit':
      return { tool_name: 'edit', display_type: 'edit', file_path: args.filePath || args.path || '',
               summary: `Edit ${args.filePath || args.path || ''}` }
    case 'write':
      return { tool_name: 'write', display_type: 'write', file_path: args.filePath || args.path || '',
               summary: `Write ${args.filePath || args.path || ''}` }
    case 'patch':
      return { tool_name: 'patch', display_type: 'edit', summary: 'Apply patch' }
    default:
      return { tool_name: 'unknown', display_type: 'unknown', summary: tool }
  }
}

async function uploadAndWait(e, row) {
  const res = await fetch(`${e.apiUrl}/relay/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-machine-api-key': e.machineApiKey },
    body: JSON.stringify({ payload: row }),
  })
  if (!res.ok) throw new Error(`upload failed ${res.status}`)
  const { id } = await res.json()

  const deadline = Date.now() + (e.timeoutMs || 300000)
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500))
    const s = await fetch(`${e.apiUrl}/relay/status/${id}`, {
      headers: { 'x-machine-api-key': e.machineApiKey },
    }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    if (s?.status === 'approved') return true
    if (s?.status === 'denied')   return false
  }
  return e.failOpen !== false   // honor the machine's fail-open/closed policy
}

// Upload a kind='question' request and block until the mobile user picks an option.
// Mirrors uploadAndWait but resolves on status='answered' and returns the chosen
// selected_options (or null on timeout). Reuses the exact same harness-agnostic
// /relay/upload + /relay/status pipeline the Claude Code question flow already uses.
async function uploadAndWaitAnswer(e, row) {
  const res = await fetch(`${e.apiUrl}/relay/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-machine-api-key': e.machineApiKey },
    body: JSON.stringify({ payload: row }),
  })
  if (!res.ok) throw new Error(`upload failed ${res.status}`)
  const { id } = await res.json()

  const deadline = Date.now() + (e.timeoutMs || 300000)
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500))
    const s = await fetch(`${e.apiUrl}/relay/status/${id}`, {
      headers: { 'x-machine-api-key': e.machineApiKey },
    }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    if (s?.status === 'answered') return s.selected_options || []
  }
  return null   // no answer within the timeout
}

// Turn the structured selection into a natural-language string the model reads as
// the tool's result (the OpenCode analogue of Claude's block-reason answer).
function formatAnswer(questions, selected_options) {
  const parts = (selected_options || []).map((ans) => {
    const q = questions[ans.question_index] ?? questions[0]
    const labels = (ans.selected || []).map((s) => `"${s.label}"`).join(', ')
    const custom = ans.custom_text ? ` (custom answer: "${ans.custom_text}")` : ''
    return `Q: "${q?.question}" → The user selected: ${labels || ans.custom_text}${custom}.`
  })
  return `[Answered remotely via mobile] ${parts.join(' ')} Proceed with this choice.`
}

const GATED = new Set(['bash', 'edit', 'write', 'patch'])

// ── Native-permission ↔ tool-gate dedup ───────────────────────────────────────
// Two gates can fire for the same call: tool.execute.before (gates the write tools, which are
// "allow" by default so this is their only gate) and the permission.updated handler (gates
// whatever OpenCode's config sets to "ask"). In the default config they never overlap. But if a
// user sets a GATED tool (bash/edit/…) to "ask", BOTH fire — so each stamps a map on approval and
// the other skips a call it already handled, preventing a double phone prompt (either order).
const _gatedByTool = new Map()   // `${sessionID}:${tool}` → ts, set by tool.execute.before
const _gatedByPerm = new Map()   // `${sessionID}:${tool}` → ts, set by permission.updated
function stampRecent(map, key) { map.set(key, Date.now()) }
function takeRecent(map, key, ms = 15000) {
  const ts = map.get(key)
  if (ts && Date.now() - ts < ms) { map.delete(key); return true }
  return false
}

// Respond to an OpenCode permission request: POST /session/{id}/permissions/{permissionID}
// body { response: 'once' | 'always' | 'reject' }. Mirrors replyNativeQuestion — try the typed
// client, then a direct HTTP POST (root path, then /api) via the plugin's serverUrl.
async function respondPermission({ serverUrl, client, sessionID, permissionID, response }) {
  try {
    if (client?.postSessionByIdPermissionsByPermissionId) {
      await client.postSessionByIdPermissionsByPermissionId({ path: { id: sessionID, permissionID }, body: { response } })
      dbg(`permission replied via client (${response})`)
      return true
    }
  } catch (err) { dbg(`client permission respond failed: ${err.message}`) }

  if (!serverUrl) { dbg('respondPermission: no serverUrl'); return false }
  const base = String(serverUrl).replace(/\/+$/, '')
  for (const url of [
    `${base}/session/${sessionID}/permissions/${permissionID}`,
    `${base}/api/session/${sessionID}/permissions/${permissionID}`,
  ]) {
    try {
      const res = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ response }),
      })
      dbg(`permission respond POST ${url} → ${res.status}`)
      if (res.ok) return true
    } catch (err) { dbg(`permission respond POST ${url} failed: ${err.message}`) }
  }
  return false
}

// Track which sessions we've already pinged so we only do it once per session
// rather than on every tool call (the ping is just to register the agent row).
const _pingedSessions = new Set()

async function agentPing(e, sessionID, cwd) {
  if (!sessionID || _pingedSessions.has(sessionID)) return
  try {
    const res = await fetch(`${e.apiUrl}/relay/agent-ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-machine-api-key': e.machineApiKey },
      body: JSON.stringify({ sessionId: sessionID, cwd: cwd ?? null, harness: 'opencode' }),
    })
    // Only cache as "pinged" once the agents row was actually created. Previously we marked it
    // BEFORE the fetch, so a single failed ping meant the session was never created and never
    // retried. That surfaced when the permission handler began pinging early (before any
    // narrative). Leaving it uncached on failure lets the next event retry.
    if (res.ok) { _pingedSessions.add(sessionID); dbg(`agent-ping ok ${sessionID}`) }
    else dbg(`agent-ping ${sessionID} → HTTP ${res.status} (will retry)`)
  } catch (err) {
    dbg(`agent-ping failed ${sessionID}: ${err.message} (will retry)`)
  }
}

// ── Debug log (helps diagnose why narrative may not appear) ───────────────────
const DEBUG_LOG = path.join(os.homedir(), '.config', 'opencode', 'vibe-relay-debug.log')
function dbg(msg) {
  try { fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] ${msg}\n`) } catch {}
}

// ── Record this OpenCode process's PID so the heartbeat can inject prompts into
// THIS terminal (same scheme Claude's hook.js uses). OpenCode is a single binary
// that owns the console, so process.pid is exactly the process to target. The
// heartbeat reads <runtime>/relay-pid-<sessionId>.txt (runtime dir below) and injects there.
// Runtime dir — MUST match RUNTIME_DIR in relay-deamon1/src/paths.js. This file is
// copied out to OpenCode's plugin dir, so it can't import paths.js — keep the formula in sync.
function relayRuntimeDir() {
  const local = process.platform === 'win32'
    ? path.join(os.homedir(), 'AppData', 'Local')
    : process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : path.join(os.homedir(), '.local', 'share')
  return path.join(local, 'VibeRemote', 'runtime')
}
const PID_DIR = relayRuntimeDir()
const _pidWritten = new Set()
function recordPid(sessionId) {
  if (!sessionId || process.platform !== 'win32' || _pidWritten.has(sessionId)) return
  _pidWritten.add(sessionId)
  try {
    fs.mkdirSync(PID_DIR, { recursive: true })
    fs.writeFileSync(path.join(PID_DIR, `relay-pid-${sessionId}.txt`), String(process.pid))
    dbg(`recorded pid ${process.pid} for session ${sessionId}`)
  } catch (err) {
    dbg(`recordPid failed: ${err.message}`)
  }
}

// Remove the PID files for sessions this process recorded — called on dispose
// (OpenCode shutting down) so the heartbeat sees the CLI as closed and resumes
// future prompts in a fresh window instead of injecting into a dead terminal.
function clearPids() {
  for (const sessionId of _pidWritten) {
    try { fs.unlinkSync(path.join(PID_DIR, `relay-pid-${sessionId}.txt`)) } catch {}
  }
  dbg(`cleared ${_pidWritten.size} pid file(s) on dispose`)
}

// ── Busy/idle flags for fast prompt delivery (mirrors the Claude hook scheme) ──
// While a turn is in flight we write relay-busy-<sessionId>.flag so the heartbeat won't
// inject a queued prompt mid-turn; on session.idle we delete it and drop a relay-ready
// flag so the heartbeat injects within ~1s. See FAST_PROMPT_DELIVERY_DESIGN.md.
function markBusyOC(sessionId) {
  if (!sessionId || process.platform !== 'win32') return
  try { fs.writeFileSync(path.join(PID_DIR, `relay-busy-${sessionId}.flag`), String(Date.now())) } catch {}
}
function readyOC(sessionId) {
  if (!sessionId || process.platform !== 'win32') { dbg(`readyOC skipped — sid=${sessionId}`); return }
  try { fs.unlinkSync(path.join(PID_DIR, `relay-busy-${sessionId}.flag`)) } catch {}
  try { fs.writeFileSync(path.join(PID_DIR, `relay-ready-${sessionId}.flag`), '1') } catch {}
  dbg(`session.idle → cleared busy + ready flag for ${sessionId}`)
}

// ── Answer the NATIVE OpenCode `question` tool ────────────────────────────────
// OpenCode emits `question.asked` and suspends the tool on a Deferred until something
// calls question.reply(). The runtime UI does this via client.question.reply(); the
// installed plugin SDK (1.16.2) has no `question` namespace, so we POST directly to the
// server. Route (matches the SDK convention, no /api prefix):
//   POST {serverUrl}/session/{sessionID}/question/{requestID}/reply   body { answers }
// answers = ReadonlyArray<string[]> — one array of selected LABELS per question.
// See opencode-question-tool-internals.md.
async function replyNativeQuestion({ serverUrl, client, sessionID, requestID, directory, answers }) {
  // 1) Typed client first (future SDK versions that expose .question).
  try {
    if (client?.question?.reply) {
      await client.question.reply({ path: { sessionID, requestID }, body: { answers }, query: directory ? { directory } : undefined })
      dbg(`native question replied via client.question.reply`)
      return true
    }
  } catch (err) { dbg(`client.question.reply failed: ${err.message}`) }

  // 2) Direct HTTP POST (1.16.2 client lacks .question). Try the root path, then /api.
  if (!serverUrl) { dbg('replyNativeQuestion: no serverUrl'); return false }
  const base = String(serverUrl).replace(/\/+$/, '')
  const dq   = directory ? `?directory=${encodeURIComponent(directory)}` : ''
  for (const url of [
    `${base}/session/${sessionID}/question/${requestID}/reply${dq}`,
    `${base}/api/session/${sessionID}/question/${requestID}/reply${dq}`,
  ]) {
    try {
      const res = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ answers }),
      })
      dbg(`native question reply POST ${url} → ${res.status}`)
      if (res.ok) return true
    } catch (err) { dbg(`native question reply POST ${url} failed: ${err.message}`) }
  }
  return false
}

// ── Shared terminal-event helper ──────────────────────────────────────────────
async function postTerminalEvent(e, payload) {
  if (!e.apiUrl) { dbg('postTerminalEvent skipped — no apiUrl'); return }
  try {
    const res = await fetch(`${e.apiUrl}/relay/terminal-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-machine-api-key': e.machineApiKey },
      body: JSON.stringify({ ...payload, harness: 'opencode' }),
    })
    dbg(`POST terminal-event ${payload.event_type} session=${payload.session_id} → ${res.status}`)
  } catch (err) {
    dbg(`POST terminal-event FAILED: ${err.message}`)
  }
}

// ── Live token usage (TOKEN_USAGE_STREAMING_DESIGN.md) ────────────────────────
async function postUsage(e, payload) {
  if (!e.apiUrl) return
  try {
    await fetch(`${e.apiUrl}/relay/usage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-machine-api-key': e.machineApiKey },
      body: JSON.stringify(payload),
    })
  } catch (err) { dbg(`POST usage FAILED: ${err.message}`) }
}

// Per-session token accumulator. OpenCode makes several assistant messages per turn (tool
// loops); we key by message id and sum their outputs for the turn total. Reset on session.idle.
const ocUsage = new Map()   // sessionId → { byMsg: Map<msgId,{input,output}>, lastPostAt }
function ocUsageState(sid) {
  let st = ocUsage.get(sid)
  if (!st) { st = { byMsg: new Map(), lastPostAt: 0 }; ocUsage.set(sid, st) }
  return st
}
// Pull token counts + session id off a message-updated event, tolerating shape differences
// across SDK versions. Returns null if this isn't an assistant message with usage.
function readOcUsage(event) {
  const info = event?.properties?.info || event?.properties?.message
  const t    = info?.tokens
  if (!info || !t) return null
  const sid = info.sessionID || info.session_id || info.sessionId
  const mid = info.id
  if (!sid || !mid) return null
  const input  = (t.input  || 0) + (t.cache?.read || 0) + (t.cache?.write || 0)
  const output = (t.output || 0) + (t.reasoning || 0)
  return { sid, mid, input, output }
}

// Track text/reasoning parts we've already posted (keyed by part id) so the
// per-token streaming updates don't create a flood of duplicate rows.
const _postedParts = new Set()

// Sessions we aborted because of a mobile Stop. abortIfStopRequested already posts the
// "Stopped" turn-end tag, so the session.idle handler must SKIP its own "Task finished" post
// for these — otherwise the chat shows both tags. We match by session id AND by a short
// timestamp window, because the id on the session.idle event doesn't always match the id on
// the part/tool event we aborted from (different OpenCode event shapes). In-memory — the
// plugin is long-lived.
const _abortedByFlag = new Set()
let _lastAbortAt = 0

// The heartbeat drops this flag when the phone taps Stop. We consume it from INSIDE OpenCode
// and abort via our own `client` — the reliable path, because the heartbeat's separate SDK
// client is pinned to OPENCODE_URL (localhost:4096) and usually can't reach the real server,
// so its direct abort silently no-ops and the CLI keeps generating. Mirrors claude's flag.
const stopFlag = (sessionId) => path.join(PID_DIR, `relay-stop-${sessionId}.flag`)

export const VibeRelay = async ({ project, directory, serverUrl, client } = {}) => {
  dbg(`plugin loaded — flag=${fs.existsSync(FLAG_FILE)} dir=${directory ?? '?'} serverUrl=${serverUrl ?? '?'}`)

  // Abort the in-flight turn if the phone requested a Stop for this session. Runs from inside
  // OpenCode using the plugin's own `client`, so it actually reaches the running server. Called
  // on the frequent streaming events (tool.execute.before / message.part.updated), so a stop
  // lands within a token or two. Returns true if it consumed a stop flag.
  const abortIfStopRequested = async (sessionID) => {
    if (!sessionID) return false
    let armed = false
    try { armed = fs.existsSync(stopFlag(sessionID)) } catch { return false }
    if (!armed) return false
    try { fs.unlinkSync(stopFlag(sessionID)) } catch {}   // one-shot: don't halt the NEXT turn too
    _abortedByFlag.add(sessionID)   // tells session.idle to skip its own "Task finished" post
    _lastAbortAt = Date.now()       // fallback dedup if the session.idle id doesn't match
    try {
      await client?.session?.abort?.({ path: { id: sessionID } })   // POST /session/:id/abort
      dbg(`mobile stop → aborted session ${sessionID}`)
    } catch (err) {
      dbg(`session.abort failed for ${sessionID}: ${err.message}`)
    }
    // Post the "Stopped" turn-end tag NOW — immediate and reliable: we know it's a user stop
    // here, so it doesn't depend on session.idle firing or on session-id formats matching.
    // status:'stopped' is what the mobile StopRow renders as the "Stopped" tag.
    const e = env()
    if (e.apiUrl) {
      postTerminalEvent(e, {
        session_id: sessionID,
        event_type: 'stop',
        tool_name:  null,
        summary:    'Stopped from mobile — turn halted.',
        status:     'stopped',
      })
    }
    return true
  }

  // ── Custom "ask the user a choice" tool — the mobile question picker for OpenCode.
  // OpenCode has no built-in AskUserQuestion tool, so we register one here. Unlike the
  // Claude Code hook (which can only block with exit 2), an OpenCode tool returns its
  // result directly — so the user's chosen option(s) become the tool output the model
  // reads, with no "hook error" noise. Loaded via dynamic import so that a resolution
  // failure can NEVER break the rest of the plugin (gating + narrative keep working).
  let askTool = null
  try {
    const { tool } = await import('@opencode-ai/plugin/tool')
    const z = tool.schema
    askTool = tool({
      description:
        'Ask the remote user a question and wait for their answer. This is the ONLY way to get ' +
        'input from the user: they are on a phone and CANNOT see or reply to anything you write as ' +
        'plain text. Use it for EVERY question — choosing between options, yes/no confirmations, or ' +
        'open-ended input. Provide the question plus a list of options the user can tap (for a ' +
        'yes/no, pass options "Yes" and "No"; for open input, the user can type a custom answer).',
      args: {
        questions: z.array(z.object({
          header:      z.string().optional(),
          question:    z.string(),
          multiSelect: z.boolean().optional(),
          options:     z.array(z.object({
            label:       z.string(),
            description: z.string().optional(),
          })),
        })),
      },
      execute: async (args, context) => {
        dbg(`askUserQuestion.execute CALLED — ${(args?.questions ?? []).length} question(s)`)
        const e = env()
        const questions = args?.questions ?? []
        if (!fs.existsSync(FLAG_FILE) || !e.apiUrl || questions.length === 0) {
          return 'Mobile picker unavailable — ask the user this question directly in your reply and wait for their answer.'
        }
        recordPid(context.sessionID)
        agentPing(e, context.sessionID, context.directory ?? directory ?? null)

        const summary = questions[0].header
          ? `${questions[0].header}: ${questions[0].question}`
          : questions[0].question

        postTerminalEvent(e, {
          session_id: context.sessionID ?? null,
          event_type: 'tool_start',
          tool_name:  'askUserQuestion',
          summary,
        })

        const row = {
          id: randomUUID(),
          harness: 'opencode',
          kind: 'question',
          user_id: e.userId, machine_id: e.machineId,
          session_id: context.sessionID ?? null,
          tool_name: 'askUserQuestion',
          display_type: 'question',
          summary,
          risk_level: 'low', risk_reason: 'OpenCode is asking you to choose', risk_icon: '❓',
          files_affected: [],
          question: { questions },
          status: 'pending', created_at: new Date().toISOString(),
        }

        let selected
        try {
          selected = await uploadAndWaitAnswer(e, row)
        } catch (err) {
          dbg(`question upload failed: ${err.message}`)
          return 'Could not reach the mobile app — ask the user directly in your reply instead.'
        }
        if (!selected) return 'No answer from the user within the time limit. Ask again or proceed conservatively.'
        dbg(`question answered: ${JSON.stringify(selected)}`)
        return formatAnswer(questions, selected)
      },
    })
  } catch (err) {
    dbg(`ask tool unavailable (import failed): ${err.message}`)
  }
  dbg(`askUserQuestion tool ${askTool ? 'registered OK' : 'NOT registered'}`)

  return {
    // ── Custom tool registration (only added if the import above succeeded) ────
    ...(askTool ? { tool: { askUserQuestion: askTool } } : {}),

    // Nudge the model to use askUserQuestion when mobile mode is on, so a remote
    // user gets a tappable picker instead of a plain-text question they must type.
    'experimental.chat.system.transform': async (_input, output) => {
      if (!fs.existsSync(FLAG_FILE)) return
      try {
        output.system.push(
          'CRITICAL — HOW TO ASK THE USER ANYTHING: The user is REMOTE (on a phone) and CANNOT ' +
          'read or answer questions you type as plain text — a prose question goes unanswered and ' +
          'you will stall. To ask the user ANYTHING — choosing between options, yes/no ' +
          'confirmations, or open-ended input — use the `question` tool with the question and its ' +
          'options (use "Yes"/"No" for confirmations; set multiple:true to allow several ' +
          'selections). Never put a question to the user in prose or wait for a typed reply.'
        )
        dbg('system.transform nudge added')
      } catch (err) { dbg(`system.transform error: ${err.message}`) }
    },

    // ── 0. Cleanup on OpenCode shutdown ───────────────────────────────────────
    // Removes this session's PID file so the heartbeat treats the CLI as closed
    // and resumes future prompts in a new window rather than a dead terminal.
    dispose: async () => { clearPids() },

    // ── 1. Tool gating ────────────────────────────────────────────────────────
    'tool.execute.before': async (input, output) => {
      if (!fs.existsSync(FLAG_FILE)) return
      // Phone tapped Stop → abort the turn before this tool runs.
      if (await abortIfStopRequested(input.sessionID)) {
        throw new Error('Stopped from the Vibe Remote mobile app')
      }
      markBusyOC(input.sessionID)            // any tool call → a turn is in flight
      if (!GATED.has(input.tool)) return

      // If OpenCode's permission system already gated this exact call through the phone
      // (permission.updated handler approved it), don't prompt again.
      if (takeRecent(_gatedByPerm, `${input.sessionID}:${input.tool}`)) return

      const e = env()
      if (!e.apiUrl) return

      recordPid(input.sessionID)
      // Await so the session is registered before we block on the approval wait below.
      await agentPing(e, input.sessionID, directory ?? null)

      const args = (output && output.args) || input.args || {}
      const meta = summarize(input.tool, args)

      postTerminalEvent(e, {
        session_id: input.sessionID ?? null,
        event_type: 'tool_start',
        tool_name:  meta.tool_name,
        summary:    meta.summary,
      })

      const row = {
        id: randomUUID(),
        harness: 'opencode',
        user_id: e.userId, machine_id: e.machineId,
        session_id: input.sessionID ?? null,
        tool_name: meta.tool_name,
        display_type: meta.display_type,
        summary: meta.summary,
        risk_level: 'medium', risk_reason: 'OpenCode tool call', risk_icon: '🔶',
        files_affected: meta.file_path ? [meta.file_path] : [],
        command: meta.command ?? null,
        file_path: meta.file_path ?? null,
        raw_input: args,
        status: 'pending', created_at: new Date().toISOString(),
      }

      const approved = await uploadAndWait(e, row)
      if (!approved) throw new Error('Denied via Vibe Remote mobile app')
      // Remember we gated this call so a following permission.updated (if this tool is also
      // configured "ask") auto-approves instead of prompting the phone a second time.
      stampRecent(_gatedByTool, `${input.sessionID}:${input.tool}`)
    },

    // ── 2. Tool completion ────────────────────────────────────────────────────
    'tool.execute.after': async (input, output) => {
      if (!fs.existsSync(FLAG_FILE)) return
      const e = env()
      postTerminalEvent(e, {
        session_id: input.sessionID ?? null,
        event_type: 'tool_end',
        tool_name:  input.tool,
        summary:    output?.title || `${input.tool} completed`,
        status:     'success',
      })
    },

    // ── 3. Narrative — reasoning + response text ─────────────────────────────
    // event.properties.part is a Part; sessionID lives on the PART (not on
    // event.properties). Text streams token-by-token via repeated
    // message.part.updated; we post only once the part finishes (time.end set)
    // so each reasoning/response block becomes one chat bubble.
    event: async ({ event }) => {
      if (!fs.existsSync(FLAG_FILE)) return

      // ── NATIVE permission request → mobile ─────────────────────────────────
      // OpenCode fires `permission.updated` whenever a tool needs approval per the user's
      // `permission` config — webfetch, websearch, external_directory, or anything set to
      // "ask". The TUI would prompt locally (the "requires CLI accept" the user saw); instead we
      // route it to the phone and reply via POST /session/:id/permissions/:permissionID, which is
      // what actually clears the prompt. Covers EVERY tool OpenCode asks about, not a fixed list.
      if (event?.type === 'permission.updated' || event?.type === 'permission.asked') {
        const perm         = event.properties || {}
        const sessionID    = perm.sessionID
        const permissionID = perm.id
        if (!sessionID || !permissionID) { dbg(`permission event missing ids: ${JSON.stringify(perm).slice(0, 200)}`); return }
        const e = env()
        if (!e.apiUrl) return

        const permTool = String(perm.type || perm.metadata?.tool || perm.pattern || '').toLowerCase()
        dbg(`permission.updated tool=${permTool} id=${permissionID} session=${sessionID} title=${perm.title ?? ''}`)

        // The question tool routes its ACTUAL prompt to mobile via the question.asked flow — just
        // let it run (auto-approve its permission) rather than gating "may I ask a question".
        if (permTool === 'question') {
          await respondPermission({ serverUrl, client, sessionID, permissionID, response: 'once' })
          return
        }

        // Dedup: a GATED write tool (tool.execute.before) may have just gated this same call.
        if (takeRecent(_gatedByTool, `${sessionID}:${permTool}`)) {
          await respondPermission({ serverUrl, client, sessionID, permissionID, response: 'once' })
          dbg(`permission ${permTool} auto-approved (already gated via tool.execute.before)`)
          return
        }

        recordPid(sessionID)
        // Await so the session (agents row) is registered BEFORE we block on the approval wait —
        // otherwise the phone gets a notification for a session that isn't in its list yet.
        await agentPing(e, sessionID, directory ?? null)

        const summary = perm.title || (permTool ? `Permission: ${permTool}` : 'Permission request')
        postTerminalEvent(e, { session_id: sessionID, event_type: 'tool_start', tool_name: permTool || 'permission', summary })

        const row = {
          id: randomUUID(), harness: 'opencode',
          user_id: e.userId, machine_id: e.machineId, session_id: sessionID,
          tool_name: permTool || 'permission',
          display_type: 'unknown',
          summary,
          risk_level: 'medium', risk_reason: 'OpenCode needs permission to continue', risk_icon: '🔶',
          files_affected: [],
          raw_input: perm.metadata || null,
          status: 'pending', created_at: new Date().toISOString(),
        }

        let approved
        try { approved = await uploadAndWait(e, row) }
        catch (err) { dbg(`permission upload failed: ${err.message} — leaving for local TUI`); return }

        // Stamp BEFORE replying so a following tool.execute.before for this call (if the tool is
        // also gated) sees it and skips a second prompt.
        if (approved) stampRecent(_gatedByPerm, `${sessionID}:${permTool}`)
        await respondPermission({ serverUrl, client, sessionID, permissionID, response: approved ? 'once' : 'reject' })
        // On approval the tool runs and tool.execute.after posts the completion row — don't
        // duplicate it. On denial the tool never executes (no after-hook), so close the row here.
        if (!approved) {
          postTerminalEvent(e, {
            session_id: sessionID, event_type: 'tool_end',
            tool_name:  permTool || 'permission',
            summary:    `Denied: ${summary}`,
            status:     'error',
          })
        }
        return
      }

      // ── NATIVE question tool → mobile ──────────────────────────────────────
      // OpenCode's built-in `question` tool emits `question.asked` and suspends until
      // question.reply() is called. This is what the model uses by default, so we route
      // it to mobile and reply with the user's selection — no dependency on the model
      // choosing our custom askUserQuestion tool. See opencode-question-tool-internals.md.
      if (event?.type === 'question.asked') {
        const p          = event.properties || {}
        const sessionID  = p.sessionID
        const requestID  = p.id
        const rawQs      = Array.isArray(p.questions) ? p.questions : []
        dbg(`question.asked requestID=${requestID} session=${sessionID} qs=${rawQs.length}`)
        const e = env()
        if (!e.apiUrl || !sessionID || !requestID || rawQs.length === 0) return

        // OpenCode schema → mobile shape (note: OpenCode uses `multiple`, we use multiSelect).
        const questions = rawQs.map(q => ({
          header:      q.header,
          question:    q.question,
          multiSelect: q.multiple === true,
          options:     (q.options || []).map(o => ({ label: o.label, description: o.description })),
        }))

        recordPid(sessionID)
        agentPing(e, sessionID, directory ?? null)

        const summary = questions[0].header
          ? `${questions[0].header}: ${questions[0].question}`
          : questions[0].question
        postTerminalEvent(e, { session_id: sessionID, event_type: 'tool_start', tool_name: 'question', summary })

        const row = {
          id: randomUUID(), harness: 'opencode', kind: 'question',
          user_id: e.userId, machine_id: e.machineId, session_id: sessionID,
          tool_name: 'question', display_type: 'question', summary,
          risk_level: 'low', risk_reason: 'OpenCode is asking you to choose', risk_icon: '❓',
          files_affected: [], question: { questions }, status: 'pending',
          created_at: new Date().toISOString(),
        }

        let selected
        try { selected = await uploadAndWaitAnswer(e, row) }
        catch (err) { dbg(`native question upload failed: ${err.message}`); return }
        if (!selected) { dbg('native question: no answer within timeout — leaving for local TUI'); return }

        // mobile selected_options → OpenCode answers: one string[] of labels per question.
        const answers = rawQs.map((_q, i) => {
          const ans = selected.find(a => a.question_index === i)
          if (!ans) return []
          const labels = (ans.selected || []).map(s => s.label)
          if (ans.custom_text) labels.push(ans.custom_text)
          return labels
        })

        await replyNativeQuestion({ serverUrl, client, sessionID, requestID, directory, answers })
        return
      }

      // Turn ended → clear busy + drop a ready flag so the heartbeat injects any queued
      // prompt for this now-idle session within ~1s. See FAST_PROMPT_DELIVERY_DESIGN.md.
      if (event?.type === 'session.idle') {
        const p = event.properties || {}
        const sid = p.sessionID || p.info?.id || p.session?.id || p.sessionId
        dbg(`session.idle received — sid=${sid ?? '(none)'} keys=${Object.keys(p).join(',')}`)
        readyOC(sid)
        // Emit a turn-end `stop` event (Claude's Stop hook does this; OpenCode didn't).
        // The mobile composer keys off this reliable feed broadcast to unlock the input
        // the instant the turn ends, and the server backdates last_activity_at on `stop`
        // so the session's status flips to idle immediately instead of on the 15s poll.
        if (sid) {
          const e = env()
          if (e.apiUrl) {
            // If WE aborted this session for a mobile Stop, abortIfStopRequested already
            // posted the "Stopped" turn-end tag — skip so we don't double up. Match by id,
            // and fall back to a short time window since the session.idle id doesn't always
            // match the part/tool id we aborted from. Otherwise it's a natural turn-end.
            const justAborted = _abortedByFlag.delete(sid) || (Date.now() - _lastAbortAt < 4000)
            if (justAborted) {
              _lastAbortAt = 0   // consume the window so the NEXT natural finish still posts
            } else {
              postTerminalEvent(e, {
                session_id: sid,
                event_type: 'stop',
                tool_name:  null,
                summary:    'Task finished',
                status:     'success',
              })
            }
          }
        }
        if (sid) ocUsage.delete(sid)   // reset the per-turn token counter for the next turn
        return
      }

      // Live token usage → mobile compose-bar counter. OpenCode updates the assistant message
      // (carrying cumulative tokens) as it generates; accumulate per message id and push the
      // turn total, throttled to ≤1/s. Reset on session.idle above. See TOKEN_USAGE design doc.
      if (event?.type === 'message.updated') {
        const u = readOcUsage(event)
        if (u) {
          const st = ocUsageState(u.sid)
          st.byMsg.set(u.mid, { input: u.input, output: u.output })
          let turnOutput = 0
          for (const v of st.byMsg.values()) turnOutput += v.output
          const now = Date.now()
          if (now - st.lastPostAt >= 1000) {
            st.lastPostAt = now
            const e = env()
            if (e.apiUrl) postUsage(e, { sessionId: u.sid, turnInput: u.input, turnOutput })
          }
        }
        return
      }

      if (!event || event.type !== 'message.part.updated') return

      const part = event.properties?.part
      if (!part) return
      if (part.type !== 'text' && part.type !== 'reasoning') return
      // Phone tapped Stop → abort mid-stream. Checked here because message.part.updated fires
      // continuously while the model generates, so a stop lands almost immediately.
      if (await abortIfStopRequested(part.sessionID)) return
      markBusyOC(part.sessionID)                        // output is streaming → a turn is in flight
      if (part.synthetic) return                       // skip auto-generated parts

      // Only emit once the streaming part has completed.
      if (!part.time || part.time.end == null) return
      if (_postedParts.has(part.id)) return
      _postedParts.add(part.id)

      const text = String(part.text || '').trim()
      if (!text) return

      const e = env()
      if (!e.apiUrl) return

      // Register the session here too, so tool-less conversation turns (pure text
      // responses with no gated tool) still appear in the phone's chat list, and
      // record the PID so prompts can be injected into this terminal.
      recordPid(part.sessionID)
      agentPing(e, part.sessionID, directory ?? null)

      dbg(`narrative part ${part.type} id=${part.id} session=${part.sessionID} len=${text.length}`)
      postTerminalEvent(e, {
        session_id: part.sessionID ?? null,          // ← CORRECT: sessionID is on the part
        event_type: 'output',
        tool_name:  part.type === 'reasoning' ? 'reasoning' : null,
        summary:    text.slice(0, 4000),
      })
    },
  }
}
