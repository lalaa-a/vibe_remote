-- Migration 005 — chat feed pagination support
-- Additive and safe to run on a live DB.
--
-- Backs the new GET /mobile/sessions/:id/feed endpoint (WhatsApp/Telegram-style
-- windowed loading) and lets the mobile chat receive sent-prompt updates over
-- Realtime instead of polling.
--
-- 1) Per-session, time-ordered indexes so cursor pagination stays fast as the
--    tables grow. terminal_events already has (session_id, created_at desc)
--    via terminal_events_session_idx; we add the matching indexes for the other
--    two feed sources.
create index if not exists idx_requests_session_created
  on public.pending_requests (session_id, created_at desc);

create index if not exists idx_commands_session_created
  on public.mobile_commands (session_id, created_at desc);

-- 2) Publish mobile_commands on the Realtime channel so the chat feed can show
--    a user's sent prompt the moment it lands, without waiting for a poll.
--    Guarded so re-running the migration is a no-op (ADD TABLE errors if the
--    table is already a publication member).
do $$
begin
  alter publication supabase_realtime add table public.mobile_commands;
exception
  when duplicate_object then null;  -- already published
  when others then
    -- publication may not exist in some local setups; ignore so the rest applies
    raise notice 'skipped adding mobile_commands to supabase_realtime: %', sqlerrm;
end $$;
