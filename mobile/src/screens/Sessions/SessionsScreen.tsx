import React from 'react'
import {
  View, Text, FlatList, StyleSheet,
  RefreshControl, TouchableOpacity, StatusBar,
} from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { formatDistanceToNow } from 'date-fns'
import Ionicons from 'react-native-vector-icons/Ionicons'
import { useSessions } from '../../hooks/useSessions'
import { GradientBackground } from '../../components/GradientBackground'
import { LiveBadge } from '../../components/LiveBadge'
import { HarnessBadge } from '../../components/HarnessBadge'
import { Colors, Spacing, Radius, FontSize, FontFamily, Shadow, TAB_BOTTOM_INSET } from '../../constants/colors'
import type { SessionsStackParamList, AgentSession, HarnessId } from '../../types'

function dirName(cwd: string | null): string {
  if (!cwd) return '~'
  return cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd
}

type Nav = NativeStackNavigationProp<SessionsStackParamList>

const STATUS_COLOR: Record<string, string> = {
  active:   Colors.success,
  idle:     Colors.warning,
  finished: Colors.textTertiary,
}



// ── Chat card — one session = one WhatsApp-style chat entry ──────────────────
function SessionCard({ session, onOpen }: {
  session: AgentSession
  onOpen:  () => void
}) {
  const cliClosed = session.cli_alive === false && session.status !== 'active'
  const dotColor  = cliClosed ? Colors.textTertiary : (STATUS_COLOR[session.status] ?? Colors.textTertiary)
  const isActive  = session.status === 'active'
  const hasPending = session.pending_count > 0
  const dir       = dirName(session.cwd)
  const timeAgo   = session.last_activity_at
    ? formatDistanceToNow(new Date(session.last_activity_at), { addSuffix: true })
    : ''

  return (
    <TouchableOpacity style={styles.card} onPress={onOpen} activeOpacity={0.75}>
      {/* Avatar — directory initial + status ring */}
      <View style={[styles.avatar, { borderColor: dotColor + '60' }]}>
        <Text style={styles.avatarText}>{dir.charAt(0).toUpperCase()}</Text>
        {isActive && <View style={[styles.avatarDot, { backgroundColor: Colors.success }]} />}
      </View>

      {/* Content */}
      <View style={styles.cardBody}>
        <View style={styles.cardTopRow}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle} numberOfLines={1}>{dir}</Text>
            <HarnessBadge harness={(session.harness ?? 'claude-code') as HarnessId} size="xs" />
          </View>
          <Text style={styles.timeText}>{timeAgo}</Text>
        </View>

        <View style={styles.cardBottomRow}>
          <View style={styles.cardMeta}>
            <View style={[styles.statusDot, { backgroundColor: dotColor }]} />
            <Text style={[styles.statusLabel, { color: dotColor }]}>
              {cliClosed ? 'Closed' : isActive ? 'Active' : session.status === 'idle' ? 'Idle' : 'Finished'}
            </Text>
            <Text style={styles.metaSep}>·</Text>
            <Text style={styles.machineText} numberOfLines={1}>{session.machine_label}</Text>
          </View>
          {hasPending && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{session.pending_count}</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  )
}

// ── Screen ────────────────────────────────────────────────────────────────────
export function SessionsScreen() {
  const navigation  = useNavigation<Nav>()
  const insets      = useSafeAreaInsets()
  const { data: sessions = [], isLoading, refetch, isRefetching } = useSessions()
  const activeCount = sessions.filter(s => s.status === 'active').length

  function renderItem({ item }: { item: AgentSession }) {
    return (
      <SessionCard
        session={item}
        onOpen={() => navigation.navigate('Chat', {
          sessionId:       item.session_id,
          machineLabel:    item.machine_label,
          cwd:             item.cwd,
          machineIsOnline: item.machine_is_online,
          harness:         (item.harness ?? 'claude-code') as any,
          status:          item.status,
        })}
      />
    )
  }

  return (
    <GradientBackground>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />

      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View>
          <Text style={styles.appName}>Vibe Remote</Text>
          <Text style={styles.title}>Chats</Text>
        </View>
        <LiveBadge />
      </View>

      <FlatList
        data={sessions}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        contentContainerStyle={
          sessions.length === 0 ? styles.emptyContainer : styles.listContent
        }
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={Colors.accent}
            colors={[Colors.accent]}
          />
        }
        ListEmptyComponent={
          isLoading ? null : (
            <View style={styles.empty}>
              <View style={styles.emptyIconWrap}>
                <Ionicons name="flash-outline" size={48} color={Colors.accentDeep} />
              </View>
              <Text style={styles.emptyTitle}>{'No sessions\nrunning.'}</Text>
              <Text style={styles.emptySub}>
                Sessions appear once an agent intercepts a tool call.
                Enable mobile support from the desktop app.
              </Text>
            </View>
          )
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
    paddingBottom:     Spacing.px16,
  },
  appName: {
    fontSize:   28,
    fontFamily: FontFamily.serifItalic,
    color:      Colors.textPrimary,
    lineHeight: 32,
  },
  title: {
    fontSize:      FontSize.cardTitle,
    fontFamily:    FontFamily.loraItalic,
    fontWeight:    '500',
    color:         Colors.textTertiary,
    letterSpacing: 0.3,
  },
  listContent: {
    paddingBottom: TAB_BOTTOM_INSET,
  },

  // Card
  // Chat card (WhatsApp-style list item)
  card: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               Spacing.px12,
    paddingVertical:   Spacing.px12,
    paddingHorizontal: Spacing.px20,
    backgroundColor:   Colors.bgPrimary,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderHairline,
  },
  avatar: {
    width:          48,
    height:         48,
    borderRadius:   Radius.full,
    backgroundColor: Colors.accentLight,
    alignItems:     'center',
    justifyContent: 'center',
    borderWidth:    2,
    flexShrink:     0,
    position:       'relative',
  },
  avatarText: {
    fontSize:   FontSize.cardTitle,
    fontWeight: '700',
    color:      Colors.accentDeep,
    fontFamily: FontFamily.serifBold,
  },
  avatarDot: {
    position:     'absolute',
    bottom:       1,
    right:        1,
    width:        12,
    height:       12,
    borderRadius: Radius.full,
    borderWidth:  2,
    borderColor:  Colors.bgPrimary,
  },
  cardBody: { flex: 1, gap: 4 },
  cardTopRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    gap:            Spacing.px8,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           Spacing.px8,
    flex:          1,
  },
  cardTitle: {
    fontSize:   FontSize.cardTitle,
    fontWeight: '600',
    color:      Colors.textPrimary,
    flexShrink: 1,
  },
  timeText: {
    fontSize:  FontSize.metadata,
    color:     Colors.textTertiary,
    flexShrink: 0,
  },
  cardBottomRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    gap:            Spacing.px8,
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           5,
    flex:          1,
  },
  statusDot: { width: 6, height: 6, borderRadius: Radius.full },
  statusLabel: { fontSize: FontSize.metadata, fontWeight: '500' },
  metaSep: { fontSize: FontSize.metadata, color: Colors.textTertiary },
  machineText: {
    fontSize:  FontSize.metadata,
    color:     Colors.textTertiary,
    flex:      1,
  },
  badge: {
    backgroundColor:   Colors.danger,
    borderRadius:      Radius.full,
    minWidth:          20,
    height:            20,
    alignItems:        'center',
    justifyContent:    'center',
    paddingHorizontal: 4,
    flexShrink:        0,
  },
  badgeText: { fontSize: 10, fontWeight: '700', color: Colors.white },

  // Empty
  emptyContainer: { flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
  empty: {
    alignItems:        'center',
    paddingHorizontal: Spacing.px32,
    gap:               Spacing.px12,
  },
  emptyIconWrap: {
    width:           80,
    height:          80,
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
    maxWidth:   280,
  },
  code: {
    fontSize: FontSize.monoSmall,
    color:    Colors.accent,
  },
})
