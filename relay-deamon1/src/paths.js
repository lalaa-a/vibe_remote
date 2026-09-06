/**
 * paths.js (ESM) — the single source of truth for the app's writable directories.
 *
 * Replaces the old hardcoded `C:\temp\...`. Those files are cross-process
 * coordination + logs shared by the Claude Code hooks, the heartbeat, relay.cjs,
 * the OpenCode plugin and Electron main — so EVERY process must derive the SAME
 * directory. It is computed from os.homedir() (never import.meta.url), so it is
 * identical no matter who spawned the process, and is bundling-safe (inline-able).
 *
 *   runtime → %LOCALAPPDATA%\VibeRemote\runtime   (transient flags/pending/PIDs)
 *   logs    → %LOCALAPPDATA%\VibeRemote\logs       (debug logs)
 *
 * Local (not Roaming) so transient files never sync across machines in a domain.
 *
 * ⚠️ KEEP IN SYNC with src/paths.cjs (the CommonJS twin used by relay.cjs,
 *    decide.cjs and the *-wrapper.cjs files) and with the inlined copies in
 *    src/harnesses/opencode/plugin/relay.js and src/main.js.
 */
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

function localAppData() {
  if (process.platform === 'win32')  return path.join(os.homedir(), 'AppData', 'Local')
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support')
  return path.join(os.homedir(), '.local', 'share')
}

export const APP_DIR     = path.join(localAppData(), 'VibeRemote')
export const RUNTIME_DIR = path.join(APP_DIR, 'runtime')
export const LOG_DIR     = path.join(APP_DIR, 'logs')

/** Build a path inside the runtime dir, e.g. runtimePath('relay-pending'). */
export const runtimePath = (...parts) => path.join(RUNTIME_DIR, ...parts)
/** Build a path inside the logs dir, e.g. logPath('hook-debug.log'). */
export const logPath     = (...parts) => path.join(LOG_DIR, ...parts)

/** Create the runtime + log dirs (idempotent, never throws). */
export function ensureDirs() {
  for (const d of [RUNTIME_DIR, LOG_DIR]) {
    try { fs.mkdirSync(d, { recursive: true }) } catch {}
  }
}
