/**
 * bundleRelay.cjs
 *
 * Option A — collapse the readable relay-deamon1 `src/` tree into a handful of
 * self-contained entry files, so the shipped daemon no longer exposes browsable
 * source. Runs against the PACKAGED copy only (git source stays clean).
 *
 * ── Why this is careful, not naive ────────────────────────────────────────────
 * relay-deamon1 has three traits that a blind "bundle everything" would break:
 *
 *   1. DYNAMIC DISCOVERY — src/registry.js does readdirSync(src/harnesses) +
 *      dynamic import() of each provider.js. esbuild can't follow that, so the
 *      provider files must remain real files at their original paths.
 *
 *   2. DEPTH-SENSITIVE PATHS — a few shared modules resolve other files relative
 *      to their OWN location via import.meta.url:
 *        • src/registry.js         → readdir(join(__dir,'harnesses'))
 *        • src/machineEnv.js       → LEGACY_ENV = join(__dir,'..','.env')
 *        • src/harness-sdk/env.js  → RELAY_ROOT = join(__dir,'..','..')
 *        • src/harness-sdk/index.js→ re-exports env.js (the only aggregator that
 *                                     pulls the depth-sensitive RELAY_ROOT)
 *      If these were inlined into an entry at a different directory depth their
 *      paths would silently point to the wrong place. So they are marked EXTERNAL
 *      (kept as their own files) and every consumer references them at runtime.
 *
 *   3. RUNTIME-PATH ENTRIES — files launched by path from OUTSIDE this bundler:
 *      Claude Code hooks (*-wrapper.cjs → hook.js → relay.cjs), the OpenCode
 *      plugin (plugin/relay.js, copied into ~/.config/opencode), the pty worker
 *      (tty-worker.cjs), and the CLIs main.js spawns (harness-cli.js, heartbeat).
 *      All must keep their filenames and paths.
 *
 * The safety trick: every bundle is emitted AT ITS SOURCE PATH. Because the
 * importer's location never changes, relative `external` specifiers stay valid
 * and `import.meta.url` keeps resolving correctly.
 *
 * After bundling, only files esbuild actually INLINED (tracked via metafile) and
 * that are not themselves entries/externals are deleted. node_modules is never
 * touched here (npm packages are marked external and resolve at runtime).
 */

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

/**
 * Entry points — each bundled in place. Also includes the four depth-sensitive
 * shared modules, which are bundled (to inline THEIR non-external deps) but also
 * kept as files and referenced externally by everyone else.
 */
const ENTRIES = [
  // root hooks + their CJS wrappers
  'hook.js', 'postHook.js', 'stopHook.js', 'notifyHook.js',
  'hook-wrapper.cjs', 'postHook-wrapper.cjs', 'stopHook-wrapper.cjs', 'notifyHook-wrapper.cjs',
  // root control scripts (CJS)
  'relay.cjs', 'decide.cjs',
  // CLI + long-running scripts spawned by main.js
  'harness-cli.js', 'scripts/heartbeat.js', 'scripts/setup.js',
  // dynamically-discovered harness adapters (must keep path for registry readdir)
  'src/harnesses/claude-code/provider.js',
  'src/harnesses/gemini-cli/provider.js',
  'src/harnesses/opencode/provider.js',
  // OpenCode plugin (copied by path into OpenCode's plugin dir)
  'src/harnesses/opencode/plugin/relay.js',
  // pty worker (loaded by path into a worker thread)
  'src/tty-worker.cjs',
  // depth-sensitive shared modules — kept as files, marked external below
  'src/registry.js', 'src/machineEnv.js',
  'src/harness-sdk/env.js', 'src/harness-sdk/index.js',
];

/** The four shared modules that must NOT be inlined (kept as external files). */
const EXTERNAL_RELATIVE = [
  'src/registry.js', 'src/machineEnv.js',
  'src/harness-sdk/env.js', 'src/harness-sdk/index.js',
];

/**
 * esbuild plugin: mark the depth-sensitive shared modules as external so any
 * importer references them at runtime instead of inlining them.
 *
 * CRITICAL: the external specifier is rewritten to be relative to the ENTRY's
 * output directory — NOT kept verbatim. A leaf like src/config.js may import
 * `./machineEnv.js`; when that leaf is inlined into an entry at a different depth
 * (e.g. root/hook.js) the specifier must become `./src/machineEnv.js` or the
 * runtime import points at the wrong directory.
 *
 * @param {string} relayRoot
 * @param {string} entryOutDir absolute dir of the entry being built (= its source dir)
 */
function externalSharedPlugin(relayRoot, entryOutDir) {
  const externalAbs = new Set(
    EXTERNAL_RELATIVE.map((r) => path.resolve(relayRoot, r).toLowerCase())
  );
  return {
    name: 'external-shared',
    setup(build) {
      build.onResolve({ filter: /^\./ }, (args) => {
        // Resolve the relative import to an absolute path (add .js if extensionless).
        let abs = path.resolve(args.resolveDir, args.path);
        if (!/\.[cm]?js$/i.test(abs) && fs.existsSync(abs + '.js')) abs += '.js';
        if (!externalAbs.has(abs.toLowerCase())) return null; // bundle normally

        // Rewrite the specifier relative to the entry's OUTPUT location so it
        // still resolves no matter which inlined leaf imported it.
        let spec = path.relative(entryOutDir, abs).replace(/\\/g, '/');
        if (!spec.startsWith('.')) spec = './' + spec;
        return { path: spec, external: true };
      });
    },
  };
}

async function bundleOne(relayRoot, rel) {
  const abs = path.join(relayRoot, rel);
  if (!fs.existsSync(abs)) {
    console.warn(`[bundle] entry missing, skipping: ${rel}`);
    return null;
  }
  const isCjs = abs.toLowerCase().endsWith('.cjs');
  const result = await esbuild.build({
    entryPoints: [abs],
    outfile: abs,            // emit in place
    absWorkingDir: relayRoot, // metafile input paths become relative to relayRoot
    allowOverwrite: true,    // required to overwrite the input file
    bundle: true,
    platform: 'node',
    format: isCjs ? 'cjs' : 'esm',
    target: 'node18',
    packages: 'external',    // never bundle npm deps — they resolve from node_modules
    minify: true,            // strong, safe unreadability (mangled + no whitespace)
    legalComments: 'none',
    metafile: true,
    logLevel: 'silent',
    plugins: [externalSharedPlugin(relayRoot, path.dirname(abs))],
  });
  return result.metafile;
}

/**
 * @param {string} relayRoot absolute path to <output>/resources/relay-deamon1
 */
async function bundleRelayDir(relayRoot) {
  relayRoot = path.resolve(relayRoot); // normalize separators (Win: → backslashes)
  if (!fs.existsSync(relayRoot)) {
    console.warn(`[bundle] relay dir not found, skipping: ${relayRoot}`);
    return;
  }
  // Absolute paths of every entry (these are outputs — never delete them).
  const entryAbs = new Set(
    ENTRIES.map((r) => path.join(relayRoot, r).toLowerCase())
  );

  // 1. Bundle every entry in place, collecting the set of inlined input files.
  //    metafile input keys are relative to relayRoot (absWorkingDir), forward-slashed.
  const inlined = new Set();
  for (const rel of ENTRIES) {
    const metafile = await bundleOne(relayRoot, rel);
    if (!metafile) continue;
    for (const input of Object.keys(metafile.inputs)) {
      const absInput = path.resolve(relayRoot, input).toLowerCase();
      inlined.add(absInput);
    }
  }

  // 2. Delete only files that were actually INLINED into some bundle and are not
  //    themselves an entry/external. This removes config/supabase/logger/parsers/
  //    filter/differ/risk, the harness-sdk leaves, grammar.js and the manifests —
  //    without ever guessing. node_modules is excluded by construction (packages
  //    were external, so nothing under node_modules appears as an inlined input).
  let deleted = 0;
  for (const absInput of inlined) {
    if (entryAbs.has(absInput)) continue;                 // it's an entry — keep
    if (absInput.includes(`${path.sep}node_modules${path.sep}`.toLowerCase())) continue;
    if (!absInput.startsWith(relayRoot.toLowerCase())) continue; // outside relay — keep
    try {
      fs.unlinkSync(absInput);
      deleted++;
    } catch (err) {
      console.warn(`[bundle] could not delete ${absInput}: ${err.message}`);
    }
  }

  // 3. Prune now-empty directories left under src/ (e.g. harness-sdk/strategies).
  pruneEmptyDirs(path.join(relayRoot, 'src'));

  console.log(`[bundle] bundled ${ENTRIES.length} entries, removed ${deleted} inlined source files`);
}

function pruneEmptyDirs(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) pruneEmptyDirs(path.join(dir, entry.name));
  }
  try {
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  } catch {}
}

module.exports = { bundleRelayDir };
