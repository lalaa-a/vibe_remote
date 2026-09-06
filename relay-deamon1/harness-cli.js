#!/usr/bin/env node
/**
 * harness-cli.js — the bridge the Electron main process spawns.
 *
 * Electron's main.js is bundled by Vite and lives inside the asar; relay-deamon1
 * is shipped as a separate resource with its own node_modules. Rather than bundle
 * the registry into the renderer build, main.js shells out to this CLI (same
 * pattern the app already uses for the heartbeat). All harness logic therefore
 * lives in ONE place: the daemon.
 *
 * Usage (always prints a single JSON line to stdout):
 *   node harness-cli.js list
 *   node harness-cli.js enable  <harnessId>
 *   node harness-cli.js disable <harnessId>
 *   node harness-cli.js status  <harnessId>
 *   node harness-cli.js report          # push current inventory to the VPS
 *   node harness-cli.js apply-desired   # apply phone-requested toggles
 */
import { getAdapter, listInstalled } from './src/registry.js'
import { machineCtx, reportHarness, getDesired } from './src/harness-sdk/index.js'
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs'
import { runtimePath, ensureDirs } from './src/paths.js'

// Where disable-all remembers what was enabled, so restore can bring it back next launch.
const RESTORE_FILE = () => runtimePath('mobile-restore.json')

function out(obj) { process.stdout.write(JSON.stringify(obj)) }
function fail(msg) { out({ ok: false, error: msg }); process.exit(1) }

async function pushReport() {
  try { await reportHarness(await listInstalled()) } catch { /* offline / unregistered → ignore */ }
}

async function main() {
  const [, , cmd, id] = process.argv

  switch (cmd) {
    case 'list': {
      out({ ok: true, harnesses: await listInstalled() })
      return
    }

    case 'status': {
      const a = await getAdapter(id)
      if (!a) return fail(`unknown harness: ${id}`)
      out({ ok: true, status: await a.mobile.status() })
      return
    }

    case 'enable':
    case 'disable': {
      const a = await getAdapter(id)
      if (!a) return fail(`unknown harness: ${id}`)
      if (cmd === 'enable') await a.mobile.enable(machineCtx())
      else                  await a.mobile.disable()
      const status = await a.mobile.status()
      await pushReport()
      out({ ok: true, harness: id, mobile_enabled: !!status.enabled })
      return
    }

    case 'report': {
      await pushReport()
      out({ ok: true })
      return
    }

    // Re-apply the install artifacts (settings.json hooks / OpenCode plugin file) for every
    // currently-enabled harness, so a shipped update to those artifacts lands on the next app
    // launch without the user toggling mobile off/on. Safe no-op for harnesses that are off.
    case 'refresh': {
      const refreshed = []
      for (const h of await listInstalled()) {
        const a = await getAdapter(h.harness)
        if (!a || typeof a.refreshIfEnabled !== 'function') continue
        try { await a.refreshIfEnabled(machineCtx()); refreshed.push(h.harness) } catch {}
      }
      out({ ok: true, refreshed })
      return
    }

    case 'apply-desired': {
      const desired = await getDesired()
      const applied = []
      for (const d of desired) {
        const a = await getAdapter(d.harness)
        if (!a || d.desired_enabled == null) continue
        const cur = (await a.mobile.status()).enabled
        if (d.desired_enabled && !cur)      { await a.mobile.enable(machineCtx()); applied.push(d.harness) }
        else if (!d.desired_enabled && cur) { await a.mobile.disable();            applied.push(d.harness) }
      }
      if (applied.length) await pushReport()
      out({ ok: true, applied })
      return
    }

    // Disable mobile support for EVERY currently-enabled harness (removes the CLI hooks /
    // OpenCode plugin) and remember the set, so the CLIs behave normally while the desktop app
    // is closed. main.js runs this when the user quits from the tray. See TRAY_AND_HARNESS…md.
    case 'disable-all': {
      const disabled = []
      for (const h of await listInstalled()) {
        if (!h.mobile_enabled) continue
        const a = await getAdapter(h.harness)
        if (!a) continue
        try { await a.mobile.disable(); disabled.push(h.harness) } catch {}
      }
      try { ensureDirs(); writeFileSync(RESTORE_FILE(), JSON.stringify(disabled)) } catch {}
      await pushReport()
      out({ ok: true, disabled })
      return
    }

    // Re-enable the harnesses that disable-all turned off, so mobile support resumes seamlessly
    // when the app relaunches. main.js runs this on startup.
    case 'restore': {
      let want = []
      try { want = JSON.parse(readFileSync(RESTORE_FILE(), 'utf8')) } catch {}
      const restored = []
      for (const hid of Array.isArray(want) ? want : []) {
        const a = await getAdapter(hid)
        if (!a) continue
        try {
          if (!(await a.mobile.status()).enabled) { await a.mobile.enable(machineCtx()); restored.push(hid) }
        } catch {}
      }
      try { unlinkSync(RESTORE_FILE()) } catch {}
      if (restored.length) await pushReport()
      out({ ok: true, restored })
      return
    }

    default:
      return fail(`unknown command: ${cmd || '(none)'} — use list|enable|disable|status|report|apply-desired|disable-all|restore|refresh`)
  }
}

main().catch((err) => fail(err.message))
