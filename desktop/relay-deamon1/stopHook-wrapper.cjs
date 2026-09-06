/**
 * stopHook-wrapper.cjs
 * ESM bridge for stopHook.js — same pattern as hook-wrapper.cjs
 */

const path = require('path')
const fs   = require('fs')
const url  = require('url')
const { logPath, ensureDirs } = require('./src/paths.cjs')

const HOOK_FILE = path.join(__dirname, 'stopHook.js')
const HOOK_URL  = url.pathToFileURL(HOOK_FILE).href

function debugLog(msg) {
  try {
    ensureDirs()
    fs.appendFileSync(logPath('hook-debug.log'), `[${new Date().toISOString()}] [stopHook] ${msg}\n`)
  } catch {}
}

debugLog(`Wrapper started — loading ${HOOK_URL}`)

import(HOOK_URL).catch((err) => {
  debugLog(`Wrapper import error: ${err.message}\n${err.stack}`)
  process.exit(0)
})
