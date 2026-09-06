/**
 * obfuscateRelay.cjs
 *
 * Obfuscates the relay-deamon1 source that ships OUTSIDE the asar
 * (resources/relay-deamon1). This runs against the PACKAGED output only —
 * the git source stays clean and debuggable; only the shipped copy is scrambled.
 *
 * Constraints honored (do not loosen without testing the daemon):
 *  - Only relay-deamon1's OWN .js/.cjs are touched — node_modules is skipped.
 *  - Filenames are preserved (external configs reference hook-wrapper.cjs,
 *    harness-cli.js, etc. by path).
 *  - Module structure is preserved: renameProperties / transformObjectKeys stay
 *    OFF so cross-file require()/import exports keep their names.
 *  - disableConsoleOutput stays OFF — the daemon logs to files via console.*.
 */

const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

// Conservative-but-strong. Dial up controlFlowFlattening/deadCodeInjection later
// once the packaged daemon is confirmed working.
const OBFUSCATOR_OPTIONS = {
  target: 'node',
  compact: true,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,          // never rename globals — would break require/exports
  renameProperties: false,       // keep export/property names intact
  transformObjectKeys: false,    // keep object shapes intact for consumers
  stringArray: true,
  stringArrayThreshold: 1,
  stringArrayEncoding: ['base64'],
  stringArrayCallsTransform: true,
  splitStrings: true,
  splitStringsChunkLength: 8,
  numbersToExpressions: true,
  simplify: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.6,
  deadCodeInjection: false,       // off: bloat + perf; enable selectively if desired
  selfDefending: false,           // off: safer first pass; anti-debug can be added later
  disableConsoleOutput: false,    // off: the daemon relies on console.* for file logs
  unicodeEscapeSequence: false,
};

/** Recursively collect .js/.cjs files, skipping any node_modules directory. */
function collectSourceFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, acc);
    } else if (entry.isFile() && /\.(c?js)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Obfuscate every relay-deamon1 source file in place within a packaged app.
 * @param {string} relayRoot absolute path to <output>/resources/relay-deamon1
 */
function obfuscateRelayDir(relayRoot) {
  if (!fs.existsSync(relayRoot)) {
    console.warn(`[obfuscate] relay dir not found, skipping: ${relayRoot}`);
    return;
  }
  const files = collectSourceFiles(relayRoot);
  let ok = 0;
  for (const file of files) {
    const code = fs.readFileSync(file, 'utf8');
    try {
      const result = JavaScriptObfuscator.obfuscate(code, OBFUSCATOR_OPTIONS);
      fs.writeFileSync(file, result.getObfuscatedCode(), 'utf8');
      ok++;
    } catch (err) {
      // Fail loudly — a silently un-obfuscated core file defeats the purpose.
      throw new Error(`[obfuscate] failed on ${file}: ${err.message}`);
    }
  }
  console.log(`[obfuscate] obfuscated ${ok}/${files.length} relay-deamon1 files`);
}

module.exports = { obfuscateRelayDir };
