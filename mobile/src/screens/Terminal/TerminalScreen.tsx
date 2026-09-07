import React, { useState, useEffect, useRef, useMemo } from 'react'
import {
  View, Text, FlatList, StyleSheet, ScrollView,
  StatusBar, TouchableOpacity, Animated,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Ionicons from 'react-native-vector-icons/Ionicons'
import { formatDistanceToNow } from 'date-fns'
import { useSessions } from '../../hooks/useSessions'
import { useTerminalEvents } from '../../hooks/useTerminal'
import { GradientBackground } from '../../components/GradientBackground'
import { Colors, Spacing, FontSize, Radius, FontFamily, TAB_BOTTOM_INSET } from '../../constants/colors'
import { SPINNER_WORDS } from './spinnerWords'
import type { TerminalEvent } from '../../types'

const TOOL_ICONS: Record<string, string> = {
  Bash:      'terminal-outline',
  Write:     'document-outline',
  Edit:      'create-outline',
  MultiEdit: 'documents-outline',
  Read:      'eye-outline',
}

// ── Thinking row ──────────────────────────────────────────────────────────────
function ThinkingRow({ isPendingApproval }: { isPendingApproval: boolean }) {
  const [wordIdx, setWordIdx] = useState(() => Math.floor(Math.random() * SPINNER_WORDS.length))
  const opacity = useRef(new Animated.Value(0.4)).current

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1,   duration: 500, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 500, useNativeDriver: true }),
      ])
    )
    pulse.start()

    const interval = setInterval(() => {
      setWordIdx(i => (i + 1) % SPINNER_WORDS.length)
    }, 2000)

    return () => { pulse.stop(); clearInterval(interval) }
  }, [])

  const label = isPendingApproval
    ? 'Waiting for approval...'
    : SPINNER_WORDS[wordIdx] + '...'

  const dotColor = isPendingApproval ? Colors.warning : Colors.accent

  return (
    <View style={styles.thinkingRow}>
      <Animated.View style={[styles.thinkingDot, { backgroundColor: dotColor, opacity }]} />
      <Text style={[styles.thinkingText, isPendingApproval && { color: Colors.warning }]}>
        {label}
      </Text>
    </View>
  )
}

// ── Tool event row ─────────────────────────────────────────────────────────────
function ToolRow({ item }: { item: TerminalEvent }) {
  const palette = Colors.tool[(item.tool_name as keyof typeof Colors.tool) ?? 'unknown'] ?? Colors.tool.unknown
  const iconName = TOOL_ICONS[item.tool_name ?? ''] ?? 'cube-outline'
  const isPending = item.event_type === 'tool_start'
  const isError   = item.status === 'error'

  return (
    <View style={styles.row}>
      <View style={[styles.iconBox, { backgroundColor: palette.bg }]}>
        <Ionicons name={iconName} size={14} color={palette.text} />
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={[styles.toolName, { color: palette.text }]}>{item.tool_name}</Text>
          <View style={[
            styles.badge,
            isPending ? styles.badgePending : isError ? styles.badgeError : styles.badgeSuccess,
          ]}>
            <Text style={styles.badgeText}>
              {isPending ? 'pending' : isError ? 'error' : 'done'}
            </Text>
          </View>
        </View>

        <Text style={styles.summary} numberOfLines={2}>{item.summary}</Text>

        {!!item.detail && (
          <Text style={styles.detail} numberOfLines={3}>{item.detail}</Text>
        )}

        <Text style={styles.timeAgo}>
          {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
        </Text>
      </View>
    </View>
  )
}

// ── Notification row ───────────────────────────────────────────────────────────
function NotificationRow({ item }: { item: TerminalEvent }) {
  return (
    <View style={styles.notifyRow}>
      <Ionicons name="chatbubble-ellipses-outline" size={14} color={Colors.textTertiary} style={styles.notifyIcon} />
      <View style={styles.rowBody}>
        <Text style={styles.notifyText}>{item.summary}</Text>
        <Text style={styles.timeAgo}>
          {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
        </Text>
      </View>
    </View>
  )
}

// ── Stop row ───────────────────────────────────────────────────────────────────
function StopRow({ item }: { item: TerminalEvent }) {
  return (
    <View style={styles.stopRow}>
      <View style={styles.stopIconBox}>
        <Ionicons name="checkmark-done-circle" size={18} color={Colors.successDark} />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.stopTitle}>Task finished</Text>
        {!!item.summary && item.summary !== 'Task finished' && (
          <Text style={styles.stopSummary} numberOfLines={4}>{item.summary}</Text>
        )}
        <Text style={styles.timeAgo}>
          {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
        </Text>
      </View>
    </View>
  )
}

// ── PTY output row ─────────────────────────────────────────────────────────────
function OutputRow({ item }: { item: TerminalEvent }) {
  return (
    <View style={styles.outputRow}>
      <Text style={styles.outputText} selectable>{item.summary}</Text>
    </View>
  )
}

// ── Event dispatcher ───────────────────────────────────────────────────────────
function EventRow({ item }: { item: TerminalEvent }) {
  if (item.event_type === 'notification') return <NotificationRow item={item} />
  if (item.event_type === 'stop')         return <StopRow item={item} />
  if (item.event_type === 'output')       return <OutputRow item={item} />
  return <ToolRow item={item} />
}

// ── Screen ─────────────────────────────────────────────────────────────────────
export function TerminalScreen() {
  const insets  = useSafeAreaInsets()
  const { data: sessions = [] } = useSessions()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const selectedSession = useMemo(() => {
    if (selectedId) return sessions.find(s => s.session_id === selectedId) ?? null
    return (
      sessions.find(s => s.status === 'active') ??
      sessions.find(s => s.status === 'idle')   ??
      sessions[0]                               ??
      null
    )
  }, [sessions, selectedId])

  const { data: events = [] } = useTerminalEvents(selectedSession?.session_id ?? undefined)

  const isPendingApproval = (selectedSession?.pending_count ?? 0) > 0
  const lastEvent         = events[events.length - 1]
  const isThinking        = selectedSession?.status === 'active'
    && !isPendingApproval
    && lastEvent?.event_type !== 'stop'

  const showThinking = isThinking || isPendingApproval

  return (
    <GradientBackground>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View>
          <Text style={styles.appName}>Vibe Remote</Text>
          <Text style={styles.title}>Terminal</Text>
        </View>
        <View style={styles.liveIndicator}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>live</Text>
        </View>
      </View>

      {/* Session picker — always rendered to keep header position stable */}
      <View style={styles.sessionPickerWrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.sessionPicker}
      >
        {sessions.length > 0 ? sessions.map(session => {
          const active = selectedSession?.session_id === session.session_id
          const isLive = session.status === 'active'
          return (
            <TouchableOpacity
              key={session.session_id}
              style={[styles.sessionChip, active && styles.sessionChipActive]}
              onPress={() => setSelectedId(session.session_id)}
              activeOpacity={0.7}
            >
              {isLive && <View style={[styles.sessionLiveDot, active && styles.sessionLiveDotActive]} />}
              <Text style={[styles.sessionChipText, active && styles.sessionChipTextActive]} numberOfLines={1}>
                {session.machine_label}
              </Text>
              {session.pending_count > 0 && (
                <View style={styles.sessionBadge}>
                  <Text style={styles.sessionBadgeText}>{session.pending_count}</Text>
                </View>
              )}
            </TouchableOpacity>
          )
        }) : (
          <Text style={styles.noSessionText}>No active sessions</Text>
        )}
      </ScrollView>
      </View>

      {/* Session banner — always rendered to keep layout stable */}
      <View style={styles.banner}>
        <View style={[
          styles.bannerDot,
          { backgroundColor: selectedSession?.status === 'active' ? Colors.success : Colors.textTertiary },
        ]} />
        <Text style={styles.bannerText} numberOfLines={1}>
          {selectedSession?.cwd ?? selectedSession?.machine_label ?? '—'}
        </Text>
        {selectedSession && (
          <Text style={[styles.bannerStatus, {
            color: selectedSession.status === 'active' ? Colors.success : Colors.textTertiary,
          }]}>
            {selectedSession.status}
          </Text>
        )}
      </View>

      {/* Event list */}
      <FlatList
        style={styles.list}
        data={events}
        keyExtractor={item => item.id}
        renderItem={({ item }) => <EventRow item={item} />}
        contentContainerStyle={events.length === 0 ? styles.emptyContainer : styles.listContent}
        ListFooterComponent={showThinking
          ? <ThinkingRow isPendingApproval={isPendingApproval} />
          : null
        }
        ListEmptyComponent={
          !showThinking ? (
            <View style={styles.empty}>
              <View style={styles.emptyIconWrap}>
                <Ionicons name="terminal-outline" size={40} color={Colors.accentDeep} />
              </View>
              <Text style={styles.emptyTitle}>
                {sessions.length === 0
                  ? 'No sessions\nyet.'
                  : 'No activity\nyet.'}
              </Text>
              <Text style={styles.emptySub}>
                {sessions.length === 0
                  ? 'Start Claude Code on your desktop to see activity here.'
                  : 'Claude Code activity will appear here as it works.'}
              </Text>
            </View>
          ) : null
        }
      />
    </GradientBackground>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    paddingHorizontal: Spacing.px20,
    paddingBottom:     Spacing.px12,
    flexShrink:        0,
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
  liveIndicator: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               4,
    backgroundColor:   Colors.surfaceGlassStrong,
    borderRadius:      Radius.full,
    paddingHorizontal: Spacing.px8,
    paddingVertical:   4,
    borderWidth:       1,
    borderColor:       Colors.borderHairline,
  },
  liveDot: {
    width:           6,
    height:          6,
    borderRadius:    Radius.full,
    backgroundColor: Colors.accent,
  },
  liveText: {
    fontSize:  FontSize.microLabel,
    color:     Colors.textSecondary,
    fontStyle: 'italic',
  },

  // Session picker
  sessionPickerWrap: {
    minHeight:  48,
    flexShrink: 0,
  },
  sessionPicker: {
    flexDirection:     'row',
    paddingHorizontal: Spacing.px20,
    paddingTop:        Spacing.px4,
    paddingBottom:     Spacing.px8,
    gap:               Spacing.px8,
    alignItems:        'center',
  },
  noSessionText: {
    fontSize:  FontSize.label,
    color:     Colors.textTertiary,
    fontStyle: 'italic',
  },
  sessionChip: {
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
    maxWidth:          180,
  },
  sessionChipActive: {
    backgroundColor: Colors.accentDeep,
    borderColor:     Colors.accentDeep,
  },
  sessionLiveDot: {
    width:           5,
    height:          5,
    borderRadius:    Radius.full,
    backgroundColor: Colors.success,
  },
  sessionLiveDotActive: {
    backgroundColor: Colors.white,
  },
  sessionChipText: {
    fontSize:   FontSize.label,
    fontWeight: '500',
    color:      Colors.textSecondary,
    flexShrink: 1,
  },
  sessionChipTextActive: {
    color: Colors.white,
  },
  sessionBadge: {
    backgroundColor:   Colors.danger,
    borderRadius:      Radius.full,
    minWidth:          16,
    height:            16,
    alignItems:        'center',
    justifyContent:    'center',
    paddingHorizontal: 3,
  },
  sessionBadgeText: {
    fontSize:   9,
    fontWeight: '700',
    color:      Colors.white,
  },

  // Banner
  banner: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               Spacing.px8,
    paddingHorizontal: Spacing.px20,
    paddingBottom:     Spacing.px8,
    minHeight:         24,
    flexShrink:        0,
  },
  bannerDot: {
    width:        6,
    height:       6,
    borderRadius: Radius.full,
    flexShrink:   0,
  },
  bannerText: {
    flex:       1,
    fontSize:   FontSize.metadata,
    fontFamily: FontFamily.mono,
    color:      Colors.textTertiary,
  },
  bannerStatus: {
    fontSize:   FontSize.metadata,
    fontWeight: '500',
  },

  // Thinking
  thinkingRow: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               Spacing.px8,
    paddingHorizontal: Spacing.px20,
    paddingVertical:   Spacing.px12,
  },
  thinkingDot: {
    width:        8,
    height:       8,
    borderRadius: Radius.full,
  },
  thinkingText: {
    fontSize:   FontSize.label,
    fontStyle:  'italic',
    color:      Colors.textSecondary,
  },

  // Event rows
  row: {
    flexDirection:     'row',
    alignItems:        'flex-start',
    gap:               Spacing.px12,
    paddingHorizontal: Spacing.px20,
    paddingVertical:   Spacing.px12,
    borderBottomWidth: 1,
    borderColor:       Colors.borderHairline,
  },
  iconBox: {
    width:          30,
    height:         30,
    borderRadius:   Radius.xs,
    alignItems:     'center',
    justifyContent: 'center',
    flexShrink:     0,
    marginTop:      1,
  },
  rowBody: {
    flex: 1,
    gap:  3,
  },
  rowTop: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    gap:            Spacing.px8,
  },
  toolName: {
    fontSize:   FontSize.label,
    fontWeight: '600',
    fontStyle:  'italic',
  },
  badge: {
    borderRadius:      Radius.full,
    paddingHorizontal: 6,
    paddingVertical:   2,
  },
  badgePending: {
    backgroundColor: Colors.creamDeep,
  },
  badgeSuccess: {
    backgroundColor: Colors.risk.low.bg,
  },
  badgeError: {
    backgroundColor: Colors.dangerLight,
  },
  badgeText: {
    fontSize:   9,
    fontWeight: '700',
    color:      Colors.textSecondary,
  },
  summary: {
    fontSize:  FontSize.metadata,
    color:     Colors.textSecondary,
    lineHeight: 18,
  },
  detail: {
    fontSize:   FontSize.monoSmall,
    fontFamily: FontFamily.mono,
    color:      Colors.textTertiary,
    lineHeight: 17,
    backgroundColor: Colors.creamDeep,
    borderRadius:    Radius.xs,
    paddingHorizontal: 6,
    paddingVertical:   4,
    marginTop:  2,
  },
  timeAgo: {
    fontSize: FontSize.metadata,
    color:    Colors.textTertiary,
    marginTop: 2,
  },

  // Notification row
  notifyRow: {
    flexDirection:     'row',
    alignItems:        'flex-start',
    gap:               Spacing.px8,
    paddingHorizontal: Spacing.px20,
    paddingVertical:   Spacing.px8,
    borderBottomWidth: 1,
    borderColor:       Colors.borderHairline,
  },
  notifyIcon: {
    marginTop: 2,
  },
  notifyText: {
    fontSize:  FontSize.metadata,
    color:     Colors.textTertiary,
    fontStyle: 'italic',
    lineHeight: 18,
    flex:      1,
  },

  // Output row (PTY capture)
  outputRow: {
    paddingHorizontal: Spacing.px20,
    paddingVertical:   Spacing.px4,
    borderLeftWidth:   2,
    borderLeftColor:   Colors.borderHairline,
    marginLeft:        Spacing.px20,
  },
  outputText: {
    fontFamily: FontFamily.mono,
    fontSize:   FontSize.monoSmall,
    color:      Colors.textTertiary,
    lineHeight: 17,
  },

  // Stop row
  stopRow: {
    flexDirection:     'row',
    alignItems:        'flex-start',
    gap:               Spacing.px12,
    paddingHorizontal: Spacing.px20,
    paddingVertical:   Spacing.px12,
    borderBottomWidth: 1,
    borderColor:       Colors.borderHairline,
    backgroundColor:   Colors.risk.low.whisper,
  },
  stopIconBox: {
    marginTop: 1,
    flexShrink: 0,
  },
  stopTitle: {
    fontSize:   FontSize.label,
    fontWeight: '600',
    color:      Colors.successDark,
  },
  stopSummary: {
    fontSize:  FontSize.metadata,
    color:     Colors.textSecondary,
    lineHeight: 18,
    marginTop:  2,
  },

  // List
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: TAB_BOTTOM_INSET,
  },

  // Empty
  emptyContainer: {
    flexGrow:       1,
    justifyContent: 'center',
    alignItems:     'center',
  },
  empty: {
    alignItems:        'center',
    paddingHorizontal: Spacing.px32,
    paddingVertical:   Spacing.px32,
    gap:               Spacing.px12,
  },
  emptyIconWrap: {
    width:           72,
    height:          72,
    borderRadius:    Radius.full,
    backgroundColor: Colors.accentLight,
    alignItems:      'center',
    justifyContent:  'center',
    marginBottom:    Spacing.px8,
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
    maxWidth:   260,
  },
})
