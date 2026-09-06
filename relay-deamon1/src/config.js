import { readFileSync } from 'fs'
import { machineEnvFile } from './machineEnv.js'

function loadEnv() {
  try {
    const raw = readFileSync(machineEnvFile(), 'utf8')
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq  = trimmed.indexOf('=')
      if (eq < 0) continue
      const key = trimmed.slice(0, eq).trim()
      const val = trimmed.slice(eq + 1).trim()
      if (!process.env[key]) process.env[key] = val
    }
  } catch {
    // .env not found — rely on real env vars
  }
}

loadEnv()

function required(key) {
  const v = process.env[key]
  if (!v) throw new Error(`Missing required env var: ${key}`)
  return v
}

function list(key) {
  const v = process.env[key] || ''
  return v.split(',').map(s => s.trim()).filter(Boolean)
}

export const config = {
  supabaseUrl:    required('SUPABASE_URL'),
  supabaseKey:    required('SUPABASE_ANON_KEY'),
  // API_URL: VPS backend — all writes go here, service key is never needed locally
  apiUrl:         required('API_URL'),
  machineId:      required('MACHINE_ID'),
  machineLabel:   process.env.MACHINE_LABEL  || 'Unknown Machine',
  machineApiKey:  required('MACHINE_API_KEY'),
  // USER_ID is no longer set at registration — the machine is unowned until a
  // phone pairs it (mobile-first auth). Defaults to '' so the daemon runs unpaired.
  userId:         process.env.USER_ID || '',
  // Session token issued by the server on pairing; delivered to machine.env by the
  // desktop UI. Reserved for future per-request session verification.
  machineSessionToken: process.env.MACHINE_SESSION_TOKEN || '',
  timeoutMs:      (parseInt(process.env.TIMEOUT_SECONDS) || 300) * 1000,
  failOpen:       process.env.FAIL_OPEN !== 'false',
  alwaysAllow:    list('ALWAYS_ALLOW'),
  alwaysBlock:    list('ALWAYS_BLOCK'),
}
