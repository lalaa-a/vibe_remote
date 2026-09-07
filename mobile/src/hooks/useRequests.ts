import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import {
  fetchPendingRequests,
  fetchRequestById,
  fetchHistory,
  decideRequest,
} from '../api/server'
import type { PendingRequest } from '../types'

// ── Pending requests list — polls every 8 seconds ─────────────────────────────
export function usePendingRequests() {
  return useQuery({
    queryKey:       ['requests', 'pending'],
    queryFn:        fetchPendingRequests,
    staleTime:      0,
    refetchInterval: 8_000,
  })
}

// ── Single request detail ─────────────────────────────────────────────────────
export function useRequest(id: string) {
  return useQuery({
    queryKey:        ['requests', id],
    queryFn:         () => fetchRequestById(id),
    staleTime:       10_000,
    refetchInterval: 8_000,
  })
}

// ── History ───────────────────────────────────────────────────────────────────
export function useHistory() {
  return useQuery<PendingRequest[]>({
    queryKey:  ['requests', 'history'],
    queryFn:   () => fetchHistory(),
    staleTime: 60_000,
  })
}

// ── Approve / deny mutation ───────────────────────────────────────────────────
export function useDecideRequest() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, decision }: {
      id:       string
      decision: 'approved' | 'denied'
    }) => decideRequest(id, decision),

    // Optimistic update — remove from list immediately, don't wait for server
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: ['requests', 'pending'] })
      const previous = queryClient.getQueryData<PendingRequest[]>(['requests', 'pending'])
      queryClient.setQueryData<PendingRequest[]>(
        ['requests', 'pending'],
        (prev = []) => prev.filter(r => r.id !== id)
      )
      return { previous }
    },

    // Roll back on error
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['requests', 'pending'], context.previous)
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['requests', 'history'] })
    },
  })
}
