/**
 * NullStrategy — for a harness you can observe but not gate. mobile.enable just
 * records intent (a flag file); there is no interceptor, so capabilities.approvals
 * must be false. Useful as a read-only mirror and to prove capability degradation.
 */
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export function nullStrategy({ flagFile }) {
  return {
    async enable() {
      mkdirSync(dirname(flagFile), { recursive: true })
      writeFileSync(flagFile, new Date().toISOString())
    },
    async disable() { try { unlinkSync(flagFile) } catch {} },
    async status() { return { enabled: existsSync(flagFile) } },
  }
}
