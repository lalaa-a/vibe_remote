import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } from 'electron';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync, createWriteStream } from 'node:fs';
import os from 'node:os';
import started from 'electron-squirrel-startup';

if (started) app.quit();

// In dev: __dirname = .vite/build/ → go up two levels to project root
// In production: relay-deamon1 is in resources/ via extraResource
const RELAY_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'relay-deamon1')
  : path.join(__dirname, '..', '..', 'relay-deamon1');

// Machine credentials live in the STABLE userData dir (%APPDATA%\<productName>), NOT
// in the versioned app resources — otherwise every reinstall / Squirrel update wipes
// them (forge postPackage strips the bundled .env), forcing a re-registration and
// a fresh API key on each update. userData survives reinstalls.
const RELAY_ENV       = path.join(app.getPath('userData'), 'machine.env');
const LEGACY_RELAY_ENV = path.join(RELAY_ROOT, '.env');   // pre-1.2 location, for migration
const CLAUDE_SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');

// Runtime/log dirs shared with the daemon. MUST match RUNTIME_DIR/LOG_DIR in
// relay-deamon1/src/paths.js — the heartbeat and hooks are SEPARATE processes that
// coordinate through these files, so every process must compute the identical path.
// Use os.homedir() (NOT app.getPath('userData'), which is Roaming) to match the daemon's Local path.
const RELAY_LOCAL_APPDATA =
  process.platform === 'win32'  ? path.join(os.homedir(), 'AppData', 'Local')
  : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support')
  : path.join(os.homedir(), '.local', 'share');
const RELAY_RUNTIME_DIR = path.join(RELAY_LOCAL_APPDATA, 'VibeRemote', 'runtime');
const RELAY_LOG_DIR     = path.join(RELAY_LOCAL_APPDATA, 'VibeRemote', 'logs');
const ALLOW_ALL_FILE  = path.join(RELAY_RUNTIME_DIR, 'relay-allow-all.txt');

// Electron derives userData from package.json `productName`, so RENAMING THE APP MOVES
// IT. Every past name must be migrated forward, or the new userData dir comes up empty,
// Dashboard sees no MACHINE_ID, self-registers a brand-new machine, and the phone is
// left paired to a machine that no longer reports — the exact failure the 'Vibe Remote'
// rename caused. Newest-first; keep in sync with relay-deamon1/src/machineEnv.js.
const PRIOR_APP_DIR_NAMES = ['Vibe Remote', 'vibe-remote', 'my-app'];

function priorMachineEnvPaths() {
  const root = path.dirname(app.getPath('userData'));   // %APPDATA% (or platform equivalent)
  return PRIOR_APP_DIR_NAMES
    .map((n) => path.join(root, n, 'machine.env'))
    .filter((p) => p !== RELAY_ENV);
}

// One-time migration: bring the machine identity forward from any previous location —
// an older app name's userData dir, or the pre-1.2 bundled .env — so we never
// re-register (and never orphan the phone's pairing) on this machine.
function migrateMachineEnv() {
  try {
    if (existsSync(RELAY_ENV)) return;   // already in the current location

    const source = [...priorMachineEnvPaths(), LEGACY_RELAY_ENV].find((p) => existsSync(p));
    if (!source) return;                 // genuinely first run — Dashboard will register

    mkdirSync(path.dirname(RELAY_ENV), { recursive: true });
    writeFileSync(RELAY_ENV, readFileSync(source, 'utf8'), 'utf8');
    console.log('[machine-env] migrated credentials from', source, '->', RELAY_ENV);
  } catch (err) {
    console.error('[machine-env] migration failed:', err.message);
  }
}

// ── Harness platform bridge ───────────────────────────────────────────────────
// All multi-harness logic lives in the daemon (relay-deamon1) behind a small CLI
// so the registry never has to be bundled into the Vite build. main.js shells out
// to it — the same pattern already used for the heartbeat. See
// HARNESS_PLATFORM_ARCHITECTURE.md and relay-deamon1/harness-cli.js.
const HARNESS_CLI = path.join(RELAY_ROOT, 'harness-cli.js');
let harnessDesiredTimer = null;

function runHarnessCli(args) {
  return new Promise((resolve, reject) => {
    execFile('node', [HARNESS_CLI, ...args],
      { cwd: RELAY_ROOT, windowsHide: true, timeout: 30000, env: { ...process.env, VIBE_MACHINE_ENV: RELAY_ENV } },
      (err, stdout) => {
        const text = (stdout || '').toString().trim();
        if (!text) return reject(err || new Error('harness-cli produced no output'));
        try { resolve(JSON.parse(text)); }
        catch { reject(new Error('harness-cli bad output: ' + text.slice(0, 300))); }
      });
  });
}

// Built at runtime so the hook command always uses the current absolute path.
// MUST stay in sync with relay-deamon1/src/harnesses/claude-code/provider.js buildHookBlock().
// Matcher is '*' (ALL tools) so nothing that needs permission slips through to a manual CLI
// accept — WebFetch, WebSearch, Task, MCP tools (mcp__*), future/plugin tools all route to the
// phone. hook.js auto-allows read-only tools (Glob/Grep/…) and approves the rest via
// permissionDecision:"allow". refreshHookPathIfEnabled() rewrites this on every launch, so an
// already-enabled harness picks up a widened matcher after an update with no manual re-toggle.
function buildHookBlock() {
  const wrap = (name) => `node "${path.join(RELAY_ROOT, name)}"`;
  return {
    PreToolUse: [{
      matcher: '*',
      hooks: [{ type: 'command', command: wrap('hook-wrapper.cjs') }],
    }],
    PostToolUse: [{
      matcher: '*',
      hooks: [{ type: 'command', command: wrap('postHook-wrapper.cjs') }],
    }],
    Notification: [{
      hooks: [{ type: 'command', command: wrap('notifyHook-wrapper.cjs') }],
    }],
    Stop: [{
      hooks: [{ type: 'command', command: wrap('stopHook-wrapper.cjs') }],
    }],
  };
}

function parseEnv(raw) {
  const env = {};
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return env;
}

function readSettings() {
  try { return JSON.parse(readFileSync(CLAUDE_SETTINGS, 'utf8')); } catch { return {}; }
}

function writeSettings(obj) {
  writeFileSync(CLAUDE_SETTINGS, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

// Tools whose interactive prompts are suppressed when mobile mode is active.
// The hook is the sole gatekeeper — it exits 0 (allow) or 2 (deny).
// Without this, Claude Code's own "Allow? [y/n]" prompt appears alongside the
// hook and keeps waiting for keyboard input even after mobile approves.
const HOOK_TOOLS_ALLOW = ['Bash(*)', 'Write(*)', 'Edit(*)', 'MultiEdit(*)', 'Read(*)'];

function applyMobilePermissions(settings) {
  if (!settings.permissions)       settings.permissions = {};
  if (!settings.permissions.allow) settings.permissions.allow = [];
  for (const tool of HOOK_TOOLS_ALLOW) {
    if (!settings.permissions.allow.includes(tool)) {
      settings.permissions.allow.push(tool);
    }
  }
}

function removeMobilePermissions(settings) {
  if (!settings.permissions?.allow) return;
  settings.permissions.allow = settings.permissions.allow.filter(
    t => !HOOK_TOOLS_ALLOW.includes(t)
  );
  if (!settings.permissions.allow.length)        delete settings.permissions.allow;
  if (!Object.keys(settings.permissions).length) delete settings.permissions;
}

// If the hook is already enabled, refresh its command path to the current install location.
// This fixes the path after a Squirrel version-directory change (app-1.0.0 → app-1.0.1).
// Also ensures permissions.allow is in sync so the double-approval bug stays fixed.
function refreshHookPathIfEnabled() {
  const settings = readSettings();
  if (settings.hooks?.PreToolUse) {
    settings.hooks = buildHookBlock();
    applyMobilePermissions(settings);
    writeSettings(settings);
  }
}

// ── Heartbeat auto-management ─────────────────────────────────────────────────
// The heartbeat is a long-running Node process that:
//   • pings /machines/heartbeat every 30s (keeps machine online)
//   • polls /mobile/command/next every 10s (delivers mobile prompts to claude)
//   • polls /machines/fs/pending every 5s  (serves file-tree requests)
// It must run as long as the desktop app is open.

let heartbeatProc  = null;
let heartbeatAlive = true;   // set false on app quit to stop restart loop

// ── Tray / close-to-tray state ────────────────────────────────────────────────
// Closing the window HIDES the app to the tray so the heartbeat keeps running and mobile
// support keeps working. Only an explicit tray "Quit" (or OS shutdown) really exits — and on
// the way out we disable all harnesses so the CLIs (Claude Code / OpenCode) return to normal
// while the app is closed. See TRAY_AND_HARNESS_CLEANUP.md.
let mainWindow = null;
let tray       = null;
let isQuitting = false;   // true once a real quit is in progress
let appReady   = false;   // true once whenReady finished — guards the Squirrel early-quit path

// Tray icon: src/ is excluded from packaging, so the packaged build reads it from resources
// (added to forge extraResource). Dev reads the source asset.
const TRAY_ICON = app.isPackaged
  ? path.join(process.resourcesPath, 'vibeRemote_icon.png')
  : path.join(__dirname, '..', '..', 'src', 'assets', 'logo', 'vibeRemote_icon.png');

function startHeartbeat() {
  // Only start if the machine is configured (relay .env exists with credentials)
  if (!existsSync(RELAY_ENV)) return;
  if (heartbeatProc) return;

  const script = path.join(RELAY_ROOT, 'scripts', 'heartbeat.js');
  if (!existsSync(script)) return;

  // Pipe all heartbeat output to a log file — critical for debugging
  // because the logger writes to stderr which is normally invisible from Electron
  try { mkdirSync(RELAY_LOG_DIR, { recursive: true }); } catch {}
  const logStream = createWriteStream(path.join(RELAY_LOG_DIR, 'heartbeat.log'), { flags: 'a' });
  logStream.write(`\n--- heartbeat started ${new Date().toISOString()} ---\n`);

  heartbeatProc = spawn('node', [script], {
    cwd:   RELAY_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env:   { ...process.env, VIBE_MACHINE_ENV: RELAY_ENV },
  });

  heartbeatProc.stdout.pipe(logStream);
  heartbeatProc.stderr.pipe(logStream);

  heartbeatProc.on('error', (err) => {
    console.error('[heartbeat] spawn error:', err.message);
    logStream.write(`[ERROR] spawn failed: ${err.message}\n`);
    heartbeatProc = null;
  });

  heartbeatProc.on('exit', (code) => {
    console.log(`[heartbeat] exited (code ${code})`);
    heartbeatProc = null;
    // Auto-restart after 5s unless the app is quitting
    if (heartbeatAlive) {
      setTimeout(startHeartbeat, 5000);
    }
  });

  console.log('[heartbeat] started');
}

function stopHeartbeat() {
  heartbeatAlive = false;
  if (heartbeatProc) {
    heartbeatProc.kill();
    heartbeatProc = null;
  }
}

// ── Relay IPC ─────────────────────────────────────────────────────────────────
ipcMain.handle('relay:getMachineConfig', () => {
  if (!existsSync(RELAY_ENV)) return null;
  const env = parseEnv(readFileSync(RELAY_ENV, 'utf8'));
  if (!env.MACHINE_ID) return null;
  return {
    machineId:     env.MACHINE_ID,
    machineLabel:  env.MACHINE_LABEL  || '',
    machineApiKey: env.MACHINE_API_KEY || '',
    userId:        env.USER_ID         || '',
    supabaseUrl:   env.SUPABASE_URL    || '',
  };
});

ipcMain.handle('relay:writeMachineConfig', (_, vars) => {
  let existing = {};
  if (existsSync(RELAY_ENV)) {
    existing = parseEnv(readFileSync(RELAY_ENV, 'utf8'));
  }
  const merged = { ...existing, ...vars };
  const lines  = Object.entries(merged).map(([k, v]) => `${k}=${v}`);
  writeFileSync(RELAY_ENV, lines.join('\n') + '\n', 'utf8');

  // Machine was just registered for the first time — start the heartbeat now
  startHeartbeat();
});

ipcMain.handle('relay:getHookStatus', () => {
  const s = readSettings();
  return !!(s.hooks && s.hooks.PreToolUse);
});

ipcMain.handle('relay:setHookEnabled', (_, enable) => {
  const settings = readSettings();
  if (enable) {
    settings.hooks = buildHookBlock();
    applyMobilePermissions(settings);
  } else {
    delete settings.hooks;
    removeMobilePermissions(settings);
    try { unlinkSync(ALLOW_ALL_FILE); } catch {}
  }
  writeSettings(settings);
  return true;
});

// ── Harness IPC (multi-harness) ───────────────────────────────────────────────
// These supersede the single relay:getHookStatus/setHookEnabled toggle above,
// which is kept as a backward-compatible shim for the Claude-Code-only path.
ipcMain.handle('harness:list', async () => {
  try {
    const r = await runHarnessCli(['list']);
    return r.harnesses || [];
  } catch (err) {
    console.error('[harness:list]', err.message);
    return [];
  }
});

ipcMain.handle('harness:setMobile', async (_, { harness, enable }) => {
  const r = await runHarnessCli([enable ? 'enable' : 'disable', harness]);
  if (!r.ok) throw new Error(r.error || 'Harness toggle failed');
  return r.mobile_enabled;
});

// ── System IPC ────────────────────────────────────────────────────────────────
ipcMain.handle('system:getHostname', () => os.hostname());

// ── Window control IPC ────────────────────────────────────────────────────────
ipcMain.on('window:minimize', () => BrowserWindow.getFocusedWindow()?.minimize());
ipcMain.on('window:maximize', () => {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return;
  win.isMaximized() ? win.unmaximize() : win.maximize();
});
ipcMain.on('window:close', () => BrowserWindow.getFocusedWindow()?.close());

ipcMain.handle('window:isMaximized', () => {
  return BrowserWindow.getFocusedWindow()?.isMaximized() ?? false;
});

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 780,
    minWidth: 360,
    minHeight: 560,
    maxWidth: 520,
    frame: false,
    // Packaged builds get their icon baked into the exe via packagerConfig.icon
    // (src/ is excluded from packaging, so this path only resolves in dev).
    icon: app.isPackaged ? undefined : path.join(__dirname, '..', '..', 'src', 'assets', 'logo', 'vibeRemote_icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#082134',
  });

  mainWindow.on('maximize', () =>
    mainWindow.webContents.send('window:maximizeChange', true)
  );
  mainWindow.on('unmaximize', () =>
    mainWindow.webContents.send('window:maximizeChange', false)
  );

  // Close (X) → hide to tray instead of quitting, so the heartbeat + mobile support keep
  // running. Only a real quit (isQuitting) lets the window actually close.
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
};

// Show/focus the window (creating it if it was fully closed on macOS).
function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) { createWindow(); return; }
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  if (tray) return;
  let image;
  try { image = nativeImage.createFromPath(TRAY_ICON); } catch { image = nativeImage.createEmpty(); }
  if (image.isEmpty()) image = nativeImage.createEmpty();   // Electron tolerates an empty image
  tray = new Tray(image);
  tray.setToolTip('Vibe Remote');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Vibe Remote', click: showWindow },
    { type: 'separator' },
    { label: 'Quit Vibe Remote', click: () => { gracefulQuit(); } },
  ]));
  // Left-click (Windows/Linux) toggles the window.
  tray.on('click', showWindow);
}

// The ONE real-exit path: turn off all harness mobile support (so the CLIs behave normally
// while the app is closed), then quit. Idempotent — guarded by isQuitting.
async function gracefulQuit() {
  if (isQuitting) return;
  isQuitting = true;
  try {
    if (existsSync(RELAY_ENV)) {
      // Cap the wait so a hung CLI can't stall the quit — disable-all is normally ~1s.
      await Promise.race([
        runHarnessCli(['disable-all']),
        new Promise((r) => setTimeout(r, 5000)),
      ]);
    }
  } catch { /* offline / CLI error — quit anyway, better than hanging */ }
  app.quit();
}

app.whenReady().then(() => {
  migrateMachineEnv();        // ← move credentials to userData before anything reads them
  refreshHookPathIfEnabled();
  startHeartbeat();           // ← auto-start on launch if .env already exists

  // Publish this machine's harness inventory to the VPS so the phone sees which
  // harnesses exist and their mobile state. Safe no-op if the machine isn't
  // registered yet (CLI swallows the offline error).
  if (existsSync(RELAY_ENV)) {
    // Re-enable any harnesses that were turned off by disable-all when the app last quit, so
    // mobile support resumes seamlessly. Runs before report so the pushed inventory is correct.
    // Then `refresh` re-copies the install artifacts (Claude settings.json hooks / OpenCode plugin)
    // for any still-enabled harness, so a shipped update to those files deploys without a manual
    // toggle — the OpenCode analogue of refreshHookPathIfEnabled() above.
    runHarnessCli(['restore'])
      .catch(() => {})
      .finally(() => {
        runHarnessCli(['refresh']).catch(() => {});
        runHarnessCli(['report']).catch(() => {});
      });
    // Apply any phone-requested toggles. Poll tightened 15s → 5s so a mobile-initiated harness
    // toggle lands in ~5s instead of ~15s (INSTANT_OFFLINE_AND_HARNESS_UPDATES.md §5, Solution C).
    // A desktop-initiated toggle already reports immediately. A fully event-driven apply (main
    // subscribing to a `harness_desired` broadcast) is the further optimization noted in the doc.
    harnessDesiredTimer = setInterval(() => {
      runHarnessCli(['apply-desired']).catch(() => {});
    }, 5000);
  }

  createTray();
  createWindow();
  appReady = true;
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) showWindow();
  });
});

// A quit request (tray Quit, Cmd+Q, OS shutdown) must first disable all harnesses. If that
// cleanup hasn't run yet, cancel THIS quit, do it, then quit for real. Skip the interception
// during the Squirrel install/uninstall early-quit (before the app is ready) — just let it go.
app.on('before-quit', (e) => {
  if (!isQuitting && appReady) {
    e.preventDefault();
    gracefulQuit();
    return;
  }
  stopHeartbeat();
  if (harnessDesiredTimer) { clearInterval(harnessDesiredTimer); harnessDesiredTimer = null; }
});

// Do NOT quit when the window closes — it only hides to the tray. The app exits only via
// gracefulQuit (tray Quit / before-quit), which keeps it alive in the tray otherwise.
app.on('window-all-closed', () => { /* stay alive in the tray */ });
