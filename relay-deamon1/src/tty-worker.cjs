/**
 * tty-worker.cjs
 *
 * Runs inside a worker_threads Worker.
 * Opens the Windows console device directly so it works even when
 * Claude Code has redirected stdin/stdout/stderr via pipes.
 *
 * Posts { input: 'approve' | 'deny' } to the main thread.
 * Posts { input: null } if the console is not accessible.
 */
const { parentPort, workerData } = require('worker_threads')
const fs = require('fs')

try {
  const conout = fs.openSync('\\\\.\\CONOUT$', 'w')
  const conin  = fs.openSync('\\\\.\\CONIN$',  'r')

  fs.writeSync(conout, workerData.prompt)

  const buf = Buffer.alloc(64)

  while (true) {
    const n    = fs.readSync(conin, buf, 0, 64)
    const line = buf.slice(0, n).toString().replace(/\r?\n$/, '').trim().toLowerCase()

    if (line === '1' || line === 'y' || line === 'yes' || line === 'a') {
      fs.writeSync(conout, '\r\n  ✅ Approved from PC\r\n\r\n')
      parentPort.postMessage({ input: 'approve' })
      break
    } else if (line === '2' || line === 'n' || line === 'no'  || line === 'd') {
      fs.writeSync(conout, '\r\n  ❌ Denied from PC\r\n\r\n')
      parentPort.postMessage({ input: 'deny' })
      break
    } else {
      fs.writeSync(conout, '  Invalid — press 1 (approve) or 2 (deny): ')
    }
  }
} catch (err) {
  // Console not accessible — main thread falls back to Supabase-only
  parentPort.postMessage({ input: null, error: err.message })
}
