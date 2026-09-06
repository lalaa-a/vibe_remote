/**
 * Gemini CLI adapter — demonstrates the UNIVERSAL PTY-proxy path for a harness
 * with no hook/plugin system.
 *
 * The only harness-specific logic is grammar.js (what an approval prompt looks
 * like + which key answers it). Everything else is the shared PtyProxyStrategy.
 *
 * "Mobile enabled" here means: the user launches Gemini through the Vibe shim
 * (`vibe run gemini-cli`) which calls interceptor.spawn(). enable/disable just
 * record intent via a flag file; gating defaults FAIL-CLOSED.
 */
import os from 'node:os'
import path from 'node:path'
import manifest from './manifest.json' with { type: 'json' }
import { ptyProxyStrategy, nullStrategy, commandExists, getVersion, normalizeRequest } from '../../harness-sdk/index.js'
import { grammar } from './grammar.js'

const FLAG_FILE = path.join(os.homedir(), '.config', 'vibe-remote', 'gemini-cli.on')

const intercept = ptyProxyStrategy({
  harnessId: 'gemini-cli',
  command: 'gemini',
  args: [],
  grammar,
  failOpen: false,            // PTY gating fails CLOSED
  mapPromptToRequest: (hit) => normalizeRequest({
    tool_name: 'bash', display_type: 'command',
    summary: hit.summary, command: hit.command,
    risk: { level: 'medium', reason: 'shell command (pattern-detected)', icon: '🔶' },
  }),
})

const toggle = nullStrategy({ flagFile: FLAG_FILE })   // reuse the flag-file lifecycle

export default {
  manifest,

  async detect() {
    const installed = await commandExists('gemini', ['--version'])
    return { installed, version: installed ? await getVersion('gemini', ['--version']) : undefined }
  },

  mobile: {
    enable:  () => toggle.enable(),
    disable: () => toggle.disable(),
    status:  () => toggle.status(),
  },

  // In-daemon interceptor: the desktop `vibe run` shim calls spawn() to launch
  // Gemini inside the PTY. Narrative + injection ride on the returned handle.
  interceptor: { mechanism: 'pty-proxy', spawn: intercept.spawn },
  narrator:    { external: true, start() { return () => {} } },   // streamed by the live PTY
  injector:    { external: true, async deliver() { return false } }, // use the PTY handle's inject()
}
