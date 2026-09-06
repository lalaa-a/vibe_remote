/**
 * registry.js — discovers harness adapters from src/harnesses/<id>/provider.js.
 *
 * Adding a harness = adding a folder. No central switch to edit. A provider that
 * fails validation (or throws on import) is logged and SKIPPED so one bad adapter
 * never sinks the others.
 */

import { readdirSync, existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { validateProvider } from './harness-sdk/index.js'

const __dir = dirname(fileURLToPath(import.meta.url))
const HARNESS_DIR = join(__dir, 'harnesses')

const providers = new Map()

async function discover() {
  if (providers.size) return
  let ids = []
  try { ids = readdirSync(HARNESS_DIR) } catch { return }

  for (const id of ids) {
    const provPath = join(HARNESS_DIR, id, 'provider.js')
    try {
      if (!existsSync(provPath) || !statSync(join(HARNESS_DIR, id)).isDirectory()) continue
      const mod = await import(pathToFileURL(provPath).href)
      const p = mod.default
      validateProvider(p)
      providers.set(p.manifest.id, p)
    } catch (err) {
      console.warn(`[registry] skipped harness "${id}": ${err.message}`)
    }
  }
}

export async function getAdapter(id) {
  await discover()
  return providers.get(id) || null
}

export async function allAdapters() {
  await discover()
  return [...providers.values()]
}

/**
 * Detection + current mobile state for every adapter — the shape the dashboard and
 * the server's /harness/report consume.
 */
export async function listInstalled() {
  await discover()
  const out = []
  for (const p of providers.values()) {
    let installed = false, version, enabled = false
    try { const d = await p.detect(); installed = !!d.installed; version = d.version } catch {}
    try { enabled = !!(await p.mobile.status()).enabled } catch {}
    out.push({
      harness:        p.manifest.id,
      displayName:    p.manifest.displayName,
      version:        version || null,
      adapterVersion: p.manifest.version,
      installed,
      mobile_enabled: enabled,
      capabilities:   p.manifest.capabilities,
    })
  }
  return out
}
