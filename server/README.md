# Vibe Remote — Server Side (Express API)

> Stateless REST API + Postgres backend for AI coding agent remote supervision

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Directory Structure](#3-directory-structure)
4. [Architecture](#4-architecture)
5. [Key Components](#5-key-components)
6. [Data Flow](#6-data-flow)
7. [API Endpoints](#7-api-endpoints)
8. [Database Schema](#8-database-schema)
9. [Authentication](#9-authentication)
10. [Real-Time Push](#10-real-time-push)
11. [Configuration](#11-configuration)
12. [Build & Deployment](#12-build--deployment)
13. [Dependencies](#13-dependencies)
14. [Design Patterns](#14-design-patterns)

---

## 1. Project Overview

The **Vibe Remote** server is the central API broker that connects the desktop relay daemon to the mobile app. It handles authentication, request routing, real-time push notifications, and all data persistence via a self-hosted Supabase (PostgreSQL) instance.

**Three actors in the system:**

| Actor | Auth Method | Role |
|---|---|---|
| Desktop relay daemon | `x-machine-api-key` header (SHA-256 hashed) | Hooks into AI CLIs, uploads tool-use events |
| Mobile app | Bearer JWT (Supabase GoTrue) | Approves/denies, sends prompts, monitors sessions |
| Express server (this repo) | — | Brokers all communication, holds service role key |

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (ESM modules) |
| HTTP Framework | Express 4.21 |
| Database / Auth | Supabase (PostgreSQL + GoTrue + Realtime) |
| Database Client | `@supabase/supabase-js` 2.49 (service role) |
| Push Notifications | Firebase Admin SDK 13.10 (FCM) |
| Auth Tokens | `jsonwebtoken` 9.0 (local HS256 verification) |
| Rate Limiting | `express-rate-limit` 7.5 |
| CORS | `cors` 2.8 |
| Env Config | `dotenv` 16.5 |
| Language | JavaScript (ES2022+) |

---

## 3. Directory Structure

```
vibe_remote(serverside)/
├── .env                          # Live environment variables (gitignored)
├── .env.example                  # Template for env vars
├── package.json                  # Project manifest
├── package-lock.json             # Lockfile
├── gen-keys.js                   # Utility: generates Supabase JWT keys
│
├── src/
│   ├── index.js                  # ENTRY POINT: Express app, route mounting, startup
│   ├── supabase.js               # Supabase client init (service + anon)
│   ├── utils.js                  # Utilities: syncAgentPendingCount, deriveStatus
│   ├── sweeper.js                # Background job: sweeps stale/abandoned sessions
│   ├── realtime.js               # Server-to-client push via Supabase Realtime broadcast
│   ├── notify.js                 # Firebase Cloud Messaging push notification service
│   │
│   ├── middleware/
│   │   └── auth.js               # Authentication middleware (JWT, machine key, dual)
│   │
│   └── routes/
│       ├── relay.js              # Desktop relay daemon endpoints (machine-key auth)
│       ├── mobile.js             # Mobile app endpoints (user JWT auth)
│       ├── machines.js           # Machine registration, pairing, heartbeat, file tree
│       ├── harness.js            # Multi-harness management (report, desired state)
│       └── profile.js            # User profile CRUD
│
├── public/
│   └── confirmed.html            # Branded "Email confirmed" page
│
├── migrations/                   # Sequential SQL migration files (003–013)
│   ├── 003_multiharness.sql
│   ├── 004_cli_alive.sql
│   ├── 005_feed_pagination.sql
│   ├── 006_session_feed_view.sql
│   ├── 007_user_accounts_pairing.sql
│   ├── 008_mobile_first_pairing.sql
│   ├── 009_realtime_agents.sql
│   ├── 010_feed_replica_identity.sql
│   ├── 011_question_requests.sql
│   ├── 012_stop_requests.sql
│   └── 013_token_usage.sql
│
├── supabase/                     # Supabase project exports (gitignored)
    ├── schema.sql                # Full DB schema dump
    ├── data.sql                  # Data dump
    ├── auth-schema.sql           # Auth schema dump
    └── auth-users.sql            # Auth users dump


```

---

## 4. Architecture

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                                                                  │
│                    ┌──────────────────────────────────────┐                      │
│                    │           DESKTOP WORKSTATION         │                      │
│                    │  (Node.js relay daemon + harness CLI) │                      │
│                    │                                      │                      │
│                    │  • machine-key auth                  │                      │
│                    │  • Heartbeat every ~15s              │                      │
│                    │  • Uploads tool requests             │                      │
│                    │  • Polls for mobile commands         │                      │
│                    └──────────────┬───────────────────────┘                      │
│                                   │                                              │
│                          HTTPS REST                                              │
│                    (x-machine-api-key header)                                    │
│                                   │                                              │
│    ┌──────────────────────────────┼──────────────────────────────────────┐       │
│    │                              │                                      │       │
│    │    ┌─────────────────────────▼──────────────────────────────────┐   │       │
│    │    │                  EXPRESS SERVER (Port 3000)                │   │       │
│    │    │                                                           │   │       │
│    │    │  ┌─────────┐  ┌────────────┐  ┌────────┐  ┌───────────┐  │   │       │
│    │    │  │  CORS   │  │ JSON Body  │  │ Rate   │  │   Auth    │  │   │       │
│    │    │  │         │  │ (2mb)      │  │ Limiter│  │   Layer   │  │   │       │
│    │    │  └─────────┘  └────────────┘  └────────┘  └─────┬─────┘  │   │       │
│    │    │                                                  │        │   │       │
│    │    │  ┌──────────────────────────────────────────────┐│        │   │       │
│    │    │  │              ROUTE MODULES                   ││        │   │       │
│    │    │  │                                              ││        │   │       │
│    │    │  │  /machines/*   /relay/*   /mobile/*          ││        │   │       │
│    │    │  │  /harness/*    /profile/*                     ││        │   │       │
│    │    │  └──────────────────────────────────────────────┘│        │   │       │
│    │    │                                                  │        │   │       │
│    │    │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────▼─────┐  │   │       │
│    │    │  │supabase  │  │realtime  │  │ notify   │  │ sweeper  │  │   │       │
│    │    │  │.js (DB)  │  │.js (push)│  │ .js (FCM)│  │ .js      │  │   │       │
│    │    │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────────┘  │   │       │
│    │    └───────┼──────────────┼──────────────┼─────────────────────┘   │       │
│    │            │              │              │                         │       │
│    └────────────┼──────────────┼──────────────┼─────────────────────────┘       │
│                 │              │              │                                  │
│                 ▼              ▼              ▼                                  │
│    ┌────────────────┐ ┌──────────────┐ ┌──────────────┐                        │
│    │   SUPABASE     │ │   SUPABASE   │ │   FIREBASE   │                        │
│    │   (PostgreSQL) │ │   REALTIME   │ │   ADMIN SDK  │                        │
│    │                │ │              │ │              │                         │
│    │ • machines     │ │ • Broadcast  │ │ • FCM Push   │                        │
│    │ • agents       │ │   per        │ │   to mobile  │                        │
│    │ • pending_reqs │ │   machine/   │ │   devices    │                        │
│    │ • terminal_evts│ │   session    │ └──────────────┘                        │
│    │ • mobile_cmds  │ │   topic      │                                         │
│    │ • profiles     │ └──────────────┘                                         │
│    │ • machine_     │                                                          │
│    │   harnesses    │                                                          │
│    └────────────────┘                                                          │
│                                                                                 │
│    ┌──────────────────────────────────────────────────────────────────────┐     │
│    │                    MOBILE PHONE                                      │     │
│    │  (React Native / Flutter App)                                       │     │
│    │  • User JWT auth (Supabase GoTrue)                                  │     │
│    │  • Views sessions, chat feed, requests                              │     │
│    │  • Approves/denies/answers tool requests                            │     │
│    │  • Subscribes to Realtime for live updates                          │     │
│    └──────────────────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Key Components

### 5.1 Entry Point (`src/index.js`)

- Creates Express app with CORS, JSON body parser (2mb), rate limiting
- Two rate limiters: global (120/min/IP) and strict (5/min for machine registration)
- Mounts all route modules + inline `/mobile/command/next` router
- Starts background stale-session sweeper

### 5.2 Supabase Client (`src/supabase.js`)

| Client | Key | Purpose |
|---|---|---|
| `db` | Service role | ALL database operations (bypasses RLS) |
| `authClient` | Anon key | Verifying user JWTs + admin auth operations |

Both have `persistSession: false` since this is a server process.

### 5.3 Authentication Middleware (`src/middleware/auth.js`)

| Middleware | Auth Type | Used By |
|---|---|---|
| `requireUserAuth` | Supabase Auth JWT (network verify) | Security-sensitive: password change, account delete, pair, register device |
| `requireUserAuthFast` | Local HS256 JWT verify (no network call) | Hot-path: sessions, requests, feed, profile read |
| `requireMachineAuth` | SHA-256 hashed API key lookup in DB | Desktop relay daemon endpoints |
| `requireUserOrMachine` | Either user JWT or machine key | Unpair (callable by phone OR desktop) |
| `attachDevice` | Extracts `x-device-id` header | Device-scoped operations |

### 5.4 Route Modules

#### `routes/relay.js` — Desktop Relay API (Machine-Key Auth)

| Endpoint | Purpose |
|---|---|
| `POST /relay/sessions-alive` | Heartbeat: mark which sessions' CLIs are alive |
| `POST /relay/agent-ping` | Upsert agent row on every tool call |
| `POST /relay/agent-touch` | Lightweight keepalive (refresh last_activity_at) |
| `POST /relay/usage` | Live token usage streaming |
| `POST /relay/upload` | Insert tool-use approval request + push notification |
| `POST /relay/decide` | Approve/deny a request (from PC terminal) |
| `POST /relay/answer` | Answer a question request (from PC terminal) |
| `POST /relay/terminal-event` | Log terminal events |
| `GET /relay/stop-requests` | Poll for stop/interrupt requests |
| `POST /relay/stop-ack` | Acknowledge stop requests |
| `GET /relay/status/:requestId` | Polling fallback for request decision status |

#### `routes/mobile.js` — Mobile App API (User JWT Auth)

| Endpoint | Purpose |
|---|---|
| `GET /mobile/me` | Identity check |
| `POST /mobile/realtime-token` | Sign a Supabase JWT for Realtime auth |
| `GET /mobile/sessions` | All sessions across paired machines |
| `GET /mobile/sessions/:id/requests` | Pending requests for one session |
| `GET /mobile/sessions/:id/feed` | Cursor-paginated unified chat feed (via RPC) |
| `DELETE /mobile/sessions/:id` | Delete a session |
| `POST /mobile/sessions/:id/stop` | Interrupt an active turn |
| `GET /mobile/requests` | All pending requests across machines |
| `POST /mobile/decide` | Approve/deny from phone |
| `POST /mobile/answer` | Answer question from phone |
| `POST /mobile/prompt` | Queue a prompt for agent delivery |
| `GET /mobile/prompts` | List recent prompts |
| `DELETE /mobile/prompt/:id` | Cancel a pending prompt |
| `GET /mobile/terminal` | Terminal events for a session |
| `POST /mobile/fs/request` | Request a file tree from desktop |
| `GET /mobile/fs/result/:requestId` | Poll for file tree result |

#### `routes/machines.js` — Machine Lifecycle

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /machines/register` | None (rate-limited) | Desktop self-registers (unowned) |
| `POST /machines/heartbeat` | Machine key | Update last_seen, set is_online=true |
| `POST /machines/offline` | Machine key | Set is_online=false + broadcast |
| `POST /machines/:id/challenge` | Machine key | Mint a one-time QR nonce |
| `POST /machines/:id/pair` | User JWT | QR-scan pairing (claim ownership) |
| `DELETE /machines/:id/pair` | User or Machine | Unpair device |
| `POST /machines/devices` | User JWT | Register a mobile device |
| `GET /machines/mine` | User JWT | List user's machines |
| `DELETE /machines/:id` | User JWT | Delete a machine |

#### `routes/harness.js` — Multi-Harness Management

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /harness/report` | Machine key | Desktop pushes installed harness inventory |
| `GET /harness/desired` | Machine key | Desktop polls for phone-requested toggles |
| `GET /harness/:machineId` | User JWT | Mobile reads harness state |
| `POST /harness/:machineId/desire` | User JWT | Mobile requests a toggle |

#### `routes/profile.js` — User Profile

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /profile` | User JWT (fast) | Read profile |
| `PATCH /profile` | User JWT (fast) | Update display name / avatar |
| `POST /profile/password` | User JWT (network) | Change password |
| `DELETE /profile` | User JWT (network) | Delete account |

### 5.5 Background Services

#### Realtime Push (`src/realtime.js`)

- Fire-and-forget HTTP POST to `/realtime/v1/api/broadcast`
- Two topic patterns: `machine:<uuid>` and `session:<uuid>`
- Sends minimal payloads — clients re-fetch via authed endpoints

#### Push Notifications (`src/notify.js`)

- Firebase Admin SDK for FCM
- `notifyMachine(machineId, ...)` — sends to phone paired with a specific machine
- `notifyUser(userId, ...)` — sends to all tokens for a user
- Auto-removes stale FCM registration tokens

#### Session Sweeper (`src/sweeper.js`)

Runs every 45 seconds:
1. **Offline sweep:** marks machines as `is_online=false` when heartbeat lapses
2. **Stale turn sweep:** inserts synthetic `stop` terminal event for abandoned sessions

---

## 6. Data Flow

### Tool Approval Request

```
Desktop Agent         Relay Daemon        Express Server        Supabase DB        Mobile App
     │                     │                    │                     │                  │
     │ tool-use event      │                    │                     │                  │
     ├────────────────────>│                    │                     │                  │
     │                     │ POST /relay/upload  │                     │                  │
     │                     ├───────────────────>│ INSERT into         │                  │
     │                     │                    │ pending_requests    │                  │
     │                     │                    │ + push notification │                  │
     │                     │                    │                     │    FCM push      │
     │                     │                    │                     ├─────────────────>│
     │                     │                    │ broadcast 'feed'    │                  │
     │                     │                    │ on session topic    │                  │
     │                     │                    ├─────────────────────│                  │
     │                     │                    │                     │   Realtime nudge │
     │                     │                    │                     ├─────────────────>│
     │                     │                    │                     │                  │
     │                     │                    │                     │  User taps Approve
     │                     │                    │                     │  POST /mobile/decide
     │                     │                    │<────────────────────├──────────────────│
     │                     │                    │ UPDATE pending_reqs │                  │
     │                     │                    │ status='approved'   │                  │
     │                     │                    │ broadcast 'feed'    │                  │
     │                     │                    ├─────────────────────│                  │
     │                     │                    │                     │                  │
     │                     │ GET /relay/status   │                     │                  │
     │                     │ (polling fallback)  │                     │                  │
     │                     ├───────────────────>│                     │                  │
     │  resumes with       │ {status:'approved'}│                     │                  │
     │<────────────────────│<───────────────────│                     │                  │
```

### QR Pairing Flow

```
Desktop                  Express Server        Supabase DB        Mobile App
  │                           │                    │                  │
  │ POST /machines/register   │                    │                  │
  │ (unowned, with apiKey)    │                    │                  │
  ├──────────────────────────>│ INSERT machine     │                  │
  │                           │ user_id=null       │                  │
  │                           │                    │                  │
  │ POST /:id/challenge       │                    │                  │
  │ (machine-key auth)        │                    │                  │
  ├──────────────────────────>│ INSERT challenge   │                  │
  │ <── {challenge, expires}  │                    │                  │
  │                           │                    │                  │
  │ [Desktop renders QR       │                    │                  │
  │  with challenge nonce]    │                    │                  │
  │                           │                    │                  │
  │                           │                    │  User scans QR   │
  │                           │                    │  POST /:id/pair  │
  │                           │<───────────────────│─── (user JWT) ──┤
  │                           │ Verify apiKey,     │                  │
  │                           │ consume challenge, │                  │
  │                           │ set user_id        │                  │
  │                           │                    │                  │
  │                           │ broadcast 'paired' │                  │
  │                           ├───────────────────>│                  │
```

---

## 7. API Endpoints

### Unauthenticated

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/confirmed` | Email confirmation landing page |
| `POST` | `/machines/register` | Desktop self-registration (5/min rate limit) |

### Complete Endpoint Count: 40+

See [Section 5.4](#54-route-modules) for full per-route breakdown.

---

## 8. Database Schema

### Core Tables

**`machines`** — Desktop workstations
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | Generated on desktop first-run |
| `user_id` | uuid FK → auth.users | Nullable (set at pair time) |
| `label` | text | User-friendly name |
| `api_key_hash` | text UNIQUE | SHA-256 of desktop's API key |
| `is_online` | boolean | Current online status |
| `last_seen` | timestamptz | Heartbeat timestamp |
| `paired_device_id` | uuid FK → mobile_devices | Exclusive device link |
| `paired_at` | timestamptz | When pairing occurred |

**`agents`** — Active agent sessions
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `machine_id` | uuid FK → machines | CASCADE delete |
| `session_id` | text UNIQUE | Session identifier |
| `harness` | text | `'claude-code'` default |
| `cwd` | text | Working directory |
| `pending_count` | integer | Cached count of pending requests |
| `cli_alive` | boolean | Whether CLI process is running |
| `turn_tokens_input/output` | integer | Current turn token counts |
| `session_tokens_input/output` | bigint | Total session token counts |

**`pending_requests`** — Tool-use approval/question requests
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `kind` | text | `'approval'` or `'question'` |
| `tool_name` | text | |
| `risk_level` | text | Low / Medium / High / Critical |
| `diff` | jsonb | Line + word level diff |
| `question` | jsonb | Multi-choice question payload |
| `status` | text | pending/approved/denied/timeout/answered/cli_pending |
| `decided_by` | text | `'mobile'` or `'pc'` |
| `harness` | text | Which agent harness |

**`terminal_events`** — Activity feed events (start, stop, reasoning, tool_use)
**`mobile_commands`** — Queued prompts from mobile to agent
**`fs_requests`** — Remote file tree browsing
**`push_tokens`** — FCM device tokens (device-scoped)
**`mobile_devices`** — Registered phone installations
**`profiles`** — User profile data (FK → auth.users)
**`machine_harnesses`** — Per-machine harness inventory (composite PK: machine_id + harness)
**`machine_challenges`** — One-time QR pairing nonces (5-minute TTL)
**`stop_requests`** — Interrupt requests for active turns

### Views & Functions

| Name | Type | Purpose |
|---|---|---|
| `session_feed` | View | UNION ALL over terminal_events, pending_requests, mobile_commands |
| `get_session_feed()` | RPC | Cursor-paginated reader (security-definer, service-role only) |
| `machine_push_tokens()` | RPC | Resolves push tokens for paired phone |
| `batch_decide()` | RPC | Batch approve/deny for multiple requests |
| `cleanup_old_requests()` | RPC | TTL cleanup for old decided requests |
| `set_decided_at()` | Trigger | Auto-stamps decided_at on status change |

### Key Indexes

| Index | Purpose |
|---|---|
| `idx_machines_api_key_hash` | Auth hot path |
| `idx_machines_user_paired` | User's machine listings |
| `idx_requests_user_status` | Request lookups |
| `idx_pending_requests_harness` | Multi-harness filtering |
| `idx_mobile_commands_machine_status` | Command delivery hot path |
| `idx_stop_requests_machine_pending` | Stop request polling |

---

## 9. Authentication

### Dual-Path Verification

```
┌─────────────────────────────────────────────────────────┐
│                   AUTH MIDDLEWARE                         │
│                                                          │
│  Fast Path (Hot)           Slow Path (Security)          │
│  ┌──────────────────┐     ┌──────────────────────┐       │
│  │ requireUserAuth  │     │ requireUserAuth      │       │
│  │ Fast             │     │                      │       │
│  │                  │     │                      │       │
│  │ • HS256 local    │     │ • Network verify     │       │
│  │   JWT verify     │     │   via Supabase       │       │
│  │ • No network     │     │   GoTrue API         │       │
│  │   call           │     │ • Full token         │       │
│  │ • ~1ms           │     │   validation         │       │
│  │                  │     │ • ~50-100ms          │       │
│  │ Used by:         │     │                      │       │
│  │ • GET sessions   │     │ Used by:             │       │
│  │ • GET requests   │     │ • POST password      │       │
│  │ • GET feed       │     │ • DELETE account     │       │
│  │ • POST decide    │     │ • POST pair          │       │
│  │ • GET profile    │     │ • POST device        │       │
│  └──────────────────┘     └──────────────────────┘       │
│                                                          │
│  Machine Auth              Dual Auth                      │
│  ┌──────────────────┐     ┌──────────────────────┐       │
│  │ requireMachineAuth│     │ requireUserOrMachine │       │
│  │                  │     │                      │       │
│  │ • x-machine-api- │     │ • Either path works  │       │
│  │   key header     │     │ • Used by:           │       │
│  │ • SHA-256 hash   │     │ • DELETE /pair       │       │
│  │ • DB lookup      │     └──────────────────────┘       │
│  │ • Used by:       │                                    │
│  │ • /relay/*       │                                    │
│  │ • /harness/*     │                                    │
│  │ • /machines/     │                                    │
│  │   heartbeat      │                                    │
│  └──────────────────┘                                    │
└─────────────────────────────────────────────────────────┘
```

---

## 10. Real-Time Push

### Broadcast-Over-Subscribe Pattern

The server uses Supabase Realtime **broadcast** (HTTP POST, fire-and-forget) rather than PostgreSQL change subscriptions:

```
Server                          Supabase Realtime
  │                                    │
  │ POST /realtime/v1/api/broadcast    │
  │ {                                 │
  │   "topic": "session:<uuid>",      │
  │   "payload": { "event": "feed" }  │
  │ }                                 │
  ├──────────────────────────────────>│
  │                                    │──► All subscribers on session:<uuid>
  │                                    │    receive the broadcast
  │                                    │
  │ Fire-and-forget                   │──► Client re-fetches via authed endpoint
```

**Why broadcast over subscribe:**
- Avoids RLS evaluation issues on self-hosted Supabase
- Works for unauthenticated topics (like machine pairing)
- Simpler server logic (no subscription management)

### Hybrid Approach: Broadcast + Polling

| Mechanism | Latency | Reliability |
|---|---|---|
| Supabase Realtime broadcast | ~1s | Dependent on WebSocket connection |
| HTTP polling | 5–25s | Always works |

Broadcast is the fast path; polling is the reliability backstop.

---

## 11. Configuration

### Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | Public anon key (JWT verify only) |
| `SUPABASE_SERVICE_KEY` | Yes | Service role key (full DB access) |
| `SUPABASE_JWT_SECRET` | Yes | HS256 secret for local JWT verification |
| `FIREBASE_SERVICE_ACCOUNT` | Yes | Firebase service account JSON string |
| `PORT` | No | Server port (default: 3000) |

### Rate Limiting

| Scope | Limit | Window |
|---|---|---|
| Global | 120 requests | Per minute per IP |
| Machine registration | 5 requests | Per minute per IP |
| Mobile routes | 300 requests | Per minute per user |

---

## 12. Build & Deployment

### Build

- **No build step** — plain JavaScript ESM, runs directly with Node.js
- `npm start` — production
- `npm run dev` — with `--watch` for auto-reload

### Production Deployment

| Component | Technology |
|---|---|
| Process Manager | PM2 in cluster mode (1 process per CPU core) |
| Reverse Proxy | Nginx on port 443 (SSL via Certbot) |
| Database | Self-hosted Supabase (Docker Compose) |
| Domain | `insight25.lk` (Node app), `database.insight25.lk` (Supabase API) |
| Backup | Daily `pg_dump` + optional R2 copy |

### Migration Strategy

All 11 migrations (003–013) are **purely additive** — they never modify or drop existing columns. This enables zero-downtime schema evolution on a live database. Each migration is idempotent.

---

## 13. Dependencies

| Package | Version | Purpose |
|---|---|---|
| `@supabase/supabase-js` | ^2.49.8 | Supabase client |
| `cors` | ^2.8.5 | Cross-origin support |
| `dotenv` | ^16.5.0 | Env loading |
| `express` | ^4.21.2 | HTTP framework |
| `express-rate-limit` | ^7.5.0 | Rate limiting |
| `firebase-admin` | ^13.10.0 | FCM push notifications |
| `jsonwebtoken` | ^9.0.3 | JWT verification/signing |

**No devDependencies, no build tools, no linter, no test framework.**

---

## 14. Design Patterns

### Stateless Server
No in-memory session state. All state lives in Supabase/PostgreSQL. Enables horizontal scaling via PM2 cluster mode.

### Progressive Migration
All migrations are purely additive. Zero-downtime schema evolution on a live database.

### Broadcast-Over-Subscribe
Uses Supabase Realtime broadcast (fire-and-forget HTTP) instead of PostgreSQL change subscriptions. Avoids RLS issues on self-hosted Supabase.

### Dual-Path Auth
Fast local HS256 verify for hot paths (~1ms), slow network verify for security-sensitive operations (~50–100ms).

### Defensive Status Computation
Session status (active/idle/finished) is **never stored** — derived at query time from `last_activity_at`. Avoids stale values and race conditions.

### Minimal Broadcast Payloads
Broadcasts send only nudge events (e.g., `{ event: "feed" }`). Clients re-fetch full data via authed REST endpoints. This keeps broadcast payloads tiny and avoids stale data.

---
