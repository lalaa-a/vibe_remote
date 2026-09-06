-- Migration 007 — mobile user accounts + exclusive machine↔device pairing

-- 1. Mobile devices (one row per installed phone, owned by a user)
create table if not exists mobile_devices (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references auth.users(id) on delete cascade,
  device_name    text        not null default 'Phone',
  platform       text        not null default 'android',
  push_token     text,
  created_at     timestamptz not null default now(),
  last_active_at timestamptz not null default now()
);
create index if not exists idx_mobile_devices_user on mobile_devices(user_id);

-- 2. Exclusive pairing: a machine points at AT MOST one device
alter table machines
  add column if not exists paired_device_id uuid
    references mobile_devices(id) on delete set null,
  add column if not exists paired_at timestamptz;

-- NOTE: we deliberately do NOT add a unique index on paired_device_id —
-- one device may pair many machines (device_id appears on many machine rows).

create index if not exists idx_machines_user_paired
  on machines(user_id, paired_device_id);

create index if not exists idx_machines_paired_device
  on machines(paired_device_id)
  where paired_device_id is not null;

-- 3. Profile fields
create table if not exists profiles (
  id           uuid        primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url   text,
  updated_at   timestamptz not null default now()
);
alter table profiles enable row level security;
drop policy if exists "self profile rw" on profiles;
create policy "self profile rw" on profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

-- 4. Push tokens become device-scoped
alter table push_tokens
  add column if not exists device_id uuid references mobile_devices(id) on delete cascade;
alter table push_tokens alter column machine_id drop not null;

create index if not exists idx_push_tokens_device
  on push_tokens(device_id);

-- 5. RPC: resolve push tokens for the phone paired to a machine (one round-trip)
create or replace function machine_push_tokens(p_machine_id uuid)
returns table(token text) language sql stable as $$
  select pt.token
  from machines m
  join push_tokens pt on pt.device_id = m.paired_device_id
  where m.id = p_machine_id and m.paired_device_id is not null
$$;

-- 6. Realtime prerequisites for the machines table (desktop pairing poll via Realtime)
do $$
begin
  alter publication supabase_realtime add table machines;
exception when duplicate_object then
  null; -- already a member, nothing to do
end $$;
alter table machines enable row level security;
drop policy if exists "owner reads own machines" on machines;
create policy "owner reads own machines" on machines
  for select using (user_id = auth.uid());
