import { readFileSync, existsSync } from 'fs'
import { diffLines, diffWordsWithSpace } from 'diff'

// ─── Write: full file replaced ───────────────────────────────────────────────
export function diffForWrite(filePath, newContent) {
  const oldContent = safeRead(filePath)
  const isNewFile  = oldContent === null
  const base       = oldContent ?? ''
  const lineDiff   = diffLines(base, newContent)
  const hunks      = buildHunks(lineDiff, base.split('\n'))
  const stats      = countStats(hunks)

  return {
    type:        'file_diff',
    is_new_file: isNewFile,
    file_path:   filePath,
    stats,
    hunks,
    // Language hint for syntax highlighting on mobile
    language:    detectLanguage(filePath),
  }
}

// ─── Edit: single old_string → new_string replacement ────────────────────────
export function diffForEdit(filePath, oldString, newString) {
  const fileContent = safeRead(filePath) ?? ''
  const lines       = fileContent.split('\n')

  // Find which line number this edit starts on (for mobile context)
  const editLineIndex = lines.findIndex(l => l.includes(oldString.split('\n')[0]))

  const lineDiff  = diffLines(oldString, newString)
  const hunks     = buildHunks(lineDiff, oldString.split('\n'))
  const stats     = countStats(hunks)

  // Word-level diff for fine-grained inline highlighting on mobile
  const wordDiff = diffWordsWithSpace(oldString, newString).map(p => ({
    value:   p.value,
    added:   p.added   || false,
    removed: p.removed || false,
  }))

  return {
    type:       'edit_diff',
    file_path:  filePath,
    edit_line:  editLineIndex + 1,
    stats,
    hunks,
    word_diff:  wordDiff,
    language:   detectLanguage(filePath),
  }
}

// ─── MultiEdit: multiple edits across one or more files ──────────────────────
export function diffForMultiEdit(edits) {
  // Group edits by file path
  const fileGroups = {}
  for (const edit of edits) {
    const fp = edit.file_path || edit.path
    if (!fileGroups[fp]) fileGroups[fp] = []
    fileGroups[fp].push(edit)
  }

  const fileDiffs = Object.entries(fileGroups).map(([filePath, fileEdits]) => {
    const editDiffs = fileEdits.map((edit, i) => ({
      index: i,
      ...diffForEdit(filePath, edit.old_string, edit.new_string),
    }))

    const totalAdded   = editDiffs.reduce((s, d) => s + d.stats.added,   0)
    const totalRemoved = editDiffs.reduce((s, d) => s + d.stats.removed, 0)

    return {
      file_path: filePath,
      language:  detectLanguage(filePath),
      stats:     { added: totalAdded, removed: totalRemoved },
      edits:     editDiffs,
    }
  })

  const grandAdded   = fileDiffs.reduce((s, d) => s + d.stats.added,   0)
  const grandRemoved = fileDiffs.reduce((s, d) => s + d.stats.removed, 0)

  return {
    type:        'multi_edit_diff',
    files:       fileDiffs,
    file_count:  fileDiffs.length,
    edit_count:  edits.length,
    grand_stats: { added: grandAdded, removed: grandRemoved },
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeRead(filePath) {
  try {
    if (!existsSync(filePath)) return null
    return readFileSync(filePath, 'utf8')
  } catch {
    return null
  }
}

// Build hunks with 3 lines of context either side of each changed block
function buildHunks(diffResult, originalLines) {
  const result   = []
  let lineNum    = 1

  for (const part of diffResult) {
    const lines = splitLines(part.value)

    for (const line of lines) {
      if (part.added) {
        result.push({ type: 'add',     content: line, line_new: lineNum++ })
      } else if (part.removed) {
        result.push({ type: 'remove',  content: line, line_old: lineNum   })
        lineNum++
      } else {
        result.push({ type: 'context', content: line, line_old: lineNum, line_new: lineNum })
        lineNum++
      }
    }
  }

  return result
}

function splitLines(str) {
  const lines = str.split('\n')
  // diffLines adds trailing empty string when value ends with \n — remove it
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

function countStats(hunks) {
  let added = 0, removed = 0
  for (const h of hunks) {
    if (h.type === 'add')    added++
    if (h.type === 'remove') removed++
  }
  return { added, removed }
}

function detectLanguage(filePath) {
  const ext = filePath.split('.').pop()?.toLowerCase()
  const map = {
    ts: 'typescript', tsx: 'typescript',
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    kt: 'kotlin',
    swift: 'swift',
    cs: 'csharp',
    cpp: 'cpp', cc: 'cpp', cxx: 'cpp', c: 'c', h: 'c',
    sh: 'bash', bash: 'bash', zsh: 'bash',
    json: 'json',
    yaml: 'yaml', yml: 'yaml',
    toml: 'toml',
    md: 'markdown',
    html: 'html', htm: 'html',
    css: 'css', scss: 'css', sass: 'css',
    sql: 'sql',
    env: 'dotenv',
    dockerfile: 'dockerfile',
    tf: 'terraform',
  }
  return map[ext] || 'plaintext'
}
