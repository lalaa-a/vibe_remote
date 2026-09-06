-- Migration 011 — multiple-choice question requests
-- Additive and safe to run on a live DB.
--
-- Lets a harness ask the user to pick from a set of options (Claude Code's
-- AskUserQuestion tool). Reuses pending_requests: a question is just a row with
-- kind='question' whose "decision" is the chosen option(s) instead of approve/deny.
-- See MOBILE_QUESTION_PICKER_DESIGN.md.

-- ── New columns on pending_requests ───────────────────────────────────────────
-- Discriminator: existing rows are tool approvals; new rows can be questions.
alter table public.pending_requests
  add column if not exists kind text not null default 'approval'
  check (kind in ('approval', 'question'));

-- The question payload (mirrors Claude Code's AskUserQuestion tool_input.questions).
-- Shape: { questions: [ { header, question, multiSelect, options:[{label,description}] } ] }
alter table public.pending_requests
  add column if not exists question jsonb;

-- The answer the user picked. One entry per question:
-- [ { question_index, selected: [ {index, label} ], custom_text? } ]
alter table public.pending_requests
  add column if not exists selected_options jsonb;

-- ── Teach the decided-at trigger to stamp 'answered' too ───────────────────────
-- (Body copied verbatim from schema.sql:79, only the status IN (...) list widened.)
create or replace function "public"."set_decided_at"() returns "trigger"
    language "plpgsql"
    as $$
begin
  if new.status <> old.status
     and new.status in ('approved', 'denied', 'timeout', 'answered')
     and new.decided_at is null
  then
    new.decided_at = now();
  end if;
  return new;
end;
$$;

-- ── Let cleanup purge answered question rows like any other decided row ─────────
-- (Body copied verbatim from schema.sql:66, only the status IN (...) list widened.)
create or replace function "public"."cleanup_old_requests"() returns "void"
    language "sql" security definer
    as $$
  delete from pending_requests
  where
    status    in ('approved', 'denied', 'timeout', 'answered')
    and created_at < now() - interval '7 days';
$$;

-- Realtime: pending_requests is already in the supabase_realtime publication, so
-- the new columns ride along on existing INSERT/UPDATE events. No publication change.
-- Feed RPC get_session_feed projects to_jsonb(r.*), so new columns are included. No RPC change.
