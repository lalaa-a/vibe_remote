import { db } from './supabase.js'

// Recomputes pending_count for an agent by counting actual pending rows.
// Call after inserting or deciding a pending_request.
export async function syncAgentPendingCount(agentId) {
  if (!agentId) return
  const { count } = await db
    .from('pending_requests')
    .select('*', { count: 'exact', head: true })
    .eq('agent_id', agentId)
    .eq('status', 'pending')
  await db
    .from('agents')
    .update({ pending_count: count ?? 0 })
    .eq('id', agentId)
}

// Derives session status from last_activity_at — never stored, always computed.
export function deriveStatus(lastActivityAt) {
  if (!lastActivityAt) return 'finished'
  const diffMs = Date.now() - new Date(lastActivityAt).getTime()
  if (diffMs < 30_000)      return 'active'
  if (diffMs < 10 * 60_000) return 'idle'
  return 'finished'
}
