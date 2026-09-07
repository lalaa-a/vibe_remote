import { Router } from 'express'
import { db, authClient } from '../supabase.js'
import { requireUserAuth, requireUserAuthFast } from '../middleware/auth.js'

const router = Router()

// GET /profile — read profile (fast, polled by mobile)
router.get('/', requireUserAuthFast, async (req, res) => {
  const { data: profile } = await db
    .from('profiles')
    .select('display_name, avatar_url, updated_at')
    .eq('id', req.user.id)
    .maybeSingle()

  const { data: userData } = await authClient.auth.admin.getUserById(req.user.id)

  res.json({
    id:           req.user.id,
    email:        userData?.user?.email ?? req.user.email,
    display_name: profile?.display_name ?? null,
    avatar_url:   profile?.avatar_url   ?? null,
    updated_at:   profile?.updated_at   ?? null,
  })
})

// PATCH /profile — update display name / avatar url
router.patch('/', requireUserAuthFast, async (req, res) => {
  const { display_name, avatar_url } = req.body

  const { error } = await db
    .from('profiles')
    .upsert({
      id:           req.user.id,
      display_name: display_name ?? null,
      avatar_url:   avatar_url   ?? null,
      updated_at:   new Date().toISOString(),
    }, { onConflict: 'id' })

  if (error) {
    console.error('[profile PATCH]', error.message)
    return res.status(500).json({ error: 'Failed to update profile' })
  }

  res.json({ ok: true })
})

// POST /profile/password — change password (remote auth: security-sensitive)
router.post('/password', requireUserAuth, async (req, res) => {
  const { newPassword } = req.body

  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' })
  }

  const { error } = await authClient.auth.admin.updateUserById(req.user.id, {
    password: newPassword,
  })

  if (error) {
    console.error('[profile/password]', error.message)
    return res.status(500).json({ error: 'Failed to change password' })
  }

  res.json({ ok: true })
})

// DELETE /profile — delete account and all data (remote auth: security-sensitive)
router.delete('/', requireUserAuth, async (req, res) => {
  const { error } = await authClient.auth.admin.deleteUser(req.user.id)

  if (error) {
    console.error('[profile DELETE]', error.message)
    return res.status(500).json({ error: 'Failed to delete account' })
  }

  res.json({ ok: true })
})

export default router
