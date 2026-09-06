/**
 * hook-wrapper.cjs
 *
 * Claude Code on Windows launches hooks as CommonJS by default which breaks
 * ES module imports. This wrapper uses dynamic import() to bridge the gap.
 *
 * This is the file you point settings.json at — NOT hook.js directly.
 */

const path = require('path')
const fs   = require('fs')
const url  = require('url')
const { logPath, ensureDirs } = require('./src/paths.cjs')

const LOG_FILE  = logPath('hook-debug.log')
const HOOK_FILE = path.join(__dirname, 'hook.js')

// On Windows, dynamic import() requires a file:// URL — a bare path like
// E:\foo\hook.js will throw ERR_UNSUPPORTED_ESM_URL_SCHEME
const HOOK_URL  = url.pathToFileURL(HOOK_FILE).href

function debugLog(msg) {
  try {
    ensureDirs()
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`)
  } catch {}
}

debugLog(`Wrapper started — loading ${HOOK_URL}`)

import(HOOK_URL).catch((err) => {
  debugLog(`Wrapper import error: ${err.message}\n${err.stack}`)
  process.exit(0)
})
