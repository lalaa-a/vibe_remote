// ─── Risk levels: 'low' | 'medium' | 'high' | 'critical' ────────────────────

const CRITICAL_BASH = [
  { pattern: /rm\s+-rf\s+\//, reason: 'Deletes root filesystem' },
  { pattern: /mkfs/,           reason: 'Formats a disk' },
  { pattern: /dd\s+if=.*of=\/dev/, reason: 'Writes directly to block device' },
  { pattern: /:\(\)\{.*\|.*&.*\}/, reason: 'Fork bomb pattern' },
]

const HIGH_BASH = [
  { pattern: /rm\s+-rf/,           reason: 'Recursive delete' },
  { pattern: /sudo/,               reason: 'Elevated privileges' },
  { pattern: /curl[^|]*\|\s*(sh|bash)/, reason: 'Curl-pipe-to-shell' },
  { pattern: /wget[^|]*\|\s*(sh|bash)/, reason: 'Wget-pipe-to-shell' },
  { pattern: /chmod\s+(777|a\+rwx)/, reason: 'World-writable permissions' },
  { pattern: /chown.*root/,        reason: 'Changes owner to root' },
  { pattern: />\s*\/etc\//,        reason: 'Writes to /etc' },
  { pattern: /crontab/,            reason: 'Modifies scheduled tasks' },
  { pattern: /systemctl\s+(enable|disable|start|stop)/, reason: 'Changes system service' },
  { pattern: /iptables/,           reason: 'Modifies firewall rules' },
  { pattern: /eval\s/,             reason: 'Dynamic code evaluation' },
]

const MEDIUM_BASH = [
  { pattern: /npm\s+(install|ci|publish)/, reason: 'Installs npm packages' },
  { pattern: /pip\s+install/,      reason: 'Installs Python packages' },
  { pattern: /yarn\s+add/,         reason: 'Installs yarn packages' },
  { pattern: /brew\s+install/,     reason: 'Installs Homebrew packages' },
  { pattern: /apt(-get)?\s+install/, reason: 'Installs system packages' },
  { pattern: /curl/,               reason: 'Network request' },
  { pattern: /wget/,               reason: 'Network download' },
  { pattern: /git\s+push/,         reason: 'Pushes to remote' },
  { pattern: /git\s+.*--force/,    reason: 'Force git operation' },
  { pattern: /ssh\s/,              reason: 'SSH connection' },
  { pattern: /scp\s/,              reason: 'Secure copy' },
  { pattern: /rsync/,              reason: 'Remote sync' },
  { pattern: /docker\s+(run|exec|push)/, reason: 'Docker operation' },
  { pattern: /psql|mysql|mongo/,   reason: 'Database operation' },
  { pattern: /rm\s+-[rRf]/,        reason: 'Recursive/forced delete' },
]

const HIGH_PATHS = [
  { pattern: /\.env$/,             reason: 'Environment variables file' },
  { pattern: /\.env\./,            reason: 'Environment file variant' },
  { pattern: /secrets?\//i,        reason: 'Secrets directory' },
  { pattern: /credentials/i,       reason: 'Credentials file' },
  { pattern: /id_rsa|id_ed25519/,  reason: 'SSH private key' },
  { pattern: /\.pem$/,             reason: 'Certificate/key file' },
  { pattern: /authorized_keys/,    reason: 'SSH authorized keys' },
  { pattern: /\/etc\//,            reason: 'System config directory' },
  { pattern: /\.aws\/credentials/, reason: 'AWS credentials' },
  { pattern: /\.kube\/config/,     reason: 'Kubernetes config' },
  { pattern: /password/i,          reason: 'File contains password in name' },
  { pattern: /token/i,             reason: 'File contains token in name' },
]

const MEDIUM_PATHS = [
  { pattern: /package\.json$/,     reason: 'Package manifest' },
  { pattern: /tsconfig|jsconfig/,  reason: 'TypeScript config' },
  { pattern: /webpack|vite|rollup/, reason: 'Build config' },
  { pattern: /dockerfile/i,        reason: 'Docker config' },
  { pattern: /\.github\//,         reason: 'GitHub Actions config' },
  { pattern: /nginx\.conf/,        reason: 'Nginx config' },
  { pattern: /\.sql$/,             reason: 'SQL file' },
  { pattern: /migration/i,         reason: 'Database migration' },
  { pattern: /schema/i,            reason: 'Schema definition' },
]

export function assessRisk(toolName, toolInput) {
  if (toolName === 'Bash') {
    return assessBash(toolInput.command || '')
  }

  if (['Write', 'Edit', 'MultiEdit'].includes(toolName)) {
    // For MultiEdit assess risk across all affected paths
    const paths = toolName === 'MultiEdit'
      ? (toolInput.edits || []).map(e => e.file_path || e.path)
      : [toolInput.file_path || toolInput.path || '']

    return assessPaths(paths)
  }

  if (toolName === 'Read') {
    const path = toolInput.file_path || toolInput.path || ''
    return assessReadPath(path)
  }

  // Tools now routed to the phone by the '*' hook matcher.
  if (toolName === 'WebFetch')            return { level: 'medium', reason: 'Fetches a URL over the network', icon: '🌐' }
  if (toolName === 'WebSearch')           return { level: 'low',    reason: 'Web search', icon: '🔎' }
  if (toolName === 'Task')                return { level: 'medium', reason: 'Runs a sub-agent', icon: '🤖' }
  if (toolName?.startsWith('mcp__'))      return { level: 'medium', reason: 'MCP tool call', icon: '🔌' }

  return { level: 'medium', reason: 'Unknown tool type', icon: '❓' }
}

function assessBash(command) {
  for (const { pattern, reason } of CRITICAL_BASH) {
    if (pattern.test(command)) return { level: 'critical', reason, icon: '🚨' }
  }
  for (const { pattern, reason } of HIGH_BASH) {
    if (pattern.test(command)) return { level: 'high', reason, icon: '⚠️' }
  }
  for (const { pattern, reason } of MEDIUM_BASH) {
    if (pattern.test(command)) return { level: 'medium', reason, icon: '🔶' }
  }
  return { level: 'low', reason: 'Standard command', icon: '✅' }
}

function assessPaths(paths) {
  for (const path of paths) {
    for (const { pattern, reason } of HIGH_PATHS) {
      if (pattern.test(path)) return { level: 'high', reason, icon: '⚠️' }
    }
  }
  for (const path of paths) {
    for (const { pattern, reason } of MEDIUM_PATHS) {
      if (pattern.test(path)) return { level: 'medium', reason, icon: '🔶' }
    }
    if (path.includes('node_modules')) return { level: 'low', reason: 'Dependency file', icon: '✅' }
  }
  return { level: 'low', reason: 'Source file change', icon: '✅' }
}

function assessReadPath(path) {
  for (const { pattern, reason } of HIGH_PATHS) {
    if (pattern.test(path)) return { level: 'high', reason: `Reading ${reason}`, icon: '👁️' }
  }
  for (const { pattern, reason } of MEDIUM_PATHS) {
    if (pattern.test(path)) return { level: 'medium', reason: `Reading ${reason}`, icon: '👁️' }
  }
  return { level: 'low', reason: 'Reading source file', icon: '👁️' }
}
