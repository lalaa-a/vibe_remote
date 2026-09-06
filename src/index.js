import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rateLimit } from 'express-rate-limit'
import { Router } from 'express'
import { db } from './supabase.js'
import { requireMachineAuth } from './middleware/auth.js'
import machinesRouter from './routes/machines.js'
import relayRouter from './routes/relay.js'
import mobileRouter from './routes/mobile.js'
import harnessRouter from './routes/harness.js'
import profileRouter from './routes/profile.js'
import { startStaleSweeper } from './sweeper.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app  = express()
const PORT = process.env.PORT || 3000

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(cors())
app.use(express.json({ limit: '2mb' }))

// Global IP-keyed limiter — protects unauthenticated surface (auth, machine keys)
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests, slow down' },
})
app.use(limiter)

// Strict limit on machine registration (one-time operation)
const registerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Too many registration attempts' },
})

// ── command/next — relay daemon calls this with machine key (NOT user JWT) ─────
// Mounted BEFORE /mobile so this path is handled by machine auth, not user auth.
const commandRouter = Router()
commandRouter.get('/next', requireMachineAuth, async (req, res) => {
  // The desktop may scope the claim to one session (?session=<id>) when it KNOWS that
  // CLI is idle (its local busy-flag is clear). Scoped claims skip the coarse 30s
  // last_activity gate — that gate is what made delivery slow. The unscoped backstop
  // path keeps the legacy time gate as a safety net. See FAST_PROMPT_DELIVERY_DESIGN.md.
  const scopedSession = req.query.session || null

  let pendingQ = db
    .from('mobile_commands')
    .select('*')
    .eq('machine_id', req.machine.id)
    .eq('status', 'pending')
  if (scopedSession) pendingQ = pendingQ.eq('session_id', scopedSession)

  const { data: commands } = await pendingQ
    .order('created_at', { ascending: true })
    .limit(10)

  if (!commands?.length) return res.json(null)

  const idleThreshold = new Date(Date.now() - 30_000).toISOString()

  for (const cmd of commands) {
    let query = db
      .from('agents')
      .select('id, session_id, cwd, harness, pending_count, last_activity_at')
      .eq('machine_id', req.machine.id)
      .eq('pending_count', 0)

    // Only the unscoped backstop applies the 30s idle timer; a scoped call trusts the
    // desktop's busy-flag gating, so it delivers the instant the turn ends.
    if (!scopedSession) {
      query = query.or(`last_activity_at.lt.${idleThreshold},last_activity_at.is.null`)
    }

    if (cmd.session_id) {
      query = query.eq('session_id', cmd.session_id)
    }

    const { data: agents } = await query.limit(1)

    if (!agents?.length) {
      const { data: blocker } = await db
        .from('agents')
        .select('session_id, pending_count, last_activity_at')
        .eq('machine_id', req.machine.id)
        .eq('session_id', cmd.session_id ?? '')
        .maybeSingle()

      if (blocker) {
        console.log(`[command/next] blocked — session ${cmd.session_id} pending_count=${blocker.pending_count} last_activity=${blocker.last_activity_at}`)
      } else {
        console.log(`[command/next] blocked — no agent row found for session ${cmd.session_id ?? '(any)'}`)
      }
      continue
    }

    const agent = agents[0]

    const { data: claimed, error: claimErr } = await db
      .from('mobile_commands')
      .update({ status: 'delivered', delivered_at: new Date().toISOString() })
      .eq('id', cmd.id)
      .eq('status', 'pending')
      .select('id')
      .single()

    if (claimErr || !claimed) continue

    console.log(`[command/next] delivering prompt to session ${agent.session_id} harness=${agent.harness ?? 'claude-code'}`)
    return res.json({
      prompt:     cmd.prompt,
      sessionId:  agent.session_id,
      sessionCwd: agent.cwd,
      harness:    agent.harness ?? 'claude-code',
    })
  }

  res.json(null)
})

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }))

app.get('/confirmed', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/confirmed.html'))
})

// command/next uses machine auth — mount before /mobile (which uses user auth)
app.use('/mobile/command', commandRouter)

app.use('/machines', machinesRouter)
app.use('/relay',    relayRouter)
app.use('/mobile',   mobileRouter)
app.use('/harness',  harnessRouter)
app.use('/profile',  profileRouter)

// Apply strict limiter only to the register endpoint
app.use('/machines/register', registerLimiter)

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[unhandled]', err)
  res.status(500).json({ error: 'Internal server error' })
})

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Vibe Remote API listening on port ${PORT}`)
  console.log(`Supabase project: ${process.env.SUPABASE_URL}`)
  // Close out turns abandoned by a disconnected desktop (STALE_WORKING_ON_DISCONNECT_DESIGN.md §3-B).
  startStaleSweeper()
})
