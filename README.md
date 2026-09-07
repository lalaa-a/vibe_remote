# Vibe Remote <p align="left"> <img src="https://github.com/lalaa-a/vibe_remote/blob/main/desktop/src/assets/logo/vibeRemote_icon.png" alt="Vibe Remote logo" width="72" height="72" /> </p>

> Remotely supervise your AI coding agents (Claude Code, OpenCode, Gemini CLI) from your phone approve tool calls, answer questions, inject prompts, and watch your agent work in real time, from anywhere.

[![License](https://img.shields.io/badge/license-BSL--1.1-blue)](./LICENSE)
[![Server](https://img.shields.io/badge/server-Express-black)](./server)
[![Desktop](https://img.shields.io/badge/desktop-Electron-47848F)](./desktop)
[![Mobile](https://img.shields.io/badge/mobile-React%20Native-61DAFB)](./mobile)

📱 **[Download the Android APK](https://github.com/lalaa-a/viberemote_mobile/releases/download/v1.0.0/vibeRemote.apk)** ·
🖥️ **[Download the Desktop app](https://github.com/lalaa-a/viberemote_dekstop/releases/tag/v1.0.0)**

---

## What is Vibe Remote?

You kick off a coding agent on your desktop, walk away, and it needs you a tool call needs approval, it's asking a question, it's waiting on your next prompt. Vibe Remote lets you handle all of that from your phone instead of being chained to your desk.

A lightweight **desktop daemon** hooks into your AI CLI of choice, relays every tool-use request, question, and terminal event to a **server**, which pushes it to your **phone** in real time. You approve, deny, answer, or send a new prompt — it flows straight back to the agent.

**Three components, one system:**

| Component | What it does | Stack |
|---|---|---|
| 🖥️ **[Desktop](./desktop)** | Hooks into Claude Code / OpenCode / Gemini CLI, relays events, injects prompts back into the terminal | Electron, Node.js, Vite |
| ⚙️ **[Server](./server)** | Stateless REST API that brokers all communication, handles auth, and pushes real-time + FCM notifications | Express, Supabase (Postgres), Firebase |
| 📱 **[Mobile](./mobile)** | Phone-side controller — live chat feed, approval cards, question picker, QR pairing | React Native, TypeScript, Zustand |

## Key Features

- **Multi-agent support** — Claude Code, OpenCode, and Gemini CLI, via a pluggable harness-adapter system
- **Remote approve/deny** — review tool calls (with diffs and risk level) and approve or deny from your phone
- **Live activity feed** — real-time chat-style feed of everything your agent is doing
- **Prompt injection** — send your agent a new instruction straight from your phone, mid-session
- **QR-code pairing** — scan to pair a desktop machine with your phone in seconds
- **Push notifications** — get notified the moment your agent needs input
- **File browser** — browse the remote project's file tree from your phone
- **Biometric app lock** — keep the control app itself locked behind Face ID / fingerprint

## How it works

```
┌────────────────┐        ┌──────────────────┐        ┌─────────────────┐
│    DESKTOP      │        │      SERVER       │        │      MOBILE      │
│ (Electron +     │  HTTPS │  (Express API +   │  HTTPS │ (React Native)   │
│  relay daemon)  │◄──────►│   Supabase +      │◄──────►│                  │
│                 │  + RT  │   Firebase FCM)    │  + RT  │                  │
│ Hooks into your │        │                    │        │ Approve / deny / │
│ AI coding CLI   │        │ Auth, routing,     │        │ answer / prompt  │
└────────────────┘        │ realtime broadcast │        └─────────────────┘
                           └──────────────────┘
```

1. Your AI agent (e.g. Claude Code) fires a tool call → the **desktop** daemon intercepts it via a hook
2. The daemon uploads the request to the **server**, which stores it and pushes a real-time event + push notification
3. Your **phone** shows the request instantly — you approve, deny, or answer it
4. The decision flows back through the server to the desktop daemon, which unblocks the agent

Full architecture diagrams, API references, and database schemas are in each component's own README — linked below.

## Getting Started

Each component has its own detailed setup guide:

- 🖥️ **[Desktop setup →](./desktop/README.md)** — build the Electron app, connect a harness, run the relay daemon
- ⚙️ **[Server setup →](./server/README.md)** — env vars, Supabase migrations, deployment
- 📱 **[Mobile setup →](./mobile/README.md)** — run via Metro, or just install the [prebuilt APK](https://github.com/lalaa-a/viberemote_mobile/releases/download/v1.0.0/vibeRemote.apk)

**Fastest way to try it:**
1. Download the [desktop installer](https://github.com/lalaa-a/viberemote_dekstop/releases/tag/v1.0.0) and run it on the machine where your AI CLI lives
2. Install the [Android APK](https://github.com/lalaa-a/viberemote_mobile/releases/download/v1.0.0/vibeRemote.apk) on your phone
3. Scan the QR code shown in the desktop app from the mobile app
4. Start your AI coding agent — requests will start flowing to your phone

## Repository Structure

```
vibe-remote/
├── desktop/     # Electron app + relay daemon (Windows)
├── server/      # Express API + Supabase backend
├── mobile/      # React Native app (Android primary, iOS secondary)
├── LICENSE
└── COMMERCIAL-LICENSE.md
```

## Contributing

Contributions, forks, and pull requests are welcome across all three components. See each subfolder's README for its specific dev setup. Please open an issue before large changes so we can align on approach first.

## License

Vibe Remote is source-available under the **[Business Source License 1.1](./LICENSE)**.
See **[COMMERCIAL-LICENSE.md](./COMMERCIAL-LICENSE.md)** for commercial hosting terms, and the license file for the full legal text.
