/**
 * PluginStrategy — for harnesses with a JS plugin runtime that can gate tools by
 * throwing inside a before-hook (OpenCode, and any future plugin-host harness).
 *
 * Install = copy a plugin file + an env JSON the plugin reads + a flag file the
 * plugin checks so "mobile off" is truly inert without uninstalling the plugin.
 */
import { mkdirSync, copyFileSync, writeFileSync, unlinkSync, existsSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * @param {object} cfg
 * @param {string} cfg.pluginDir   target plugin dir, e.g. ~/.config/opencode/plugin
 * @param {string} cfg.pluginDst   full path to the installed plugin file
 * @param {string} cfg.pluginSrc   bundled plugin source to copy from
 * @param {string} cfg.envDst      full path to the env JSON the plugin reads
 * @param {string} cfg.flagFile    presence = mobile mode active
 * @param {boolean}[cfg.removePluginOnDisable=false]
 */
export function pluginStrategy(cfg) {
  const { pluginDir, pluginDst, pluginSrc, envDst, flagFile, removePluginOnDisable = false } = cfg

  return {
    async enable(ctx) {
      mkdirSync(pluginDir, { recursive: true })
      copyFileSync(pluginSrc, pluginDst)
      writeFileSync(envDst, JSON.stringify({
        apiUrl:        ctx.apiUrl,
        machineApiKey: ctx.machineApiKey,
        userId:        ctx.userId,
        machineId:     ctx.machineId,
        supabaseUrl:   ctx.supabaseUrl,
        supabaseKey:   ctx.supabaseKey,
        timeoutMs:     ctx.timeoutMs ?? 300000,
        failOpen:      ctx.failOpen ?? true,
      }, null, 2))
      mkdirSync(dirname(flagFile), { recursive: true })
      writeFileSync(flagFile, new Date().toISOString())
    },

    async disable() {
      try { unlinkSync(flagFile) } catch {}
      if (removePluginOnDisable) {
        try { rmSync(pluginDst, { force: true }) } catch {}
        try { rmSync(envDst, { force: true }) } catch {}
      }
    },

    async status() {
      return { enabled: existsSync(flagFile) && existsSync(pluginDst) }
    },

    // Re-copy the plugin + env if mobile is currently on, so a shipped plugin update lands on the
    // next app launch without the user toggling off/on. Analogous to the Claude settings-hook
    // refresh. No-op when mobile is off.
    async refreshIfEnabled(ctx) {
      if (existsSync(flagFile) && existsSync(pluginDst)) { await this.enable(ctx) }
    },
  }
}
