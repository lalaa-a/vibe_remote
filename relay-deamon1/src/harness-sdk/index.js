/**
 * harness-sdk — the stable contract every harness adapter compiles against.
 * Adapters import ONLY from here; they never reach into app/Electron/React or
 * into each other.
 */
export { loadEnv, machineCtx, isRegistered, RELAY_ROOT } from './env.js'
export {
  commandExists, getVersion,
  uploadRequest, pollDecision, postNarrative, reportHarness, getDesired,
  pollStopRequests, ackStopRequests,
} from './transport.js'
export {
  normalizeRequest, validateRequest, normalizeNarrative,
  CANONICAL_TOOLS, RISK_LEVELS,
} from './schema.js'
export { validateProvider, SDK_VERSION } from './validate.js'

export { settingsHookStrategy } from './strategies/settingsHook.js'
export { pluginStrategy }        from './strategies/plugin.js'
export { ptyProxyStrategy }      from './strategies/ptyProxy.js'
export { nullStrategy }          from './strategies/null.js'
