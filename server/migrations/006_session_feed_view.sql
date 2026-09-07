-- Migration 006 — unified session_feed view + paginated RPC
-- Additive and safe to run on a live DB. Depends on the indexes from 005.
--
-- Replaces the JS-side 3-query merge behind GET /mobile/sessions/:id/feed with a
-- single ordered, cursor-paginated DB query. Benefits over the JS merge:
--   • one round-trip instead of three parallel queries;
--   • a correct (created_at, id) tuple cursor — no skipped/duplicated rows at
--     page boundaries and no "watermark clamp" that returned short pages;
--   • the planner merge-appends the three (session_id, created_at desc) index
--     scans and stops early at LIMIT.
--
-- Security: the view and RPC are server-only. We REVOKE from public/anon/
-- authenticated and GRANT to service_role only, so a client cannot call the
-- SECURITY DEFINER function directly with an arbitrary p_user_id (which would
-- bypass RLS). All access goes through the Express endpoint, which supplies the
-- authenticated machine's user_id.

-- ── Unified, normalized view over the three feed sources ───────────────────────
create or replace view public.session_feed as
  select t.id, t.user_id, t.session_id, t.created_at,
         'terminal'::text as source, to_jsonb(t.*) as payload
    from public.terminal_events t
  union all
  select r.id, r.user_id, r.session_id, r.created_at,
         'request'::text  as source, to_jsonb(r.*) as payload
    from public.pending_requests r
  union all
  select m.id, m.user_id, m.session_id, m.created_at,
         'prompt'::text   as source, to_jsonb(m.*) as payload
    from public.mobile_commands m;

revoke all on public.session_feed from public;
revoke all on public.session_feed from anon;
revoke all on public.session_feed from authenticated;
grant  select on public.session_feed to service_role;

-- ── Paginated reader: newest-first page older than the (ts,id) cursor ──────────
create or replace function public.get_session_feed(
  p_session_id text,
  p_user_id    uuid,
  p_before_ts  timestamptz default null,
  p_before_id  uuid        default null,
  p_limit      integer     default 40
) returns table (
  id         uuid,
  user_id    uuid,
  session_id text,
  created_at timestamptz,
  source     text,
  payload    jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select f.id, f.user_id, f.session_id, f.created_at, f.source, f.payload
  from public.session_feed f
  where f.session_id = p_session_id
    and f.user_id    = p_user_id
    and (
      p_before_ts is null
      or f.created_at < p_before_ts
      or (f.created_at = p_before_ts and f.id < p_before_id)
    )
  order by f.created_at desc, f.id desc
  limit least(greatest(coalesce(p_limit, 40), 1), 100);
$$;

revoke all on function public.get_session_feed(text, uuid, timestamptz, uuid, integer) from public;
revoke all on function public.get_session_feed(text, uuid, timestamptz, uuid, integer) from anon;
revoke all on function public.get_session_feed(text, uuid, timestamptz, uuid, integer) from authenticated;
grant  execute on function public.get_session_feed(text, uuid, timestamptz, uuid, integer) to service_role;
