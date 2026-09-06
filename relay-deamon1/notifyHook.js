/**
 * relay-daemon/notifyHook.js
 *
 * Claude Code Notification hook — fires when Claude emits a progress message.
 * These are the "Searching...", "Analyzing..." style messages shown in the CLI.
 *
 * stdin shape: { session_id, message, title? }
 */

import { postTerminalEvent } from './src/supabase.js'
import { mkdirSync, writeFileSync } from 'fs'
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

  recordTranscriptPath(event.session_id, event.transcript_path)

  const message = (event.message || '').trim()
  if (!message) { process.exit(0) }

  await postTerminalEvent({
    session_id: event.session_id,
    event_type: 'notification',
    tool_name:  null,
    summary:    message.slice(0, 200),
    detail:     null,
    status:     null,
  }).catch(() => {})

  process.exit(0)
}

main().catch(() => process.exit(0))
