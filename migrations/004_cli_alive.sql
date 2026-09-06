-- Migration 004 — track whether a session's CLI is still open
-- Additive and safe on a live DB.
--
-- cli_alive is reconciled every ~15s by the desktop heartbeat (POST
-- /relay/sessions-alive): true while the harness CLI process for that session is
-- still running, false once the user closes the window. Mobile uses it to block
-- prompting a closed CLI (resuming one unattended is dangerous).

alter table agents
  add column if not exists cli_alive boolean not null default true;
