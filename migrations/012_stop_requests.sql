-- Migration 012 — stop requests (interrupt an in-flight turn)
-- Additive and safe to run on a live DB.
--
-- Separate from mobile_commands on purpose: mobile_commands delivery waits for the
-- session to go idle (heartbeat.js's isBusy gate); a stop request is the opposite —
-- it only matters while the session is busy, and must bypass every busy-gate that
-- exists. harness is captured at insert time (mirrors pending_requests.harness)
-- so pollers never need to join agents to know which interrupt mechanism to use.
-- See STOP_AGENT_DESIGN.md.

create table if not exists "public"."stop_requests" (
    "id"           uuid default gen_random_uuid() not null primary key,
    "session_id"   text not null,
    "machine_id"   uuid not null references "public"."machines"("id") on delete cascade,
    "user_id"      uuid not null,
    "harness"      text not null default 'claude-code',
    "status"       text not null default 'pending' check (status in ('pending', 'delivered')),
    "created_at"   timestamptz not null default now(),
    "delivered_at" timestamptz
);

create index if not exists "idx_stop_requests_machine_pending"
  on "public"."stop_requests" ("machine_id", "status");

alter table "public"."stop_requests" enable row level security;

-- Machine-key auth goes through the service role client (see src/supabase.js),
-- which bypasses RLS entirely — no user-facing policy is needed, same as
-- mobile_commands/pending_requests. Grant matches those tables' pattern.
grant all on table "public"."stop_requests" to "service_role";

-- No realtime publication entry needed: delivery is via broadcastMachine()
-- (stateless, unauthenticated) not postgres_changes. This table is purely the
-- durable backstop + audit trail for the polling fallback.
