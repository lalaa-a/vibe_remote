import { Router } from 'express'
import { db } from '../supabase.js'
import { requireMachineAuth, requireUserAuth, requireUserAuthFast } from '../middleware/auth.js'
import { broadcastMachine } from '../realtime.js'

const router = Router()

// POST /harness/report  (machine-authed)
// Desktop daemon calls this on launch and after every toggle to push the current
// inventory of installed harnesses + their mobile_enabled state. Stored in
// machine_harnesses so the mobile app can read it without polling the desktop.
router.post('/report', requireMachineAuth, async (req, res) => {
  const rows = (req.body.harnesses ?? []).map(h => ({
    machine_id:     req.machine.id,
    harness:        h.harness,
    display_name:   h.displayName ?? h.harness,
    installed:      !!h.installed,
    mobile_enabled: !!h.mobile_enabled,
    capabilities:   h.capabilities ?? {},
    version:        h.version ?? null,
    updated_at:     new Date().toISOString(),
  }))

  if (!rows.length) return res.json({ ok: true })

  const { error } = await db
    .from('machine_harnesses')
    .upsert(rows, { onConflict: 'machine_id,harness' })

  if (error) {
    console.error('[harness/report]', error.message)
    return res.status(500).json({ error: error.message })
  }

  // Reconcile remote-control desires: a report reflects the desktop's ACTUAL state.
  // Any pending desired_enabled that now matches reality has been fulfilled, so we
  // clear it. Without this it lingers forever and the 15s apply-desired loop keeps
  // re-applying it — which silently undoes a later manual desktop toggle (toggle
  // off → bounces back on). We only clear when desired == actual, so a desire that
  // hasn't been applied yet (actual still differs) survives until it takes effect.
  const enabled  = rows.filter(r => r.mobile_enabled).map(r => r.harness)
  const disabled = rows.filter(r => !r.mobile_enabled).map(r => r.harness)
  if (enabled.length) {
    await db.from('machine_harnesses')
      .update({ desired_enabled: null })
      .eq('machine_id', req.machine.id)
      .in('harness', enabled)
      .eq('desired_enabled', true)
  }
  if (disabled.length) {
    await db.from('machine_harnesses')
      .update({ desired_enabled: null })
      .eq('machine_id', req.machine.id)
      .in('harness', disabled)
      .eq('desired_enabled', false)
  }

  // Push the change to any listening phone so its Machines tab + chat composer
  // update instantly instead of waiting up to 30s for the next poll. The desktop
  // calls /report immediately on every toggle (harness-cli.js), so this fires the
  // moment a harness is switched on/off. Polling stays as the backstop.
  broadcastMachine(req.machine.id, 'harness')

  res.json({ ok: true })
})

// GET /harness/desired  (machine-authed)
// Desktop polls this to apply phone-requested toggles (desired_enabled set by
// /harness/:machineId/desire). Returns only rows with a non-null desired_enabled.
router.get('/desired', requireMachineAuth, async (req, res) => {
  const { data, error } = await db
    .from('machine_harnesses')
    .select('harness, desired_enabled')
    .eq('machine_id', req.machine.id)
    .not('desired_enabled', 'is', null)

  if (error) {
    console.error('[harness/desired]', error.message)
    return res.status(500).json({ error: error.message })
  }

  res.json(data ?? [])
})

// GET /harness/:machineId  (fast user-auth — polled every 30s by the Machines tab)
router.get('/:machineId', requireUserAuthFast, async (req, res) => {
  // Ownership check
  const { data: machine, error: mErr } = await db
    .from('machines')
    .select('user_id')
    .eq('id', req.params.machineId)
    .single()

  if (mErr || !machine) return res.status(404).json({ error: 'Machine not found' })
  if (machine.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' })

  const { data, error } = await db
    .from('machine_harnesses')
    .select('harness, display_name, installed, mobile_enabled, capabilities, version, desired_enabled, updated_at')
    .eq('machine_id', req.params.machineId)
    .order('harness')

  if (error) {
    console.error('[harness/:machineId]', error.message)
    return res.status(500).json({ error: error.message })
  }

  res.json(data ?? [])
})

// POST /harness/:machineId/desire  (user-authed)
// Mobile app requests a toggle. The desktop's 15-second apply-desired poll picks
// it up, applies it, and clears desired_enabled via the next /harness/report.
router.post('/:machineId/desire', requireUserAuth, async (req, res) => {
  const { harness, enabled } = req.body

  if (!harness || enabled === undefined) {
    return res.status(400).json({ error: 'harness and enabled are required' })
  }

  const { data: machine, error: mErr } = await db
    .from('machines')
    .select('user_id')
    .eq('id', req.params.machineId)
    .single()

  if (mErr || !machine) return res.status(404).json({ error: 'Machine not found' })
  if (machine.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' })

  const { error } = await db
    .from('machine_harnesses')
    .upsert({
      machine_id:      req.params.machineId,
      harness,
      desired_enabled: !!enabled,
      updated_at:      new Date().toISOString(),
    }, { onConflict: 'machine_id,harness' })

  if (error) {
    console.error('[harness/:machineId/desire]', error.message)
    return res.status(500).json({ error: error.message })
  }

  res.json({ ok: true })
})

export default router
