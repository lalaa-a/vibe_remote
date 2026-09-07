import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getCredentials } from './server'

// Singleton Supabase client used only for Realtime subscriptions.
// Created on demand once we have a JWT from the server.
let client:       SupabaseClient | null = null
let currentToken: string | null         = null

export async function getRealtimeClient(): Promise<SupabaseClient | null> {
  const creds = getCredentials()
  if (!creds) return null

  if (client && currentToken) return client

  try {
    const res = await fetch(`${creds.apiUrl}/mobile/realtime-token`, {
      method:  'POST',
      headers: { 'x-machine-api-key': creds.apiKey },
    })
    if (!res.ok) {
      console.warn('[realtime] token fetch failed', res.status)
      return null
    }
    const { token } = (await res.json()) as { token: string }

    // Pass the JWT as the apiKey — Supabase accepts this for authenticated clients.
    // setAuth also tells the Realtime socket to use it for channel subscriptions.
    client = createClient(creds.supabaseUrl, token, {
      auth:     { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 5 } },
    })
    client.realtime.setAuth(token)
    currentToken = token
  } catch (err) {
    console.warn('[realtime] client init error', err)
    return null
  }

  return client
}

export function clearRealtimeClient() {
  if (client) {
    try { client.realtime.disconnect() } catch {}
  }
  client       = null
  currentToken = null
}
