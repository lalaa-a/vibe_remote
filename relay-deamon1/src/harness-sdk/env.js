/**
 * harness-sdk/env.js — loose .env loader.
 *
 * Unlike src/config.js (which calls process.exit when credentials are missing),
 * this loader is non-fatal. Detection / `list` must work even before a machine
 * is registered (no .env yet), so nothing here is "required".
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { machineEnvFile } from '../machineEnv.js'

const __dir = dirname(fileURLToPath(import.meta.url))

// src/harness-sdk → up two levels → relay-deamon1 root (used for bundled plugin/
// wrapper paths — NOT for credentials, which live in the stable userData file)
export const RELAY_ROOT = join(__dir, '..', '..')

export function loadEnv() {
  const env = {}
  const ENV_FILE = machineEnvFile()
  if (!existsSync(ENV_FILE)) return env
  try {
    const raw = readFileSync(ENV_FILE, 'utf8')
    for (const line of raw.split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq < 0) continue
      env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim()
    }
  } catch {
    // unreadable .env → behave as if absent
  }
  return env
}

/** Build the machine context handed to provider.mobile.enable(ctx). */
export function machineCtx() {
  const e = loadEnv()
  return {
    apiUrl:        e.API_URL || '',
    machineApiKey: e.MACHINE_API_KEY || '',
    userId:        e.USER_ID || '',
    machineId:     e.MACHINE_ID || '',
    supabaseUrl:   e.SUPABASE_URL || '',
    supabaseKey:   e.SUPABASE_ANON_KEY || '',
    timeoutMs:     (parseInt(e.TIMEOUT_SECONDS, 10) || 300) * 1000,
    failOpen:      e.FAIL_OPEN !== 'false',
  }
}

export function isRegistered() {
  return !!loadEnv().MACHINE_ID
}
