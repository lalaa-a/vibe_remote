# Vibe Remote - React Native Mobile App

> React Native phone controller for AI coding agent remote supervision

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Directory Structure](#3-directory-structure)
4. [Architecture](#4-architecture)
5. [Key Components](#5-key-components)
6. [Data Flow](#6-data-flow)
7. [API Layer](#7-api-layer)
8. [State Management](#8-state-management)
9. [Real-Time Updates](#9-real-time-updates)
10. [Configuration](#10-configuration)
11. [Build & Deployment](#11-build--deployment)
12. [Dependencies](#12-dependencies)
13. [Design Patterns](#13-design-patterns)
14. [Screens Reference](#14-screens-reference)

---

## 1. Project Overview

**Vibe Remote** (AgentControl) is a React Native mobile app that serves as the phone-side controller for AI coding agents running on a desktop machine. It enables developers to remotely approve/deny tool calls, answer agent questions, inject prompts, and monitor agent activity in real-time from their phone.

**Key Capabilities:**
- QR-code machine pairing
- Real-time chat feed with agent activity
- Tool-use approval/denial cards with risk assessment
- Multi-choice question answering
- Prompt injection to agent sessions
- Live terminal event monitoring
- File tree browsing
- Token usage tracking
- Biometric app lock

**Part of the VibeRemote ecosystem:**
| Component | Role |
|---|---|
| Desktop (Electron) | Hooks into AI CLIs, uploads tool-use events |
| Server (Express) | Routes and persists all communication |
| **Mobile (this app)** | Phone-side control interface |

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Framework | React Native 0.85 |
| Language | TypeScript 5.x |
| UI Framework | React 19 |
| Navigation | React Navigation 7 |
| State Management | Zustand 5 |
| Server State | TanStack React Query v5 |
| Database Client | `@supabase/supabase-js` 2 |
| Real-Time | Supabase Realtime (broadcast channels) |
| List Rendering | `@shopify/flash-list` 2 |
| Push Notifications | Firebase messaging (FCM) |
| Secure Storage | `react-native-keychain` + `react-native-mmkv` |
| Camera | `react-native-camera-kit` (QR scanning) |
| Biometrics | `react-native-biometrics` |
| Icons | `lucide-react-native` |
| Platform | Android (primary), iOS (secondary) |

---

## 3. Architecture

### High-Level Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    REACT NATIVE MOBILE APP                    │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐   │
│  │                   SCREENS LAYER                        │   │
│  │                                                       │   │
│  │  SignIn  SignUp  QRScan  Sessions  Chat  Requests     │   │
│  │  Terminal  FileBrowser  Profile  Security  Machines   │   │
│  └───────────────────────┬───────────────────────────────┘   │
│                          │                                    │
│  ┌───────────────────────▼───────────────────────────────┐   │
│  │                    HOOKS LAYER                         │   │
│  │                                                       │   │
│  │  useAuth  useSessions  useRequests  useChatFeed       │   │
│  │  useTerminal  useMachinesPresence  useFileTree        │   │
│  │  usePushNotifications  useSessionsRealtime            │   │
│  └───────────┬──────────────────────────┬────────────────┘   │
│              │                          │                     │
│  ┌───────────▼──────────┐  ┌───────────▼────────────────┐   │
│  │    STATE LAYER       │  │      API LAYER              │   │
│  │                      │  │                             │   │
│  │  ┌──────────────┐    │  │  ┌─────────────────────┐   │   │
│  │  │   Zustand    │    │  │  │  Supabase Client    │   │   │
│  │  │   Store      │    │  │  │  (auth + realtime)  │   │   │
│  │  │              │    │  │  └─────────────────────┘   │   │
│  │  │ • Auth state │    │  │  ┌─────────────────────┐   │   │
│  │  │ • UI state   │    │  │  │  Server API         │   │   │
│  │  │ • Lock state │    │  │  │  (REST endpoints)   │   │   │
│  │  └──────────────┘    │  │  └─────────────────────┘   │   │
│  │                      │  │  ┌─────────────────────┐   │   │
│  │  ┌──────────────┐    │  │  │  Realtime           │   │   │
│  │  │ React Query  │    │  │  │  (broadcast subs)   │   │   │
│  │  │ Cache        │    │  │  └─────────────────────┘   │   │
│  │  │              │    │  │  ┌─────────────────────┐   │   │
│  │  │ • Sessions   │    │  │  │  Machines API       │   │   │
│  │  │ • Requests   │    │  │  │  Device API         │   │   │
│  │  │ • Feed       │    │  │  └─────────────────────┘   │   │
│  │  │ • Terminal   │    │  │                             │   │
│  │  └──────────────┘    │  │                             │   │
│  └──────────────────────┘  └────────────────────────────┘   │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐   │
│  │                 COMPONENTS LAYER                       │   │
│  │                                                       │   │
│  │  UI primitives: Button, Badge, Card, BackButton       │   │
│  │  Domain: RequestCard, QuestionCard, HarnessAvatar     │   │
│  │  Chat: MarkdownText, TerminalText, DiffViewer         │   │
│  │  Layout: GradientBackground, AppLockGate              │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐   │
│  │                 PLATFORM LAYER                         │   │
│  │                                                       │   │
│  │  Keychain (secure)  MMKV (fast)  Biometrics           │   │
│  │  Camera Kit (QR)    FCM (push)   Permissions          │   │
│  └───────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
                          │
               HTTPS REST + WebSocket
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│              EXPRESS SERVER (Vibe Remote Backend)             │
│  • /relay/*  • /mobile/*  • /machines/*  • /harness/*        │
│  • Supabase Realtime broadcast                               │
│  • Firebase Cloud Messaging                                  │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│           DESKTOP (Electron + Relay Daemon)                   │
│  • AI coding agent hooks                                     │
│  • Tool-use interception + approval flow                     │
└──────────────────────────────────────────────────────────────┘
```

### Navigation Architecture

```
RootNavigator
├── Auth Stack (not authenticated)
│   ├── SignInScreen
│   └── SignUpScreen
│
├── App Stack (authenticated)
│   ├── SessionsScreen (tab: active sessions)
│   ├── SessionDetailScreen
│   │   └── ChatScreen (unified feed)
│   ├── RequestDetailScreen (approval/question)
│   ├── TerminalScreen (terminal events)
│   ├── FileBrowserScreen
│   ├── MachinesScreen (paired machines)
│   ├── ProfileScreen
│   │   └── SecurityScreen (biometric lock)
│   └── QRScanScreen (pair new machine)
│
└── AppLockGate (wraps app stack)
    └── Biometric challenge on resume
```

---

## 4. Key Components

### 4.1 Screens

| Screen | Purpose | Key Features |
|---|---|---|
| `SignInScreen` | User login | Email/password, Supabase GoTrue |
| `SignUpScreen` | User registration | Email/password creation |
| `QRScanScreen` | Machine pairing | Camera-based QR scanner, one-time challenge verification |
| `SessionsScreen` | Session list | Real-time presence, pull-to-refresh, machine grouping |
| `ChatScreen` | Live chat feed | Unified feed (terminal events, requests, prompts), cursor pagination |
| `SessionDetailScreen` | Session details | Tab view: chat feed + terminal events + requests |
| `RequestDetailScreen` | Approval/question | Full request details, approve/deny/answer actions, diff viewer |
| `TerminalScreen` | Terminal events | Raw terminal event stream for a session |
| `FileBrowserScreen` | File tree | Browse remote file system on desktop |
| `MachinesScreen` | Machine management | Paired machines, online/offline status, unpair |
| `ProfileScreen` | User profile | Display name, avatar, account settings |
| `SecurityScreen` | App security | Biometric lock toggle, PIN setup |

### 4.2 Custom Hooks

| Hook | Purpose | Queries/Mutations |
|---|---|---|
| `useAuth` | Authentication state | signIn, signUp, signOut, session |
| `useSessions` | Session list | Query: `/mobile/sessions` |
| `useSessionsRealtime` | Real-time session updates | Supabase broadcast subscription |
| `useRequests` | Request management | Query: pending requests, decide mutation |
| `useChatFeed` | Chat feed with pagination | Query: `/mobile/sessions/:id/feed` (cursor-based) |
| `useTerminal` | Terminal events | Query: `/mobile/terminal` |
| `useMachinesPresence` | Machine online tracking | Realtime presence + polling |
| `useFileTree` | File browsing | Request/poll for file tree from desktop |
| `usePushNotifications` | FCM token mgmt | Register token on auth |
| `useTypewriter` | Animation effect | Loading screen text animation |

### 4.3 UI Components

| Component | Purpose |
|---|---|
| `Button` | Touchable button with variants (primary, secondary, danger) |
| `Badge` | Status indicator (online, offline, pending, approved) |
| `Card` | Content container with shadow/border |
| `BackButton` | Navigation back arrow |
| `RequestCard` | Tool-use approval card (tool name, risk, summary) |
| `QuestionCard` | Multi-choice question card (options, selection) |
| `RiskBadge` | Color-coded risk level (low/medium/high/critical) |
| `HarnessAvatar` | Agent icon (Claude, OpenCode, Gemini) |
| `HarnessBadge` | Agent name label |
| `LiveBadge` | "LIVE" indicator for active sessions |
| `DiffViewer` | Side-by-side code diff (additions green, deletions red) |
| `MarkdownText` | Renders markdown in chat messages |
| `TerminalText` | Monospace terminal-styled text |
| `PinEntry` | Numeric PIN input field |
| `AppLockGate` | Biometric challenge gate on app resume |
| `GradientBackground` | Gradient backdrop for screens |

---

## 5. Data Flow

### Authentication Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  User opens  │     │  App checks  │     │  Supabase    │
│  app         │────>│  Keychain    │────>│  session     │
│              │     │  for stored  │     │  validity    │
│              │     │  session     │     │              │
│              │     └──────┬───────┘     └──────┬───────┘
│              │            │                     │
│              │     ┌──────▼───────┐     ┌──────▼───────┐
│              │     │  Valid?      │     │  Token       │
│              │     │              │     │  refreshed?  │
│              │     │  Yes → App   │     │              │
│              │     │  No → SignIn │     │  Yes → App   │
│              │     └──────────────┘     │  No → SignIn │
│              │                          └──────────────┘
└──────────────┘
```

### Approval Flow (Mobile)

```
User sees pending request
  │
  ├─► RequestCard renders (tool name, risk badge, summary)
  │
  ├─► User taps "View Details"
  │     └─► RequestDetailScreen
  │           ├─► Full request info (diff, raw input, files affected)
  │           ├─► Approve button → POST /mobile/decide {decision: 'approved'}
  │           ├─► Deny button → POST /mobile/decide {decision: 'denied'}
  │           └─► Question options → POST /mobile/answer {selected: [...]}
  │
  └─► Optimistic update in React Query cache
        └─► Server broadcasts 'feed' nudge on session topic
              └─► Chat screen updates in real-time
```

### Real-Time Chat Feed

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Supabase    │     │  useChatFeed │     │  ChatScreen  │
│  Realtime    │────>│  hook        │────>│  renders     │
│  broadcast   │     │              │     │  feed items   │
│              │     │  Invalidates │     │              │
│  'feed' on   │     │  React Query │     │  Scroll to   │
│  session:<id>│     │  cache       │     │  bottom      │
└──────────────┘     └──────────────┘     └──────────────┘

Feed items (UNION ALL from server):
├── terminal_events  (start, stop, reasoning, tool_use)
├── pending_requests (approval, question)
└── mobile_commands  (user prompts)
```

### QR Pairing Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Desktop     │     │  Express     │     │  Mobile App  │
│  renders QR  │     │  Server      │     │              │
│              │     │              │     │  User opens  │
│  POST /:id/  │     │  Stores      │     │  QR scanner  │
│  challenge   │────>│  challenge   │     │              │
│  {nonce}     │     │  (5min TTL)  │     │  Scans QR    │
│              │     │              │     │              │
│              │     │              │     │  POST /:id/  │
│              │     │<─────────────│─────│  pair        │
│              │     │  Verifies    │     │  {apiKey,    │
│              │     │  + consumes  │     │   userId}    │
│              │     │  challenge   │     │              │
│              │     │              │     │              │
│  Realtime    │<────│  Broadcast   │     │              │
│  'paired'    │     │  'paired'    │     │              │
└──────────────┘     └──────────────┘     └──────────────┘
```

---

## 6. API Layer

### Supabase Client (`src/api/supabase.ts`)

Initializes Supabase client for:
- **Authentication** (GoTrue)
- **Realtime** (broadcast subscriptions)
- **Direct database queries** (where needed)

### Server API (`src/api/server.ts`)

REST calls to the Express server:

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/mobile/sessions` | List all sessions |
| `GET` | `/mobile/sessions/:id/requests` | Pending requests for session |
| `GET` | `/mobile/sessions/:id/feed` | Cursor-paginated chat feed |
| `POST` | `/mobile/decide` | Approve/deny a request |
| `POST` | `/mobile/answer` | Answer a question |
| `POST` | `/mobile/prompt` | Queue a prompt |
| `POST` | `/mobile/sessions/:id/stop` | Interrupt active turn |
| `GET` | `/mobile/terminal` | Terminal events |
| `POST` | `/mobile/fs/request` | Request file tree |
| `GET` | `/mobile/fs/result/:id` | Poll file tree result |

### Realtime (`src/api/realtime.ts`)

| Channel Pattern | Events | Purpose |
|---|---|---|
| `machine:<uuid>` | `paired`, `unpaired`, `offline`, `command_available` | Machine-level events |
| `session:<uuid>` | `feed`, `usage` | Session-level events |

### Machines API (`src/api/machines.ts`)

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/machines/:id/pair` | Pair with machine |
| `DELETE` | `/machines/:id/pair` | Unpair |
| `GET` | `/machines/mine` | List user's machines |
| `POST` | `/machines/devices` | Register device |

### Device API (`src/api/device.ts`)

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/machines/devices` | Register device |
| `POST` | `/mobile/push-token` | Register FCM token |

---

## 7. State Management

### Zustand Store (`src/store/useAppStore.ts`)

Global app state:

| Slice | State | Purpose |
|---|---|---|
| Auth | `session`, `user` | Current auth session |
| UI | `selectedSessionId` | Active session selection |
| Lock | `isLocked`, `pinEnabled` | App lock state |

### React Query Cache

Server state managed by TanStack Query:

| Query Key | Data | Cache Strategy |
|---|---|---|
| `sessions` | Session list | Stale: 30s, Refetch on focus |
| `requests` | Pending requests | Stale: 10s, Realtime invalidation |
| `feed` | Chat feed items | Cursor pagination, append-only |
| `terminal` | Terminal events | Stale: 15s |
| `machines` | Paired machines | Stale: 60s, Realtime presence |
| `fileTree` | File tree data | Manual fetch (request + poll) |

### Optimistic Updates

Decision mutations (approve/deny/answer) use optimistic updates:
1. Immediately update React Query cache
2. Fire API request
3. Rollback on error

---

## 8. Real-Time Updates

### Broadcast Subscription Pattern

```typescript
// Subscribes to Supabase Realtime broadcast on machine:<uuid>
// Events: paired, unpaired, offline, command_available
// Invalidates relevant React Query caches on each event
```

### Dual Update Strategy

| Mechanism | Latency | Use Case |
|---|---|---|
| Supabase Realtime broadcast | ~1s | Feed updates, presence, pairing |
| React Query refetch | 10–60s | Background sync, stale data |
| Polling (file tree) | 5s | Async file tree requests |

### Session Feed Realtime

```
Server broadcasts 'feed' on session:<id>
  → useSessionsRealtime hook receives
    → Invalidates useChatFeed query cache
      → React Query refetches /mobile/sessions/:id/feed
        → ChatScreen re-renders with new items
```

---

## 9. Configuration

### Environment Variables (`.env`)

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Public anon key |
| `API_URL` | Express server base URL |

### TypeScript Config

- Strict mode enabled
- Path aliases for clean imports
- Target: ES2022

### Metro Config

- Default configuration with platform-specific extensions
- `.ios.js` / `.android.js` resolution

---

## 10. Build & Deployment

### NPM Scripts

| Script | Purpose |
|---|---|
| `npm start` | Start Metro bundler |
| `npm run android` | Build + run on Android |
| `npm run ios` | Build + run on iOS |
| `npm test` | Run Jest tests |
| `npm run lint` | Run ESLint |
| `npm run icons` | Generate app icons |

### Build Pipeline

```
Source (TypeScript + React Native)
  → Metro Bundler (JS bundle)
    → Gradle (Android APK/AAB)
      → App Store / Play Store
    → CocoaPods (iOS IPA)
      → App Store / TestFlight
```

### Platform Specifics

| Platform | Build Tool | Output |
|---|---|---|
| Android | Gradle | APK / AAB |
| iOS | CocoaPods + Xcode | IPA |

### App Icons

Generated via `scripts/generate-app-icons.mjs` from source icon.

---

## 11. Dependencies

### Core

| Package | Purpose |
|---|---|
| `react-native` 0.85 | Mobile framework |
| `react` 19 | UI library |
| `typescript` 5.x | Type safety |

### Navigation

| Package | Purpose |
|---|---|
| `@react-navigation/native` 7 | Navigation framework |
| `@react-navigation/native-stack` 7 | Native stack navigator |

### State & Data

| Package | Purpose |
|---|---|
| `zustand` 5 | Global state |
| `@tanstack/react-query` 5 | Server state cache |
| `@supabase/supabase-js` 2 | Database + auth + realtime |

### UI & Lists

| Package | Purpose |
|---|---|
| `@shopify/flash-list` 2 | High-performance list rendering |
| `lucide-react-native` | Icon library |
| `react-native-reanimated` | Animations |

### Platform

| Package | Purpose |
|---|---|
| `react-native-camera-kit` | QR code scanning |
| `react-native-biometrics` | Fingerprint/face auth |
| `react-native-keychain` | Secure credential storage |
| `react-native-mmkv` | Fast key-value storage |
| `@react-native-firebase/messaging` | FCM push notifications |
| `react-native-permissions` | Runtime permissions |

### Dev

| Package | Purpose |
|---|---|
| `jest` | Testing |
| `eslint` | Linting |
| `prettier` | Code formatting |
| `@types/react-native` | Type definitions |

---

## 12. Design Patterns

### Optimistic UI Updates
Decision mutations immediately update the React Query cache before the server responds. This gives instant visual feedback. On error, the cache is rolled back.

### Dual-Path Realtime
Primary updates via Supabase Realtime broadcast (~1s), with React Query background refetch (10–60s) as reliability backstop. Ensures data is always eventually consistent.

### Cursor-Based Pagination
Chat feed uses cursor pagination (`created_at` + `id`) instead of offset pagination. This handles real-time insertions without duplicates or gaps.

### Hook-per-Domain
Each domain (sessions, requests, feed, terminal, machines) has a dedicated hook that encapsulates all queries, mutations, and realtime subscriptions for that domain.

### Biometric Gate
`AppLockGate` wraps the authenticated app stack. On every app resume, it challenges the user with biometrics (if enabled). State is persisted in MMKV for instant check.

### Secure + Fast Storage
- **Keychain**: Auth tokens, PIN, biometric preference (encrypted at rest)
- **MMKV**: Non-sensitive fast-access state (selected session, UI preferences)

### Design System Primitives
Base UI components (`Button`, `Badge`, `Card`) are platform-agnostic and composable. Domain components (`RequestCard`, `QuestionCard`) build on top of these primitives.

---

## 13. Screens Reference

### Auth Screens

| Screen | Navigation | Purpose |
|---|---|---|
| `SignInScreen` | Auth Stack | Email/password login via Supabase GoTrue |
| `SignUpScreen` | Auth Stack | Account creation |

### Main Screens

| Screen | Navigation | Purpose |
|---|---|---|
| `SessionsScreen` | App Stack (initial) | List of active sessions grouped by machine, real-time presence |
| `SessionDetailScreen` | Push from Sessions | Tab view: chat feed + terminal + requests for one session |
| `ChatScreen` | Within SessionDetail | Unified real-time feed (terminal events, requests, prompts) |
| `RequestDetailScreen` | Push from Chat/Sessions | Full request detail with approve/deny/answer actions |
| `TerminalScreen` | Push from SessionDetail | Raw terminal event stream |
| `FileBrowserScreen` | Push from Chat | Browse remote file tree on desktop machine |

### Management Screens

| Screen | Navigation | Purpose |
|---|---|---|
| `MachinesScreen` | App Stack | List paired machines, online/offline status, unpair |
| `QRScanScreen` | Push from Machines | Camera-based QR scanner for pairing |
| `ProfileScreen` | App Stack | User profile, display name, account settings |
| `SecurityScreen` | Push from Profile | Biometric lock toggle, PIN management |

## 📥 Download Latest APK

[![Download APK](https://img.shields.io/badge/Download-APK-green?logo=android)](https://github.com/lalaa-a/viberemote_mobile/releases/download/v1.0.0/vibeRemote.apk)

---
