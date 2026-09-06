/**
 * relay.cjs — control script for relay-daemon
 *
 * Mode switching (directly edits Claude Code's settings.json):
 *   ! node relay.cjs mobile   → enable interception, send to mobile app
 *   ! node relay.cjs cli      → disable interception, Claude runs normally
 *
 * Responding to a pending request (when mobile mode is active):
 *   ! node relay.cjs 1        → Yes  (approve)
 *   ! node relay.cjs 2        → Yes, allow all  (approve + skip future prompts)
 *   ! node relay.cjs 3        → No   (deny)
 *
 * Other:
 *   ! node relay.cjs status   → show current mode and pending request
 *   ! node relay.cjs reset    → clear "allow all" flag
 */

const path = require('path')
const fs   = require('fs')
const os   = require('os')
const { RUNTIME_DIR } = require('./src/paths.cjs')

// Settings.json — Claude Code's config file (hook is added/removed here)
const SETTINGS_FILE = path.join(
  os.homedir(),
  '.claude', 'settings.json'
)

// The hook block injected when switching to mobile mode
const HOOK_BLOCK = {
  PreToolUse: [{
    matcher: 'Bash|Write|Edit|MultiEdit|Read|AskUserQuestion',
    hooks: [{ type: 'command', command: `node "${path.join(__dirname, 'hook-wrapper.cjs')}"` }],
  }],
  PostToolUse: [{
    matcher: 'Bash|Write|Edit|MultiEdit|Read',
    hooks: [{ type: 'command', command: `node "${path.join(__dirname, 'postHook-wrapper.cjs')}"` }],
  }],
  Notification: [{
    hooks: [{ type: 'command', command: `node "${path.join(__dirname, 'notifyHook-wrapper.cjs')}"` }],
  }],
  Stop: [{
    hooks: [{ type: 'command', command: `node "${path.join(__dirname, 'stopHook-wrapper.cjs')}"` }],
  }],
}

// These go into permissions.allow so Claude Code never shows its own interactive
// prompt for hook-managed tools. Without this, Claude Code's built-in "Allow? [y/n]"
// prompt appears alongside the hook and stays open even after mobile approves —
// the user then has to type in the terminal too (double-approval bug).
// The hook is the sole gatekeeper; it exits 0 (allow) or 2 (deny) instead.
const HOOK_TOOLS_ALLOW = ['Bash(*)', 'Write(*)', 'Edit(*)', 'MultiEdit(*)', 'Read(*)']

const TEMP_DIR       = RUNTIME_DIR
const PENDING_DIR    = path.join(TEMP_DIR, 'relay-pending')
const CURRENT_FILE   = path.join(TEMP_DIR, 'relay-current.txt')
const ALLOW_ALL_FILE = path.join(TEMP_DIR, 'relay-allow-all.txt')

// ── Load .env ─────────────────────────────────────────────────────────────────
// Credentials live in the stable userData dir (survives reinstalls); fall back to
// the legacy bundled .env. Keep in sync with src/machineEnv.js.
function machineEnvFile() {
  if (process.env.VIBE_MACHINE_ENV) return process.env.VIBE_MACHINE_ENV
  const os = require('os')
  // Probe every dir name this app has shipped under (productName drives Electron's
  // userData path and has changed across releases). Keep in sync with src/machineEnv.js.
  const appNames = ['VibeRemote', 'Vibe Remote', 'vibe-remote', 'my-app']
  const root = process.platform === 'win32'
    ? path.join(os.homedir(), 'AppData', 'Roaming')
    : process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : path.join(os.homedir(), '.config')
  for (const n of appNames) {
    const p = path.join(root, n, 'machine.env')
    if (fs.existsSync(p)) return p
  }
  return path.join(__dirname, '.env')
}

function loadEnv() {
  try {
    const raw = fs.readFileSync(machineEnvFile(), 'utf8')
    for (const line of raw.split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq < 0) continue
      const key = t.slice(0, eq).trim()
      const val = t.slice(eq + 1).trim()
      if (!process.env[key]) process.env[key] = val
    }
  } catch {}
}

loadEnv()

// ── Helpers ───────────────────────────────────────────────────────────────────
function readSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) } catch { return {} }
}

function writeSettings(obj) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(obj, null, 2) + '\n', 'utf8')
}

function isHookEnabled() {
  const s = readSettings()
  return !!(s.hooks && s.hooks.PreToolUse)
}

function readCurrentId() {
  try { return fs.readFileSync(CURRENT_FILE, 'utf8').trim() || null } catch { return null }
}

// ── Parse command ─────────────────────────────────────────────────────────────
const [,, cmd] = process.argv

if (!cmd) {
  const active   = isHookEnabled()
  const allowAll = fs.existsSync(ALLOW_ALL_FILE)
  const pending  = readCurrentId()
  console.log(`Mode:     ${active ? 'MOBILE (interception active)' : 'CLI (no interception)'}`)
  if (allowAll) console.log('Allow-all: YES  (! node relay.cjs reset  to clear)')
  console.log(`Pending:  ${pending || 'none'}`)
  console.log('')
  console.log('Switch:   ! node relay.cjs mobile   or   ! node relay.cjs cli')
  console.log('Respond:  ! node relay.cjs 1 (yes)  /  ! node relay.cjs 3 (no)')
  process.exit(0)
}

// ── mobile — enable PreToolUse hook in settings.json ─────────────────────────
if (cmd === 'mobile') {
  const settings = readSettings()
  settings.hooks = HOOK_BLOCK

  // Suppress Claude Code's own interactive prompt for the hook-managed tools.
  // The hook exits 0 (allow) or 2 (deny) — that is the only approval step needed.
  if (!settings.permissions)       settings.permissions = {}
  if (!settings.permissions.allow) settings.permissions.allow = []
  for (const tool of HOOK_TOOLS_ALLOW) {
    if (!settings.permissions.allow.includes(tool)) {
      settings.permissions.allow.push(tool)
    }
  }

  writeSettings(settings)
  console.log('Switched to MOBILE mode')
  console.log('Claude\'s actions are now intercepted and sent to the mobile app.')
  console.log('CLI fallback still works:  ! node relay.cjs 1  (yes)  /  3  (no)')
  process.exit(0)
}

// ── cli — remove PreToolUse hook from settings.json ───────────────────────────
if (cmd === 'cli') {
  const settings = readSettings()
  delete settings.hooks

  // Remove the auto-allow entries we added in mobile mode so Claude Code's own
  // interactive prompts come back for normal CLI use
  if (settings.permissions?.allow) {
    settings.permissions.allow = settings.permissions.allow.filter(
      t => !HOOK_TOOLS_ALLOW.includes(t)
    )
    if (!settings.permissions.allow.length)        delete settings.permissions.allow
    if (!Object.keys(settings.permissions).length) delete settings.permissions
  }

  writeSettings(settings)
  // Also clear allow-all so it doesn't linger
  try { fs.unlinkSync(ALLOW_ALL_FILE) } catch {}
  console.log('Switched to CLI mode')
  console.log('Interception disabled — Claude runs without approval prompts.')
  console.log('To re-enable:  ! node relay.cjs mobile')
  process.exit(0)
}

// ── status ────────────────────────────────────────────────────────────────────
if (cmd === 'status') {
  const active   = isHookEnabled()
  const allowAll = fs.existsSync(ALLOW_ALL_FILE)
  const pending  = readCurrentId()
  console.log(`Mode:       ${active ? 'MOBILE' : 'CLI'}`)
  console.log(`Allow all:  ${allowAll ? 'YES  (! node relay.cjs reset  to clear)' : 'no'}`)
  console.log(`Pending ID: ${pending || 'none'}`)
  process.exit(0)
}

// ── reset allow-all ───────────────────────────────────────────────────────────
if (cmd === 'reset') {
  try { fs.unlinkSync(ALLOW_ALL_FILE) } catch {}
  console.log('Allow-all cleared — approval prompts will show again')
  process.exit(0)
}

// ── answer <n> — pick option n for a pending AskUserQuestion (1-based) ─────────
// Mirrors the approve/deny local-signal path: writes {id}.answer.json which the
// hook's waitForAnswer() file-poll picks up in ~150ms, AND posts to the server so
// the mobile feed reflects the answer. Single-question, single-select for the CLI.
if (cmd === 'answer') {
  const pick = parseInt(process.argv[3], 10)
  if (!pick || Number.isNaN(pick) || pick < 1) {
    console.error('Usage:  ! node relay.cjs answer <n>   (n = option number, 1-based)')
    process.exit(1)
  }

  const QFILE = path.join(TEMP_DIR, 'relay-current-question.json')
  let q
  try { q = JSON.parse(fs.readFileSync(QFILE, 'utf8')) } catch {
    console.error('No pending question found.')
    process.exit(1)
  }

  const requestId = q.requestId || readCurrentId()
  const question  = q.questions?.[0]
  const option    = question?.options?.[pick - 1]
  if (!requestId || !option) {
    console.error(`Option ${pick} not found (question has ${question?.options?.length ?? 0} options).`)
    process.exit(1)
  }

  const answers = [{
    question_index: 0,
    selected: [{ index: pick - 1, label: option.label }],
  }]

  // Local signal — unblocks the hook immediately.
  try {
    fs.mkdirSync(PENDING_DIR, { recursive: true })
    fs.writeFileSync(
      path.join(PENDING_DIR, `${requestId}.answer.json`),
      JSON.stringify({ selected_options: answers }),
      'utf8',
    )
  } catch (e) {
    console.error('Failed to write answer signal:', e.message)
    process.exit(1)
  }

  // Also tell the server so mobile sees the answer.
  ;(async () => {
    try {
      const res = await fetch(`${process.env.API_URL}/relay/answer`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-machine-api-key': process.env.MACHINE_API_KEY },
        body:    JSON.stringify({ requestId, answers }),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => res.status)
        console.log(`✅ Answered "${option.label}"  (hook signaled; API: ${text})`)
      } else {
        console.log(`✅ Answered "${option.label}"`)
      }
    } catch (err) {
      console.log(`✅ Answered "${option.label}"  (hook signaled; API unreachable: ${err.message})`)
    }
    process.exit(0)
  })()
  return
}

// ── approve / deny (only meaningful in mobile mode) ───────────────────────────
let isAllowAll = false
let status

if      (cmd === '1' || cmd === 'approve' || cmd === 'a') { status = 'approved' }
else if (cmd === '2')                                      { status = 'approved'; isAllowAll = true }
else if (cmd === '3' || cmd === 'deny'    || cmd === 'd') { status = 'denied' }
else {
  console.error(`Unknown command: "${cmd}"`)
  console.error('Run  ! node relay.cjs  for help')
  process.exit(1)
}

const requestId = readCurrentId()

if (!requestId) {
  if (isAllowAll) {
    fs.mkdirSync(TEMP_DIR, { recursive: true })
    fs.writeFileSync(ALLOW_ALL_FILE, new Date().toISOString(), 'utf8')
    console.log('Allow-all enabled — future requests auto-approved')
    console.log('Run  ! node relay.cjs reset  to stop')
    process.exit(0)
  }
  console.error('No pending request found. Is a hook currently waiting?')
  process.exit(1)
}

// Signal hook immediately via local file (~150 ms pickup)
try {
  fs.mkdirSync(PENDING_DIR, { recursive: true })
  fs.writeFileSync(path.join(PENDING_DIR, `${requestId}.${status}`), '')
} catch (e) {
  console.error('Failed to write signal file:', e.message)
  process.exit(1)
}

if (isAllowAll) {
  fs.mkdirSync(TEMP_DIR, { recursive: true })
  fs.writeFileSync(ALLOW_ALL_FILE, new Date().toISOString(), 'utf8')
}

// Update decision via VPS — service key stays on the server
async function main() {
  const icon  = status === 'approved' ? '✅' : '❌'
  const label = status === 'approved' ? 'Approved' : 'Denied'

  try {
    const res = await fetch(`${process.env.API_URL}/relay/decide`, {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-machine-api-key': process.env.MACHINE_API_KEY,
      },
      body: JSON.stringify({ requestId, decision: status }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => res.status)
      console.log(`${icon} ${label}  (hook signaled; API: ${text})`)
    } else {
      console.log(`${icon} ${label}${isAllowAll ? '  [allow-all ON]' : ''}`)
    }
  } catch (err) {
    console.log(`${icon} ${label}  (hook signaled; API unreachable: ${err.message})`)
  }

  if (isAllowAll) console.log('Run  ! node relay.cjs reset  to stop auto-approving')
  process.exit(0)
}

main().catch(err => {
  console.error('Fatal:', err.message)
  process.exit(1)
})
