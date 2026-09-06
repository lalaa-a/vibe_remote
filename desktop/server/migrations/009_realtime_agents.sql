-- Migration 009 — publish `agents` on Realtime
-- Additive and safe to run on a live DB.
--
-- The mobile sessions list moves from a 5s poll to a Realtime subscription
-- (useSessionsRealtime). It listens on `agents` so that NEW sessions (INSERT)
-- and status transitions (last_activity_at / cli_alive UPDATEs) push to the
-- list. Without this, only pending_requests changes fire and new/idle sessions
-- would lag until the backstop poll.
--
-- 1) Add `agents` to the supabase_realtime publication. Guarded so re-running is
--    a no-op (ADD TABLE errors if it's already a member).
do $$
begin
  alter publication supabase_realtime add table public.agents;
exception
  when duplicate_object then null;  -- already published
  when others then
    raise notice 'skipped adding agents to supabase_realtime: %', sqlerrm;
end $$;

-- 2) REPLICA IDENTITY FULL so UPDATE/DELETE events carry every column. The
--    sessions subscription filters on machine_id; with the default (primary-key)
--    replica identity, an UPDATE/DELETE record only carries the id, so a
--    machine_id filter can't match those events. FULL makes the filter reliable.
--    `agents` is low-volume, so the extra WAL cost is negligible.
alter table public.agents replica identity full;