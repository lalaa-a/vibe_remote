# VibeRemote Desktop 

> Electron + Node.js relay daemon for remote AI coding agent supervision

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Architecture](#4-architecture)
4. [Key Components](#5-key-components)
5. [Data Flow](#6-data-flow)
6. [Harness Abstraction Layer](#7-harness-abstraction-layer)
7. [API Surface](#8-api-surface)
8. [Database Schema](#9-database-schema)
9. [Configuration](#10-configuration)
10. [Build & Deployment](#11-build--deployment)
11. [Dependencies](#12-dependencies)
12. [Design Patterns](#13-design-patterns)
13. [Known Issues](#14-known-issues)

---

## 1. Project Overview

**VibeRemote** is a remote-control system for AI coding agent CLIs (Claude Code, OpenCode, Gemini CLI) running on a desktop machine. It allows a developer to operate these agents from their phone — approving/denying tool calls, answering agent questions, injecting prompts, and monitoring agent activity in real-time.

| Component | Repo | Role |
|---|---|---|
| **Desktop** | `vRdeksMultiharness` (this repo) | Electron app + Node relay daemon |
| **Mobile** | `vibe_remote(reactNative)` | React Native phone controller |
| **Server** | `vibe_remote(serverside)` | Stateless Express REST API + Postgres |

**Author:** spiralware · **License:** MIT · **Version:** 1.6.5

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Desktop Framework | Electron 42 (frameless window, 400×780) |
| UI Framework | React 19 (JSX, StrictMode) |
| Bundler | Vite 5.4 (three configs: main, preload, renderer) |
| Build/Packaging | Electron Forge 7.11 + electron-builder 26 (NSIS) |
| State Management | React `useState`/`useEffect` (no external lib) |
| QR Code | `qrcode.react` |
| Backend Comms | `fetch` (native), `@supabase/supabase-js` (Realtime only) |
| Code Protection | `esbuild` (bundling), `javascript-obfuscator` (scrambling) |
| Native Modules | `node-pty` (pseudo-terminal for Gemini CLI) |
| Platform | **Windows-only** (Win32 API P/Invoke for keystroke injection) |
| Runtime | Node.js ESM (daemon), CommonJS (wrappers/relay.cjs) |

## 3. Architecture

### High-Level System Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         DESKTOP (Electron App)                           │
│                                                                          │
│  ┌─────────────┐    IPC     ┌──────────────────────────────────────────┐ │
│  │  Renderer   │◄──────────►│           Main Process (main.js)         │ │
│  │  (React 19) │            │  • Window mgmt (frameless, tray)        │ │
│  │             │            │  • IPC handlers (relay/harness/window)   │ │
│  │  Dashboard  │            │  • Spawns heartbeat.js                   │ │
│  │  TitleBar   │            │  • Harness CLI bridge (harness-cli.js)   │ │
│  │  QR Code    │            │  • Settings.json writer (Claude hooks)   │ │
│  └─────────────┘            └───────────┬──────────────────────────────┘ │
│                                          │ spawn                         │
│                    ┌─────────────────────┼─────────────────────┐         │
│                    ▼                     ▼                     ▼         │
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌───────────────┐  │
│  │   heartbeat.js       │  │   hook.js (PreTool)  │  │ harness-cli   │  │
│  │   (long-running)     │  │   postHook.js        │  │ (one-shot)    │  │
│  │                      │  │   stopHook.js        │  │               │  │
│  │ • 15s heartbeat      │  │   notifyHook.js      │  │ • list        │  │
│  │ • 3s transcript tail │  │                      │  │ • enable      │  │
│  │ • 10s prompt drain   │  │ Called by Claude Code │  │ • disable     │  │
│  │ • 5s file tree       │  │ on each tool call     │  │ • report      │  │
│  │ • 15s liveness       │  │                      │  │ • apply-desired│ │
│  │ • 5s stop poll       │  │ Exit 0 = allow       │  └───────────────┘  │
│  │ • 3s ready flags     │  │ Exit 2 = deny        │                     │
│  └──────────┬───────────┘  └──────────┬───────────┘                     │
│             │                         │                                  │
│  ┌──────────▼─────────────────────────▼───────────────────────────────┐  │
│  │                   HARNESS ABSTRACTION LAYER                        │  │
│  │                                                                    │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐   │  │
│  │  │  registry.js │  │ harness-sdk/ │  │  adapters:             │   │  │
│  │  │  (discover)  │  │  transport.js│  │  ┌──────────────────┐  │   │  │
│  │  │              │  │  schema.js   │  │  │ claude-code      │  │   │  │
│  │  │  readdirSync │  │  env.js      │  │  │  (SettingsHook)  │  │   │  │
│  │  │  + dynamic   │  │  validate.js │  │  ├──────────────────┤  │   │  │
│  │  │  import()    │  │              │  │  │ opencode         │  │   │  │
│  │  └──────────────┘  └──────────────┘  │  │  (Plugin + SDK)  │  │   │  │
│  │                                       │  ├──────────────────┤  │   │  │
│  │                                       │  │ gemini-cli       │  │   │  │
│  │                                       │  │  (PtyProxy)      │  │   │  │
│  │                                       │  └──────────────────┘  │   │  │
│  │                                       └────────────────────────┘   │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  Coordination: Files in %LOCALAPPDATA%\VibeRemote\runtime\              │
│  (relay-busy-*.flag, relay-pid-*.txt, relay-pending/*, relay-ready-*)   │
└──────────────────────────┬───────────────────────────────────────────────┘
                           │
                    HTTPS REST (x-machine-api-key header)
                    Supabase Realtime (broadcast channels)
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                         SERVER (Express REST API)                        │
│  • Stateless — no WebSocket/socket.io                                   │
│  • Self-hosted Supabase (Postgres + Kong + Realtime)                    │
│  • Routes: /machines, /relay, /mobile, /harness, /profile               │
│  • Auth: x-machine-api-key (daemon) or Bearer JWT (mobile)              │
│  • FCM push via firebase-admin for approval/question notifications       │
└──────────────────────────┬───────────────────────────────────────────────┘
                           │
                    HTTPS REST (Bearer JWT) + Supabase Realtime
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    MOBILE (React Native App)                             │
│  • Agent Control — live chat feed, approval cards, question picker       │
│  • QR scanning, push notifications, file browser                        │
│  • Zustand + TanStack Query v5 + Supabase Realtime                      │
└──────────────────────────────────────────────────────────────────────────┘
```

### Internal Desktop Architecture

```
┌─────────────────────────────────────────────────────┐
│              Electron Main Process                   │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐  │
│  │ Window   │  │ IPC      │  │ Heartbeat Mgr     │  │
│  │ Mgmt     │  │ Handlers │  │ (auto-start/restart│  │
│  │          │  │ (12)     │  │  on crash)         │  │
│  └──────────┘  └──────────┘  └───────────────────┘  │
│       │              │               │                │
│       │              │               ▼                │
│       │              │  ┌───────────────────────┐    │
│       │              │  │ heartbeat.js          │    │
│       │              │  │ (long-running child)  │    │
│       │              │  │                       │    │
│       │              │  │ Timers:               │    │
│       │              │  │ • tick (15s)          │    │
│       │              │  │ • drainBackstop (3s)  │    │
│       │              │  │ • checkReadyFlags (1s)│    │
│       │              │  │ • checkFsRequests (5s)│    │
│       │              │  │ • checkTranscripts(3s)│    │
│       │              │  │ • checkUsagePokes (1s)│    │
│       │              │  │ • flushPending (15s)  │    │
│       │              │  │ • liveness (15s)      │    │
│       │              │  │ • stopPoll (5s)       │    │
│       │              │  └───────────────────────┘    │
│       │              │                               │
│       ▼              ▼                               │
│  ┌────────────────────────────────────────────────┐  │
│  │         Harness Abstraction Layer              │  │
│  │                                                │  │
│  │  registry.js ──► harness-sdk/ ──► adapters/    │  │
│  │  (auto-discover)  (stable contract)            │  │
│  │                                                │  │
│  │  ┌────────────────────────────────────────┐    │  │
│  │  │ Strategies:                            │    │  │
│  │  │  • SettingsHook → Claude Code          │    │  │
│  │  │  • Plugin       → OpenCode             │    │  │
│  │  │  • PtyProxy     → Gemini CLI           │    │  │
│  │  │  • Null         → Flag-file toggle     │    │  │
│  │  └────────────────────────────────────────┘    │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  File Coordination:                                  │
│  %LOCALAPPDATA%\VibeRemote\runtime\                  │
│  ├── relay-busy-<session>.flag                       │
│  ├── relay-pid-<session>.txt                         │
│  ├── relay-pending/<request-id>.approved|.denied     │
│  └── relay-ready-<session>.flag                      │
└─────────────────────────────────────────────────────┘
```

---

## 4. Key Components

### 4.1 Electron Main Process (`src/main.js`)

| Responsibility | Detail |
|---|---|
| Window Management | Frameless 400×780 window, close-to-tray, custom title bar |
| Machine Identity | `migrateMachineEnv()` moves credentials across app renames/updates |
| Hook Path Updates | `refreshHookPathIfEnabled()` updates paths after Squirrel version changes |
| Harness CLI Bridge | Shells out to `harness-cli.js` for list/enable/disable/restore/refresh/report/apply-desired |
| Heartbeat Management | Auto-starts `heartbeat.js`, auto-restarts on crash, kills on quit |
| System Tray | Show/hide, graceful quit (disables all harnesses first) |
| IPC Surface | 12 handlers for relay config, hook status, harness toggles, window controls, hostname |

### 4.2 React Renderer

| Component | Purpose |
|---|---|
| `App.jsx` | Root — renders `TitleBar` + `Dashboard` |
| `TitleBar.jsx` | Custom window chrome (minimize/maximize/close), tracks maximize state |
| `Dashboard.jsx` | Three card sections: Machine info, QR pairing, Harness toggles |

### 4.3 Relay Daemon (`relay-deamon1/`)

A **separate Node.js project** with its own `node_modules`, shipped as an Electron `extraResource` outside the asar.

#### Hook System (Claude Code Interception)

| File | Trigger | Purpose |
|---|---|---|
| `hook.js` | PreToolUse | Reads stdin, resolves Claude PID, handles stop/question, pre-filters, uploads approval, blocks until decision |
| `postHook.js` | PostToolUse | Posts tool_end narrative, checks stop flag |
| `stopHook.js` | Stop (turn ends) | Posts stop event, clears busy flag, drops ready flag |
| `notifyHook.js` | Notification | Forwards progress messages as narrative events |
| `*-wrapper.cjs` | — | CJS shims that `dynamic-import()` ESM files (Windows compat) |

#### Heartbeat Daemon (`scripts/heartbeat.js` — 1122 lines)

The most complex file. Runs as a long-lived child process with multiple timed loops:

| Timer | Interval | Purpose |
|---|---|---|
| `tick` | 15s | Machine heartbeat (keeps `is_online` fresh) |
| `drainBackstop` | 3s | Polls for queued mobile prompts (per-session, idle-gated) |
| `checkReadyFlags` | 1s | Detects turn-end flags, injects queued prompts instantly |
| `checkFsRequests` | 5s | Serves file-tree requests from mobile |
| `checkTranscripts` | 3s | Tails Claude's JSONL transcript for narrative output |
| `checkUsagePokes` | 1s | Detects statusLine token-usage pokes |
| `flushPendingEvents` | 15s | Re-sends turn-end events missed while offline |
| `keepActiveTurnsAlive` | 10s | Refreshes `last_activity_at` for busy sessions |
| `reportSessionLiveness` | 15s | Reports which session CLIs are still alive |
| `checkStopRequests` | 5s | Polls for stop requests (backstop for broadcast) |

Also performs: OpenCode plugin file/env sync, prompt injection via PowerShell `WriteConsoleInput` + clipboard fallback, ESC interrupt key injection, new terminal window spawning.

#### CLI Tools

| Tool | Purpose |
|---|---|
| `harness-cli.js` | Bridge spawned by Electron main process. Commands: `list`, `enable`, `disable`, `status`, `report`, `apply-desired`, `disable-all`, `restore`, `refresh` |
| `relay.cjs` | Terminal control script. Commands: `mobile`, `cli`, `1`/`approve`, `3`/`deny`, `answer <n>`, `status`, `reset`, `allow-all` |
| `decide.cjs` | PC-side approval with request ID. Writes local signal file + updates Supabase |

---

## 5. Data Flow

### Tool Approval Flow (Claude Code)

```
Claude Code fires PreToolUse
  → hook.js (stdin: tool_name, tool_input, session_id)
    → storeClaudePid()         — resolve real Claude PID via PowerShell process tree walk
    → preFilter()              — check ALWAYS_ALLOW/ALWAYS_BLOCK, read-only auto-allow
    → parseEvent()             — build display payload with risk assessment + diff
    → uploadRequest()          — POST /relay/upload → server stores pending_requests row
    → server fires broadcast on session:<id> + FCM push to mobile
    → raceDecision(requestId)  — races:
        1. Supabase Realtime postgres_changes on pending_requests UPDATE
        2. HTTP poll GET /relay/status/:id (25s interval)
        3. Local file poll relay-pending/<id>.approved|.denied (150ms)
    → exit(0) if approved, exit(2) if denied/timeout
```

### Prompt Injection Flow (Mobile → Desktop)

```
Phone: POST /mobile/prompt → server inserts mobile_commands row
  → server broadcasts command_available on machine:<id>
    → heartbeat.js receives broadcast
      → drainQueue(sessionId) — scoped, idle-gated claim
        → getNextCommand(sessionId) — GET /mobile/command/next (atomic conditional UPDATE)
        → if session alive + idle:
            → tryInjectIntoExistingTerminal() — PowerShell WriteConsoleInput
            → fallback: clipboard + Ctrl+V keystroke
            → fallback: new PowerShell window with Start-Process
```

### QR Pairing Flow

```
Desktop: POST /machines/register (unowned, API key)
  → POST /:id/challenge → server mints one-time nonce (5min TTL)
    → Desktop renders QR code with challenge nonce
      → Phone scans QR → POST /:id/pair (user JWT, verifies API key)
        → Server sets user_id, paired_device_id
        → Broadcast 'paired' on machine:<id>
        → Desktop Realtime listener receives paired event
```

---

## 6. Harness Abstraction Layer

### Registry (`registry.js`)

Auto-discovers adapters from `src/harnesses/<id>/provider.js` via `readdirSync` + dynamic `import()`. Adding a harness is purely additive — just create a new folder.

### Harness SDK (`harness-sdk/`)

The stable contract that adapters compile against:

| Module | Purpose |
|---|---|
| `transport.js` | Single choke point for all VPS HTTP calls |
| `schema.js` | Canonical `RelayRequest` and `NarrativeEvent` row shapes |
| `env.js` | Non-fatal `.env` loader + `machineCtx()` builder |
| `validate.js` | Provider validation |

### Four Strategies

| Strategy | Used By | Mechanism |
|---|---|---|
| `SettingsHookStrategy` | Claude Code | Writes hooks + permissions into `~/.claude/settings.json` |
| `PluginStrategy` | OpenCode | Copies plugin file into OpenCode's plugin dir + env JSON + flag file |
| `PtyProxyStrategy` | Gemini CLI | Wraps CLI in `node-pty`, pattern-matches approval prompts, writes keystrokes |
| `NullStrategy` | Gemini CLI (toggle) | Flag-file-only on/off toggle |

### Three Adapters

| Adapter | Detection | Approval Mechanism | Narrative Source | Prompt Injection |
|---|---|---|---|---|
| `claude-code` | `claude --version` | SettingsHook (exit codes) | Heartbeat transcript tailing | Heartbeat keystroke injection |
| `opencode` | `opencode --version` | Plugin (throw to deny) | SDK SSE event stream | SDK `session.prompt()` |
| `gemini-cli` | `gemini --version` | PtyProxy (pattern-match) | Live PTY buffer | PTY `term.write()` |

---

## 7. API Surface

### Desktop → Server (Machine-Key Auth)

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/relay/upload` | Upload tool-use approval request |
| `GET` | `/relay/status/:id` | Poll request decision status |
| `POST` | `/relay/terminal-event` | Log terminal events |
| `GET` | `/relay/stop-requests` | Poll stop requests |
| `POST` | `/relay/stop-ack` | Acknowledge stop requests |
| `POST` | `/machines/heartbeat` | Keep alive |
| `POST` | `/machines/offline` | Go offline |
| `POST` | `/harness/report` | Push harness inventory |
| `GET` | `/harness/desired` | Poll phone-requested toggles |
| `GET` | `/mobile/command/next` | Poll queued prompts |
| `POST` | `/relay/usage` | Token usage streaming |
| `POST` | `/relay/sessions-alive` | CLI alive heartbeat |

### Desktop IPC (Electron Internal)

| Channel | Direction | Purpose |
|---|---|---|
| `relay:status` | Renderer → Main | Get relay daemon status |
| `relay:config` | Renderer → Main | Read/write relay configuration |
| `harness:list` | Renderer → Main | List detected harnesses |
| `harness:toggle` | Renderer → Main | Enable/disable a harness |
| `window:minimize` | Renderer → Main | Minimize window |
| `window:maximize` | Renderer → Main | Toggle maximize |
| `window:close` | Renderer → Main | Close/minimize to tray |
| `hostname:get` | Renderer → Main | Get machine hostname |

---

## 8. Database Schema

### Tables

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

**`agents`** — Active agent sessions
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `machine_id` | uuid FK → machines | CASCADE delete |
| `session_id` | text UNIQUE | Session identifier |
| `harness` | text | `'claude-code'` default |
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
| `risk_level` | text | |
| `diff` | jsonb | |
| `question` | jsonb | Multi-choice payload |
| `status` | text | `pending`/`approved`/`denied`/`timeout`/`answered`/`cli_pending` |
| `decided_by` | text | `'mobile'` or `'pc'` |

**`terminal_events`** — Activity feed events
**`mobile_commands`** — Queued prompts from mobile
**`fs_requests`** — Remote file tree browsing
**`push_tokens`** — FCM device tokens
**`mobile_devices`** — Registered phone installations
**`profiles`** — User profile data
**`machine_harnesses`** — Per-machine harness inventory
**`machine_challenges`** — One-time QR pairing nonces
**`stop_requests`** — Interrupt requests for active turns

---

## 9. Configuration

### Environment Variables

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Public anon key (JWT verify only) |
| `SUPABASE_SERVICE_KEY` | Service role key (full DB access) |
| `SUPABASE_JWT_SECRET` | HS256 secret for local JWT verification |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase service account JSON |
| `PORT` | Server port (default 3000) |

### File-Based Config

| Path | Purpose |
|---|---|
| `%LOCALAPPDATA%\VibeRemote\machine.env` | Machine identity (API key, machine ID, label) |
| `%LOCALAPPDATA%\VibeRemote\runtime\` | Inter-process coordination files |
| `%LOCALAPPDATA%\VibeRemote\logs\` | JSON stderr logs |
| `~/.claude/settings.json` | Claude Code hook configuration (written by SettingsHookStrategy) |

---

## 10. Build & Deployment

### Build Pipeline

```
Source Code
  → Vite (3 configs: main, preload, renderer)
    → esbuild (bundle relay-deamon1/src/*)
      → javascript-obfuscator (scramble shipped code)
        → Electron Forge (package as app)
          → electron-builder (NSIS installer)
```

### NPM Scripts

| Script | Purpose |
|---|---|
| `npm start` | Launch Electron in dev mode |
| `npm run build` | Full build pipeline |
| `npm run package` | Package without installer |
| `npm run make` | Create distributable |

### Deployment

- **Platform:** Windows only (NSIS installer)
- **Auto-update:** Squirrel-compatible with hook path refresh
- **Installers:** v1.4.0 through v1.6.5 in `dist-installer/`
- **Code protection:** esbuild bundling + javascript-obfuscator scrambling

---

## 11. Dependencies

### Electron App (`package.json`)

| Package | Purpose |
|---|---|
| `electron` | Desktop framework |
| `react` / `react-dom` | UI framework |
| `@supabase/supabase-js` | Realtime only |
| `qrcode.react` | QR code generation |
| `electron-squirrel-startup` | Auto-install/update |
| `@electron-forge/*` | Build toolchain |
| `electron-builder` | NSIS installer |
| `vite` | Bundler |
| `esbuild` | Fast bundling |
| `javascript-obfuscator` | Code protection |

### Relay Daemon (`relay-deamon1/package.json`)

| Package | Purpose |
|---|---|
| `@supabase/supabase-js` | Server communication + Realtime |
| `diff` | Diff generation for tool-use display |
| `dotenv` | Environment loading |
| `node-pty` (optional) | PTY proxy for Gemini CLI |
| `@opencode-ai/sdk` (optional) | OpenCode SDK integration |

---

## 12. Design Patterns

### Multi-Strategy Harness Abstraction
Each CLI agent has a different interception mechanism. The harness abstraction uses a strategy pattern with a shared SDK contract, making it trivial to add new agents.

### Dual Coordination (Realtime + Polling)
Primary path uses Supabase Realtime broadcast (~1s), with HTTP polling as a reliability backstop (25s interval). File-based coordination provides a third layer for local IPC.

### File-Based IPC
Since hook processes are short-lived and can't maintain connections, coordination uses flag files in `%LOCALAPPDATA%\VibeRemote\runtime\`. This includes busy flags, PID files, pending decisions, and ready flags.

### Exit-Code Protocol
Claude Code hooks communicate approval decisions via exit codes: `0` = allow, `2` = deny. This is the simplest possible IPC — no file parsing, no network calls during the hook.

### Progressive Schema Migration
All migrations are purely additive — they never modify or drop existing columns. This enables zero-downtime schema evolution on a live database.

# Vibe Remote Desktop Application

[![GitHub Release](https://img.shields.io/github/v/release/yourusername/vibe-remote-desktop)](https://github.com/lalaa-a/viberemote_dekstop/releases/tag/v1.0.0)
[![GitHub Downloads](https://img.shields.io/github/downloads/yourusername/vibe-remote-desktop/total)](https://github.com/lalaa-a/viberemote_dekstop/releases/tag/v1.0.0)

## Download
Download the latest desktop application from the [Releases page](https://github.com/lalaa-a/viberemote_dekstop/releases/tag/v1.0.0).

## Features
- Remote control
- Screen sharing
- File transfer

## Installation
1. Go to [Releases](https://github.com/lalaa-a/viberemote_dekstop/releases)
2. Download the appropriate installer for your OS
3. Run the installer

---
