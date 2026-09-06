-- Migration 010 — REPLICA IDENTITY FULL for the chat-feed tables
-- Additive and safe to run on a live DB. Idempotent (re-running is a no-op).
--
-- Why: the mobile chat feed's live edge rides Supabase `postgres_changes`
-- subscriptions (useChatFeed.ts) filtered by `session_id`. On self-hosted Supabase
-- with RLS enabled, the Realtime server must evaluate each WAL change against the
-- table's RLS policies (user_id = auth.uid()) AND apply the `session_id=eq.…`
-- filter. With the default (primary-key) replica identity, UPDATE/DELETE records
-- carry only the id — so the filter can't match and RLS can't be evaluated, and
-- the change is dropped SILENTLY (no CHANNEL_ERROR). The result was: new reasoning
-- and new requests never streamed into an open chat; the user had to leave and
-- re-enter (a REST refetch) to see them.
--
-- REPLICA IDENTITY FULL makes every change record carry all columns, so RLS and
-- the session_id filter work for INSERT *and* UPDATE/DELETE. These tables are not
-- ultra-high-volume per session, so the extra WAL cost is acceptable.
--
-- This was originally intended for migration 009 but a stray `/////` (invalid SQL)
-- aborted those statements before they ran. 009 has since been corrected; this
-- migration is the authoritative place for the feed tables.
--
-- NOTE: after applying, restart the Realtime service so it re-reads replica
-- identity for these tables (e.g. `docker compose restart realtime`).

alter table public.terminal_events  replica identity full;
alter table public.pending_requests replica identity full;
alter table public.mobile_commands  replica identity full;

