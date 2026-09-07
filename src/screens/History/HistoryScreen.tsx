import React, { useState, useMemo } from 'react'
import {
  View, Text, FlatList, StyleSheet, RefreshControl,
  StatusBar, TouchableOpacity, ScrollView,
} from 'react-native'
import { formatDistanceToNow } from 'date-fns'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Ionicons from 'react-native-vector-icons/Ionicons'
import { useHistory } from '../../hooks/useRequests'
import { GradientBackground } from '../../components/GradientBackground'
import { Colors, Spacing, Radius, FontSize, FontFamily, Shadow, TAB_BOTTOM_INSET } from '../../constants/colors'
import type { PendingRequest } from '../../types'

type StatusFilter = 'all' | 'approved' | 'denied'
type ToolFilter   = 'all' | 'bash' | 'file-edit'

const STATUS_CONFIG: Record<string, { color: string; label: string; icon: string }> = {
  approved:    { color: Colors.successDark, label: 'Approved', icon: 'checkmark-circle'   },
  denied:      { color: Colors.danger,      label: 'Denied',   icon: 'close-circle'        },
  timeout:     { color: Colors.warning,     label: 'Timeout',  icon: 'time-outline'        },
  cli_pending: { color: Colors.textTertiary,label: 'CLI',      icon: 'terminal-outline'   },
  pending:     { color: Colors.info,        label: 'Pending',  icon: 'ellipsis-horizontal' },
}

// ── Filter chip ───────────────────────────────────────────────────────────────
function FilterChip({
  label, active, onPress, count,
}: {
  label:   string
  active:  boolean
  onPress: () => void
  count?:  number
}) {
  return (
    <TouchableOpacity
      style={[styles.chip, active && styles.chipActive]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
      {count !== undefined && count > 0 && (
        <View style={[styles.chipCount, active && styles.chipCountActive]}>
          <Text style={[styles.chipCountText, active && styles.chipCountTextActive]}>
            {count}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  )
}

// ── Dense history row ─────────────────────────────────────────────────────────
function HistoryRow({ item }: { item: PendingRequest }) {
  const cfg = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.pending
  const timeAgo = formatDistanceToNow(
    new Date(item.decided_at ?? item.created_at),
    { addSuffix: true }
  )

  return (
    <View style={styles.row}>
      <View style={[styles.iconBox, { backgroundColor: cfg.color + '18' }]}>
        <Ionicons name={cfg.icon} size={16} color={cfg.color} />
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.rowTool}>{item.tool_name}</Text>
          <Text style={[styles.rowStatus, { color: cfg.color }]}>{cfg.label}</Text>
        </View>
        <Text style={styles.rowSummary} numberOfLines={1}>{item.summary}</Text>
        <View style={styles.rowBottom}>
          <Text style={styles.rowMachine}>{item.machines?.label ?? 'Unknown'}</Text>
          <Text style={styles.rowTime}>{timeAgo}</Text>
        </View>
      </View>
    </View>
  )
}

// ── Screen ────────────────────────────────────────────────────────────────────
export function HistoryScreen() {
  const insets = useSafeAreaInsets()
  const { data: history = [], isRefetching, refetch } = useHistory()
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [toolFilter,   setToolFilter]   = useState<ToolFilter>('all')

  const displayed = useMemo(() => {
    return history.filter(item => {
      const statusOk =
        statusFilter === 'all' ||
        item.status === statusFilter
      const toolOk =
        toolFilter === 'all' ? true :
        toolFilter === 'bash' ? item.tool_name === 'Bash' :
        ['Edit', 'Write', 'MultiEdit'].includes(item.tool_name)
      return statusOk && toolOk
    })
  }, [history, statusFilter, toolFilter])

  const approvedCount = history.filter(r => r.status === 'approved').length
  const deniedCount   = history.filter(r => r.status === 'denied').length
  const bashCount     = history.filter(r => r.tool_name === 'Bash').length
  const fileEditCount = history.filter(r => ['Edit', 'Write', 'MultiEdit'].includes(r.tool_name)).length

  return (
    <GradientBackground>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />

      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View>
          <Text style={styles.appName}>Vibe Remote</Text>
          <Text style={styles.title}>History</Text>
        </View>
      </View>

      {/* Filter chips */}
      <View style={styles.filtersWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
        >
          <FilterChip
            label="All"
            active={statusFilter === 'all' && toolFilter === 'all'}
            onPress={() => { setStatusFilter('all'); setToolFilter('all') }}
          />
          <FilterChip
            label="Approved"
            count={approvedCount}
            active={statusFilter === 'approved'}
            onPress={() => { setStatusFilter('approved'); setToolFilter('all') }}
          />
          <FilterChip
            label="Denied"
            count={deniedCount}
            active={statusFilter === 'denied'}
            onPress={() => { setStatusFilter('denied'); setToolFilter('all') }}
          />
          <View style={styles.chipDivider} />
          <FilterChip
            label="Bash"
            count={bashCount}
            active={toolFilter === 'bash'}
            onPress={() => { setStatusFilter('all'); setToolFilter('bash') }}
          />
          <FilterChip
            label="File Edit"
            count={fileEditCount}
            active={toolFilter === 'file-edit'}
            onPress={() => { setStatusFilter('all'); setToolFilter('file-edit') }}
          />
        </ScrollView>
      </View>

      <FlatList
        data={displayed}
        keyExtractor={item => item.id}
        renderItem={({ item }) => <HistoryRow item={item} />}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={Colors.accent}
            colors={[Colors.accent]}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>
              {statusFilter === 'all' && toolFilter === 'all'
                ? 'No history\nyet.'
                : 'No matches\nin history.'}
            </Text>
            <Text style={styles.emptySub}>
              {statusFilter === 'all' && toolFilter === 'all'
                ? 'Decided requests will appear here.'
                : 'Try a different filter.'}
            </Text>
          </View>
        }
      />
    </GradientBackground>
  )
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: Spacing.px20,
    paddingBottom:     Spacing.px12,
  },
  appName: {
    fontSize:   28,
    fontFamily: FontFamily.serifItalic,
    color:      Colors.textPrimary,
    lineHeight: 32,
  },
  title: {
    fontSize:      FontSize.cardTitle,
    fontFamily:    FontFamily.sans,
    fontWeight:    '500',
    color:         Colors.textTertiary,
    letterSpacing: 0.3,
  },

  filtersWrap: {
    paddingBottom: Spacing.px8,
  },
  filters: {
    flexDirection:   'row',
    paddingHorizontal: Spacing.px20,
    paddingVertical: Spacing.px8,
    gap:             Spacing.px4,
    alignItems:      'center',
  },
  chip: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               5,
    paddingHorizontal: Spacing.px12,
    paddingVertical:   7,
    borderRadius:      Radius.full,
    backgroundColor:   Colors.surfaceGlassStrong,
    borderWidth:       1,
    borderColor:       Colors.borderHairline,
    borderTopColor:    Colors.borderGlass,
  },
  chipActive: {
    backgroundColor: Colors.accentDeep,
    borderColor:     Colors.accentDeep,
  },
  chipText: {
    fontSize:   FontSize.label,
    fontWeight: '500',
    color:      Colors.textSecondary,
  },
  chipTextActive: {
    color: Colors.textInverse,
  },
  chipCount: {
    backgroundColor:   Colors.creamDeep,
    borderRadius:      Radius.full,
    minWidth:          16,
    height:            16,
    alignItems:        'center',
    justifyContent:    'center',
    paddingHorizontal: 3,
  },
  chipCountActive: {
    backgroundColor: 'rgba(255,255,255,0.20)',
  },
  chipCountText: {
    fontSize:   9,
    fontWeight: '700',
    color:      Colors.textSecondary,
  },
  chipCountTextActive: {
    color: Colors.textInverse,
  },
  chipDivider: {
    width:           1,
    height:          20,
    backgroundColor: Colors.border,
    marginHorizontal: 2,
  },

  listContent: {
    paddingBottom: TAB_BOTTOM_INSET,
  },
  row: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               Spacing.px12,
    paddingHorizontal: Spacing.px20,
    paddingVertical:   Spacing.px12,
    borderBottomWidth: 1,
    borderColor:       Colors.borderHairline,
  },
  iconBox: {
    width:          36,
    height:         36,
    borderRadius:   Radius.md,
    alignItems:     'center',
    justifyContent: 'center',
    flexShrink:     0,
  },
  rowBody: { flex: 1, gap: 2 },
  rowTop: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
  },
  rowTool: {
    fontSize:   FontSize.label,
    fontWeight: '600',
    color:      Colors.textPrimary,
    fontStyle:  'italic',
  },
  rowStatus: {
    fontSize:   FontSize.metadata,
    fontWeight: '600',
  },
  rowSummary: {
    fontSize:  FontSize.metadata,
    color:     Colors.textSecondary,
    lineHeight: 18,
  },
  rowBottom: {
    flexDirection:  'row',
    justifyContent: 'space-between',
  },
  rowMachine: { fontSize: FontSize.metadata, color: Colors.textTertiary },
  rowTime:    { fontSize: FontSize.metadata, color: Colors.textTertiary },

  empty: {
    alignItems:        'center',
    paddingHorizontal: Spacing.px32,
    paddingTop:        Spacing.px40,
    gap:               Spacing.px8,
  },
  emptyTitle: {
    fontSize:      FontSize.displayM,
    fontWeight:    '500',
    fontFamily:    'Fraunces-SemiBold',
    color:         Colors.textPrimary,
    textAlign:     'center',
    letterSpacing: -0.4,
    lineHeight:    FontSize.displayM * 1.1,
  },
  emptySub: {
    fontSize:   FontSize.body,
    color:      Colors.textSecondary,
    textAlign:  'center',
    lineHeight: 22,
  },
})
