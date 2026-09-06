import { createHash } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { authClient, db } from '../supabase.js'

function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

// Validates Supabase Auth JWT — used for routes the desktop/mobile app calls
export async function requireUserAuth(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Authorization header' })
  }

  const token = header.slice(7)
  const { data: { user }, error } = await authClient.auth.getUser(token)

  if (error || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }

  req.user = user
  next()
}

// HOT PATH: verify the Supabase access token locally — no network call.
// Valid for this project because gen-keys.js signs with HS256 + SUPABASE_JWT_SECRET.
export function requireUserAuthFast(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Authorization header' })
  }
  try {
    const claims = jwt.verify(header.slice(7), process.env.SUPABASE_JWT_SECRET, {
      algorithms: ['HS256'],
    })
    req.user = { id: claims.sub, email: claims.email }
    return next()
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}

// Resolve the calling device from the x-device-id header set by the phone.
export function attachDevice(req, _res, next) {
  req.deviceId = req.headers['x-device-id'] || null
  next()
}

// Accept EITHER a user JWT (mobile) OR a machine API key (desktop).
// Used by routes that both sides can call — e.g. unpair, which the phone triggers
// from the machines tab and the desktop triggers from its paired screen.
export async function requireUserOrMachine(req, res, next) {
  if (req.headers.authorization?.startsWith('Bearer ')) {
    return requireUserAuth(req, res, next)
  }
  if (req.headers['x-machine-api-key']) {
    return requireMachineAuth(req, res, next)
  }
  return res.status(401).json({ error: 'Missing authentication' })
}

// Validates machine API key — used for routes the relay daemon calls
export async function requireMachineAuth(req, res, next) {
  const apiKey = req.headers['x-machine-api-key']
  if (!apiKey) {
    return res.status(401).json({ error: 'Missing x-machine-api-key header' })
  }

  const hash = sha256(apiKey)
  const { data: machine, error } = await db
    .from('machines')
    .select('id, user_id, label')
    .eq('api_key_hash', hash)
    .single()

  if (error || !machine) {
    return res.status(401).json({ error: 'Invalid machine API key' })
  }

  req.machine = machine
  next()
}
