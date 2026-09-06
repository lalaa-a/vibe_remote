/**
 * relay-daemon/stopHook.js
 *
 * Claude Code Stop hook — fires when Claude finishes a task.
 * The `result` field contains Claude's own summary of what it did.
 *
 * stdin shape: { session_id, stop_reason?, result? }
 */

import { postTerminalEvent } from './src/supabase.js'
import { mkdirSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { runtimePath } from './src/paths.js'

const TRANSCRIPT_DIR = runtimePath('transcript-paths')

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

  const summary = event.result
    ? String(event.result).slice(0, 300)
    : 'Task finished'

  await postTerminalEvent({
    session_id: event.session_id,
    event_type: 'stop',
    tool_name:  null,
    summary,
    detail:     null,
    status:     'success',
  }).catch(() => {})

  // Do NOT delete the transcript mapping here. Stop fires at the end of EVERY turn
  // (not when the CLI closes), so deleting it removed the mapping the heartbeat's 3s
  // transcript tailer needs — short turns deleted their mapping before the tailer
  // read the new reasoning, so narrative never reached mobile. Aging of genuinely
  // dead sessions is handled by the heartbeat's 5-min STALE_MAPPING_MS gate; a
  // closed CLI is tracked separately via the relay-pid liveness probe.

  // Turn ended → clear the busy flag and drop a ready flag so the heartbeat injects any
  // prompt queued for this now-idle session within ~1s. See FAST_PROMPT_DELIVERY_DESIGN.md.
  if (event.session_id) {
    try { unlinkSync(runtimePath(`relay-busy-${event.session_id}.flag`)) } catch {}
    try { writeFileSync(runtimePath(`relay-ready-${event.session_id}.flag`), '1') } catch {}

    // Drop any unconsumed stop flag. The turn is over, so a stop that raced the finish
    // line has nothing left to halt — and if it survived, the FIRST tool call of the
    // user's next prompt would consume it and kill that prompt on arrival.
    try { unlinkSync(runtimePath(`relay-stop-${event.session_id}.flag`)) } catch {}
  }

  process.exit(0)
}

main().catch(() => process.exit(0))
