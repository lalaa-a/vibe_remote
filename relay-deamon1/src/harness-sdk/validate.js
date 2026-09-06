/**
 * harness-sdk/validate.js — the capability ↔ implementation contract.
 *
 * Enforced at registry load time so a "declared but not implemented" capability
 * fails fast instead of in production. One bad adapter is skipped, never fatal
 * (see registry.js), but this is what tells the registry it's bad.
 */
export const SDK_VERSION = '1.0.0'

const REQUIRED_CAP_KEYS = [
  'approvals', 'narrative', 'injection', 'fileTree', 'sessionList', 'approvalMechanism',
]
const APPROVAL_MECHANISMS = ['hook', 'plugin', 'mcp', 'pty-proxy', 'api', 'none']

export function validateProvider(p) {
  if (!p || typeof p !== 'object') throw new Error('provider must be an object')
  const m = p.manifest
  if (!m || typeof m !== 'object') throw new Error('provider.manifest missing')
  if (!m.id) throw new Error('manifest.id missing')
  if (!m.displayName) throw new Error(`${m.id}: manifest.displayName missing`)
  if (typeof p.detect !== 'function') throw new Error(`${m.id}: detect() missing`)
  if (!p.mobile || typeof p.mobile.enable !== 'function' ||
      typeof p.mobile.disable !== 'function' || typeof p.mobile.status !== 'function') {
    throw new Error(`${m.id}: mobile.{enable,disable,status} required`)
  }

  const c = m.capabilities || {}
  for (const k of REQUIRED_CAP_KEYS) {
    if (!(k in c)) throw new Error(`${m.id}: capabilities.${k} not declared`)
  }
  if (!APPROVAL_MECHANISMS.includes(c.approvalMechanism)) {
    throw new Error(`${m.id}: bad approvalMechanism "${c.approvalMechanism}"`)
  }

  // Capability ↔ implementation agreement.
  // For 'hook' | 'plugin' | 'mcp' the gate runs INSIDE the harness process via an
  // installed artifact (hook script / plugin / MCP server), so no in-daemon
  // interceptor is required. 'pty-proxy' and 'api' run the gate in the daemon and
  // therefore must ship a runtime interceptor.
  const EXTERNAL_GATES = ['hook', 'plugin', 'mcp']
  if (c.approvals) {
    const external = EXTERNAL_GATES.includes(c.approvalMechanism)
    if (!external && !p.interceptor) {
      throw new Error(`${m.id}: approvals via '${c.approvalMechanism}' needs an in-daemon interceptor`)
    }
  }
  if (c.narrative   && !p.narrator)   throw new Error(`${m.id}: narrative capability needs a narrator`)
  if (c.injection   && !p.injector)   throw new Error(`${m.id}: injection capability needs an injector`)
  if (c.fileTree    && !p.fsProvider) throw new Error(`${m.id}: fileTree capability needs an fsProvider`)
  if (c.sessionList && !p.sessions)   throw new Error(`${m.id}: sessionList capability needs a sessions lister`)

  // Soft SDK-version gate: warn on major mismatch, don't hard-fail patch/minor.
  if (m.sdkVersion) {
    const wantMajor = String(m.sdkVersion).replace(/[^\d.]/g, '').split('.')[0]
    const haveMajor = SDK_VERSION.split('.')[0]
    if (wantMajor && wantMajor !== haveMajor) {
      throw new Error(`${m.id}: targets SDK v${m.sdkVersion}, host is v${SDK_VERSION}`)
    }
  }
  return true
}
