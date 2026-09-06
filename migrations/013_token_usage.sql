-- 013_token_usage.sql
-- Live token-usage streaming (see TOKEN_USAGE_STREAMING_DESIGN.md).
-- The desktop harnesses report running token counts for the current turn; the server
-- persists them here (durable across mobile remounts) and broadcasts a 'usage' event on
-- the session topic for the live compose-bar counter.
--
-- turn_*  : reset each turn (absolute totals for the CURRENT turn).
-- session_*: monotonic totals across the whole session (optional "budget" view).

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS turn_tokens_input     integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS turn_tokens_output    integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS session_tokens_input  bigint      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS session_tokens_output bigint      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tokens_updated_at     timestamptz;
