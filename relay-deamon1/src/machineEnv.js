/**
 * machineEnv.js — resolves WHERE the machine credentials (.env) live.
 *
 * The credentials must survive app reinstalls and Squirrel version updates. The
 * bundled `relay-deamon1/.env` does NOT: forge's postPackage strips it, and every
 * (re)install replaces the whole versioned app dir. So machine identity is stored
 * in Electron's userData dir (%APPDATA%\VibeRemote on Windows), which Squirrel never
 * touches. Losing it was forcing a re-registration (reclaim) — and a new API key —
 * on every reinstall, which broke the OpenCode plugin's copied key.
 *
 * Resolution order:
 *   1. $VIBE_MACHINE_ENV         — explicit path passed by main.js to spawned procs
 *   2. <userData>/machine.env    — the stable location (survives reinstalls)
 *   3. relay-deamon1/.env        — legacy/bundled fallback (first run, pre-migration)
 */
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dir = path.dirname(fileURLToPath(import.meta.url))

// relay-deamon1/.env — src/ is one level under the daemon root
const LEGACY_ENV = path.join(__dir, '..', '.env')

// Electron derives userData from package.json `productName` (falling back to `name`).
// That value has changed across releases ('my-app' → 'Vibe Remote' → 'VibeRemote'), and
// the hooks are spawned by Claude Code — NOT by main.js — so they never inherit
// $VIBE_MACHINE_ENV and must locate the file themselves. Hardcoding one name here is why
// a rename silently broke every hook: the path missed, the bundled .env is stripped at
// package time, and config.js then threw "Missing required env var" on every tool call.
//
// So probe every directory name this app has ever shipped under, newest first, and take
// whichever actually holds the credentials. Add new names to the FRONT of this list if
// productName ever changes again (and to PRIOR_APP_DIR_NAMES in src/main.js, which
// migrates the file forward into the current dir).
const APP_DIR_NAMES = ['VibeRemote', 'Vibe Remote', 'vibe-remote', 'my-app']

function appDataRoot() {
  if (process.platform === 'win32')  return path.join(os.homedir(), 'AppData', 'Roaming')
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support')
  return path.join(os.homedir(), '.config')
}

export const CANDIDATE_MACHINE_ENVS = APP_DIR_NAMES.map(
  (n) => path.join(appDataRoot(), n, 'machine.env')
)

// The canonical current location (first candidate) — where a fresh install writes.
export const STABLE_MACHINE_ENV = CANDIDATE_MACHINE_ENVS[0]

export function machineEnvFile() {
  if (process.env.VIBE_MACHINE_ENV) return process.env.VIBE_MACHINE_ENV
  for (const p of CANDIDATE_MACHINE_ENVS) {
    if (fs.existsSync(p)) return p
  }
  return LEGACY_ENV
}
