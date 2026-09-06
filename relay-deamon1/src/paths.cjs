/**
 * paths.cjs (CommonJS twin of src/paths.js) — used by the CJS entries
 * (relay.cjs, decide.cjs, the *-wrapper.cjs files) which use require(), not import.
 *
 * ⚠️ KEEP IN SYNC with src/paths.js. See that file for the full rationale.
 */
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')

function localAppData() {
  if (process.platform === 'win32')  return path.join(os.homedir(), 'AppData', 'Local')
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support')
  return path.join(os.homedir(), '.local', 'share')
}

const APP_DIR     = path.join(localAppData(), 'VibeRemote')
const RUNTIME_DIR = path.join(APP_DIR, 'runtime')
const LOG_DIR     = path.join(APP_DIR, 'logs')

const runtimePath = (...parts) => path.join(RUNTIME_DIR, ...parts)
const logPath     = (...parts) => path.join(LOG_DIR, ...parts)

function ensureDirs() {
  for (const d of [RUNTIME_DIR, LOG_DIR]) {
    try { fs.mkdirSync(d, { recursive: true }) } catch {}
  }
}

module.exports = { APP_DIR, RUNTIME_DIR, LOG_DIR, runtimePath, logPath, ensureDirs }
