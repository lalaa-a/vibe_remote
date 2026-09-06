/**
 * harness-sdk/schema.js — the canonical request/event shapes.
 *
 * Every adapter, whatever its mechanism, normalizes into these. Downstream
 * (server, DB, mobile) therefore never sees a harness's private format.
 * The server's /relay/upload expects exactly the `pending_requests` columns
 * produced by normalizeRequest() below (same shape the legacy hook.js emits,
 * plus the new `harness` tag).
 */
import { randomUUID } from 'node:crypto'

export const CANONICAL_TOOLS = ['bash', 'edit', 'write', 'read', 'patch', 'unknown']
export const RISK_LEVELS = ['low', 'medium', 'high', 'critical']

/**
 * Build a row ready for POST /relay/upload.
 * `harness` is intentionally left for the registry to stamp so an adapter can't
 * mislabel itself.
 */
export function normalizeRequest(partial = {}) {
  return {
    id:             partial.id ?? randomUUID(),
    harness:        partial.harness ?? null,        // stamped by registry
    session_id:     partial.session_id ?? null,
    tool_name:      partial.tool_name ?? 'unknown', // canonical, lower-case
    display_type:   partial.display_type ?? 'unknown',
    summary:        partial.summary ?? '',
    risk_level:     partial.risk?.level  ?? partial.risk_level  ?? 'medium',
    risk_reason:    partial.risk?.reason ?? partial.risk_reason ?? '',
    risk_icon:      partial.risk?.icon   ?? partial.risk_icon   ?? '?',
    files_affected: partial.files_affected ?? [],
    command:        partial.command     ?? null,
    file_path:      partial.file_path    ?? null,
    old_content:    partial.old_content  ?? null,
    new_content:    partial.new_content  ?? null,
    raw_input:      partial.raw_input    ?? null,
    status:         'pending',
    created_at:     new Date().toISOString(),
  }
}

/** Throw if a request is malformed before it ever hits the network. */
export function validateRequest(r) {
  if (!r || typeof r !== 'object') throw new Error('request must be an object')
  if (!r.tool_name) throw new Error('request.tool_name is required')
  if (typeof r.summary !== 'string') throw new Error('request.summary must be a string')
  if (!RISK_LEVELS.includes(r.risk_level)) throw new Error(`bad risk_level: ${r.risk_level}`)
  return r
}

export function normalizeNarrative(partial = {}) {
  return {
    session_id: partial.session_id ?? null,
    harness:    partial.harness ?? null,
    event_type: partial.event_type ?? 'output',   // output|tool_start|tool_end|notify|stop
    tool_name:  partial.tool_name ?? null,
    summary:    partial.summary ?? null,
    detail:     partial.detail ?? null,
    status:     partial.status ?? null,
  }
}
