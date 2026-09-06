/**
 * decide.cjs — PC-side approval for relay-daemon
 *
 * Usage:
 *   node decide.cjs approve <request-id>
 *   node decide.cjs deny    <request-id>
 *
 * Paste the command shown in Claude Code's hook panel with a ! prefix:
 *   ! node decide.cjs approve <id>
 *
 * This writes a local signal file (picked up by the hook in ~150 ms) AND
 * updates Supabase so the mobile app sees the decision immediately.
*/

const { createClient } = require('@supabase/supabase-js')
const path = require('path')
const fs   = require('fs')
const { runtimePath } = require('./src/paths.cjs')

const PENDING_DIR = runtimePath('relay-pending')

// ── Load .env ─────────────────────────────────────────────────────────────────
function loadEnv() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '.env'), 'utf8')
    for (const line of raw.split('\n')) {
      const t  = line.trim()
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

// ── Parse args ────────────────────────────────────────────────────────────────
const [,, action, requestId] = process.argv

if (!['approve', 'deny'].includes(action) || !requestId) {
  console.error('Usage: node decide.cjs <approve|deny> <request-id>')
  process.exit(1)
}

const status = action === 'approve' ? 'approved' : 'denied'

// ── Signal the waiting hook immediately via local file ────────────────────────
// The hook polls every 150 ms — this unblocks it before Supabase even responds
try {
  fs.mkdirSync(PENDING_DIR, { recursive: true })
  fs.writeFileSync(path.join(PENDING_DIR, `${requestId}.${status}`), '')
} catch {}

// ── Also update Supabase so mobile sees the decision ─────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
)

async function main() {
  const { data, error } = await supabase
    .from('pending_requests')
    .update({ status, decided_at: new Date().toISOString(), decided_by: 'pc' })
    .eq('id', requestId)
    .eq('status', 'pending')
    .select('id, tool_name, summary')
    .single()

  if (error) {
    // Hook already unblocked via file — just warn, don't fail hard
    console.warn('Supabase update skipped:', error.message)
    process.exit(0)
  }

  if (!data) {
    console.warn('Request not found or already decided in DB (hook may have timed out)')
    process.exit(0)
  }

  const icon = action === 'approve' ? '✅' : '❌'
  console.log(`${icon} ${status} [${data.tool_name}] ${data.summary}`)
  process.exit(0)
}

main().catch(err => {
  console.error('Fatal:', err.message)
  process.exit(1)
})
