import { config } from './config.js'

// Pure read-only / no-side-effect tools that Claude Code auto-approves and that fire
// constantly (search/list). The PreToolUse hook now matches ALL tools so nothing that needs
// permission can slip through to a manual CLI prompt (WebFetch, WebSearch, Task, MCP tools,
// future tools) — but these are auto-allowed here so they don't spam the phone with approvals.
// NOTE: `Read` is intentionally NOT here — it keeps going to mobile like before.
export const READONLY_TOOLS = new Set([
  'Glob', 'Grep', 'LS', 'TodoWrite', 'TodoRead', 'NotebookRead', 'BashOutput',
])

// Returns 'allow' | 'block' | 'ask'
export function preFilter(toolName, toolInput) {

  const target = getTarget(toolName, toolInput)

  // ─── Always block list (checked first) ───────────────────────────────────
  if (config.alwaysBlock.length) {
    for (const pattern of config.alwaysBlock) {
      try {
        if (new RegExp(pattern).test(target)) {
          return { action: 'block', reason: `Matched always-block rule: ${pattern}` }
        }
      } catch {}
    }
  }

  // ─── Read-only tools → auto-allow (Claude auto-approves these; no mobile decision needed) ──
  if (READONLY_TOOLS.has(toolName)) {
    return { action: 'allow', reason: 'read-only tool (auto-approved)' }
  }

  // ─── Always allow list ────────────────────────────────────────────────────
  if (config.alwaysAllow.length) {
    for (const pattern of config.alwaysAllow) {
      try {
        if (new RegExp(pattern).test(target)) {
          return { action: 'allow', reason: `Matched always-allow rule: ${pattern}` }
        }
      } catch {}
    }
  }

  // ─── Default: ask mobile ──────────────────────────────────────────────────
  return { action: 'ask', reason: null }
}

function getTarget(toolName, toolInput) {
  if (toolName === 'Bash')      return toolInput.command || ''
  if (toolName === 'Write')     return toolInput.file_path || toolInput.path || ''
  if (toolName === 'Edit')      return toolInput.file_path || toolInput.path || ''
  if (toolName === 'Read')      return toolInput.file_path || toolInput.path || ''
  if (toolName === 'MultiEdit') {
    return (toolInput.edits || []).map(e => e.file_path || e.path || '').join('\n')
  }
  return JSON.stringify(toolInput)
}
