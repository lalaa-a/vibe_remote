import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { requestFileTree, pollFileTreeResult } from '../api/server'
import type { FsNode } from '../types'

const FS_TIMEOUT_MS = 15_000

export function useFileTree(sessionId: string) {
  const [requestId, setRequestId] = useState<string | null>(null)
  const [tree,      setTree]      = useState<FsNode[] | null>(null)
  const [error,     setError]     = useState<string | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { data } = useQuery({
    queryKey:        ['fs', requestId],
    queryFn:         () => pollFileTreeResult(requestId!),
    enabled:         !!requestId,
    staleTime:       0,
    refetchInterval: (query) =>
      query.state.data?.status === 'pending' ? 2_000 : false,
  })

  useEffect(() => {
    if (!data) return
    if (data.status === 'ready') {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      setTree(data.result ?? null)
      setRequestId(null)
    } else if (data.status === 'error') {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      setError(data.error ?? 'Unknown error')
      setRequestId(null)
    }
  }, [data])

  async function loadPath(path: string) {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setTree(null)
    setError(null)
    try {
      const { requestId: id } = await requestFileTree(path, sessionId)
      setRequestId(id)
      timeoutRef.current = setTimeout(() => {
        setError('Machine did not respond — is it online?')
        setRequestId(null)
      }, FS_TIMEOUT_MS)
    } catch (err: any) {
      setError(err.message ?? 'Failed to request file tree')
    }
  }

  return { tree, error, loadPath, loading: !!requestId }
}
