import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchSessions,
  fetchSessionRequests,
  fetchPrompts,
  sendPrompt,
  cancelPrompt,
} from '../api/server'

export function useSessions() {
  return useQuery({
    queryKey:        ['sessions'],
    queryFn:         fetchSessions,
    staleTime:       0,
    refetchInterval: 10_000,
  })
}

export function useSessionRequests(sessionId: string) {
  return useQuery({
    queryKey:        ['sessions', sessionId, 'requests'],
    queryFn:         () => fetchSessionRequests(sessionId),
    staleTime:       0,
    refetchInterval: 8_000,
  })
}

export function usePrompts() {
  return useQuery({
    queryKey:        ['prompts'],
    queryFn:         fetchPrompts,
    staleTime:       0,
    refetchInterval: 10_000,
  })
}

export function useSendPrompt() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ prompt, sessionId }: { prompt: string; sessionId?: string }) =>
      sendPrompt(prompt, sessionId),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['prompts'] })
    },
  })
}

export function useCancelPrompt() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => cancelPrompt(id),
    onSettled:  () => {
      queryClient.invalidateQueries({ queryKey: ['prompts'] })
    },
  })
}
