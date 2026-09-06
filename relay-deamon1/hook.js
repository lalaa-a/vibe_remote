/**
 * relay-daemon/hook.js
 *
 * Runs only when mobile mode is active (relay.cjs mobile enables the hook).
 * In CLI mode the hook doesn't exist in settings.json, so this never runs.
 *
 * stdin  → JSON event from Claude Code
 * stderr → shown in Claude Code's hook panel
 * exit 0 → allow  |  exit 2 → block
 *
 * Respond from mobile app, or as fallback from terminal:
 *   ! node relay.cjs 1   (Yes)
 *   ! node relay.cjs 3   (No)
 */

import { randomUUID }                                        from 'crypto'
import { appendFileSync, mkdirSync, existsSync,
         unlinkSync, writeFileSync, readFileSync }           from 'fs'
import { execFileSync }                                      from 'child_process'
import { join }                                              from 'path'
import { fileURLToPath }                                     from 'url'
import { dirname }                                           from 'path'
import { config }                                            from './src/config.js'
import { parseEvent }                                        from './src/parsers.js'
import { preFilter }                                         from './src/filter.js'
import { uploadRequest, waitForDecision, waitForAnswer, markDecided,
         agentPing, postTerminalEvent }                      from './src/supabase.js'
import { logger }                                            from './src/logger.js'
import { runtimePath, logPath, ensureDirs }                 from './src/paths.js'

const __dir     = dirname(fileURLToPath(import.meta.url))
const relayPath = join(__dir, 'relay.cjs').replace(/\\/g, '/')

const PENDING_DIR      = runtimePath('relay-pending')
const CURRENT_FILE     = runtimePath('relay-current.txt')
const ALLOW_ALL_FILE   = runtimePath('relay-allow-all.txt')
const TRANSCRIPT_DIR   = runtimePath('transcript-paths')

// ── Stop (interrupt the turn) ─────────────────────────────────────────────────
// Claude Code exposes NO external interrupt API, and OS keystroke injection (ESC via
// WriteConsoleInput) does not reach the CLI when it runs under a ConPTY — which is the
// normal case in Windows Terminal and VS Code's integrated terminal. The API reports
// "records written" and the key is simply never consumed.
//
// Hooks are the only supported control surface. A hook that prints
//   { "continue": false, "stopReason": "..." }
// on stdout and exits 0 halts Claude entirely — this takes precedence over
// permissionDecision and ends the turn. The heartbeat drops a flag file when the phone
// requests a stop; we consume it here, on the next tool call. See STOP_AGENT_DESIGN.md.
const stopFlag = (sessionId) => runtimePath(`relay-stop-${sessionId}.flag`)

function stopRequested(sessionId) {
  if (!sessionId) return false
  try {
    if (!existsSync(stopFlag(sessionId))) return false
    unlinkSync(stopFlag(sessionId))   // one-shot: never halt the NEXT turn too
    return true
  } catch { return false }
}

// Halt Claude entirely. Exit 0 + this JSON is the documented contract; exit 2 would
// only block the single tool call and let the model keep going.
function haltExit(sessionId, reason) {
  // The turn is over, so drop the busy flag ourselves — the Stop hook may not fire on
  // a halted turn, and a stale busy flag locks the session out of every future prompt
  // until its 60s TTL expires.
  if (sessionId) {
    try { unlinkSync(runtimePath(`relay-busy-${sessionId}.flag`)) } catch {}
  }
  process.stdout.write(JSON.stringify({ continue: false, stopReason: reason }))
  process.exit(0)
}

// Record this session's transcript path so heartbeat.js can tail it for narrative output.
// Touched on every hook fire, so heartbeat can age out sessions where interception is off
// (the mapping file's mtime stops updating).
function recordTranscriptPath(sessionId, transcriptPath) {
  if (!sessionId || !transcriptPath) return
  try {
    mkdirSync(TRANSCRIPT_DIR, { recursive: true })
    writeFileSync(join(TRANSCRIPT_DIR, `${sessionId}.path`), transcriptPath, 'utf8')
  } catch (err) {
    debugLog(`recordTranscriptPath failed: ${err.message}`)
  }
}

function debugLog(msg) {
  try {
    ensureDirs()
    appendFileSync(logPath('hook-debug.log'), `[${new Date().toISOString()}] ${msg}\n`)
  } catch {}
}

// ── Resolve the real, long-lived `claude` process PID ─────────────────────────
// process.ppid is a transient shell that Claude Code spawns per hook and which
// dies the moment the hook finishes — so the heartbeat can't use it later.
// We walk the full process tree NOW, while every ancestor is still alive, and
// find the actual `claude` process by matching its command line.
function findClaudePid() {
  const psScript = `
$startPid = ${process.pid}
$all = @{}
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object { $all[[int]$_.ProcessId] = $_ }
$result = 0
$cur = $all[[int]$startPid]
$guard = 0
while ($cur -and $guard -lt 30) {
  $guard++
  $cl = $cur.CommandLine
  if ($cl -and ($cl -match 'claude') -and ($cl -notmatch 'hook-wrapper') -and ($cl -notmatch 'heartbeat') -and ($cl -notmatch 'relay-deamon')) {
    $result = $cur.ProcessId
    break
  }
  $pp = $cur.ParentProcessId
  if (-not $pp) { break }
  $cur = $all[[int]$pp]
}
Write-Output $result
`.trim()
  try {
    const out = execFileSync(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
      { timeout: 10000, windowsHide: true }
    ).toString().trim()
    const pid = parseInt(out, 10)
    return (pid && !Number.isNaN(pid)) ? pid : null
  } catch (err) {
    debugLog(`findClaudePid failed: ${err.message}`)
    return null
  }
}

// Resolve and cache the claude PID for a session. The process-tree walk is
// expensive (spawns PowerShell) so it runs only once per session — later hooks
// reuse the cached PID as long as that process is still alive.
function storeClaudePid(sessionId) {
  if (!sessionId) return
  try {
    ensureDirs()
    const pidFile = runtimePath(`relay-pid-${sessionId}.txt`)

    if (existsSync(pidFile)) {
      const stored = parseInt(readFileSync(pidFile, 'utf8').trim(), 10)
      if (stored && !Number.isNaN(stored)) {
        try { process.kill(stored, 0); return }              // still alive — keep it
        catch (e) { if (e.code === 'EPERM') return }         // alive (no perms) — keep it
      }
    }

    const claudePid = findClaudePid()
    if (claudePid) {
      writeFileSync(pidFile, String(claudePid))
      debugLog(`resolved claude pid for session: ${claudePid}`)
    } else {
      debugLog('could not resolve claude pid')
    }
  } catch (err) {
    debugLog(`storeClaudePid failed: ${err.message}`)
  }
}

// ── Read stdin ────────────────────────────────────────────────────────────────
function readStdinWithTimeout(ms) {
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
    process.stdin.on('data',  chunk => chunks.push(chunk))
    process.stdin.on('end',   finish)
    process.stdin.on('error', finish)
    if (process.stdin.isTTY) finish()
  })
}

// ── Race: Supabase realtime (mobile) vs local file signal (CLI fallback) ──────
function raceDecision(requestId) {
  const approvedFile = join(PENDING_DIR, `${requestId}.approved`)
  const deniedFile   = join(PENDING_DIR, `${requestId}.denied`)
  return new Promise((resolve) => {
    let settled = false, poll = null
    function finish(decision, decidedBy) {
      if (settled) return
      settled = true
      clearInterval(poll)
      try { unlinkSync(approvedFile) } catch {}
      try { unlinkSync(deniedFile)   } catch {}
      resolve({ decision, decidedBy })
    }
    // Mobile — Supabase Realtime (handles timeout internally)
    waitForDecision(requestId).then(({ decision, decidedBy }) => finish(decision, decidedBy))
    // CLI fallback — poll signal file every 150 ms
    try {
      mkdirSync(PENDING_DIR, { recursive: true })
      poll = setInterval(() => {
        try {
          if (existsSync(approvedFile)) { finish('approved', 'pc'); return }
          if (existsSync(deniedFile))   { finish('denied',   'pc'); return }
        } catch {}
      }, 150)
    } catch {}
  })
}

async function handleQuestion(event){
  const questions = event.tool_input?.questions
  if(!Array.isArray(questions)||questions.length === 0) {
    //Nothing to ask - let claude's native tool to handle it.
    process.exit(0);return
  }

  //Keep the session row fresh (same as the approval path).
  try {
    await agentPing(event.session_id, event.cwd ?? process.cwd(),'AskUserQuestion')
  } catch {}

  const requestId = randomUUID()
  try {
    ensureDirs()
    writeFileSync(CURRENT_FILE, requestId, 'utf8') //lets relay.cjs answer by index
    // Persist the options so `relay.cjs answer <n>` can map an index → label locally.
    writeFileSync(
      runtimePath('relay-current-question.json'),
      JSON.stringify({ requestId, questions }),
      'utf8',
    )
  } catch {}

  const row = {
    id:             requestId, 
    user_id:        config.userId, 
    machine_id:     config.machineId,
    session_id:     event.session_id     || null,
    harness:        'claude-code',
    kind:           'question',
    tool_name:      'AskUserQuestion',
    display_type:   'question',
    summary:        questions[0].header ? `${questions[0].header} : ${questions[0].question}` 
                    : questions[0].question,
    risk_level:     'low',
    risk_reason:    'Claude is asking you to choose an option',
    risk_icon:      '❓',
    files_affected: [],
    question:       { questions }, // ← full structured payload
    status:         'pending', 
    created_at:     new Date().toISOString(),
  }

  try {
    await uploadRequest(row)
  } catch (err) {
    debugLog(`question upload failed: ${err.message}`)
    // Can't reach the server — fall back to the native picker so the user isn't stuck.
    process.exit(0);return
  }

  // Mirror the approval path's "tool_start" so mobile shows activity immediately.
  postTerminalEvent({
    session_id: event.session_id, event_type: 'tool_start',
    tool_name: 'AskUserQuestion', summary: row.summary, detail: null, status: null,
  }).catch(() => {})

  process.stderr.write(
    `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `  RELAY  ❓ Claude is asking a question\n` +
    `  ${row.summary}\n` +
    `  → Sent to mobile app. Or answer from terminal:\n` +
    `      ! node ${relayPath} answer 1   (pick option 1)\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`
  )

  // Block until the user answers (mobile) or the terminal supplies an index.
  let answer
  try {
    answer = await waitForAnswer(requestId)   // { selected_options } | { timeout:true }
  } catch (err) {
    debugLog(`waitForAnswer error: ${err.message}`)
    process.exit(config.failOpen ? 0 : 2); return
  }

  if (answer?.timeout) {
    // No answer in time → let the native picker take over rather than guess.
    hardExit(2, 'No answer within the time limit — please answer in the terminal.')
    return
  }

  // Turn the structured selection into a natural-language reason Claude can act on, and
  // deliver it via a clean deny (exit 0) so there's no "hook error" banner.
  answerExit(formatAnswerReason(questions, answer.selected_options))
}

// Build the deny reason that carries the chosen option(s) back to the model.
function formatAnswerReason(questions, selected_options) {
  const parts = (selected_options || []).map(ans => {
    const q = questions[ans.question_index] ?? questions[0]
    const labels = (ans.selected || []).map(s => `"${s.label}"`).join(', ')
    const custom = ans.custom_text ? ` (custom answer: "${ans.custom_text}")` : ''
    return `Q: "${q.question}" → The user selected: ${labels || ans.custom_text}${custom}.`
  })
  return `[Answered remotely via mobile] ${parts.join(' ')} ` +
         `Proceed with this choice and do NOT call AskUserQuestion again for this question.`
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  debugLog('hook started')

  const raw    = await readStdinWithTimeout(3000)
  const source = raw || process.env.CLAUDE_HOOK_INPUT || ''

  let event
  try {
    event = JSON.parse(source)
  } catch (err) {
    debugLog(`JSON parse failed: ${err.message}`)
    hardExit(config.failOpen ? 0 : 2, 'Could not parse hook event')
    return
  }

  debugLog(`tool: ${event.tool_name}`)
  logger.info('Hook fired', { tool: event.tool_name, session: event.session_id })

  // Cache the real claude PID so the heartbeat can inject mobile prompts into
  // this exact terminal. Runs the expensive process-tree walk only once per session.
  // MUST run before the AskUserQuestion branch below: if a session's first hook fire
  // is a question, returning early here would skip PID registration entirely and the
  // heartbeat would report the CLI as closed even though it's still open.
  storeClaudePid(event.session_id)

  // Record the transcript path so heartbeat can tail it for narrative output
  recordTranscriptPath(event.session_id, event.transcript_path)

  // Mark this session busy (a turn is in flight) so the heartbeat won't inject a queued
  // mobile prompt mid-turn. The Stop hook clears it. See FAST_PROMPT_DELIVERY_DESIGN.md.
  if (event.session_id) {
    try { writeFileSync(runtimePath(`relay-busy-${event.session_id}.flag`), String(Date.now())) } catch {}
  }

  // Did the phone hit Stop? Check BEFORE the question branch and before any upload, so a
  // stop wins over anything else this tool call would have done.
  if (stopRequested(event.session_id)) {
    debugLog(`stop flag consumed for ${event.session_id} — halting turn`)
    logger.info('Stopped from mobile', { session: event.session_id })
    // Emit a `stop` (turn-end) event, not a notification: the Stop hook does NOT fire on a
    // halted turn, so this is the only turn-end signal the mobile feed gets. The phone keys
    // its composer off this event (feed broadcast is instant & reliable, unlike the sessions
    // poll) to unlock the input the moment the turn actually halts. MUST be awaited — haltExit
    // calls process.exit immediately, which would otherwise kill this POST mid-flight.
    await postTerminalEvent({
      session_id: event.session_id,
      event_type: 'stop',
      tool_name:  null,
      summary:    'Stopped from mobile — turn halted.',
      detail:     null,
      status:     'stopped',   // mobile StopRow renders this as a "Stopped" tag
    }).catch(() => {})
    haltExit(event.session_id, 'Stopped from the VibeRemote mobile app')
    return
  }

  if(event.tool_name === "AskUserQuestion") {
    await handleQuestion(event)
    return
  }

  // Pre-filter
  const { action: filterAction, reason: filterReason } = preFilter(event.tool_name, event.tool_input || {})
  if (filterAction === 'allow') { approveExit(); return }
  if (filterAction === 'block') { hardExit(2, filterReason); return }

  // Allow-all fast path
  if (existsSync(ALLOW_ALL_FILE)) {
    debugLog('allow-all active — auto-approved')
    approveExit()
    return
  }

  // Parse into display payload
  let parsed
  try {
    parsed = parseEvent(event)
  } catch (err) {
    parsed = {
      tool_name: event.tool_name, session_id: event.session_id,
      display_type: 'unknown', summary: `${event.tool_name} — parse error`,
      risk: { level: 'medium', reason: 'Could not parse payload', icon: '?' },
      files_affected: [], diff: null, raw_input: event.tool_input,
    }
  }

  // Upsert agent row — keeps last_activity_at and cwd fresh for sessions view
  try {
    await agentPing(
      event.session_id,
      parsed.working_dir ?? process.cwd(),
      event.tool_name,
    )
  } catch (err) {
    debugLog(`agent-ping failed: ${err.message}`)
  }

  const requestId = randomUUID()

  // Store current ID so relay.cjs 1/2/3 needs no UUID
  try {
    ensureDirs()
    writeFileSync(CURRENT_FILE, requestId, 'utf8')
  } catch {}

  // Upload to Supabase for mobile
  const row = {
    id: requestId, user_id: config.userId, machine_id: config.machineId,
    session_id:     parsed.session_id     || null,
    tool_name:      parsed.tool_name,
    display_type:   parsed.display_type,
    summary:        parsed.summary,
    risk_level:     parsed.risk.level,
    risk_reason:    parsed.risk.reason,
    risk_icon:      parsed.risk.icon,
    files_affected: parsed.files_affected || [],
    diff:           parsed.diff           || null,
    command:        parsed.command        || null,
    file_path:      parsed.file_path      || null,
    new_content:    parsed.new_content    || null,
    old_content:    parsed.old_content    || null,
    raw_input:      parsed.raw_input      || null,
    status: 'pending', created_at: new Date().toISOString(),
  }

  try {
    await uploadRequest(row)
    debugLog(`uploaded — id: ${requestId}`)
    logger.info('Request uploaded', { id: requestId, tool: parsed.tool_name })
  } catch (err) {
    debugLog(`upload failed: ${err.message}`)
    hardExit(config.failOpen ? 0 : 2, 'Supabase unreachable')
    return
  }

  // Fire-and-forget — lets mobile show "pending approval" before the user decides
  postTerminalEvent({
    session_id: event.session_id,
    event_type: 'tool_start',
    tool_name:  parsed.tool_name,
    summary:    parsed.summary,
    detail:     null,
    status:     null,
  }).catch(() => {})

  // Show prompt — mobile primary, CLI as fallback
  process.stderr.write(
    `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `  RELAY  ${parsed.tool_name}  ${parsed.risk.icon} ${parsed.risk.level}\n` +
    `  ${parsed.summary}\n` +
    `\n` +
    `  → Sent to mobile app for approval\n` +
    `    Or respond from terminal:\n` +
    `      ! node ${relayPath} 1   (Yes)\n` +
    `      ! node ${relayPath} 3   (No)\n` +
    `\n` +
    `  Disable interception:  ! node ${relayPath} cli\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`
  )

  logger.info('Waiting for decision', { id: requestId, timeout: config.timeoutMs })

  let decision, decidedBy
  try {
    ;({ decision, decidedBy } = await raceDecision(requestId))
  } catch (err) {
    debugLog(`raceDecision error: ${err.message}`)
    hardExit(config.failOpen ? 0 : 2, 'Decision wait failed')
    return
  }

  if (decidedBy === 'pc') {
    try { await markDecided(requestId, decision, 'pc') } catch {}
  }

  debugLog(`decision: ${decision}  by: ${decidedBy}`)
  logger.info('Decision received', { id: requestId, decision, decidedBy })

  if (decision === 'approved') {
    approveExit()
  } else {
    hardExit(2, decision === 'timeout'
      ? `No response within ${config.timeoutMs / 1000}s`
      : decidedBy === 'pc' ? 'Denied from terminal' : 'Denied via mobile app')
  }
}

function hardExit(code, reason) {
  if (code !== 0 && reason) process.stderr.write(JSON.stringify({ decision: reason }) + '\n')
  process.exit(code)
}

// Approve the tool via the official PreToolUse JSON contract. A bare `exit 0` only means "hook
// succeeded" — Claude then still runs its NORMAL permission flow, which prompts in the CLI for
// anything not in settings.json `permissions.allow` (WebFetch, WebSearch, Task, MCP tools, …).
// Emitting permissionDecision:"allow" makes the hook the sole permission authority, so once the
// phone approves (or preFilter auto-allows a read-only tool), the tool runs with no manual CLI
// accept — for EVERY tool, not just the handful pre-listed in permissions.allow.
function approveExit() {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName:      'PreToolUse',
      permissionDecision: 'allow',
    },
  }) + '\n')
  process.exit(0)
}

// Clean "answer the question" exit for AskUserQuestion. Instead of exit 2 (which Claude
// Code renders as a "hook error" banner), we exit 0 and DENY the tool via the official
// PreToolUse JSON contract — the native picker never renders and the model reads the
// answer from permissionDecisionReason. See CLAUDE_ASKUSERQUESTION_MECHANISM.md §3.3.
function answerExit(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName:            'PreToolUse',
      permissionDecision:       'deny',
      permissionDecisionReason: reason,
    },
  }) + '\n')
  process.exit(0)
}

main().catch(err => {
  try {
    ensureDirs()
    appendFileSync(logPath('hook-debug.log'), `[${new Date().toISOString()}] CRASH: ${err.message}\n${err.stack}\n`)
  } catch {}
  process.exit(0)
})
