import { readFileSync, existsSync } from 'fs'
import { diffForWrite, diffForEdit, diffForMultiEdit } from './differ.js'
import { assessRisk } from './risk.js'

export function parseEvent(event) {
  const { tool_name, tool_input, session_id } = event
  const risk = assessRisk(tool_name, tool_input)

  const base = { tool_name, session_id, risk }

  switch (tool_name) {
    case 'Bash':      return { ...base, ...parseBash(tool_input) }
    case 'Write':     return { ...base, ...parseWrite(tool_input) }
    case 'Edit':      return { ...base, ...parseEdit(tool_input) }
    case 'MultiEdit': return { ...base, ...parseMultiEdit(tool_input) }
    case 'Read':      return { ...base, ...parseRead(tool_input) }
    // Every other tool now reaches the phone (the hook matches '*'): WebFetch, WebSearch, Task,
    // MCP tools (mcp__server__tool), plugin tools, future tools. We keep display_type 'unknown'
    // (the mobile app's existing fallback card) but give it a clean, human summary so the
    // approval reads well instead of "X — unrecognised tool".
    default: return {
      ...base,
      display_type:   'unknown',
      summary:        genericSummary(tool_name, tool_input),
      files_affected: [],
      diff:           null,
      raw_input:      tool_input,
    }
  }
}

// Human-readable one-liner for any tool without a dedicated parser.
function genericSummary(toolName, input = {}) {
  if (toolName === 'WebFetch')  return `Fetch ${input.url || ''}`.trim()
  if (toolName === 'WebSearch') return `Search "${input.query || ''}"`
  if (toolName === 'Task') {
    const type = input.subagent_type || 'agent'
    return `Task (${type})${input.description ? `: ${input.description}` : ''}`
  }
  // MCP tools are named mcp__<server>__<tool>
  const mcp = /^mcp__(.+?)__(.+)$/.exec(toolName || '')
  if (mcp) return `${mcp[1]} → ${mcp[2].replace(/_/g, ' ')}`
  return toolName || 'Tool'
}

// ─── Bash ─────────────────────────────────────────────────────────────────────
function parseBash(input) {
  const command  = input.command || ''
  const parts    = command.trim().split(/\s+/)
  const program  = parts[0] || ''
  const args     = parts.slice(1)
  const summary  = command.length > 100 ? command.slice(0, 97) + '…' : command

  // For multi-line commands, extract meaningful lines for the preview
  const lines    = command.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'))
  const preview  = lines.slice(0, 5).join('\n')

  return {
    display_type:   'bash',
    summary,
    command,
    program,
    args,
    preview,
    working_dir:    input.cwd || null,
    files_affected: [],
    diff:           null,
  }
}

// ─── Write ────────────────────────────────────────────────────────────────────
function parseWrite(input) {
  const filePath   = input.file_path || input.path || ''
  const newContent = input.content   || ''
  const diff       = diffForWrite(filePath, newContent)
  const oldContent = existsSync(filePath) ? readFileSync(filePath, 'utf8') : null

  return {
    display_type:   'write',
    summary:        `${diff.is_new_file ? 'Create' : 'Overwrite'} ${filePath}  (+${diff.stats.added} −${diff.stats.removed})`,
    file_path:      filePath,
    is_new_file:    diff.is_new_file,
    new_content:    newContent,
    old_content:    oldContent,
    diff,
    files_affected: [filePath],
  }
}

// ─── Edit ─────────────────────────────────────────────────────────────────────
function parseEdit(input) {
  const filePath = input.file_path || input.path || ''
  const diff     = diffForEdit(filePath, input.old_string || '', input.new_string || '')

  return {
    display_type:   'edit',
    summary:        `Edit ${filePath}  (+${diff.stats.added} −${diff.stats.removed})`,
    file_path:      filePath,
    old_string:     input.old_string || '',
    new_string:     input.new_string || '',
    diff,
    files_affected: [filePath],
  }
}

// ─── Read ─────────────────────────────────────────────────────────────────────
function parseRead(input) {
  const filePath = input.file_path || input.path || ''
  const offset   = input.offset ?? null
  const limit    = input.limit  ?? null

  let summary = `Read ${filePath}`
  if (offset != null || limit != null) {
    const parts = []
    if (offset != null) parts.push(`from line ${offset}`)
    if (limit  != null) parts.push(`${limit} lines`)
    summary += `  (${parts.join(', ')})`
  }

  return {
    display_type:   'read',
    summary,
    file_path:      filePath,
    files_affected: [filePath],
    diff:           null,
  }
}

// ─── MultiEdit ────────────────────────────────────────────────────────────────
function parseMultiEdit(input) {
  const edits     = input.edits || []
  const diff      = diffForMultiEdit(edits)
  const filePaths = [...new Set(edits.map(e => e.file_path || e.path))]

  return {
    display_type:   'multi_edit',
    summary:        `Edit ${diff.file_count} file${diff.file_count !== 1 ? 's' : ''}  (+${diff.grand_stats.added} −${diff.grand_stats.removed})`,
    files_affected: filePaths,
    diff,
    edit_count:     diff.edit_count,
  }
}
