import { Router } from 'express'
import { createHash, randomBytes } from 'node:crypto'
import { db } from '../supabase.js'
import { requireUserAuth, requireUserAuthFast, requireMachineAuth, requireUserOrMachine, attachDevice } from '../middleware/auth.js'
import { bustPairCache } from './mobile.js'
import { broadcastMachine } from '../realtime.js'

function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

const CHALLENGE_TTL_MS = 5 * 60 * 1000   // QR nonce lifetime

const router = Router()

// POST /machines/register — login-free self-registration by the desktop.
// The machine is created UNOWNED (user_id null); ownership is claimed at pair-time
// when a logged-in phone scans its QR. No auth header required — possession of a
// freshly generated machineId + api key is all the desktop has at first run.
router.post('/register', async (req, res) => {
  const { machineId, machineLabel, apiKeyHash } = req.body

  if (!machineId || !machineLabel || !apiKeyHash) {
    return res.status(400).json({ error: 'machineId, machineLabel and apiKeyHash are required' })
  }

  const { data: existing } = await db
    .from('machines')
    .select('id')
    .eq('id', machineId)
    .single()

  // Idempotent: a desktop that still holds this machineId is already registered.
  // We never overwrite api_key_hash here — that would let anyone holding the id
  // hijack the key. Re-keying goes through /reclaim (owner-authenticated).
  if (existing) {
    return res.json({ ok: true, machineId, alreadyRegistered: true })
  }

  const { error } = await db.from('machines').insert({
    id:           machineId,
    user_id:      null,
    label:        machineLabel,
    api_key_hash: apiKeyHash,
    is_online:    true,
    last_seen:    new Date().toISOString(),
  })

  if (error) {
    console.error('[machines/register]', error.message)
    return res.status(500).json({ error: 'Registration failed' })
  }

  res.json({ ok: true, machineId })
})

// POST /machines/heartbeat
router.post('/heartbeat', requireMachineAuth, async (req, res) => {
  const { error } = await db
    .from('machines')
    .update({ is_online: true, last_seen: new Date().toISOString() })
    .eq('id', req.machine.id)

  if (error) {
    console.error('[machines/heartbeat]', error.message)
    return res.status(500).json({ error: 'Heartbeat failed' })
  }

  res.json({ ok: true })
})

// POST /machines/offline
router.post('/offline', requireMachineAuth, async (req, res) => {
  await db
    .from('machines')
    .update({ is_online: false })
    .eq('id', req.machine.id)

  // Push it — the mobile flips this machine offline instantly instead of waiting for last_seen
  // to go stale. See INSTANT_OFFLINE_AND_HARNESS_UPDATES.md §4.
  broadcastMachine(req.machine.id, 'offline')

  res.json({ ok: true })
})

// ── File tree ─────────────────────────────────────────────────────────────────

router.get('/fs/pending', requireMachineAuth, async (req, res) => {
  const { data, error } = await db
    .from('fs_requests')
    .select('*')
    .eq('machine_id', req.machine.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[machines/fs/pending]', error.message)
    return res.status(500).json({ error: 'Failed to fetch fs request' })
  }

  if (!data) return res.json(null)

  let sessionCwd = null
  if (data.session_id) {
    const { data: agent } = await db
      .from('agents')
      .select('cwd')
      .eq('session_id', data.session_id)
      .single()
    sessionCwd = agent?.cwd ?? null
  }

  res.json({ ...data, sessionCwd })
})

router.post('/fs/respond', requireMachineAuth, async (req, res) => {
  const { requestId, tree, error: treeError } = req.body

  if (!requestId) {
    return res.status(400).json({ error: 'requestId is required' })
  }

  const { error } = await db
    .from('fs_requests')
    .update({
      status:      treeError ? 'error' : 'ready',
      result:      tree      ?? null,
      error:       treeError ?? null,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', requestId)
    .eq('machine_id', req.machine.id)

  if (error) {
    console.error('[machines/fs/respond]', error.message)
    return res.status(500).json({ error: 'Failed to store fs result' })
  }

  res.json({ ok: true })
})

// ── Device management ─────────────────────────────────────────────────────────

// POST /machines/devices — register this phone as a device (get or create)
router.post('/devices', requireUserAuth, async (req, res) => {
  const { deviceName = 'Phone', platform = 'android' } = req.body

  const { data, error } = await db
    .from('mobile_devices')
    .insert({
      user_id:     req.user.id,
      device_name: deviceName,
      platform,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[machines/devices POST]', error.message)
    return res.status(500).json({ error: 'Failed to register device' })
  }

  res.json({ deviceId: data.id })
})

// GET /machines/devices — list devices for this user
router.get('/devices', requireUserAuthFast, async (req, res) => {
  const { data, error } = await db
    .from('mobile_devices')
    .select('id, device_name, platform, last_active_at, created_at')
    .eq('user_id', req.user.id)
    .order('last_active_at', { ascending: false })

  if (error) {
    console.error('[machines/devices GET]', error.message)
    return res.status(500).json({ error: 'Failed to fetch devices' })
  }

  res.json(data ?? [])
})

// DELETE /machines/devices/:deviceId — unregister a device
router.delete('/devices/:deviceId', requireUserAuth, attachDevice, async (req, res) => {
  const { deviceId } = req.params

  const { data: device } = await db
    .from('mobile_devices')
    .select('user_id')
    .eq('id', deviceId)
    .single()

  if (!device || device.user_id !== req.user.id)
    return res.status(403).json({ error: 'Forbidden' })

  const { error } = await db
    .from('mobile_devices')
    .delete()
    .eq('id', deviceId)

  if (error) {
    console.error('[machines/devices DELETE]', error.message)
    return res.status(500).json({ error: 'Delete failed' })
  }

  bustPairCache(req.user.id, deviceId)
  res.json({ ok: true })
})

// ── Pairing ───────────────────────────────────────────────────────────────────

// POST /machines/:machineId/challenge — desktop (machine-key) mints a one-time QR
// nonce just before rendering its QR. The phone echoes it back on /pair.
router.post('/:machineId/challenge', requireMachineAuth, async (req, res) => {
  if (req.machine.id !== req.params.machineId) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  const challenge  = randomBytes(32).toString('hex')
  const expiresAt  = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString()

  const { error } = await db
    .from('machine_challenges')
    .insert({ machine_id: req.machine.id, challenge, expires_at: expiresAt })

  if (error) {
    console.error('[machines/challenge]', error.message)
    return res.status(500).json({ error: 'Failed to create challenge' })
  }

  res.json({ challenge, expiresAt })
})

// POST /machines/:machineId/pair — scan QR and pair device to machine.
// Body: { apiKey, deviceId, challenge }. Claims ownership (user_id) on first pair.
router.post('/:machineId/pair', requireUserAuth, async (req, res) => {
  const { machineId } = req.params
  const { apiKey, deviceId, challenge } = req.body

  if (!apiKey || !deviceId || !challenge) {
    return res.status(400).json({ error: 'apiKey, deviceId and challenge are required' })
  }

  const { data: m, error: fetchErr } = await db
    .from('machines')
    .select('id, user_id, api_key_hash, paired_device_id')
    .eq('id', machineId)
    .single()

  if (fetchErr || !m) return res.status(404).json({ error: 'Machine not found' })
  if (sha256(apiKey) !== m.api_key_hash) return res.status(403).json({ error: 'QR does not match this machine' })
  // Owned machines can only be (re)paired by their owner. Unowned (null) → claimable.
  if (m.user_id && m.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Machine is owned by another account', code: 'owned_elsewhere' })
  }

  // Consume the one-time challenge atomically: the UPDATE only matches a row that
  // is still unused AND unexpired, so a replayed/expired QR claims nothing.
  const { data: consumed } = await db
    .from('machine_challenges')
    .update({ used_at: new Date().toISOString() })
    .eq('machine_id', machineId)
    .eq('challenge', challenge)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('id')
    .maybeSingle()

  if (!consumed) {
    return res.status(403).json({ error: 'QR code expired or already used — refresh it on the desktop', code: 'bad_challenge' })
  }

  if (m.paired_device_id === deviceId) {
    return res.json({ ok: true, alreadyPaired: true })
  }
  if (m.paired_device_id && m.paired_device_id !== deviceId) {
    return res.status(409).json({ error: 'Machine already paired to another device', code: 'paired_elsewhere' })
  }

  const sessionToken = randomBytes(32).toString('hex')

  // Optimistic lock: only claim if still unpaired (prevents TOCTOU race). Also
  // stamps ownership (user_id) and the desktop session token in the same write.
  const { data: claimed } = await db
    .from('machines')
    .update({
      user_id:          req.user.id,
      paired_device_id: deviceId,
      paired_at:        new Date().toISOString(),
      session_token:    sessionToken,
    })
    .eq('id', machineId)
    .is('paired_device_id', null)
    .select('id')
    .maybeSingle()

  if (!claimed) {
    return res.status(409).json({ error: 'Machine already paired to another device', code: 'paired_elsewhere' })
  }

  bustPairCache(req.user.id, deviceId)
  broadcastMachine(machineId, 'paired')   // nudge the desktop to re-fetch /session
  res.json({ ok: true })
})

// DELETE /machines/:machineId/pair — unpair. Callable by the owner (user JWT,
// from the machines tab) OR by the machine itself (api key, from the desktop's
// paired screen). Clears the device link AND revokes the session token.
router.delete('/:machineId/pair', requireUserOrMachine, async (req, res) => {
  const { machineId } = req.params

  const { data: m } = await db
    .from('machines')
    .select('user_id, paired_device_id')
    .eq('id', machineId)
    .single()

  if (!m) return res.status(404).json({ error: 'Machine not found' })
  // Authorize: a user may only unpair machines they own; a machine only itself.
  if (req.user  && m.user_id && m.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' })
  if (req.machine && req.machine.id !== machineId)         return res.status(403).json({ error: 'Forbidden' })

  const deviceId = m.paired_device_id

  const { error } = await db
    .from('machines')
    .update({ paired_device_id: null, paired_at: null, session_token: null })
    .eq('id', machineId)

  if (error) {
    console.error('[machines/pair DELETE]', error.message)
    return res.status(500).json({ error: 'Unpair failed' })
  }

  if (deviceId && m.user_id) bustPairCache(m.user_id, deviceId)
  broadcastMachine(machineId, 'unpaired')   // nudge the desktop back to the QR
  res.json({ ok: true })
})

// GET /machines/:machineId/session — desktop (machine-key) reads its pairing
// state on launch and while showing the QR. Returns the session token + the
// connected device's human-readable name so the desktop can render "Connected to…".
router.get('/:machineId/session', requireMachineAuth, async (req, res) => {
  if (req.machine.id !== req.params.machineId) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  const { data: m, error } = await db
    .from('machines')
    .select('paired_device_id, paired_at, session_token, mobile_devices(id, device_name, platform)')
    .eq('id', req.machine.id)
    .single()

  if (error || !m) return res.status(404).json({ error: 'Machine not found' })

  if (!m.paired_device_id) {
    return res.json({ paired: false })
  }

  res.json({
    paired:       true,
    sessionToken: m.session_token,
    pairedDevice: m.mobile_devices,
    pairedAt:     m.paired_at,
  })
})

// GET /machines/:machineId/pairing — legacy user-auth pairing poll (kept for
// backward compatibility; the desktop now uses GET /session with machine-key auth).
router.get('/:machineId/pairing', requireUserAuthFast, async (req, res) => {
  const { machineId } = req.params

  const { data: m, error } = await db
    .from('machines')
    .select('user_id, paired_device_id, paired_at, mobile_devices(id, device_name, platform)')
    .eq('id', machineId)
    .single()

  if (error || !m) return res.status(404).json({ error: 'Machine not found' })
  if (m.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' })

  if (!m.paired_device_id) {
    return res.json({ paired: false })
  }

  res.json({
    paired:    true,
    device:    m.mobile_devices,
    paired_at: m.paired_at,
  })
})

// ── User-authenticated machine management ─────────────────────────────────────

// GET /machines/mine — list all machines for the signed-in user (with pairing state)
router.get('/mine', requireUserAuthFast, attachDevice, async (req, res) => {
  const { data, error } = await db
    .from('machines')
    .select('id, label, is_online, last_seen, created_at, paired_device_id, paired_at, mobile_devices(id, device_name, platform)')
    .eq('user_id', req.user.id)
    .order('last_seen', { ascending: false, nullsFirst: false })

  if (error) {
    console.error('[machines/mine]', error.message)
    return res.status(500).json({ error: 'Failed to fetch machines' })
  }

  const now = Date.now()
  res.json((data ?? []).map(m => ({
    ...m,
    is_online: m.last_seen
      ? (now - new Date(m.last_seen).getTime()) < 90_000
      : false,
    connection: !m.paired_device_id
      ? 'none'
      : m.paired_device_id === req.deviceId
        ? 'this'
        : 'other',
  })))
})

// POST /machines/:machineId/reclaim
router.post('/:machineId/reclaim', requireUserAuth, async (req, res) => {
  const { machineId } = req.params
  const { apiKeyHash, machineLabel } = req.body

  if (!apiKeyHash) return res.status(400).json({ error: 'apiKeyHash is required' })

  const { data: machine, error: fetchErr } = await db
    .from('machines')
    .select('id, user_id')
    .eq('id', machineId)
    .single()

  if (fetchErr || !machine) return res.status(404).json({ error: 'Machine not found' })
  if (machine.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' })

  const update = { api_key_hash: apiKeyHash, is_online: false, last_seen: null }
  if (machineLabel) update.label = machineLabel

  const { error: updateErr } = await db
    .from('machines')
    .update(update)
    .eq('id', machineId)

  if (updateErr) {
    console.error('[machines/reclaim]', updateErr.message)
    return res.status(500).json({ error: 'Reclaim failed' })
  }

  res.json({ ok: true })
})

// DELETE /machines/:machineId
router.delete('/:machineId', requireUserAuth, async (req, res) => {
  const { data: machine } = await db
    .from('machines')
    .select('user_id')
    .eq('id', req.params.machineId)
    .single()

  if (!machine || machine.user_id !== req.user.id)
    return res.status(403).json({ error: 'Forbidden' })

  const { error } = await db
    .from('machines')
    .delete()
    .eq('id', req.params.machineId)

  if (error) {
    console.error('[machines/delete]', error.message)
    return res.status(500).json({ error: 'Delete failed — machine may have linked data' })
  }

  res.json({ ok: true })
})

export default router
