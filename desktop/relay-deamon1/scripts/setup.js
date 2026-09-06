#!/usr/bin/env node
/**
 * Run once to register this machine in Supabase and write .env
 *
 *   USER_ID=your-user-uuid SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/setup.js
 */

import { createClient } from '@supabase/supabase-js'
import { randomUUID }   from 'crypto'
import { createHash }   from 'crypto'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { hostname }     from 'os'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dir = dirname(fileURLToPath(import.meta.url))
const root  = join(__dir, '..')

// ── Read existing .env if present ─────────────────────────────────────────────
function readEnv() {
  const path = join(root, '.env')
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t  = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq < 0) continue
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim()
  }
  return out
}

function writeEnv(vars) {
  const lines = Object.entries(vars).map(([k, v]) => `${k}=${v}`)
  writeFileSync(join(root, '.env'), lines.join('\n') + '\n')
}

async function main() {
  const existing = readEnv()

  const supabaseUrl        = process.env.SUPABASE_URL         || existing.SUPABASE_URL
  const supabaseKey        = process.env.SUPABASE_ANON_KEY    || existing.SUPABASE_ANON_KEY
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || existing.SUPABASE_SERVICE_KEY
  const userId             = process.env.USER_ID              || existing.USER_ID

  if (!supabaseUrl || !supabaseKey || !supabaseServiceKey || !userId) {
    console.error('\nMissing required values. Set these in .env or pass as env vars:\n')
    if (!supabaseUrl)        console.error('  ❌ SUPABASE_URL')
    if (!supabaseKey)        console.error('  ❌ SUPABASE_ANON_KEY')
    if (!supabaseServiceKey) console.error('  ❌ SUPABASE_SERVICE_KEY')
    if (!userId)             console.error('  ❌ USER_ID')
    console.error('\nGet SUPABASE_SERVICE_KEY from: Supabase dashboard → Project Settings → API → service_role\n')
    process.exit(1)
  }

  // Use service role key for the insert — bypasses RLS so the daemon
  // (which is not a logged-in user) can write to the machines table
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // ── Always generate FRESH machine credentials on each new machine ─────────
  // Never reuse MACHINE_ID from an existing .env — that would make both
  // machines share the same row in Supabase instead of having separate rows.
  const machineId     = randomUUID()
  const machineApiKey = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')
  const machineLabel  = process.env.MACHINE_LABEL || existing.MACHINE_LABEL || hostname()
  const apiKeyHash    = createHash('sha256').update(machineApiKey).digest('hex')

  console.log(`\n🔧 Registering machine: ${machineLabel}`)
  console.log(`   Machine ID: ${machineId}`)

  // ── Insert new machine row ────────────────────────────────────────────────
  const { data, error } = await supabase
    .from('machines')
    .insert({
      id:           machineId,
      user_id:      userId,
      label:        machineLabel,
      api_key_hash: apiKeyHash,
      is_online:    true,
      last_seen:    new Date().toISOString(),
    })
    .select('id, label')
    .single()

  if (error) {
    console.error('❌ Supabase error:', error.message)
    process.exit(1)
  }

  // ── Write .env — always includes all keys including service key ───────────
  writeEnv({
    SUPABASE_URL:         supabaseUrl,
    SUPABASE_ANON_KEY:    supabaseKey,
    SUPABASE_SERVICE_KEY: supabaseServiceKey,
    MACHINE_ID:           machineId,
    MACHINE_LABEL:        machineLabel,
    MACHINE_API_KEY:      machineApiKey,
    USER_ID:              userId,
    TIMEOUT_SECONDS:      existing.TIMEOUT_SECONDS || '300',
    FAIL_OPEN:            existing.FAIL_OPEN        || 'true',
    ALWAYS_ALLOW:         existing.ALWAYS_ALLOW     || 'node_modules,\\.git/,dist/,\\.next/',
    ALWAYS_BLOCK:         existing.ALWAYS_BLOCK     || '',
  })

  console.log(`✅ Machine registered: ${data.label}`)
  console.log(`✅ .env written\n`)
  console.log('Next: add this to ~/.claude/settings.json:\n')
  console.log(JSON.stringify({
    hooks: {
      PreToolUse: [{
        matcher: 'Bash|Write|Edit|MultiEdit',
        hooks: [{
          type:    'command',
          command: `node ${join(root, 'hook.js')}`,
        }],
      }],
    },
  }, null, 2))
  console.log()
}

main().catch(err => {
  console.error('Setup failed:', err.message)
  process.exit(1)
})