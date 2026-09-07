import React, { useState, useMemo } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
} from 'react-native'
import Ionicons from 'react-native-vector-icons/Ionicons'
import { Colors, Spacing, Radius, FontSize, FontFamily } from '../../constants/colors'
import type { FileDiff, DiffHunk } from '../../types'

interface Props {
  diff: FileDiff
}

// ── GitHub-dark palette ───────────────────────────────────────────────────────
const G = {
  surface:  '#0d1117',
  header:   '#161b22',
  border:   '#30363d',
  lineNum:  '#6e7681',

  add: {
    bg:     'rgba(46,160,67,0.15)',
    numBg:  'rgba(46,160,67,0.08)',
    border: '#3fb950',
    text:   '#aff5b4',
    pfx:    '#3fb950',
  },
  del: {
    bg:     'rgba(248,81,73,0.15)',
    numBg:  'rgba(248,81,73,0.08)',
    border: '#f85149',
    text:   '#ffdcd7',
    pfx:    '#f85149',
  },
  ctx: {
    bg:     'transparent',
    numBg:  'transparent',
    border: 'transparent',
    text:   '#c9d1d9',
    pfx:    '#6e7681',
  },
  hunk: {
    bg:   'rgba(121,192,255,0.08)',
    text: '#79c0ff',
  },
}

const FONT = FontFamily.mono
const FS   = 12
const LH   = 20
const NW   = 40   // line number column width

// ── Pre-process hunks into display items ──────────────────────────────────────
type DisplayItem =
  | { kind: 'header'; oldStart: number; newStart: number }
  | { kind: 'line';   hunk: DiffHunk }

function buildItems(hunks: DiffHunk[]): DisplayItem[] {
  const out: DisplayItem[] = []
  for (let i = 0; i < hunks.length; i++) {
    const h    = hunks[i]
    const prev = hunks[i - 1]
    let needHeader = i === 0

    if (!needHeader && prev) {
      const prevEnd   = prev.type !== 'remove' ? prev.line_new : prev.line_old
      const currStart = h.type   !== 'remove' ? h.line_new   : h.line_old
      if (prevEnd != null && currStart != null && currStart > prevEnd + 1) needHeader = true
    }

    if (needHeader) {
      out.push({ kind: 'header', oldStart: h.line_old ?? 0, newStart: h.line_new ?? 0 })
    }
    out.push({ kind: 'line', hunk: h })
  }
  return out
}

// ── Hunk header row ───────────────────────────────────────────────────────────
function HunkHeaderRow({ oldStart, newStart }: { oldStart: number; newStart: number }) {
  return (
    <View style={styles.hunkRow}>
      <View style={[styles.numCell, { backgroundColor: G.hunk.bg }]} />
      <View style={[styles.numCell, { backgroundColor: G.hunk.bg }]} />
      <View style={[styles.pfxCell, { backgroundColor: G.hunk.bg, borderLeftColor: 'transparent' }]} />
      <Text style={styles.hunkText}>
        {`@@ -${oldStart} +${newStart} @@`}
      </Text>
    </View>
  )
}

// ── Single diff line ──────────────────────────────────────────────────────────
function DiffLine({ hunk }: { hunk: DiffHunk }) {
  const cfg    = hunk.type === 'add' ? G.add : hunk.type === 'remove' ? G.del : G.ctx
  const prefix = hunk.type === 'add' ? '+' : hunk.type === 'remove' ? '-' : ' '
  const oldNum = hunk.type !== 'add'    ? String(hunk.line_old ?? '') : ''
  const newNum = hunk.type !== 'remove' ? String(hunk.line_new ?? '') : ''

  return (
    <View style={[styles.lineRow, { backgroundColor: cfg.bg }]}>
      <View style={[styles.numCell, { backgroundColor: cfg.numBg }]}>
        <Text style={styles.numText}>{oldNum}</Text>
      </View>
      <View style={[styles.numCell, { backgroundColor: cfg.numBg }]}>
        <Text style={styles.numText}>{newNum}</Text>
      </View>
      <View style={[styles.pfxCell, { backgroundColor: cfg.numBg, borderLeftColor: cfg.border }]}>
        <Text style={[styles.pfxText, { color: cfg.pfx }]}>{prefix}</Text>
      </View>
      <Text style={[styles.codeText, { color: cfg.text }]} selectable>
        {hunk.content}
      </Text>
    </View>
  )
}

// ── File diff block ───────────────────────────────────────────────────────────
function FileDiffBlock({
  diff,
  showHeader = true,
}: {
  diff:        FileDiff
  showHeader?: boolean
}) {
  const [expanded, setExpanded] = useState(true)
  const stats = diff.stats ?? { added: 0, removed: 0 }
  const items = useMemo(() => buildItems(diff.hunks ?? []), [diff.hunks])

  return (
    <View style={styles.fileBlock}>
      {showHeader && (
        <TouchableOpacity
          style={styles.fileHeader}
          onPress={() => setExpanded(e => !e)}
          activeOpacity={0.8}
        >
          <View style={styles.fileHeaderLeft}>
            <Ionicons name="document-text-outline" size={13} color={G.lineNum} />
            <Text style={styles.filePath} numberOfLines={1}>{diff.file_path}</Text>
            {diff.is_new_file && (
              <View style={styles.newPill}>
                <Text style={styles.newPillText}>NEW</Text>
              </View>
            )}
          </View>
          <View style={styles.fileHeaderRight}>
            <Text style={styles.statAdd}>+{stats.added}</Text>
            <Text style={styles.statDel}>-{stats.removed}</Text>
            <Ionicons
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={14}
              color={G.lineNum}
            />
          </View>
        </TouchableOpacity>
      )}

      {expanded && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ minWidth: '100%' }}>
            {items.map((item, i) =>
              item.kind === 'header'
                ? <HunkHeaderRow key={i} oldStart={item.oldStart} newStart={item.newStart} />
                : <DiffLine      key={i} hunk={item.hunk} />
            )}
            {items.length === 0 && (
              <Text style={styles.emptyText}>No diff available</Text>
            )}
          </View>
        </ScrollView>
      )}
    </View>
  )
}

// ── Grand stats bar (multi-file) ──────────────────────────────────────────────
function GrandStatsBar({ diff }: { diff: FileDiff }) {
  const count = diff.file_count ?? diff.files?.length ?? 0
  const g     = diff.grand_stats ?? { added: 0, removed: 0 }
  return (
    <View style={styles.grandStats}>
      <Text style={styles.grandStatsLabel}>
        {count} file{count !== 1 ? 's' : ''} changed
      </Text>
      <Text style={styles.statAdd}>  +{g.added}</Text>
      <Text style={styles.statDel}>  -{g.removed}</Text>
    </View>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────
export function DiffViewer({ diff }: Props) {
  if (!diff) return null

  if (diff.type === 'multi_edit_diff' && diff.files?.length) {
    return (
      <View style={styles.container}>
        <GrandStatsBar diff={diff} />
        {diff.files.map((f, i) => <FileDiffBlock key={i} diff={f} showHeader />)}
      </View>
    )
  }

  if (diff.type === 'edit_diff' && diff.edits?.length) {
    return (
      <View style={styles.container}>
        {diff.edits.map((e, i) => (
          <FileDiffBlock key={i} diff={e} showHeader={diff.edits!.length > 1} />
        ))}
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <FileDiffBlock diff={diff} showHeader={false} />
    </View>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    borderRadius:    Radius.xs,
    overflow:        'hidden',
    backgroundColor: G.surface,
    borderWidth:     1,
    borderColor:     G.border,
  },

  // Grand stats
  grandStats: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
    backgroundColor:   G.header,
    borderBottomWidth: 1,
    borderColor:       G.border,
  },
  grandStatsLabel: {
    fontFamily: FONT,
    fontSize:   FS,
    color:      G.lineNum,
  },

  // Per-file block
  fileBlock: {
    borderTopWidth: 1,
    borderColor:    G.border,
  },
  fileHeader: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical:   10,
    backgroundColor:   G.header,
  },
  fileHeaderLeft: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           6,
    flex:          1,
  },
  filePath: {
    fontFamily: FONT,
    fontSize:   FS,
    color:      '#e6edf3',
    flex:       1,
  },
  newPill: {
    backgroundColor:   'rgba(63,185,80,0.18)',
    borderRadius:      4,
    paddingHorizontal: 5,
    paddingVertical:   1,
  },
  newPillText: {
    fontFamily: FONT,
    fontSize:   10,
    color:      '#3fb950',
    fontWeight: '700',
  },
  fileHeaderRight: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           8,
  },
  statAdd: {
    fontFamily: FONT,
    fontSize:   FS,
    color:      '#3fb950',
    fontWeight: '600',
  },
  statDel: {
    fontFamily: FONT,
    fontSize:   FS,
    color:      '#f85149',
    fontWeight: '600',
  },

  // Hunk header
  hunkRow: {
    flexDirection: 'row',
    alignItems:    'center',
  },
  hunkText: {
    fontFamily:  FONT,
    fontSize:    FS,
    color:       G.hunk.text,
    lineHeight:  LH,
    flex:        1,
    paddingLeft: 8,
    paddingVertical: 2,
    backgroundColor: G.hunk.bg,
  },

  // Diff lines
  lineRow: {
    flexDirection: 'row',
  },
  numCell: {
    width:          NW,
    paddingRight:   6,
    paddingVertical: 1,
    alignItems:     'flex-end',
    justifyContent: 'center',
  },
  numText: {
    fontFamily: FONT,
    fontSize:   FS - 1,
    color:      G.lineNum,
    lineHeight: LH,
  },
  pfxCell: {
    width:           24,
    alignItems:      'center',
    justifyContent:  'center',
    borderLeftWidth: 3,
    paddingVertical: 1,
  },
  pfxText: {
    fontFamily: FONT,
    fontSize:   FS,
    lineHeight: LH,
    fontWeight: '700',
  },
  codeText: {
    fontFamily:      FONT,
    fontSize:        FS,
    lineHeight:      LH,
    paddingLeft:     8,
    paddingRight:    16,
    paddingVertical: 1,
  },
  emptyText: {
    fontFamily: FONT,
    fontSize:   FS,
    color:      G.lineNum,
    padding:    Spacing.md,
  },
})
