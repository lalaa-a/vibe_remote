/**
 * Claude Code adapter — the REFERENCE adapter.
 *
 * It wraps the existing, proven runtime UNCHANGED:
 *   • approvals  → external hook scripts (hook.js + *-wrapper.cjs) via settings.json
 *   • narrative  → heartbeat.js transcript tailing
 *   • injection  → heartbeat.js terminal keystroke injection
 *
 * So this provider only owns detection + install/remove of the settings.json hook
 * block (the SettingsHookStrategy). The narrator/injector are marked `external`
 * because the long-running heartbeat performs them — the conformance suite and the
 * heartbeat both key off that flag. Changing this file must keep the legacy
 * settings.json shape byte-for-byte (see HARNESS_PLATFORM_ARCHITECTURE.md §9).
 */
import os from 'node:os'
import path from 'node:path'
import manifest from './manifest.json' with { type: 'json' }
import { settingsHookStrategy, commandExists, getVersion, RELAY_ROOT } from '../../harness-sdk/index.js'
import { runtimePath } from '../../paths.js'

const SETTINGS_FILE  = path.join(os.homedir(), '.claude', 'settings.json')
const ALLOW_ALL_FILE = runtimePath('relay-allow-all.txt')

// Identical to the legacy main.js buildHookBlock() — same matchers, same wrapper
// filenames, resolved against the real relay-deamon1 root in dev and packaged.
const HOOK_TOOLS_ALLOW = ['Bash(*)', 'Write(*)', 'Edit(*)', 'MultiEdit(*)', 'Read(*)']
const wrap = (name) => `node "${path.join(RELAY_ROOT, name)}"`

function buildHookBlock() {
  return {
    // Match ALL tools ('*') so nothing that needs permission slips through to a manual CLI
    // accept — WebFetch, WebSearch, Task, MCP tools (mcp__*), and any future/plugin tool now
    // route to the phone. hook.js auto-allows the read-only tools (Glob/Grep/…) so they don't
    // spam approvals, and approves the rest via permissionDecision:"allow". AskUserQuestion still
    // matches '*' and keeps its special handling. See src/filter.js READONLY_TOOLS.
    PreToolUse: [{
      matcher: '*',
      hooks: [{ type: 'command', command: wrap('hook-wrapper.cjs') }],
    }],
    // Also '*' so the phone sees results (tool_end) for the newly-intercepted tools. postHook
    // skips the read-only tools so they don't create orphan feed rows.
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
  }
}

const strategy = settingsHookStrategy({
  settingsFile:  SETTINGS_FILE,
  buildHookBlock,
  allowList:     HOOK_TOOLS_ALLOW,
  allowAllFile:  ALLOW_ALL_FILE,
  // Live token-usage: register our statusLine so it pokes the heartbeat at Claude's refresh
  // cadence (see LIVE_TOKEN_STATUSLINE_DESIGN.md). Backs up / restores any user statusLine.
  statusLineCommand:    wrap('statusLine.cjs'),
  statusLineBackupFile: runtimePath('statusline-backup.json'),
})

export default {
  manifest,

  async detect() {
    const installed = await commandExists('claude', ['--version'])
    return { installed, version: installed ? await getVersion('claude', ['--version']) : undefined }
  },

  mobile: {
    enable:  () => strategy.enable(),
    disable: () => strategy.disable(),
    status:  () => strategy.status(),
  },

  // Re-export so main.js can keep refreshing the hook path after a version-dir change.
  refreshIfEnabled: () => strategy.refreshIfEnabled(),

  // Narrative + injection are performed by the long-running heartbeat (transcript
  // tail + keystroke injection). File tree + session list are served by the
  // heartbeat (fs_requests) and the server (/mobile/sessions). All marked external
  // so the capability ↔ implementation contract is satisfied without duplicating
  // that proven logic here.
  narrator:   { external: true, start() { return () => {} } },
  injector:   { external: true, async deliver() { return false } },
  fsProvider: { external: true, async tree() { return [] } },
  sessions:   { external: true, async list() { return [] } },
}
