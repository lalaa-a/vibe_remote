-- Migration 003 — Multi-harness support
-- Safe to run on a live database: all changes are additive.
-- Existing rows default to 'claude-code' so nothing breaks.

-- ── 1. Tag every request, session and event with its source harness ────────────

alter table pending_requests
  add column if not exists harness text not null default 'claude-code';

alter table agents
  add column if not exists harness text not null default 'claude-code';

alter table terminal_events
  add column if not exists harness text not null default 'claude-code';

-- ── 2. Per-machine, per-harness state ─────────────────────────────────────────
-- One row per (machine, harness). The desktop writes this via POST /harness/report.
-- The mobile app reads it via GET /harness/:machineId.
-- desired_enabled lets the phone request a toggle the desktop then applies.

create table if not exists machine_harnesses (
  machine_id      uuid        not null references machines(id) on delete cascade,
  harness         text        not null,
  display_name    text        not null default '',
  installed       boolean     not null default false,
  mobile_enabled  boolean     not null default false,
  desired_enabled boolean,                          -- null = no pending request
  capabilities    jsonb       not null default '{}'::jsonb,
  version         text,
  updated_at      timestamptz not null default now(),
  primary key (machine_id, harness)
);

-- ── 3. RLS ────────────────────────────────────────────────────────────────────
-- The Express server uses the service key (bypasses RLS) for all writes.
-- Enable RLS only to prevent direct anon/user client reads of other users' rows.

alter table machine_harnesses enable row level security;

drop policy if exists "owner reads harness rows" on machine_harnesses;
create policy "owner reads harness rows" on machine_harnesses
  for select using (
    exists (
      select 1 from machines m
      where m.id = machine_id
        and m.user_id = auth.uid()
    )
  );

-- ── 4. Indexes for common queries ─────────────────────────────────────────────

create index if not exists idx_pending_requests_harness
  on pending_requests(machine_id, harness);

create index if not exists idx_agents_harness
  on agents(machine_id, harness);

create index if not exists idx_terminal_events_harness
  on terminal_events(machine_id, harness);
