/**
 * relay-daemon/postHook.js
 *
 * Claude Code PostToolUse hook — fires after every tool call completes.
 * Sends a terminal_event so the mobile app can show the result.
 *
 * Must exit 0 — PostToolUse hooks must never block.
 *
 * stdin shape:
 *   { session_id, tool_name, tool_input, tool_response }
 *   tool_response for Bash: { output, error, exit_code, interrupted }
 *   tool_response for file tools: { success } or { error }
 */

import { postTerminalEvent } from './src/supabase.js'
import { READONLY_TOOLS } from './src/filter.js'
import { mkdirSync, writeFileSync, existsSync, unlinkSync } from 'fs'
import { join } from 'path'
import { runtimePath } from './src/paths.js'

const TRANSCRIPT_DIR = runtimePath('transcript-paths')
function recordTranscriptPath(sessionId, transcriptPath) {
  if (!sessionId || !transcriptPath) return
  try {
    mkdirSync(TRANSCRIPT_DIR, { recursive: true })
    writeFileSync(join(TRANSCRIPT_DIR, `${sessionId}.path`), transcriptPath, 'utf8')
  } catch {}
}

// ── Stop (interrupt the turn) ─────────────────────────────────────────────────
// PreToolUse (hook.js) catches a stop before the NEXT tool runs. This catches the case
// where there is no next tool — the turn ends in plain text — so the stop would
// otherwise be silently dropped and only land on some later turn.
//
// PostToolUse can't block the tool (it already ran), but `continue: false` is honoured
// on every hook event and halts Claude outright. See STOP_AGENT_DESIGN.md.
const stopFlag = (sessionId) => runtimePath(`relay-stop-${sessionId}.flag`)

function stopRequested(sessionId) {
  if (!sessionId) return false
  try {
    if (!existsSync(stopFlag(sessionId))) return false
    unlinkSync(stopFlag(sessionId))   // one-shot
    return true
  } catch { return false }
}

function readStdin(ms) {
  return new Promise((resolve) => {
    const chunks = []
    let settled  = false
    function finish() {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(Buffer.concat(chunks).toString().trim())
    }
    const timer = setTimeout(finish, ms)
    process.stdin.on('data',  c => chunks.push(c))
    process.stdin.on('end',   finish)
    process.stdin.on('error', finish)
    if (process.stdin.isTTY) finish()
  })
}

async function main() {
  const raw = await readStdin(3000)
  let event
  try { event = JSON.parse(raw) } catch { process.exit(0) }

  const { session_id, tool_name, tool_input, tool_response, transcript_path } = event
  recordTranscriptPath(session_id, transcript_path)

  // PostToolUse now matches ALL tools (to show results for WebFetch/WebSearch/etc.), but the
  // read-only tools were auto-allowed with no "tool_start", so posting their "tool_end" would
  // leave orphan rows in the feed. Skip the result post for them — but still fall through to the
  // stop check below (a stop can arrive while a read-only tool runs).
  if (!READONLY_TOOLS.has(tool_name)) {

  const isError = (tool_response?.exit_code > 0) || !!tool_response?.error

  let summary = ''
  let detail  = null

  if (tool_name === 'Bash') {
    const cmd = (tool_input?.command || '').slice(0, 80)
    summary   = `Bash: ${cmd}`
    const out = tool_response?.output || tool_response?.error || ''
    if (out.trim()) detail = out.slice(0, 500)
  } else if (tool_name === 'Read') {
    summary = `Read ${tool_input?.file_path || ''}`
  } else if (tool_name === 'Write') {
    summary = `Write ${tool_input?.file_path || ''}`
  } else if (tool_name === 'Edit') {
    summary = `Edit ${tool_input?.file_path || ''}`
  } else if (tool_name === 'MultiEdit') {
    const count = (tool_input?.edits || []).length
    summary = `MultiEdit ${count} file${count !== 1 ? 's' : ''}`
  } else if (tool_name === 'WebFetch') {
    summary = `WebFetch ${tool_input?.url || ''}`.trim()
  } else if (tool_name === 'WebSearch') {
    summary = `WebSearch ${tool_input?.query || ''}`.trim()
  } else if (tool_name === 'Task') {
    summary = `Task ${tool_input?.description || tool_input?.subagent_type || ''}`.trim()
  } else {
    summary = tool_name || 'Unknown tool'
  }

  await postTerminalEvent({
    session_id,
    event_type: 'tool_end',
    tool_name:  tool_name ?? null,
    summary,
    detail,
    status: isError ? 'error' : 'success',
  }).catch(() => {})

  } // end: non-read-only tool result post

  // Phone hit Stop while this tool was running → halt now, rather than letting the
  // model produce another round of output first.
  if (stopRequested(session_id)) {
    if (session_id) {
      try { unlinkSync(runtimePath(`relay-busy-${session_id}.flag`)) } catch {}
    }
    // Emit a `stop` (turn-end) event so the mobile feed unlocks the composer the instant the
    // turn halts — the phone keys off this reliable feed broadcast, not the laggy sessions
    // poll. (Matches the PreToolUse halt path in hook.js.)
    await postTerminalEvent({
      session_id,
      event_type: 'stop',
      tool_name:  null,
      summary:    'Stopped from mobile — turn halted.',
      detail:     null,
      status:     'stopped',   // mobile StopRow renders this as a "Stopped" tag
    }).catch(() => {})
    process.stdout.write(JSON.stringify({
      continue:   false,
      stopReason: 'Stopped from the VibeRemote mobile app',
    }))
    process.exit(0)
  }

  process.exit(0)
}

main().catch(() => process.exit(0))
