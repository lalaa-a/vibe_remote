-- Migration 008 — mobile-first auth + QR-challenge pairing
--
-- Removes the desktop login requirement. A machine now self-registers WITHOUT a
-- user (user_id null) and ownership is claimed at pair-time when a logged-in phone
-- scans the machine's QR. The QR carries a one-time `challenge` nonce (5-min TTL)
-- to prevent replay. A `session_token` is issued to the desktop on pairing and
-- cleared on unpair.

-- 1. user_id is assigned at PAIR time now, not register time → must be nullable.
alter table machines alter column user_id drop not null;

-- 2. Per-machine session token, issued on pair, cleared on unpair.
--    Delivered to the desktop via GET /machines/:id/session (machine-key auth).
alter table machines add column if not exists session_token text;

-- 3. One-time QR pairing nonces. A desktop requests one before rendering its QR;
--    the phone echoes it back on POST /pair, where it is consumed (used_at set).
create table if not exists machine_challenges (
  id         uuid        primary key default gen_random_uuid(),
  machine_id uuid        not null references machines(id) on delete cascade,
  challenge  text        not null unique,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_machine_challenges_lookup
  on machine_challenges(machine_id, expires_at);

-- Optional housekeeping: a partial index to find live (unused, unexpired) nonces fast.
create index if not exists idx_machine_challenges_live
  on machine_challenges(machine_id)
  where used_at is null;
