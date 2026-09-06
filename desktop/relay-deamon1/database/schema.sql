-- ============================================================
-- Relay Daemon — complete Supabase schema
-- Run this once in your Supabase project's SQL Editor
-- ============================================================

-- ── Extensions ───────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";  -- for gen_random_uuid()

-- ── Drop existing objects (safe to re-run) ───────────────────────────────────
drop table  if exists pending_requests cascade;
drop table  if exists agents           cascade;
drop table  if exists machines         cascade;
drop function if exists batch_decide(uuid[], text);
drop function if exists cleanup_old_requests();

-- ═══════════════════════════════════════════════════════════════
-- TABLES
-- ═══════════════════════════════════════════════════════════════

-- ── machines: one row per dev machine registered by a user ───────────────────
create table machines (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete cascade not null,
  label        text not null,                  -- "Work MacBook Pro"
  api_key_hash text not null unique,           -- SHA-256 of MACHINE_API_KEY
  is_online    bool    default false,
  last_seen    timestamptz,
  created_at   timestamptz default now()
);

-- ── agents: one row per active Claude Code session ───────────────────────────
create table agents (
  id          uuid primary key default gen_random_uuid(),
  machine_id  uuid references machines(id) on delete cascade not null,
  session_id  text unique,                     -- Claude Code session ID
  name        text,                            -- optional label ("auth refactor")
  started_at  timestamptz default now()
);

-- ── pending_requests: every intercepted tool-use call ────────────────────────
create table pending_requests (
  id              uuid primary key default gen_random_uuid(),

  -- ownership
  user_id         uuid references auth.users(id) on delete cascade not null,
  machine_id      uuid references machines(id)   on delete cascade not null,
  agent_id        uuid references agents(id)     on delete set null,
  session_id      text,

  -- what the tool wants to do
  tool_name       text        not null,          -- Bash | Write | Edit | MultiEdit
  display_type    text        not null,          -- bash | write | edit | multi_edit | unknown
  summary         text        not null,

  -- risk assessment
  risk_level      text        not null default 'low',  -- low | medium | high | critical
  risk_reason     text,
  risk_icon       text,

  -- files affected (for the mobile file list)
  files_affected  text[]      default '{}',

  -- full payload (jsonb so mobile can render rich diffs)
  diff            jsonb,
  command         text,                          -- for Bash
  file_path       text,                          -- for Write/Edit
  new_content     text,                          -- for Write
  old_content     text,                          -- for Write (previous file)
  raw_input       jsonb,                         -- fallback for unknown tools

  -- lifecycle
  status          text        not null default 'pending',
                              -- pending | approved | denied | timeout
  decided_by      text,       -- 'pc' (terminal) | 'mobile' | null (timeout/unknown)
  decided_at      timestamptz,
  created_at      timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════════════════

-- mobile app: list pending requests for a user, newest first
create index idx_requests_user_status
  on pending_requests (user_id, status, created_at desc);

-- daemon: realtime filter query
create index idx_requests_id_status
  on pending_requests (id, status);

-- filtering by machine
create index idx_requests_machine
  on pending_requests (machine_id, status);

-- filtering by agent
create index idx_requests_agent
  on pending_requests (agent_id);

-- machines: look up by user
create index idx_machines_user
  on machines (user_id, is_online);

-- ═══════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════

alter table machines         enable row level security;
alter table agents           enable row level security;
alter table pending_requests enable row level security;

-- machines: users see only their own machines
create policy "users own their machines"
  on machines for all
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

-- agents: users see only agents on their machines
create policy "users own their agents"
  on agents for all
  using (
    machine_id in (
      select id from machines where user_id = auth.uid()
    )
  );

-- pending_requests: users see only their own requests
create policy "users own their requests"
  on pending_requests for all
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════
-- REALTIME
-- ═══════════════════════════════════════════════════════════════

-- Enable realtime on pending_requests so the daemon's
-- subscription fires the instant mobile updates the row
alter publication supabase_realtime add table pending_requests;
alter publication supabase_realtime add table machines;

-- ═══════════════════════════════════════════════════════════════
-- FUNCTIONS
-- ═══════════════════════════════════════════════════════════════

-- ── batch_decide: approve or deny multiple requests at once ──────────────────
create or replace function batch_decide(
  request_ids  uuid[],
  decision     text        -- 'approved' | 'denied'
)
returns table(id uuid, status text)
language sql
security definer
as $$
  update pending_requests
  set
    status     = decision,
    decided_at = now()
  where
    id      = any(request_ids)
    and user_id = auth.uid()       -- RLS enforced even inside the function
    and status  = 'pending'        -- only change pending rows
  returning id, status;
$$;

-- ── cleanup_old_requests: prune decided rows older than 7 days ───────────────
create or replace function cleanup_old_requests()
returns void
language sql
security definer
as $$
  delete from pending_requests
  where
    status    in ('approved', 'denied', 'timeout')
    and created_at < now() - interval '7 days';
$$;

-- ── auto-update decided_at when status changes ───────────────────────────────
create or replace function set_decided_at()
returns trigger
language plpgsql
as $$
begin
  if new.status <> old.status
     and new.status in ('approved', 'denied', 'timeout')
     and new.decided_at is null
  then
    new.decided_at = now();
  end if;
  return new;
end;
$$;

create trigger trg_decided_at
  before update on pending_requests
  for each row execute function set_decided_at();

-- ── auto-cleanup via pg_cron (optional, requires pg_cron extension) ──────────
-- Uncomment if you have pg_cron enabled in your Supabase project:
-- select cron.schedule('cleanup-old-requests', '0 3 * * *', 'select cleanup_old_requests()');
