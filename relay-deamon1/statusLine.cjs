/**
 * statusLine.cjs — Claude Code custom status line command (mobile mode only).
 *
 * Registered into ~/.claude/settings.json as `statusLine` when mobile support for
 * claude-code is enabled (settingsHook strategy). Claude Code runs this often and pipes
 * a JSON blob on stdin; whatever we print on stdout becomes the CLI's status line.
 *
 * Two jobs (see LIVE_TOKEN_STATUSLINE_DESIGN.md — the "poke" variant):
 *   1. Drop a tiny poke file <runtime>/usage-<sessionId>.json so the heartbeat re-reads
 *      the transcript for token usage NOW (at Claude's refresh cadence) instead of waiting
 *      for its 3s tick. The heartbeat stays the single accumulator (turn-cumulative + reset).
 *   2. Print a compact status line so the desktop CLI still shows useful info (we replace
 *      Claude's default status line while registered).
 *
 * MUST be fast: read stdin, read only the transcript TAIL, write one small file, print.
 * Written as CommonJS so Claude Code launches it directly (no ESM-import wrapper needed).
 */
const fs = require('node:fs')
const { runtimePath, ensureDirs } = require('./src/paths.cjs')

function readStdin() { try { return fs.readFileSync(0, 'utf8') } catch { return '' } }

function fmt(n) {
  if (!n || n < 1000) return String(n || 0)
  if (n < 1e6) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k'
  return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'
}

// Newest assistant usage from the transcript TAIL only (never parse the whole file).
function latestUsage(transcriptPath) {
  try {
    const stat = fs.statSync(transcriptPath)
    const start = Math.max(0, stat.size - 64 * 1024)
    const fd = fs.openSync(transcriptPath, 'r')
    const buf = Buffer.alloc(stat.size - start)
    fs.readSync(fd, buf, 0, buf.length, start)
    fs.closeSync(fd)
    const lines = buf.toString('utf8').split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim()
      if (!line) continue
      let e
      try { e = JSON.parse(line) } catch { continue }
      const u = e && e.type === 'assistant' && e.message && e.message.usage
      if (u) return {
        input:  (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
        output: u.output_tokens || 0,
      }
    }
  } catch {}
  return null
}

let j = {}
try { j = JSON.parse(readStdin()) || {} } catch {}

const sid = j.session_id

// 1. Poke the heartbeat (fire-and-forget; the heartbeat computes the real turn totals).
if (sid) {
  try {
    ensureDirs()
    fs.writeFileSync(runtimePath(`usage-${sid}.json`), JSON.stringify({ sessionId: sid, ts: Date.now() }))
  } catch {}
}

// 2. Print a compact, token-focused status line for the desktop CLI.
const dir = (j.workspace && j.workspace.current_dir) || j.cwd || ''
const dirName = dir ? dir.split(/[\\/]/).filter(Boolean).pop() : ''
const model = (j.model && j.model.display_name) || 'Claude'
const u = j.transcript_path ? latestUsage(j.transcript_path) : null

const parts = []
if (dirName) parts.push(dirName)
parts.push(model)
if (u) parts.push(`↑${fmt(u.input)} ↓${fmt(u.output)} tok`)
process.stdout.write(parts.join('  ·  '))
