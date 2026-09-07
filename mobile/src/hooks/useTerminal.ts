import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchTerminalEvents } from '../api/server'
import { getRealtimeClient } from '../api/realtime'
import type { TerminalEvent } from '../types'

export function useTerminalEvents(sessionId?: string) {
  const qc       = useQueryClient()
  const queryKey = ['terminal', sessionId ?? 'all']

  const query = useQuery<TerminalEvent[]>({
    queryKey,
    queryFn: async () => {
      const res = await fetchTerminalEvents(sessionId, 120)
      return res.events
    },
    staleTime: 2_000,
    // 5s when watching a specific session, 30s for the global all-sessions view.
    // Realtime is the fast path but requires the terminal_events table to have
    // Realtime publications enabled in self-hosted Supabase — this poll is the
    // guaranteed fallback so reasoning appears within a few seconds either way.
    refetchInterval: sessionId ? 5_000 : 30_000,
  })

  useEffect(() => {
    if (!sessionId) return

    let cancelled = false
    let unsub: (() => void) | null = null

    ;(async () => {
      const client = await getRealtimeClient()
      if (!client || cancelled) return

      const channel = client
        .channel(`terminal:${sessionId}`)
        .on(
          'postgres_changes',
          {
            event:  'INSERT',
            schema: 'public',
            table:  'terminal_events',
            filter: `session_id=eq.${sessionId}`,
          },
          (payload) => {
            const newRow = payload.new as TerminalEvent
            qc.setQueryData<TerminalEvent[]>(queryKey, (old = []) => {
              if (old.some(e => e.id === newRow.id)) return old
              return [...old, newRow].slice(-200) // cap in-memory list
            })
          },
        )
        .subscribe()

      unsub = () => { try { channel.unsubscribe() } catch {} }
    })()

    return () => {
      cancelled = true
      if (unsub) unsub()
    }
  }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  return query
}
