// Server → client push over Supabase Realtime *broadcast*.
//
// We use the HTTP broadcast endpoint (not a persistent WebSocket) so an Express
// handler can fire an event statelessly and return immediately. Broadcast does NOT
// go through table RLS, which is exactly what we need: the desktop has no user
// session, and the most important event (`paired`) happens while the machine is
// still unowned — so postgres_changes + owner-RLS could never deliver it.
//
// The channel name carries the machine UUID (`machine:<id>`); the desktop subscribes
// to that topic. Payloads are intentionally empty — the desktop re-fetches
// GET /machines/:id/session (machine-key authed) on any event, so no token or
// device data ever rides the unauthenticated broadcast channel.

const BROADCAST_URL = `${process.env.SUPABASE_URL}/realtime/v1/api/broadcast`

function broadcast(topic, event, payload = {}) {
  // Fire-and-forget: a realtime hiccup must never fail or delay the HTTP handler.
  // A poll/refetch is always the correctness backstop if a broadcast never lands.
  fetch(BROADCAST_URL, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey:         process.env.SUPABASE_SERVICE_KEY,
      Authorization:  `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify({
      messages: [{ topic, event, payload }],
    }),
  }).catch(() => {})
}

export function broadcastMachine(machineId, event, payload = {}) {
  broadcast(`machine:${machineId}`, event, payload)
}

// Server → mobile push that the open chat listens on. The chat live edge used to
// rely solely on `postgres_changes`, which the self-hosted Realtime server drops
// silently when RLS + replica identity aren't aligned (see
// LIVE_FEED_REALTIME_DIAGNOSIS.md). Broadcast does NOT go through table RLS, so it
// is the reliable nudge.
//
// The payload is intentionally minimal (no row content): the topic `session:<id>`
// is not RLS-protected, so we never put reasoning/diff text on it. The client
// re-fetches the user-authed feed endpoint (GET /mobile/sessions/:id/feed) on any
// nudge — that endpoint is access-controlled, so no data leaks over broadcast.
export function broadcastSession(sessionId, event = 'feed', payload = {}) {
  if (!sessionId) return
  broadcast(`session:${sessionId}`, event, payload)
}
