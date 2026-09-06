● Now I have a complete, verified picture. Here's the full Supabase schema:

  ---
  Supabase Schema — relay-daemon

  2 Tables Required

  ---
  Complete SQL (run this in Supabase SQL editor)

  -- ══════════════════════════════════════════════════════════
  --  TABLE 1: machines
  -- ══════════════════════════════════════════════════════════
  CREATE TABLE machines (
    id           UUID        PRIMARY KEY,
    user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    label        TEXT        NOT NULL,
    api_key_hash TEXT        NOT NULL UNIQUE,
    is_online    BOOLEAN     NOT NULL DEFAULT false,
    last_seen    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, label)
  );

  CREATE INDEX idx_machines_user_id     ON machines(user_id);
  CREATE INDEX idx_machines_user_online ON machines(user_id, is_online);

  ALTER TABLE machines ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "users_read_own_machines" ON machines
    FOR SELECT USING (auth.uid() = user_id);

  CREATE POLICY "service_all_machines" ON machines
    FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');


  -- ══════════════════════════════════════════════════════════
  --  TABLE 2: pending_requests
  -- ══════════════════════════════════════════════════════════
  CREATE TABLE pending_requests (
    id             UUID        PRIMARY KEY,
    user_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    machine_id     UUID        NOT NULL REFERENCES machines(id)   ON DELETE CASCADE,
    session_id     TEXT,
    tool_name      TEXT        NOT NULL,
    display_type   TEXT        NOT NULL,   -- 'bash' | 'write' | 'edit' | 'multi_edit' | 'unknown'
    summary        TEXT        NOT NULL,
    risk_level     TEXT        NOT NULL,   -- 'low' | 'medium' | 'high' | 'critical'
    risk_reason    TEXT        NOT NULL,
    risk_icon      TEXT        NOT NULL,
    files_affected JSONB,                  -- string[]
    diff           JSONB,                  -- see diff structure below
    command        TEXT,                   -- Bash only
    file_path      TEXT,                   -- Write/Edit only
    new_content    TEXT,
    old_content    TEXT,
    raw_input      JSONB,
    status         TEXT        NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'denied'
    decided_by     TEXT,                   -- 'pc' | 'mobile' | null
    decided_at     TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX idx_pr_machine_status ON pending_requests(machine_id, status);
  CREATE INDEX idx_pr_user_created   ON pending_requests(user_id, created_at DESC);

  ALTER TABLE pending_requests ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "users_read_own_requests" ON pending_requests
    FOR SELECT USING (auth.uid() = user_id);

  CREATE POLICY "service_all_requests" ON pending_requests
    FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

  -- ══════════════════════════════════════════════════════════
  --  REALTIME — enable on pending_requests
  -- ══════════════════════════════════════════════════════════
  ALTER PUBLICATION supabase_realtime ADD TABLE pending_requests;

  ---
  Required .env vars

  SUPABASE_URL=https://xxxx.supabase.co
  SUPABASE_ANON_KEY=eyJ...         # used for realtime subscriptions (anon, RLS-protected)
  SUPABASE_SERVICE_KEY=eyJ...      # used for all writes (bypasses RLS)
  MACHINE_ID=<uuid>                # generated once at setup
  MACHINE_API_KEY=<secret>         # generated once at setup
  USER_ID=<uuid>                   # auth.users.id of the owner
  MACHINE_LABEL=My PC              # optional, human-readable name
  TIMEOUT_SECONDS=300              # optional, default 300
  FAIL_OPEN=true                   # optional, allow on timeout if true

  ---
  Key notes

  Point: machines row
  Detail: Must be inserted manually at setup — there's no setup.js in this codebase. Create it with the service key.
  ────────────────────────────────────────
  Point: USER_ID
  Detail: Must match an existing auth.users.id — create the user in Supabase Auth first, then copy their UUID.
  ────────────────────────────────────────
  Point: Realtime
  Detail: Enable Realtime on pending_requests in Supabase dashboard → Database → Replication, or the SQL above handles it.
  ────────────────────────────────────────
  Point: Polling fallback
  Detail: waitForDecision() polls status, decided_by every 2s if realtime fails — anon key + RLS must allow SELECT.
  ────────────────────────────────────────
  Point: Shutdown heartbeat
  Detail: heartbeat.js uses the anon client to set is_online = false on SIGINT/SIGTERM — the service policy covers this via service key in normal heartbeats, but the
    shutdown path needs the service key too if anon SELECT-only policy is strict.

  diff JSONB structure

  {
    "type": "file_diff | edit_diff | multi_edit_diff",
    "file_path": "src/foo.js",
    "is_new_file": false,
    "language": "javascript",
    "stats": { "added": 3, "removed": 1 },
    "hunks": [
      { "type": "add | remove | context", "content": "...", "line_new": 10, "line_old": 10 }
    ],
    "files": [...],
    "file_count": 2,
    "edit_count": 3,
    "grand_stats": { "added": 5, "removed": 2 }
  }

  That's everything — 2 tables, 1 realtime publication, RLS policies, indexes. No storage buckets, no edge functions.