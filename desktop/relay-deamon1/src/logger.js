// All output goes to stderr — stdout is owned by Claude Code for hook responses

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 }
const MIN    = LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LEVELS.info

function log(level, message, data = {}) {
  if (LEVELS[level] < MIN) return
  const entry = {
    ts:      new Date().toISOString(),
    level,
    message,
    ...data,
  }
  process.stderr.write(JSON.stringify(entry) + '\n')
}

export const logger = {
  debug: (msg, data)  => log('debug', msg, data),
  info:  (msg, data)  => log('info',  msg, data),
  warn:  (msg, data)  => log('warn',  msg, data),
  error: (msg, data)  => log('error', msg, data),
}
