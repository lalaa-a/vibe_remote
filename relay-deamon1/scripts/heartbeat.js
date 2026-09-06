#!/usr/bin/env node
/**
 * Keep this running in a separate terminal (or as a launchd/systemd service).
 *
 *   node scripts/heartbeat.js
 *
 * Runs three loops:
 *   30s — machine heartbeat (keeps is_online fresh)
 *   10s — prompt delivery   (spawns claude --resume when session is idle)
 *    5s — file tree          (responds to fs_requests from mobile)
 */

import { spawn }                  from 'child_process'
import fs                         from 'fs'
import path                       from 'path'
import os                         from 'os'
import { supabase, heartbeat, markOffline, getNextCommand, getPendingFsRequest, respondFsRequest, postTerminalEvent, reportSessionsAlive, pollStopRequests, ackStopRequests, agentTouch, postUsage, flushPendingEvents } from '../src/supabase.js'
import { config }                 from '../src/config.js'
import { logger }                 from '../src/logger.js'
import { getAdapter }             from '../src/registry.js'
import { RUNTIME_DIR, runtimePath, logPath, ensureDirs } from '../src/paths.js'
import { fileURLToPath }          from 'node:url'

const __dir = path.dirname(fileURLToPath(import.meta.url))

// Append a line to the app log dir — always works regardless of how
// this process was started (manual terminal or spawned from Electron)
function fileLog(msg) {
  try {
    ensureDirs()
    fs.appendFileSync(logPath('heartbeat.log'), `[${new Date().toISOString()}] ${msg}\n`)
  } catch {}
}

// ── Per-session busy/idle tracking for fast prompt delivery ───────────────────
// command/next atomically marks a command delivered, so we must only claim when the
// target CLI is at its prompt (idle). "Busy" is a flag file written while a turn is in
// flight: the Claude hook writes it on each tool call and the heartbeat writes it on
// inject; the Stop hook deletes it and drops a relay-ready flag (turn ended). OpenCode
// does the same from its plugin (tool.execute.before / session.idle).
//
// TTL is deliberately short (60s): if an injected prompt silently fails to start a turn
// (e.g. the inject pasted into the wrong terminal window) no Stop ever fires to clear the
// flag, so a long TTL would lock the session out of every further prompt. The Claude hook
// and OpenCode plugin re-write this flag on every tool call, so a genuinely active turn
// stays "busy" regardless of the TTL; only a stuck/failed inject ages out — within 60s
// instead of minutes. See FAST_PROMPT_DELIVERY_DESIGN.md.
const BUSY_TTL_MS = 60 * 1000
function busyFlag(sessionId)  { return runtimePath(`relay-busy-${sessionId}.flag`) }
function isBusy(sessionId) {
  if (!sessionId) return false
  try {
    const st = fs.statSync(busyFlag(sessionId))
    if (Date.now() - st.mtimeMs > BUSY_TTL_MS) { try { fs.unlinkSync(busyFlag(sessionId)) } catch {}; return false }
    return true
  } catch { return false }
}
function markBusy(sessionId)  { if (sessionId) { try { fs.writeFileSync(busyFlag(sessionId), String(Date.now())) } catch {} } }
function clearBusy(sessionId) { if (sessionId) { try { fs.unlinkSync(busyFlag(sessionId)) } catch {} } }

// ── Machine heartbeat (30s) ───────────────────────────────────────────────────

async function tick() {
  try {
    await heartbeat()
    logger.debug('Heartbeat sent', { machine: config.machineId })
  } catch (err) {
    logger.warn('Heartbeat failed', { err: err.message })
  }
  // Keep the OpenCode plugin (file + credentials) in sync with the shipped source.
  syncOpencodePluginFile()
  syncOpencodePluginEnv()
}

// ── Keep the OpenCode plugin env in sync with the live machine key ────────────
// The OpenCode plugin reads its credentials from a SEPARATE JSON file that only
// gets rewritten when mobile support is toggled. If the machine re-registers (new
// API key in .env), that copy goes stale and every plugin request 401s. The
// heartbeat already holds the current valid key (config), so we rewrite the
// plugin env from it whenever the plugin is installed — making it self-heal.
const OC_PLUGIN_DIR = path.join(os.homedir(), '.config', 'opencode', 'plugin')
const OC_PLUGIN_JS  = path.join(OC_PLUGIN_DIR, 'vibe-relay.js')
const OC_ENV_FILE   = path.join(OC_PLUGIN_DIR, 'vibe-relay.env.json')
// The plugin SOURCE that ships with the daemon (bundled + obfuscated in prod). Kept in
// place by the bundler at src/harnesses/opencode/plugin/relay.js.
const OC_PLUGIN_SRC = path.join(__dir, '..', 'src', 'harnesses', 'opencode', 'plugin', 'relay.js')

// Self-heal the installed plugin FILE. enable() only copies the plugin when mobile mode
// is toggled, so after an app update the copy already sitting in OpenCode's dir stays
// STALE — e.g. it keeps writing PID/busy/ready flags to the OLD path the heartbeat no
// longer reads, which silently breaks session liveness (a session with no visible chat
// entry, even though its approval prompt still reaches mobile). Re-copy from the packaged
// source whenever the installed copy differs. Only refresh an already-installed plugin —
// creating it from scratch remains enable()'s job.
function syncOpencodePluginFile() {
  try {
    if (!fs.existsSync(OC_PLUGIN_JS)) return       // not installed → leave to enable()
    let src
    try { src = fs.readFileSync(OC_PLUGIN_SRC, 'utf8') } catch { return }  // no source to copy
    let dst = null
    try { dst = fs.readFileSync(OC_PLUGIN_JS, 'utf8') } catch {}
    if (src !== dst) {
      fs.writeFileSync(OC_PLUGIN_JS, src)
      fileLog('refreshed stale OpenCode plugin file from packaged source')
    }
  } catch (err) {
    fileLog(`syncOpencodePluginFile failed: ${err.message}`)
  }
}

function syncOpencodePluginEnv() {
  try {
    if (!fs.existsSync(OC_PLUGIN_JS)) return   // OpenCode plugin not installed
    const next = JSON.stringify({
      apiUrl:        config.apiUrl,
      machineApiKey: config.machineApiKey,
      userId:        config.userId,
      machineId:     config.machineId,
      supabaseUrl:   config.supabaseUrl,
      supabaseKey:   config.supabaseKey,
      timeoutMs:     config.timeoutMs,
      failOpen:      config.failOpen,
    }, null, 2)
    let current = null
    try { current = fs.readFileSync(OC_ENV_FILE, 'utf8') } catch {}
    if (current !== next) {
      fs.writeFileSync(OC_ENV_FILE, next)
      fileLog('synced OpenCode plugin env with current machine key')
    }
  } catch (err) {
    fileLog(`syncOpencodePluginEnv failed: ${err.message}`)
  }
}

// ── Prompt delivery (10s) ─────────────────────────────────────────────────────
// Server only returns a command when pending_count === 0 AND last_activity > 30s ago,
// so we never interrupt an active session.

// Is the harness CLI for this session STILL OPEN?
// Both Claude (hook.js) and OpenCode (relay plugin) write the live console PID to
// <runtime>/relay-pid-<sessionId>.txt while running (runtime dir = src/paths.js). We verify it:
//   • alive  → the CLI window is still open → inject the prompt into it
//   • dead/missing → the user closed the CLI → resume the session in a new window
// `session.kill(pid, 0)` throws ESRCH if the process is gone, EPERM if it is alive
// but owned by another user (still "alive" for our purposes).
function isSessionProcessAlive(sessionId) {
  if (!sessionId || process.platform !== 'win32') return false
  const pidFile = runtimePath(`relay-pid-${sessionId}.txt`)
  try {
    if (!fs.existsSync(pidFile)) return false
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10)
    if (!pid || Number.isNaN(pid)) return false
    try { process.kill(pid, 0); return true }
    catch (e) { return e.code === 'EPERM' }
  } catch { return false }
}

// ── Prompt delivery — claim + inject into the existing CLI ────────────────────
// Called on a broadcast nudge (sessionId scoped), on a turn-end ready flag, and on a
// slow backstop (no session → server applies its legacy idle gate). We only CLAIM a
// command for a session we believe is idle, because the server marks it delivered the
// moment it hands it over — claiming for a busy session would lose the prompt.
async function drainQueue(sessionId) {
  try {
    // Never claim for a session we know is mid-turn — wait for its Stop/turn-end flag.
    if (sessionId && isBusy(sessionId)) return

    const cmd = await getNextCommand(sessionId)
    if (!cmd?.prompt) return

    const harness = cmd.harness || 'claude-code'
    fileLog(`prompt claimed — sessionId=${cmd.sessionId} harness=${harness}`)
    logger.info('Delivering prompt', { sessionId: cmd.sessionId, harness })

    // ── CLI still open → inject into that exact terminal (UNCHANGED injector) ──
    // Only Claude/OpenCode run an injectable interactive console (Gemini uses the
    // PTY-proxy model). We require the PID to be alive so we never inject into a
    // closed/stale terminal — and we NEVER spawn a new window for a closed CLI.
    const injectable = harness === 'claude-code' || harness === 'opencode'

    if (injectable && isSessionProcessAlive(cmd.sessionId) && !isBusy(cmd.sessionId)) {
      markBusy(cmd.sessionId)   // hold further prompts for this session until its Stop
      // Clear any orphaned stop flag before starting this fresh turn. A turn halted by ESC
      // (classic console) leaves its stop flag un-consumed — no hook fires to clear it — and
      // the FIRST tool call of THIS new prompt would otherwise consume it and kill the prompt
      // on arrival. We only reach here once the previous turn is over (!isBusy), so any
      // surviving flag is guaranteed stale. Mirrors stopHook.js's own orphan cleanup.
      try { fs.unlinkSync(runtimePath(`relay-stop-${cmd.sessionId}.flag`)) } catch {}
      const injected = await tryInjectIntoExistingTerminal(cmd.sessionId, cmd.prompt)
      if (injected) {
        fileLog(`prompt injected into existing ${harness} terminal`)
        return
      }
      clearBusy(cmd.sessionId)
      fileLog(`live PID but injection failed for ${harness} — dropping prompt`)
    } else {
      // CLI was closed/busy (or non-injectable). Notify instead of silently relaunching.
      fileLog(`CLI closed/busy for session ${cmd.sessionId} (${harness}) — prompt not delivered`)
    }

    postTerminalEvent({
      session_id: cmd.sessionId,
      event_type: 'notification',
      tool_name:  null,
      summary:    'Prompt not delivered — the CLI for this session is closed. Start the agent again to continue.',
      detail:     null,
      status:     null,
    }).catch(() => {})
  } catch (err) {
    fileLog(`drainQueue error: ${err.message}`)
    logger.warn('drainQueue failed', { err: err.message })
  }
}

// ── Stop requests (interrupt an in-flight turn) ───────────────────────────────
// The opposite of drainQueue: prompt delivery deliberately WAITS for idle
// (isBusy gate above); a stop request only matters WHILE busy and must bypass
// every busy-gate that exists. This does NOT kill the harness CLI process — it
// only interrupts the current turn, same as pressing Esc yourself. See
// STOP_AGENT_DESIGN.md.
async function handleStopRequest(sessionId, harness) {
  if (!sessionId) return
  try {
    if (harness === 'opencode') {
      // Only act on an in-flight turn (same gate as claude-code). A flag dropped while idle
      // would linger and be consumed by the FIRST event of the user's NEXT turn, aborting it
      // on arrival. An active turn keeps its busy flag warm (the plugin's markBusyOC fires on
      // every streamed part) and its events consume the flag promptly, so this is reliable.
      if (isBusy(sessionId)) {
        // PRIMARY: drop the stop flag the in-process plugin consumes to abort via ITS OWN
        // client. This is the reliable path — the plugin runs inside OpenCode and reaches the
        // real server, whereas the heartbeat's separate SDK client is pinned to OPENCODE_URL
        // (localhost:4096) and usually can't reach it, so a direct abort here silently no-ops
        // and the CLI keeps generating. The plugin posts the turn-end `stop` event on the
        // resulting session.idle (labeled "Stopped"), so we don't post one here. Mirrors claude.
        writeStopFlag(sessionId)
        // SECONDARY best-effort: also try a direct SDK abort in case OPENCODE_URL is correct
        // (makes Stop feel instant where it happens to reach the server). Result is advisory.
        try {
          const adapter = await getAdapter('opencode')
          const ok = await adapter?.interrupter?.send?.(sessionId)   // POST /session/:id/abort
          fileLog(`opencode stop(${sessionId}) → flag armed, direct-abort=${ok}`)
        } catch (err) {
          fileLog(`opencode direct abort error: ${err.message}`)
        }
      } else {
        fileLog(`opencode stop(${sessionId}) → session not mid-turn, nothing to stop`)
      }
    } else if (harness === 'gemini-cli') {
      // Handled by the vibe-run-gemini-cli process itself, which owns the live PTY
      // and polls for stop requests on its own (heartbeat has no reachable handle
      // into that separate process). Nothing to do here.
      fileLog(`gemini-cli stop request for ${sessionId} — handled by PTY wrapper process`)
    } else {
      // claude-code (default). TWO mechanisms, because neither alone is sufficient:
      //
      //  1. The stop FLAG (authoritative). Claude Code has no external interrupt API,
      //     and the hooks are its only supported control surface. hook.js (PreToolUse)
      //     and postHook.js (PostToolUse) consume this flag and emit
      //     {"continue": false, ...}, which halts the turn outright. This lands on the
      //     next hook event — typically within a second while the agent is working —
      //     and it works in EVERY terminal.
      //
      //  2. The ESC keystroke (best-effort, instant). Only reaches the CLI on a classic
      //     console host. Under a ConPTY — Windows Terminal, VS Code's integrated
      //     terminal — WriteConsoleInput happily reports "records written" but the
      //     client never consumes them, so the key silently evaporates. Hence the flag
      //     above is what actually makes Stop reliable; this just makes it feel instant
      //     where it happens to work.
      // Only arm the flag if a turn is actually in flight. If the turn already ended,
      // there is nothing to stop — and a flag left lying around would be consumed by
      // the FIRST tool call of the user's NEXT prompt, killing it on arrival.
      if (isBusy(sessionId)) {
        writeStopFlag(sessionId)
        const ok = isSessionProcessAlive(sessionId) ? await sendInterruptKey(sessionId) : false
        fileLog(`claude-code stop(${sessionId}) → stop-flag armed, esc=${ok}`)
        // Persist a turn-end `stop` event NOW. When ESC halts the turn (classic console),
        // no further Claude hook fires — so hook.js/postHook.js never get to post the stop,
        // and this becomes the ONLY turn-end signal the mobile feed ever receives. Without
        // it, the session's last feed boundary stays an activity/output and the phone shows
        // the harness "working" forever (obvious after leaving and reopening the chat, once
        // the optimistic local override is gone). The server backdates last_activity_at on
        // `stop`, so status also flips to idle. Harmless if a later hook posts one too.
        await postTerminalEvent({
          session_id: sessionId,
          event_type: 'stop',
          tool_name:  null,
          summary:    'Stopped from mobile — turn halted.',
          detail:     null,
          status:     'stopped',   // mobile StopRow renders this as a "Stopped" tag
        }).catch(() => {})
      } else {
        fileLog(`claude-code stop(${sessionId}) → session not mid-turn, nothing to stop`)
      }
    }
  } finally {
    // Don't leave a stale busy flag if the interrupt takes an unusual exit path; the
    // hooks clear it too when they consume the stop flag.
    clearBusy(sessionId)
  }
}

// Drop the flag the Claude hooks consume to halt the turn (see hook.js / postHook.js).
function writeStopFlag(sessionId) {
  if (!sessionId) return
  try { fs.writeFileSync(runtimePath(`relay-stop-${sessionId}.flag`), String(Date.now())) } catch {}
}

// Backstop poll — covers a missed stop_requested broadcast. Unscoped: one call
// covers every pending stop request on this machine regardless of session.
async function checkStopRequests() {
  const pending = await pollStopRequests().catch(() => [])
  if (!pending.length) return
  for (const r of pending) await handleStopRequest(r.session_id, r.harness)
  await ackStopRequests(pending.map(r => r.id)).catch(() => {})
}

// Build the CLI command (with the prompt in PowerShell var $p, or shell var) for
// the given harness. The prompt itself is passed via a variable, never inlined,
// so quotes/newlines in it can't break the command.
function harnessRunCommand(harness, sessionId, promptVar) {
  if (harness === 'opencode') {
    const sess = sessionId ? `--session "${sessionId}"` : ''
    return `opencode run ${sess} ${promptVar}`
  }
  if (harness === 'gemini-cli') {
    // Gemini has no resume-by-id; -p runs a one-shot prompt in the cwd.
    return `gemini -p ${promptVar}`
  }
  // claude-code (default)
  const sess = sessionId ? `--resume "${sessionId}"` : ''
  return `claude ${sess} -p ${promptVar}`
}

// ── Inject prompt into the already-open Claude terminal ───────────────────────
// Two methods, tried in order:
//   1. WriteConsoleInput  — writes raw KEY_EVENT records into the console input
//      buffer Claude is reading from. Works for traditional console hosts.
//   2. Clipboard + focus + paste shortcut — fallback for ConPTY-based terminals
//      (Windows Terminal). Uses Ctrl+Shift+V because that's WT's default paste.
//
// All steps log to inject-log.txt (in the logs dir, src/paths.js) so the user can see which
// stage succeeded or failed.
async function tryInjectIntoExistingTerminal(sessionId, prompt) {
  if (process.platform !== 'win32' || !sessionId) return false

  const pidFile = runtimePath(`relay-pid-${sessionId}.txt`)
  if (!fs.existsSync(pidFile)) {
    fileLog(`no PID file for session ${sessionId}`)
    return false
  }

  const claudePid = parseInt(fs.readFileSync(pidFile, 'utf8').trim())
  if (!claudePid || isNaN(claudePid)) {
    fileLog(`invalid PID in file: ${claudePid}`)
    return false
  }

  const tmpDir    = process.env.TEMP || os.tmpdir()
  const tmpScript = path.join(tmpDir, `inject-${Date.now()}.ps1`)

  // The PS1 script is built as a JS template literal. Note:
  //   ${jsVar}   → JavaScript interpolation (resolved by Node)
  //   $psVar     → PowerShell variable, passed through verbatim
  //   $($expr)   → PowerShell expression substitution, passed through verbatim
  //   \\         → single backslash in the output file (for path escaping in C#)
  const ps1 = `
$log = "${logPath('inject-log.txt')}"
function L([string]$m) {
    try { Add-Content -Path $log -Value ((Get-Date).ToString("HH:mm:ss") + " " + $m) } catch {}
}

L "=== injection start ===  claudePid=${claudePid}  session=${sessionId}"

$prompt = @'
${prompt}
'@

# C# helper — WriteConsoleInput + window operations + VkKeyScan
try {
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public class Inj {
    [StructLayout(LayoutKind.Explicit, CharSet=CharSet.Unicode)]
    public struct IR {
        [FieldOffset(0)] public ushort T;
        [FieldOffset(4)] public KER K;
    }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct KER {
        public int    Down;
        public ushort Rep;
        public ushort Vk;
        public ushort Sc;
        public char   U;
        public uint   Ctrl;
    }
    [DllImport("kernel32.dll")] public static extern bool FreeConsole();
    [DllImport("kernel32.dll",SetLastError=true)] public static extern bool AttachConsole(uint pid);
    [DllImport("kernel32.dll",SetLastError=true)] public static extern IntPtr GetStdHandle(int h);
    [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] public static extern IntPtr CreateFileW(string n, uint a, uint s, IntPtr sec, uint d, uint f, IntPtr t);
    [DllImport("kernel32.dll",SetLastError=true)] public static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll",SetLastError=true)] public static extern bool WriteConsoleInput(IntPtr h, IR[] b, uint n, out uint w);
    [DllImport("user32.dll")] public static extern short VkKeyScan(char c);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();

    public static int Write(uint pid, string text) {
        FreeConsole();
        if (!AttachConsole(pid)) return 1000 + Marshal.GetLastWin32Error();
        // Open the real console input buffer. GetStdHandle(STD_INPUT) returns a redirected
        // handle on ConPTY / Windows Terminal, so WriteConsoleInput then fails with
        // ERROR_INVALID_HANDLE (6) and we fall back to the fragile clipboard paste. CONIN$ is
        // the documented way to get a writable input handle for the attached console; we keep
        // GetStdHandle as a fallback so this can only improve, never regress.
        IntPtr h = CreateFileW("CONIN$", 0x80000000u | 0x40000000u, 0x1u | 0x2u, IntPtr.Zero, 3u, 0u, IntPtr.Zero);
        if (h == IntPtr.Zero || h == new IntPtr(-1)) h = GetStdHandle(-10);
        if (h == IntPtr.Zero || h == new IntPtr(-1)) { FreeConsole(); return 2000; }
        var list = new List<IR>();
        foreach (char c in text) {
            short vks = VkKeyScan(c);
            ushort vk = (ushort)(vks & 0xFF);
            var d = new IR(); d.T = 1; d.K = new KER { Down=1, Rep=1, Vk=vk, U=c }; list.Add(d);
            var u = new IR(); u.T = 1; u.K = new KER { Down=0, Rep=1, Vk=vk, U=c }; list.Add(u);
        }
        // Enter (VK_RETURN = 0x0D)
        var ed = new IR(); ed.T = 1; ed.K = new KER { Down=1, Rep=1, Vk=0x0D, U='\\r' }; list.Add(ed);
        var eu = new IR(); eu.T = 1; eu.K = new KER { Down=0, Rep=1, Vk=0x0D, U='\\r' }; list.Add(eu);
        var arr = list.ToArray();
        uint written;
        bool ok = WriteConsoleInput(h, arr, (uint)arr.Length, out written);
        int err = Marshal.GetLastWin32Error();
        CloseHandle(h);
        FreeConsole();
        if (!ok) return 3000 + err;
        return (int)written;
    }
}
"@
} catch {
    L "Add-Type failed: $_"
    exit 99
}

# ─── Method 1: WriteConsoleInput ────────────────────────────────────────────
L "trying WriteConsoleInput..."
$wc = [Inj]::Write(${claudePid}, $prompt)
L "WriteConsoleInput returned $wc  (positive = records written, 1xxx = AttachConsole err, 2xxx = GetStdHandle err, 3xxx = WriteConsoleInput err)"

if ($wc -gt 0 -and $wc -lt 1000) {
    L "SUCCESS via WriteConsoleInput ($wc records)"
    exit 0
}

# ─── Method 2: Clipboard + window focus + paste shortcut ────────────────────
L "WriteConsoleInput did not write, falling back to clipboard+paste"
try { Set-Clipboard -Value $prompt; L "clipboard set ($($prompt.Length) chars)" } catch { L "Set-Clipboard error: $_" }

# Walk up the process tree from claude's PID until we hit a process with a visible window
$walk = ""
$p = Get-Process -Id ${claudePid} -EA SilentlyContinue
$win = $null
while ($p) {
    $walk += "$($p.Name)[$($p.Id)] hwnd=$($p.MainWindowHandle.ToInt64()) -> "
    if ($p.MainWindowHandle -ne [IntPtr]::Zero) { $win = $p; break }
    $parent = (Get-CimInstance Win32_Process -Filter "ProcessId=$($p.Id)" -EA 0).ParentProcessId
    if (-not $parent -or $parent -eq 0) { break }
    $p = Get-Process -Id $parent -EA SilentlyContinue
}
L "process walk: $walk"

if ($null -eq $win) { L "FAILED: no terminal window found in process tree"; exit 1 }
L "terminal window: $($win.Name)  PID=$($win.Id)  hwnd=$($win.MainWindowHandle.ToInt64())"

[void][Inj]::ShowWindow($win.MainWindowHandle, 9)   # SW_RESTORE
[void][Inj]::SetForegroundWindow($win.MainWindowHandle)
Start-Sleep -Milliseconds 600
$fg = [Inj]::GetForegroundWindow()
L "after focus: foreground hwnd=$($fg.ToInt64()) target=$($win.MainWindowHandle.ToInt64())"

Add-Type -AssemblyName System.Windows.Forms

# Windows Terminal uses Ctrl+Shift+V; legacy CMD/PowerShell uses Ctrl+V
$shortcut = '^v'
if ($win.Name -match 'WindowsTerminal') { $shortcut = '^+v' }
L "sending paste shortcut: $shortcut"
[System.Windows.Forms.SendKeys]::SendWait($shortcut)
Start-Sleep -Milliseconds 300
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')

L "SUCCESS via clipboard paste"
exit 0
`.trim()

  fs.writeFileSync(tmpScript, ps1, 'utf8')
  fileLog(`injection script written: ${tmpScript}  claudePid=${claudePid}`)

  return new Promise((resolve) => {
    const child = spawn('powershell', ['-ExecutionPolicy', 'Bypass', '-NonInteractive', '-File', tmpScript], {
      stdio: 'ignore',
      shell: false,
    })
    child.on('close', code => {
      fileLog(`injection exit code=${code}  (see ${logPath('inject-log.txt')} for details)`)
      resolve(code === 0)
    })
    child.on('error', err => {
      fileLog(`injection spawn error: ${err.message}`)
      resolve(false)
    })
  })
}

// ── Interrupt the current turn in an already-open Claude terminal ─────────────
// Same PID-resolution as tryInjectIntoExistingTerminal above, but sends a single
// VK_ESCAPE key event — same as pressing Esc yourself — instead of typed text +
// Enter. This does NOT close the terminal or kill the claude process; it only
// cancels the in-flight turn. Each call spawns a fresh powershell.exe process, so
// there's no conflict with tryInjectIntoExistingTerminal's own Add-Type in the
// same tick — every invocation gets its own process and its own type table.
async function sendInterruptKey(sessionId) {
  if (process.platform !== 'win32' || !sessionId) return false

  const pidFile = runtimePath(`relay-pid-${sessionId}.txt`)
  if (!fs.existsSync(pidFile)) { fileLog(`no PID file for session ${sessionId} (interrupt)`); return false }
  const claudePid = parseInt(fs.readFileSync(pidFile, 'utf8').trim())
  if (!claudePid || isNaN(claudePid)) { fileLog(`invalid PID for interrupt: ${claudePid}`); return false }

  const tmpDir    = process.env.TEMP || os.tmpdir()
  const tmpScript = path.join(tmpDir, `interrupt-${Date.now()}.ps1`)

  const ps1 = `
$log = "${logPath('inject-log.txt')}"
function L([string]$m) {
    try { Add-Content -Path $log -Value ((Get-Date).ToString("HH:mm:ss") + " [interrupt] " + $m) } catch {}
}

L "=== interrupt start ===  claudePid=${claudePid}  session=${sessionId}"

try {
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class InjKey {
    [StructLayout(LayoutKind.Explicit, CharSet=CharSet.Unicode)]
    public struct IR {
        [FieldOffset(0)] public ushort T;
        [FieldOffset(4)] public KER K;
    }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct KER {
        public int    Down;
        public ushort Rep;
        public ushort Vk;
        public ushort Sc;
        public char   U;
        public uint   Ctrl;
    }
    [DllImport("kernel32.dll")] public static extern bool FreeConsole();
    [DllImport("kernel32.dll",SetLastError=true)] public static extern bool AttachConsole(uint pid);
    [DllImport("kernel32.dll",SetLastError=true)] public static extern IntPtr GetStdHandle(int h);
    [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] public static extern IntPtr CreateFileW(string n, uint a, uint s, IntPtr sec, uint d, uint f, IntPtr t);
    [DllImport("kernel32.dll",SetLastError=true)] public static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll",SetLastError=true)] public static extern bool WriteConsoleInput(IntPtr h, IR[] b, uint n, out uint w);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);

    // Writes ONE VK code as a key-down + key-up pair. Critically, it must also set
    // UnicodeChar (U) on both records, exactly like Write() does for the Enter key
    // above — WriteConsoleInput can report success while the character never reaches
    // the reading process if U is left at its default (zero). Node's console reader
    // (libuv's tty backend, which Claude Code's CLI runs on) takes the actual byte
    // from UnicodeChar, not VirtualKeyCode, for control characters like ESC — so
    // leaving U unset silently drops the keystroke even though WriteConsoleInput
    // returns records-written > 0 and looks like it succeeded.
    //
    // NOTE: this whole C# block is a JS template literal. Never write a backslash
    // escape here (not even inside a comment): JS resolves it before PowerShell or
    // csc ever see it, so a stray CR/NUL lands mid-source and Add-Type dies with
    // "Newline in constant". Escape it as \\ if you truly need one.
    public static int WriteVk(uint pid, ushort vk, char ch) {
        FreeConsole();
        if (!AttachConsole(pid)) return 1000 + Marshal.GetLastWin32Error();
        IntPtr h = CreateFileW("CONIN$", 0x80000000u | 0x40000000u, 0x1u | 0x2u, IntPtr.Zero, 3u, 0u, IntPtr.Zero);
        if (h == IntPtr.Zero || h == new IntPtr(-1)) h = GetStdHandle(-10);
        if (h == IntPtr.Zero || h == new IntPtr(-1)) { FreeConsole(); return 2000; }
        var d = new IR(); d.T = 1; d.K = new KER { Down=1, Rep=1, Vk=vk, U=ch };
        var u = new IR(); u.T = 1; u.K = new KER { Down=0, Rep=1, Vk=vk, U=ch };
        var arr = new IR[] { d, u };
        uint written;
        bool ok = WriteConsoleInput(h, arr, (uint)arr.Length, out written);
        int err = Marshal.GetLastWin32Error();
        CloseHandle(h);
        FreeConsole();
        if (!ok) return 3000 + err;
        return (int)written;
    }
}
"@
} catch {
    L "Add-Type failed: $_"
    exit 99
}

# ─── Method 1: WriteConsoleInput(ESC) ───────────────────────────────────────
L "trying WriteConsoleInput(ESC)..."
$wc = [InjKey]::WriteVk(${claudePid}, 0x1B, [char]0x1B)
L "WriteConsoleInput(ESC) returned $wc"

if ($wc -gt 0 -and $wc -lt 1000) {
    L "SUCCESS via WriteConsoleInput"
    exit 0
}

# ─── Method 2: focus + SendKeys ESC ──────────────────────────────────────────
# No clipboard step here (unlike the prompt injector) — there's nothing to paste,
# ESC isn't text.
L "WriteConsoleInput did not write, falling back to SendKeys ESC"

$walk = ""
$p = Get-Process -Id ${claudePid} -EA SilentlyContinue
$win = $null
while ($p) {
    $walk += "$($p.Name)[$($p.Id)] hwnd=$($p.MainWindowHandle.ToInt64()) -> "
    if ($p.MainWindowHandle -ne [IntPtr]::Zero) { $win = $p; break }
    $parent = (Get-CimInstance Win32_Process -Filter "ProcessId=$($p.Id)" -EA 0).ParentProcessId
    if (-not $parent -or $parent -eq 0) { break }
    $p = Get-Process -Id $parent -EA SilentlyContinue
}
L "process walk: $walk"

if ($null -eq $win) { L "FAILED: no terminal window found in process tree"; exit 1 }
L "terminal window: $($win.Name)  PID=$($win.Id)  hwnd=$($win.MainWindowHandle.ToInt64())"

[void][InjKey]::ShowWindow($win.MainWindowHandle, 9)   # SW_RESTORE
[void][InjKey]::SetForegroundWindow($win.MainWindowHandle)
Start-Sleep -Milliseconds 300

Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('{ESC}')

L "SUCCESS via SendKeys ESC"
exit 0
`.trim()

  fs.writeFileSync(tmpScript, ps1, 'utf8')
  fileLog(`interrupt script written: ${tmpScript}  claudePid=${claudePid}`)

  return new Promise((resolve) => {
    const child = spawn('powershell', ['-ExecutionPolicy', 'Bypass', '-NonInteractive', '-File', tmpScript], {
      stdio: 'ignore',
      shell: false,
    })
    child.on('close', code => {
      fileLog(`interrupt exit code=${code}  (see ${logPath('inject-log.txt')} for details)`)
      resolve(code === 0)
    })
    child.on('error', err => {
      fileLog(`interrupt spawn error: ${err.message}`)
      resolve(false)
    })
  })
}

// ── Open a new visible terminal window running the harness with the prompt ────
function openNewTerminalWindow(cmd, spawnCwd, harness = 'claude-code') {
  if (process.platform === 'win32') {
    const tmpDir    = process.env.TEMP || os.tmpdir()
    const tmpScript = path.join(tmpDir, `vibe-relay-${Date.now()}.ps1`)
    // Prompt goes into the PowerShell here-string $p; the run command references $p
    const runCmd = harnessRunCommand(harness, cmd.sessionId, '$p')
    fs.writeFileSync(
      tmpScript,
      [`$p = @'`, cmd.prompt, `'@`, runCmd].join('\r\n'),
      'utf8'
    )
    const escaped = tmpScript.replace(/"/g, '\\"')
    const shellCmd = `start "VibeRemote — ${harness}" powershell -NoExit -ExecutionPolicy Bypass -File "${escaped}"`
    fileLog(`new window (${harness}): ${runCmd}`)
    const child = spawn(shellCmd, [], {
      cwd: spawnCwd, stdio: 'ignore', env: { ...process.env }, detached: true, shell: true,
    })
    child.unref()
  } else {
    const escapedPrompt = cmd.prompt.replace(/'/g, "'\\''")
    // Pass the prompt as a single-quoted positional/arg per harness
    const runCmd = harness === 'opencode'
      ? (cmd.sessionId ? `opencode run --session '${cmd.sessionId}' '${escapedPrompt}'` : `opencode run '${escapedPrompt}'`)
      : harness === 'gemini-cli'
      ? `gemini -p '${escapedPrompt}'`
      : (cmd.sessionId ? `claude --resume '${cmd.sessionId}' -p '${escapedPrompt}'` : `claude -p '${escapedPrompt}'`)
    const termCmd = process.platform === 'darwin'
      ? `open -a Terminal -n --args zsh -c '${runCmd}; exec zsh'`
      : `x-terminal-emulator -e bash -c '${runCmd}; exec bash'`
    fileLog(`new window (${harness}): ${runCmd}`)
    const child = spawn(termCmd, [], {
      cwd: spawnCwd, stdio: 'ignore', env: { ...process.env }, detached: true, shell: true,
    })
    child.unref()
  }
}

// ── File tree (5s) ────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', '__pycache__', '.venv', 'build'])

function buildTree(absoluteRoot, requestedPath, baseCwd, maxDepth, depth = 0) {
  const fullPath = path.resolve(absoluteRoot, requestedPath)

  // Security: never escape the session's cwd
  if (!fullPath.startsWith(baseCwd)) throw new Error('Path traversal blocked')

  const entries = fs.readdirSync(fullPath, { withFileTypes: true })
    .filter(e => !SKIP_DIRS.has(e.name) && !e.name.startsWith('.'))
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name)
    })

  return entries.map(entry => {
    const childRelPath = path.join(requestedPath, entry.name)
    if (entry.isDirectory()) {
      return {
        name:     entry.name,
        path:     childRelPath,
        type:     'dir',
        // null = has children but not loaded yet — mobile requests lazily
        children: depth < maxDepth
          ? buildTree(absoluteRoot, childRelPath, baseCwd, maxDepth, depth + 1)
          : null,
      }
    }
    const stat = fs.statSync(path.join(fullPath, entry.name))
    return { name: entry.name, path: childRelPath, type: 'file', size: stat.size }
  })
}

async function checkFsRequests() {
  try {
    const pending = await getPendingFsRequest()
    if (!pending?.id) return

    logger.info('Serving fs request', { id: pending.id, path: pending.path })

    try {
      const root = pending.sessionCwd ?? process.cwd()
      const tree = buildTree(root, pending.path ?? '.', root, 4)
      await respondFsRequest(pending.id, { tree })
    } catch (err) {
      await respondFsRequest(pending.id, { error: err.message })
    }
  } catch (err) {
    logger.warn('checkFsRequests failed', { err: err.message })
  }
}

// ── Transcript watcher (3s) ───────────────────────────────────────────────────
// Claude Code writes a JSONL transcript for each session at
//   ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
// Each hook fire updates <runtime>/transcript-paths/<session-id>.path with the path (runtime
// dir = src/paths.js), so we know which transcripts belong to active sessions on this machine.
//
// Each loop tick: read new bytes from each known transcript, parse complete JSON lines,
// forward any assistant `text` content blocks (Claude's narrative reasoning between tool
// calls) as `output` terminal_events. Tool uses/results are skipped — hooks already capture
// those. Output is what the user sees Claude "monologuing" in their CLI between tool calls.

const TRANSCRIPT_MAPPING_DIR = runtimePath('transcript-paths')
const STALE_MAPPING_MS       = 5 * 60 * 1000           // mappings older than 5m → assume hook is off
const transcriptPositions    = new Map()               // sessionId → byte offset

// Per-session token accumulators for the live compose-bar counter (TOKEN_USAGE_STREAMING_DESIGN.md).
// turn* reset each turn (a genuine user prompt); session* are monotonic. We send ABSOLUTE totals.
const usageBySession = new Map()   // sessionId → { turnInput, turnOutput, sessionInput, sessionOutput, seq }
function getUsageAcc(sessionId) {
  let acc = usageBySession.get(sessionId)
  if (!acc) { acc = { turnInput: 0, turnOutput: 0, sessionInput: 0, sessionOutput: 0, seq: 0 }; usageBySession.set(sessionId, acc) }
  return acc
}

function listTranscriptMappings() {
  try {
    return fs.readdirSync(TRANSCRIPT_MAPPING_DIR)
      .filter(f => f.endsWith('.path'))
      .map(f => ({ sessionId: f.replace(/\.path$/, ''), file: path.join(TRANSCRIPT_MAPPING_DIR, f) }))
  } catch {
    return []
  }
}

async function tailOneTranscript(sessionId, mappingFile) {
  // Skip mappings whose file hasn't been touched recently — interception is likely off
  let mappingStat
  try { mappingStat = fs.statSync(mappingFile) } catch { return }
  if (Date.now() - mappingStat.mtimeMs > STALE_MAPPING_MS) return

  let transcriptPath
  try { transcriptPath = fs.readFileSync(mappingFile, 'utf8').trim() } catch { return }
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return

  let stat
  try { stat = fs.statSync(transcriptPath) } catch { return }

  // First time we see this session — skip existing history, start tailing from end
  if (!transcriptPositions.has(sessionId)) {
    transcriptPositions.set(sessionId, stat.size)
    return
  }

  const lastPos = transcriptPositions.get(sessionId)
  if (stat.size <= lastPos) return

  // Read only the new bytes since lastPos
  let chunk
  try {
    const fd = fs.openSync(transcriptPath, 'r')
    chunk = Buffer.alloc(stat.size - lastPos)
    fs.readSync(fd, chunk, 0, chunk.length, lastPos)
    fs.closeSync(fd)
  } catch (err) {
    fileLog(`transcript read ${sessionId} failed: ${err.message}`)
    return
  }

  // Only process complete lines — a partial trailing line waits for the next tick
  const text         = chunk.toString('utf8')
  const lastNewline  = text.lastIndexOf('\n')
  if (lastNewline < 0) return
  transcriptPositions.set(sessionId, lastPos + lastNewline + 1)

  const lines = text.slice(0, lastNewline).split('\n').filter(l => l.trim())
  let forwardedOutput = false
  let usageChanged    = false
  for (const line of lines) {
    let entry
    try { entry = JSON.parse(line) } catch { continue }

    // Turn boundary: a genuine user prompt (NOT a tool_result, which is also type 'user')
    // starts a new turn → reset the per-turn token counters so mobile shows THIS turn.
    if (entry.type === 'user') {
      const content = entry.message?.content
      const isToolResult = Array.isArray(content) && content.some(b => b?.type === 'tool_result')
      if (!isToolResult) {
        const acc = getUsageAcc(sessionId)
        acc.turnInput = 0; acc.turnOutput = 0; acc.seq++
        usageChanged = true
      }
      continue
    }

    // Only forward assistant narrative text — tool_use/tool_result are already covered by hooks
    if (entry.type !== 'assistant' || !entry.message?.content) continue

    // Accumulate token usage — present on every assistant message (even tool-only ones).
    // turnInput = latest call's context size (input + cache); turnOutput = cumulative generated
    // this turn. session* are monotonic (billed input + generated). ABSOLUTE totals.
    const u = entry.message.usage
    if (u) {
      const acc = getUsageAcc(sessionId)
      acc.turnInput      = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)
      acc.turnOutput    += (u.output_tokens || 0)
      acc.sessionInput  += (u.input_tokens || 0)
      acc.sessionOutput += (u.output_tokens || 0)
      usageChanged = true
    }

    const blocks = Array.isArray(entry.message.content) ? entry.message.content : []
    for (const block of blocks) {
      if (block.type !== 'text') continue
      const t = (block.text || '').trim()
      if (!t) continue
      forwardedOutput = true
      postTerminalEvent({
        session_id: sessionId,
        event_type: 'output',
        tool_name:  null,
        summary:    t.slice(0, 2000),
        detail:     null,
        status:     null,
      }).catch(() => {})
    }
  }

  // Push the current turn's running token totals (absolute; the 3s tailer tick throttles this
  // to ≤1 POST/session/3s). The server persists them and broadcasts 'usage' for the compose bar.
  if (usageChanged) {
    const acc = getUsageAcc(sessionId)
    postUsage({
      sessionId,
      turnInput:     acc.turnInput,
      turnOutput:    acc.turnOutput,
      sessionInput:  acc.sessionInput,
      sessionOutput: acc.sessionOutput,
    }).catch(() => {})
  }

  // Fresh reasoning just streamed → keep an IN-FLIGHT turn active: refresh last_activity_at
  // so the server holds status='active' through a long reasoning phase that fires no tool
  // calls, and keep the busy flag warm so it can't age out mid-turn.
  //
  // Gate on isBusy: only a turn that's actually running should be kept alive. Without this
  // gate, a session that was JUST stopped gets silently revived here — the halted turn's
  // final partial reasoning flushes into the transcript a beat after the stop, and touching
  // last_activity_at would flip status back to 'active' for ~30s, making the (now-visible)
  // send bar reject the user's next prompt as session_busy. The stop path clears the busy
  // flag, so a stopped session is skipped and stays idle.
  if (forwardedOutput && isBusy(sessionId)) {
    markBusy(sessionId)
    agentTouch(sessionId).catch(() => {})
  }
}

async function checkTranscripts() {
  for (const { sessionId, file } of listTranscriptMappings()) {
    await tailOneTranscript(sessionId, file)
  }
}

// ── Usage poke (1s) ───────────────────────────────────────────────────────────
// Claude Code's statusLine command (statusLine.cjs) writes <runtime>/usage-<sid>.json on
// every refresh — i.e. at Claude's OWN cadence, around each model response. When one changes,
// re-read that session's transcript immediately so the mobile token counter updates at
// Claude's pace instead of waiting up to 3s for checkTranscripts. tailOneTranscript is
// idempotent (reads only new bytes, advances the position synchronously), so poke + the 3s
// tick never double-count. See LIVE_TOKEN_STATUSLINE_DESIGN.md.
const usagePokeMtimes = new Map()   // sessionId → last-seen mtimeMs of usage-<sid>.json
function checkUsagePokes() {
  let files
  try { files = fs.readdirSync(RUNTIME_DIR) } catch { return }
  for (const f of files) {
    const m = /^usage-(.+)\.json$/.exec(f)
    if (!m) continue
    const sid = m[1]
    let st
    try { st = fs.statSync(path.join(RUNTIME_DIR, f)) } catch { continue }
    if (usagePokeMtimes.get(sid) === st.mtimeMs) continue   // unchanged since last check
    usagePokeMtimes.set(sid, st.mtimeMs)
    tailOneTranscript(sid, runtimePath('transcript-paths', `${sid}.path`)).catch(() => {})
  }
}

// ── Session liveness (15s) ────────────────────────────────────────────────────
// Enumerate the per-session PID files (relay-pid-<sessionId>.txt) written by each
// harness while running, check which processes are still alive, and report the
// live set to the server. The server marks every other agent on this machine
// cli_alive=false so the mobile app can block prompting a closed CLI.
async function reportSessionLiveness() {
  if (process.platform !== 'win32') return
  const dir = RUNTIME_DIR
  let files
  try { files = fs.readdirSync(dir) } catch { return }

  const alive = []
  for (const f of files) {
    const m = /^relay-pid-(.+)\.txt$/.exec(f)
    if (!m) continue
    const sessionId = m[1]
    if (isSessionProcessAlive(sessionId)) {
      alive.push(sessionId)
    } else {
      // Process is gone — drop the stale PID file (and its usage poke file) so they don't accumulate.
      try { fs.unlinkSync(path.join(dir, f)) } catch {}
      try { fs.unlinkSync(runtimePath(`usage-${sessionId}.json`)) } catch {}
      usagePokeMtimes.delete(sessionId)
    }
  }

  try {
    await reportSessionsAlive(alive)
    logger.debug('Reported session liveness', { alive: alive.length })
  } catch (err) {
    logger.warn('reportSessionLiveness failed', { err: err.message })
  }
}

// ── Realtime nudge for prompt delivery ───────────────────────────────────────
// Instead of polling /mobile/command/next on a tight timer, subscribe to INSERTs
// on mobile_commands for THIS machine and run checkPendingCommands on each nudge.
// The HTTP call (and its server-side idle-gating + atomic "mark delivered") stays
// — we just stop the steady polling. A slow interval below remains as a backstop
// in case the socket drops. mobile_commands is in the Realtime publication
// (server migration 005).
let machineChannel = null   // the machine:<id> channel — also carries our presence (A1)

function subscribeCommandNudge() {
  try {
    machineChannel = supabase
      .channel(`machine:${config.machineId}`, { config: { presence: { key: config.machineId } } })
      // PRIMARY: broadcast is reliable where postgres_changes is silently dropped on
      // this self-hosted Supabase. The server fires it from POST /mobile/prompt with the
      // sessionId so we can do a scoped, idle-gated claim. See FAST_PROMPT_DELIVERY_DESIGN.md.
      .on('broadcast', { event: 'command_available' }, ({ payload }) => {
        fileLog(`command_available broadcast — draining session=${payload?.sessionId ?? '(any)'}`)
        drainQueue(payload?.sessionId || undefined)
      })
      // SECONDARY: harmless if it also fires (claim is atomic/idempotent).
      .on('postgres_changes', {
        event:  'INSERT',
        schema: 'public',
        table:  'mobile_commands',
        filter: `machine_id=eq.${config.machineId}`,
      }, (p) => {
        fileLog('mobile_commands INSERT — draining')
        drainQueue(p?.new?.session_id || undefined)
      })
      // NEW: interrupt an in-flight turn — bypasses every busy-gate on purpose,
      // the opposite of the prompt-delivery nudges above. See STOP_AGENT_DESIGN.md.
      .on('broadcast', { event: 'stop_requested' }, ({ payload }) => {
        fileLog(`stop_requested broadcast — session=${payload?.sessionId} harness=${payload?.harness}`)
        handleStopRequest(payload?.sessionId, payload?.harness)
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          fileLog('command nudge subscribed (broadcast + pg + presence)')
          // A1 — announce presence. The mobile watches this channel's presence and flips the
          // machine OFFLINE the instant our socket drops (kill / network / sleep), instead of
          // waiting for last_seen to go stale. See INSTANT_OFFLINE_AND_HARNESS_UPDATES.md §3.
          try { machineChannel.track({ online: true, at: Date.now() }) } catch {}
        }
      })
  } catch (err) {
    fileLog(`command nudge subscribe failed: ${err.message}`)
    logger.warn('command nudge subscribe failed', { err: err.message })
  }
}

// ── Turn-end watcher (1s) ─────────────────────────────────────────────────────
// The Stop hook (Claude) and the OpenCode plugin (session.idle) drop a relay-ready flag
// when a turn ends. Consume it and immediately drain any prompt queued for that now-idle
// session, so a prompt sent mid-turn lands within ~1s of the turn finishing.
function checkReadyFlags() {
  let files
  try { files = fs.readdirSync(RUNTIME_DIR) } catch { return }
  for (const f of files) {
    const m = /^relay-ready-(.+)\.flag$/.exec(f)
    if (!m) continue
    try { fs.unlinkSync(path.join(RUNTIME_DIR, f)) } catch {}
    const sid = m[1]
    clearBusy(sid)
    fileLog(`turn-end ready flag for ${sid} — draining`)
    drainQueue(sid)
  }
}

// ── Delivery backstop (3s) ────────────────────────────────────────────────────
// Covers a missed broadcast. Iterate the live sessions (those with a relay-pid file)
// and drain only the IDLE ones — every claim is therefore session-scoped and pre-gated
// by isBusy, so we never claim a command we can't inject (which would lose it, since the
// server marks it delivered on claim). Only when there are no live sessions do we fall
// back to an unscoped claim (for the rare session-less prompt).
function drainBackstop() {
  let files
  try { files = fs.readdirSync(RUNTIME_DIR) } catch { files = [] }
  let anyLive = false
  for (const f of files) {
    const m = /^relay-pid-(.+)\.txt$/.exec(f)
    if (!m) continue
    anyLive = true
    const sid = m[1]
    if (!isBusy(sid)) drainQueue(sid)
  }
  if (!anyLive) drainQueue()   // session-less fallback (server applies its legacy gate)
}

// ── Active-turn keepalive (10s) ───────────────────────────────────────────────
// deriveStatus on the server flips a session to 'idle' 30s after the last activity ping,
// and pings previously fired ONLY on tool calls — so a long reasoning phase or a long
// single tool made mobile briefly show 'idle' mid-turn and unlock the composer, letting a
// prompt slip in while the agent was still working. Every session with a live busy flag
// (the authoritative "turn in flight" signal, set on each tool call / prompt inject and
// cleared by the Stop hook) gets its last_activity_at refreshed here, so status stays
// 'active' for the whole turn — the mobile lock and the desktop busy-gate now agree.
function keepActiveTurnsAlive() {
  let files
  try { files = fs.readdirSync(RUNTIME_DIR) } catch { return }
  for (const f of files) {
    const m = /^relay-busy-(.+)\.flag$/.exec(f)
    if (!m) continue
    const sid = m[1]
    // isBusy() also ages out (and unlinks) a stale flag past its TTL, so a stuck/failed
    // inject stops getting touched and correctly decays to idle.
    if (isBusy(sid)) agentTouch(sid).catch(() => {})
  }
}

// ── Shutdown ──────────────────────────────────────────────────────────────────

async function shutdown() {
  // Untrack presence FIRST — fires an instant `leave` to the mobile (sub-second), before the
  // durable markOffline. Belt (presence) and suspenders (DB). See INSTANT_OFFLINE…md §3-A3.
  try { await machineChannel?.untrack() } catch {}
  try { await markOffline() } catch {}
  logger.info('Machine marked offline')
  process.exit(0)
}

process.on('SIGINT',  shutdown)
process.on('SIGTERM', shutdown)

// ── Start ─────────────────────────────────────────────────────────────────────

logger.info('Heartbeat started', { machine: config.machineId })

syncOpencodePluginFile()  // refresh a stale installed plugin immediately on launch
syncOpencodePluginEnv()   // sync immediately on launch
tick()
reportSessionLiveness()
subscribeCommandNudge()   // broadcast push for prompt delivery (primary path)
drainBackstop()           // drain anything already queued at startup (scoped per live session)
setInterval(tick,                  15_000)   // machine heartbeat — faster so offline backstop is tighter
setInterval(drainBackstop,          3_000)   // backstop only — broadcast + ready-flag are primary
setInterval(checkReadyFlags,        1_000)   // inject queued prompts the instant a turn ends
setInterval(checkFsRequests,        5_000)
setInterval(checkTranscripts,       3_000)
setInterval(checkUsagePokes,        1_000)   // statusLine poke → token counter at Claude's cadence
setInterval(() => { flushPendingEvents().catch(() => {}) }, 15_000)   // re-send turn-ends missed while offline
setInterval(keepActiveTurnsAlive,  10_000)   // hold status='active' through long reasoning / long tools
setInterval(reportSessionLiveness, 15_000)
setInterval(checkStopRequests,      5_000)   // backstop only — stop_requested broadcast is primary
