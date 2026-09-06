/**
 * OpenCode adapter.
 *
 *   • approvals → a JS plugin (plugin/relay.js) installed into OpenCode's plugin
 *                 dir; it throws in `tool.execute.before` to deny. (PluginStrategy)
 *   • narrative → the OpenCode SDK event stream (in-daemon narrator).
 *   • injection → SDK `session.prompt()` (no keystroke hack). (in-daemon injector)
 *
 * The @opencode-ai/sdk dependency is loaded lazily so the app still runs if it
 * isn't installed — narrative/injection then degrade to no-ops with a warning,
 * while approvals (the plugin) keep working independently.
 */
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import manifest from './manifest.json' with { type: 'json' }
import { pluginStrategy, commandExists, getVersion, postNarrative, normalizeNarrative } from '../../harness-sdk/index.js'

const __dir = path.dirname(fileURLToPath(import.meta.url))

// OpenCode global config dir (current builds use ~/.config/opencode on all OSes).
const OC_DIR     = path.join(os.homedir(), '.config', 'opencode')
const PLUGIN_DIR = path.join(OC_DIR, 'plugin')
const PLUGIN_DST = path.join(PLUGIN_DIR, 'vibe-relay.js')
const PLUGIN_SRC = path.join(__dir, 'plugin', 'relay.js')
const ENV_DST    = path.join(PLUGIN_DIR, 'vibe-relay.env.json')
const FLAG_FILE  = path.join(OC_DIR, '.vibe-mobile-on')
const OPENCODE_URL = process.env.OPENCODE_URL || 'http://localhost:4096'

const strategy = pluginStrategy({
  pluginDir: PLUGIN_DIR, pluginDst: PLUGIN_DST, pluginSrc: PLUGIN_SRC,
  envDst: ENV_DST, flagFile: FLAG_FILE,
})

// ── Lazy SDK client ──────────────────────────────────────────────────────────────
let _client
async function client() {
  if (_client !== undefined) return _client
  try {
    const { createOpencodeClient } = await import('@opencode-ai/sdk')
    _client = createOpencodeClient({ baseUrl: OPENCODE_URL })
  } catch {
    console.warn('[opencode] @opencode-ai/sdk not installed — narrative/injection disabled')
    _client = null
  }
  return _client
}

export default {
  manifest,

  async detect() {
    const installed = await commandExists('opencode', ['--version'])
    return { installed, version: installed ? await getVersion('opencode', ['--version']) : undefined }
  },

  mobile: {
    enable:  (ctx) => strategy.enable(ctx),
    disable: () => strategy.disable(),
    status:  () => strategy.status(),
  },

  // Re-copy the plugin on launch if enabled, so a shipped plugin update deploys without a manual
  // toggle (mirrors Claude Code's refreshIfEnabled). Called by harness-cli `refresh`.
  refreshIfEnabled: (ctx) => strategy.refreshIfEnabled(ctx),

  // Narrative via SDK SSE. Returns a stop() function.
  narrator: {
    async start() {
      const c = await client()
      if (!c) return () => {}
      let stop = false
      ;(async () => {
        try {
          const events = await c.event.subscribe()
          for await (const event of events.stream) {
            if (stop) break
            if (event.type === 'message.part.updated' && event.properties?.part?.type === 'text') {
              postNarrative(normalizeNarrative({
                session_id: event.properties.sessionID,
                harness: 'opencode', event_type: 'output',
                summary: String(event.properties.part.text || '').slice(0, 2000),
              })).catch(() => {})
            }
          }
        } catch (err) {
          console.warn('[opencode] event stream ended:', err.message)
        }
      })()
      return () => { stop = true }
    },
  },

  // Prompt injection via SDK — replaces keystroke injection entirely.
  injector: {
    async deliver(sessionId, prompt) {
      const c = await client()
      if (!c) return false
      try {
        const id = sessionId ?? (await c.session.create({ body: { title: 'Vibe Remote' } })).id
        await c.session.prompt({ path: { id }, body: { parts: [{ type: 'text', text: prompt }] } })
        return true
      } catch (err) {
        console.warn('[opencode] inject failed:', err.message)
        return false
      }
    },
  },

  // Interrupt the current turn via SDK — no keystroke hack needed. This only
  // aborts the in-flight generation on this session; the OpenCode server process
  // (and any other sessions) keep running. See STOP_AGENT_DESIGN.md.
  interrupter: {
    async send(sessionId) {
      const c = await client()
      if (!c || !sessionId) return false
      try {
        await c.session.abort({ path: { id: sessionId } })
        return true
      } catch (err) {
        console.warn('[opencode] abort failed:', err.message)
        return false
      }
    },
  },
}
