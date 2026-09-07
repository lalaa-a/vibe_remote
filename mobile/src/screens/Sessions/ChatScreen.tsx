import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  TextInput, StatusBar, ActivityIndicator, KeyboardAvoidingView,
  Platform, Alert,
} from 'react-native'
import type { NativeSyntheticEvent, NativeScrollEvent } from 'react-native'
import { useRoute, useNavigation, useFocusEffect } from '@react-navigation/native'
import type { RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { formatDistanceToNow } from 'date-fns'
import Ionicons from 'react-native-vector-icons/Ionicons'
import { useChatFeed } from '../../hooks/useChatFeed'
import type { ChatItem } from '../../hooks/useChatFeed'
import { useDecideRequest } from '../../hooks/useRequests'
import { useSendPrompt, useSessions } from '../../hooks/useSessions'
import { GradientBackground } from '../../components/GradientBackground'
import { RiskBadge } from '../../components/RiskBadge'
import { HarnessBadge } from '../../components/HarnessBadge'
import {
  Colors, Spacing, Radius, FontSize, FontFamily, Shadow, TAB_BOTTOM_INSET,
} from '../../constants/colors'
import type { SessionsStackParamList, PendingRequest, TerminalEvent, MobileCommand } from '../../types'

type Route = RouteProp<SessionsStackParamList, 'Chat'>
type Nav   = NativeStackNavigationProp<SessionsStackParamList>

const TOOL_ICONS: Record<string, string> = {
  Bash: 'terminal-outline', bash: 'terminal-outline',
  Write: 'document-outline', write: 'document-outline',
  Edit: 'create-outline', edit: 'create-outline',
  MultiEdit: 'documents-outline', patch: 'git-merge-outline',
  Read: 'eye-outline', read: 'eye-outline',
}

function dirName(cwd: string | null) {
  if (!cwd) return '~'
  return cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd
}

// ── Agent reasoning bubble (left, like WhatsApp "received") ───────────────────
function OutputBubble({ event }: { event: TerminalEvent }) {
  const [expanded, setExpanded] = useState(true)
  const text = event.summary ?? ''
  const isLong = text.length > 400
  const display = expanded ? text : text.slice(0, 400) + '…'

  return (
    <View style={styles.rowLeft}>
      <View style={styles.agentAvatar}>
        <Ionicons name="sparkles-outline" size={12} color={Colors.accentDeep} />
      </View>
      <View style={styles.bubbleReceived}>
        <Text style={styles.bubbleText} selectable>{display}</Text>
        {isLong && (
          <TouchableOpacity onPress={() => setExpanded(v => !v)} activeOpacity={0.7}>
            <Text style={styles.showMore}>{expanded ? 'Show less ↑' : 'Show more ↓'}</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.bubbleTime}>
          {formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}
        </Text>
      </View>
    </View>
  )
}

// ── User sent-prompt bubble (right, like WhatsApp "sent") ─────────────────────
function SentBubble({ cmd }: { cmd: MobileCommand }) {
  const icon = cmd.status === 'delivered'
    ? 'checkmark-done' : cmd.status === 'pending'
    ? 'time-outline' : 'close-outline'
  const iconColor = cmd.status === 'delivered' ? Colors.success : Colors.textTertiary

  return (
    <View style={styles.rowRight}>
      <View style={styles.bubbleSent}>
        <Text style={styles.bubbleSentText}>{cmd.prompt}</Text>
        <View style={styles.bubbleSentMeta}>
          <Text style={styles.bubbleSentTime}>
            {formatDistanceToNow(new Date(cmd.created_at), { addSuffix: true })}
          </Text>
          <Ionicons name={icon} size={12} color={iconColor} />
        </View>
      </View>
    </View>
  )
}

// ── Notification (centred small text) ────────────────────────────────────────
function NotifyRow({ event }: { event: TerminalEvent }) {
  return (
    <View style={styles.notifyRow}>
      <Text style={styles.notifyText}>{event.summary}</Text>
    </View>
  )
}

// ── Task-complete divider ─────────────────────────────────────────────────────
function StopRow({ event }: { event: TerminalEvent }) {
  return (
    <View style={styles.stopRow}>
      <View style={styles.stopLine} />
      <View style={styles.stopPill}>
        <Ionicons name="checkmark-done-circle" size={13} color={Colors.successDark} />
        <Text style={styles.stopText}>Task complete</Text>
        <Text style={styles.stopTime}>
          {formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}
        </Text>
      </View>
      <View style={styles.stopLine} />
    </View>
  )
}

// ── Tool approval card ────────────────────────────────────────────────────────
function RequestCard({ req, onApprove, onDeny }: {
  req:       PendingRequest
  onApprove: () => void
  onDeny:    () => void
}) {
  const riskCfg  = Colors.risk[req.risk_level] ?? Colors.risk.low
  const toolCfg  = Colors.tool[req.tool_name as keyof typeof Colors.tool] ?? Colors.tool.unknown
  const iconName = TOOL_ICONS[req.tool_name as string] ?? 'cube-outline'
  const isPending  = req.status === 'pending'
  const isApproved = req.status === 'approved'

  return (
    <View style={[styles.reqCard, { borderLeftColor: riskCfg.dot }]}>
      <View style={[styles.reqWhisper, { backgroundColor: riskCfg.whisper }]} />

      {/* Tool + risk header */}
      <View style={styles.reqHeader}>
        <View style={[styles.reqIconBox, { backgroundColor: toolCfg.bg }]}>
          <Ionicons name={iconName} size={13} color={toolCfg.text} />
        </View>
        <Text style={[styles.reqToolName, { color: toolCfg.text }]}>{req.tool_name}</Text>
        <RiskBadge level={req.risk_level} />
        {!isPending && (
          <View style={[
            styles.decidedBadge,
            { backgroundColor: isApproved ? Colors.risk.low.bg : Colors.dangerLight },
          ]}>
            <Ionicons
              name={isApproved ? 'checkmark' : 'close'}
              size={10}
              color={isApproved ? Colors.successDark : Colors.danger}
            />
            <Text style={[styles.decidedText, { color: isApproved ? Colors.successDark : Colors.danger }]}>
              {isApproved ? 'Approved' : 'Denied'}
            </Text>
          </View>
        )}
      </View>

      {/* Summary */}
      <Text style={styles.reqSummary} numberOfLines={isPending ? 6 : 3}>{req.summary}</Text>

      {/* Command code block */}
      {!!req.command && (
        <View style={styles.reqCode}>
          <Text style={styles.reqCodeText} numberOfLines={4}>{req.command}</Text>
        </View>
      )}

      {/* Action buttons (only while pending) */}
      {isPending && (
        <View style={styles.reqActions}>
          <TouchableOpacity style={styles.denyBtn} onPress={onDeny} activeOpacity={0.8}>
            <Ionicons name="close" size={16} color={Colors.white} />
            <Text style={styles.denyText}>Deny</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.approveBtn} onPress={onApprove} activeOpacity={0.8}>
            <Ionicons name="checkmark" size={16} color={Colors.white} />
            <Text style={styles.approveText}>Approve</Text>
          </TouchableOpacity>
        </View>
      )}

      <Text style={styles.reqTime}>
        {formatDistanceToNow(new Date(req.created_at), { addSuffix: true })}
      </Text>
    </View>
  )
}

// ── Animated thinking dots ────────────────────────────────────────────────────
function ThinkingBubble({ isPendingApproval }: { isPendingApproval: boolean }) {
  const color = isPendingApproval ? Colors.warning : Colors.accent
  const label = isPendingApproval ? 'Waiting for approval…' : 'Thinking…'
  return (
    <View style={styles.rowLeft}>
      <View style={styles.agentAvatar}>
        <Ionicons name="sparkles-outline" size={12} color={Colors.accentDeep} />
      </View>
      <View style={[styles.bubbleReceived, styles.thinkingBubble]}>
        <View style={styles.thinkingDots}>
          <View style={[styles.dot, { backgroundColor: color }]} />
          <View style={[styles.dot, { backgroundColor: color, opacity: 0.6 }]} />
          <View style={[styles.dot, { backgroundColor: color, opacity: 0.3 }]} />
        </View>
        <Text style={[styles.thinkingLabel, { color }]}>{label}</Text>
      </View>
    </View>
  )
}

// ── Activity bubble — compact tool_start / tool_end row ──────────────────────
function ActivityBubble({ event }: { event: TerminalEvent }) {
  const isStart   = event.event_type === 'tool_start'
  const iconName  = TOOL_ICONS[event.tool_name ?? ''] ?? 'cube-outline'
  const toolCfg   = Colors.tool[(event.tool_name ?? '') as keyof typeof Colors.tool] ?? Colors.tool.unknown

  return (
    <View style={styles.activityRow}>
      <View style={[styles.activityIcon, { backgroundColor: toolCfg.bg }]}>
        <Ionicons name={iconName} size={11} color={toolCfg.text} />
      </View>
      <Text style={styles.activityText} numberOfLines={2}>
        <Text style={{ fontWeight: '600', color: toolCfg.text }}>{event.tool_name}</Text>
        {event.summary ? `  ${event.summary}` : ''}
      </Text>
      <View style={[styles.activityBadge, isStart ? styles.activityBadgeStart : styles.activityBadgeDone]}>
        <Text style={styles.activityBadgeText}>{isStart ? 'running' : 'done'}</Text>
      </View>
    </View>
  )
}

// ── Feed item renderer ────────────────────────────────────────────────────────
// Memoized so a feed change (poll, Realtime append) only re-renders the rows that
// actually changed — not every visible bubble. `onApprove`/`onDeny` are stable
// (useCallback in the screen) and item objects are reused across renders, so the
// default shallow prop compare is enough.
const FeedRow = React.memo(function FeedRow({ item, onApprove, onDeny }: {
  item:      ChatItem
  onApprove: (id: string) => void
  onDeny:    (id: string) => void
}) {
  if (item.kind === 'output')   return <OutputBubble  event={item.event} />
  if (item.kind === 'activity') return <ActivityBubble event={item.event} />
  if (item.kind === 'sent')     return <SentBubble    cmd={item.cmd} />
  if (item.kind === 'notify')   return <NotifyRow     event={item.event} />
  if (item.kind === 'stop')     return <StopRow       event={item.event} />
  return (
    <RequestCard
      req={item.req}
      onApprove={() => onApprove(item.req.id)}
      onDeny={()    => onDeny(item.req.id)}
    />
  )
})

// ── Screen ────────────────────────────────────────────────────────────────────
export function ChatScreen() {
  const route      = useRoute<Route>()
  const navigation = useNavigation<Nav>()
  const insets     = useSafeAreaInsets()
  const { sessionId, machineLabel, cwd, machineIsOnline, harness, status, prefill } = route.params

  const { feed, isLoading, isRefetching, fetchOlder, isFetchingOlder } = useChatFeed(sessionId)
  const decide  = useDecideRequest()
  const sendPmt = useSendPrompt()

  // Live session data — route.params.status / machineIsOnline are stale snapshots
  // captured at navigation time. A session can go idle/finished while the user is
  // reading the chat, or be finished already when they open it, which would lock the
  // compose bar. Use the live sessions query as the source of truth.
  const { data: sessions = [] } = useSessions()
  const liveSession    = sessions.find(s => s.session_id === sessionId)
  const liveStatus     = liveSession?.status     ?? status
  const liveOnline     = liveSession?.machine_is_online ?? machineIsOnline
  // The CLI is "closed" only when we're confident: the desktop reported it dead
  // AND it isn't currently active. Active sessions are never blocked (avoids a
  // false-block in the brief window before the first liveness report).
  const cliClosed      = liveSession?.cli_alive === false && liveStatus !== 'active'

  const [prompt, setPrompt] = useState(prefill ?? '')
  const listRef = useRef<FlatList>(null)

  // Auto-scroll only follows the live edge when the user is already near the
  // bottom. While they scroll up to read history, new rows (Realtime/poll) must
  // NOT yank them down — they get a "jump to latest" button instead. This is the
  // fix for the "scroll up and it snaps back down" bug.
  const isNearBottomRef    = useRef(true)
  const didInitialScroll   = useRef(false)
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height)
    const near = distanceFromBottom < 120
    isNearBottomRef.current = near
    setShowJumpToLatest(!near)   // React bails out if the value is unchanged
  }, [])

  const scrollToLatest = useCallback((animated = true) => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated }))
    isNearBottomRef.current = true
    setShowJumpToLatest(false)
  }, [])

  // When returning from FileBrowser, pick up prefill set on our route params
  useFocusEffect(useCallback(() => {
    if (route.params.prefill) setPrompt(route.params.prefill)
  }, [route.params.prefill])) // eslint-disable-line react-hooks/exhaustive-deps

  // Follow the live edge only when the user is already there.
  useEffect(() => {
    if (feed.length > 0 && isNearBottomRef.current) {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }))
    }
  }, [feed.length])

  const pendingCount = feed.filter(i => i.kind === 'request' && i.req.status === 'pending').length
  const isActive     = liveStatus === 'active'
  const lastItem     = feed[feed.length - 1]
  const lastIsStop   = lastItem?.kind === 'stop'
  const showThinking = isActive && !lastIsStop

  const handleApprove = useCallback((id: string) => decide.mutate({ id, decision: 'approved' }), [decide])
  const handleDeny    = useCallback((id: string) => decide.mutate({ id, decision: 'denied'   }), [decide])

  async function handleSend() {
    const text = prompt.trim()
    if (!text) return
    try {
      await sendPmt.mutateAsync({ prompt: text, sessionId })
      setPrompt('')
    } catch (err: any) {
      Alert.alert('Failed to send', err.message ?? 'Please try again')
    }
  }

  const dirLabel = dirName(cwd)
  // Allow prompting when the machine is online, no approvals pending, and the CLI
  // is still open. A closed CLI is blocked — resuming it would spawn a new
  // unattended agent, which is dangerous.
  const canType  = liveOnline && pendingCount === 0 && !cliClosed
  const canSend  = prompt.trim().length > 0 && !sendPmt.isPending && canType

  return (
    // GradientBackground provides flex:1 + background colour
    <GradientBackground>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />

      {/*
        KeyboardAvoidingView MUST be flex:1 and sit INSIDE GradientBackground.
        On iOS use 'padding' so the compose bar lifts with the keyboard.
        On Android use 'height' (adjustResize in manifest also helps but 'height' is safer).
      */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >

        {/* ── Header ── */}
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={22} color={Colors.textSecondary} />
          </TouchableOpacity>

          <View style={styles.headerCenter}>
            <View style={styles.headerTitleRow}>
              <Text style={styles.headerTitle} numberOfLines={1}>{dirLabel}</Text>
              <HarnessBadge harness={harness} size="xs" />
            </View>
            <Text style={styles.headerSub} numberOfLines={1}>{machineLabel}{cwd ? ` · ${cwd}` : ''}</Text>
          </View>

          <View style={styles.headerRight}>
            {isRefetching && <ActivityIndicator size="small" color={Colors.textTertiary} />}
            <TouchableOpacity
              style={[styles.headerBtn, !machineIsOnline && { opacity: 0.4 }]}
              onPress={() => navigation.navigate('FileBrowser', { sessionId, machineLabel, cwd })}
              disabled={!machineIsOnline}
              activeOpacity={0.7}
            >
              <Ionicons name="folder-outline" size={17} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Status strip ── */}
        <View style={styles.statusStrip}>
          <View style={[styles.statusDot, { backgroundColor: isActive ? Colors.success : liveStatus === 'idle' ? Colors.warning : Colors.textTertiary }]} />
          <Text style={[styles.statusText, { color: isActive ? Colors.success : liveStatus === 'idle' ? Colors.warning : Colors.textTertiary }]}>
            {isActive ? 'Active' : liveStatus === 'idle' ? 'Idle' : 'Finished'}
          </Text>
          {!liveOnline && <Text style={styles.offlineChip}>machine offline</Text>}
        </View>

        {/* ── Message feed ── */}
        {isLoading && feed.length === 0 ? (
          <View style={styles.loadingCenter}>
            <ActivityIndicator size="large" color={Colors.accent} />
            <Text style={styles.loadingText}>Loading conversation…</Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            // flex:1 is the critical fix — without it, FlatList expands to full
            // content height and pushes the compose bar below the screen
            style={styles.flex}
            data={feed}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
              <FeedRow item={item} onApprove={handleApprove} onDeny={handleDeny} />
            )}
            contentContainerStyle={[
              styles.listContent,
              feed.length === 0 && styles.listContentEmpty,
            ]}
            // Track scroll position so auto-follow only happens at the live edge
            onScroll={handleScroll}
            scrollEventThrottle={16}
            // Keeps the viewport anchored when OLDER rows are prepended on
            // scroll-up, so loading history doesn't jump the list (index 1 skips
            // the loading-older header).
            maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
            // Load older history when the user reaches the top (WhatsApp style)
            onStartReached={fetchOlder}
            onStartReachedThreshold={0.3}
            ListHeaderComponent={isFetchingOlder
              ? <View style={styles.loadingOlder}><ActivityIndicator size="small" color={Colors.textTertiary} /></View>
              : null
            }
            // Snap to bottom on first render only; afterwards respect the user's
            // position (the unconditional jump-to-bottom here was the scroll bug).
            onContentSizeChange={() => {
              if (!didInitialScroll.current && feed.length > 0) {
                listRef.current?.scrollToEnd({ animated: false })
                didInitialScroll.current = true
              } else if (isNearBottomRef.current) {
                listRef.current?.scrollToEnd({ animated: false })
              }
            }}
            // Virtualization tuning — fewer mounted rows, smoother scroll
            windowSize={11}
            maxToRenderPerBatch={8}
            updateCellsBatchingPeriod={50}
            initialNumToRender={15}
            removeClippedSubviews
            ListFooterComponent={showThinking
              ? <ThinkingBubble isPendingApproval={pendingCount > 0} />
              : null
            }
            ListEmptyComponent={
              !showThinking ? (
                <View style={styles.empty}>
                  <Ionicons name="chatbubbles-outline" size={40} color={Colors.accentDeep} />
                  <Text style={styles.emptyTitle}>No activity yet</Text>
                  <Text style={styles.emptySub}>
                    Reasoning and tool calls will appear here as the agent works.
                  </Text>
                </View>
              ) : null
            }
          />
        )}

        {/* ── Jump to latest (shown only when scrolled away from the live edge) ── */}
        {showJumpToLatest && feed.length > 0 && (
          <TouchableOpacity
            style={styles.jumpToLatest}
            onPress={() => scrollToLatest(true)}
            activeOpacity={0.85}
          >
            <Ionicons name="arrow-down" size={16} color={Colors.white} />
            <Text style={styles.jumpToLatestText}>Latest</Text>
          </TouchableOpacity>
        )}

        {/* ── Compose bar — always anchored above the floating tab bar ── */}
        <View style={[styles.compose, { paddingBottom: TAB_BOTTOM_INSET }]}>
          {cliClosed ? (
            // CLI was closed — prompting is blocked (resuming it is dangerous)
            <View style={styles.closedNote}>
              <Ionicons name="lock-closed" size={16} color={Colors.danger} />
              <View style={styles.closedTextWrap}>
                <Text style={styles.closedTitle}>CLI is closed</Text>
                <Text style={styles.closedSub}>
                  This session's terminal was closed. Start the agent again on your
                  computer to continue — prompts can't be sent to a closed CLI.
                </Text>
              </View>
            </View>
          ) : pendingCount > 0 ? (
            // Approval pending — show a note instead of the input
            <View style={styles.pendingNote}>
              <Ionicons name="hourglass-outline" size={14} color={Colors.warning} />
              <Text style={styles.pendingText}>
                {pendingCount} approval{pendingCount > 1 ? 's' : ''} pending — scroll up to decide
              </Text>
            </View>
          ) : (
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                value={prompt}
                onChangeText={setPrompt}
                placeholder={
                  !liveOnline ? 'Machine offline — cannot send'
                  : 'Send a prompt…'
                }
                placeholderTextColor={Colors.textTertiary}
                multiline
                editable={canType}
                maxLength={2000}
                textAlignVertical="top"
              />
              <TouchableOpacity
                style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]}
                onPress={handleSend}
                disabled={!canSend}
                activeOpacity={0.8}
              >
                {sendPmt.isPending
                  ? <ActivityIndicator size="small" color={Colors.white} />
                  : <Ionicons name="arrow-up" size={20} color={canSend ? Colors.white : Colors.textTertiary} />
                }
              </TouchableOpacity>
            </View>
          )}
        </View>

      </KeyboardAvoidingView>
    </GradientBackground>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  flex: { flex: 1 },

  // ── Header ──────────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.px8, paddingBottom: Spacing.px8,
    borderBottomWidth: 1, borderBottomColor: Colors.borderHairline,
    backgroundColor: Colors.surfaceGlassStrong,
    gap: Spacing.px4,
  },
  backBtn: {
    width: 40, height: 40,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  headerCenter: { flex: 1, gap: 2 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.px8 },
  headerTitle: {
    fontSize: FontSize.cardTitle, fontWeight: '700', color: Colors.textPrimary, flexShrink: 1,
  },
  headerSub: { fontSize: FontSize.metadata, color: Colors.textTertiary },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.px8, flexShrink: 0 },
  headerBtn: {
    width: 36, height: 36,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: Radius.sm, borderWidth: 1, borderColor: Colors.borderHairline,
    backgroundColor: Colors.surfaceGlassStrong,
  },

  // ── Status strip ────────────────────────────────────────────────────────────
  statusStrip: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.px6,
    paddingHorizontal: Spacing.px20, paddingVertical: 6,
    backgroundColor: Colors.cream,
    borderBottomWidth: 1, borderBottomColor: Colors.borderHairline,
  },
  statusDot: { width: 6, height: 6, borderRadius: Radius.full },
  statusText: { fontSize: FontSize.metadata, fontWeight: '500' },
  offlineChip: {
    fontSize: FontSize.microLabel, color: Colors.danger, fontWeight: '600',
    marginLeft: Spacing.px8, backgroundColor: Colors.dangerLight,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: Radius.full,
  },

  // ── Feed ────────────────────────────────────────────────────────────────────
  loadingCenter: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.px12,
  },
  loadingText: { fontSize: FontSize.label, color: Colors.textTertiary },
  loadingOlder: { paddingVertical: Spacing.px12, alignItems: 'center' },

  // ── Jump to latest pill ──────────────────────────────────────────────────────
  jumpToLatest: {
    position: 'absolute', alignSelf: 'center', bottom: Spacing.px12,
    flexDirection: 'row', alignItems: 'center', gap: Spacing.px4,
    backgroundColor: Colors.accentDeep,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.px16, paddingVertical: Spacing.px8,
    ...Shadow.inkPill,
  },
  jumpToLatestText: { fontSize: FontSize.label, color: Colors.white, fontWeight: '600' },

  listContent: {
    paddingHorizontal: Spacing.px12,
    paddingTop: Spacing.px12,
    paddingBottom: Spacing.px16,
    gap: Spacing.px4,
  },
  listContentEmpty: {
    flexGrow: 1, justifyContent: 'center',
  },

  // ── Empty ────────────────────────────────────────────────────────────────────
  empty: {
    alignItems: 'center', paddingHorizontal: Spacing.px32, gap: Spacing.px12,
  },
  emptyTitle: {
    fontSize: FontSize.displayM, fontWeight: '600', color: Colors.textPrimary,
    fontFamily: FontFamily.serifBold,
  },
  emptySub: {
    fontSize: FontSize.body, color: Colors.textSecondary,
    textAlign: 'center', lineHeight: 22, maxWidth: 260,
  },

  // ── Row wrappers ─────────────────────────────────────────────────────────────
  rowLeft: {
    flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.px8,
    marginVertical: 3, paddingRight: 60,
  },
  rowRight: {
    flexDirection: 'row', justifyContent: 'flex-end',
    marginVertical: 3, paddingLeft: 60,
  },

  // ── Agent avatar ─────────────────────────────────────────────────────────────
  agentAvatar: {
    width: 26, height: 26, borderRadius: Radius.full,
    backgroundColor: Colors.accentLight,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },

  // ── Received bubble (agent reasoning) ────────────────────────────────────────
  bubbleReceived: {
    backgroundColor: Colors.surfaceGlassStrong,
    borderRadius: Radius.md, borderTopLeftRadius: 4,
    borderWidth: 1, borderColor: Colors.borderHairline, borderTopColor: Colors.borderGlass,
    paddingHorizontal: Spacing.px12, paddingVertical: Spacing.px8,
    gap: 4,
    flexShrink: 1,
    ...Shadow.glassLow,
  },
  bubbleText: {
    fontSize: FontSize.body, color: Colors.textSecondary,
    lineHeight: 22, fontFamily: FontFamily.sans,
  },
  showMore: { fontSize: FontSize.metadata, color: Colors.accent, fontWeight: '500' },
  bubbleTime: { fontSize: FontSize.metadata, color: Colors.textTertiary, alignSelf: 'flex-end' },

  // ── Sent bubble (user prompt) ─────────────────────────────────────────────────
  bubbleSent: {
    backgroundColor: Colors.accentDeep,
    borderRadius: Radius.md, borderTopRightRadius: 4,
    paddingHorizontal: Spacing.px12, paddingVertical: Spacing.px8,
    gap: 4, flexShrink: 1,
    ...Shadow.inkPill,
  },
  bubbleSentText: {
    fontSize: FontSize.body, color: Colors.white, lineHeight: 22,
  },
  bubbleSentMeta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4,
  },
  bubbleSentTime: { fontSize: FontSize.metadata, color: 'rgba(255,255,255,0.6)' },

  // ── Notification ─────────────────────────────────────────────────────────────
  notifyRow: {
    alignItems: 'center', paddingVertical: Spacing.px8, paddingHorizontal: Spacing.px32,
  },
  notifyText: {
    fontSize: FontSize.metadata, color: Colors.textTertiary,
    fontStyle: 'italic', textAlign: 'center',
  },

  // ── Stop divider ─────────────────────────────────────────────────────────────
  stopRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: Spacing.px8, marginVertical: Spacing.px16,
  },
  stopLine: { flex: 1, height: 1, backgroundColor: Colors.risk.low.border },
  stopPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.risk.low.bg,
    borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.risk.low.border,
    paddingHorizontal: Spacing.px12, paddingVertical: 4,
  },
  stopText: { fontSize: FontSize.label, fontWeight: '600', color: Colors.successDark },
  stopTime: { fontSize: FontSize.metadata, color: Colors.successDark, opacity: 0.7 },

  // ── Tool request card ─────────────────────────────────────────────────────────
  reqCard: {
    backgroundColor: Colors.bgPrimary,
    borderRadius: Radius.md, borderWidth: 1,
    borderColor: Colors.borderHairline, borderLeftWidth: 3,
    overflow: 'hidden', padding: Spacing.px12, gap: Spacing.px8,
    marginVertical: 4,
    ...Shadow.glassLow,
  },
  reqWhisper: { position: 'absolute', top: 0, left: 0, right: 0, height: 36 },
  reqHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.px8 },
  reqIconBox: {
    width: 24, height: 24, borderRadius: Radius.xs,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  reqToolName: { fontSize: FontSize.label, fontWeight: '600', fontStyle: 'italic', flex: 1 },
  decidedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderRadius: Radius.full, paddingHorizontal: 6, paddingVertical: 2,
  },
  decidedText: { fontSize: FontSize.metadata, fontWeight: '600' },
  reqSummary: {
    fontSize: FontSize.label, color: Colors.textSecondary, lineHeight: 18,
    fontFamily: FontFamily.mono,
  },
  reqCode: {
    backgroundColor: Colors.codeBg, borderRadius: Radius.xs,
    paddingHorizontal: Spacing.px8, paddingVertical: Spacing.px4,
  },
  reqCodeText: {
    fontFamily: FontFamily.mono, fontSize: FontSize.monoSmall,
    color: Colors.codeText, lineHeight: 17,
  },
  reqActions: {
    flexDirection: 'row', gap: Spacing.px8, marginTop: Spacing.px4,
  },
  denyBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.px4, height: 44, borderRadius: Radius.full,
    backgroundColor: Colors.danger,
  },
  denyText: { fontSize: FontSize.label, fontWeight: '600', color: Colors.white },
  approveBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.px4, height: 44, borderRadius: Radius.full,
    backgroundColor: Colors.successDark,
    ...Shadow.inkPill,
  },
  approveText: { fontSize: FontSize.label, fontWeight: '600', color: Colors.white },
  reqTime: { fontSize: FontSize.metadata, color: Colors.textTertiary },

  // ── Activity bubble (tool_start / tool_end) ──────────────────────────────────
  activityRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.px8,
    paddingVertical: 5, paddingHorizontal: Spacing.px4,
    marginVertical: 2,
  },
  activityIcon: {
    width: 22, height: 22, borderRadius: Radius.xs,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  activityText: {
    flex: 1, fontSize: FontSize.metadata, color: Colors.textTertiary,
    fontFamily: FontFamily.mono,
  },
  activityBadge: {
    borderRadius: Radius.full, paddingHorizontal: 6, paddingVertical: 2, flexShrink: 0,
  },
  activityBadgeStart: { backgroundColor: Colors.creamDeep },
  activityBadgeDone:  { backgroundColor: Colors.risk.low.bg },
  activityBadgeText:  { fontSize: 10, fontWeight: '600', color: Colors.textTertiary },

  // ── Thinking bubble ───────────────────────────────────────────────────────────
  thinkingBubble: { flexDirection: 'row', alignItems: 'center', gap: Spacing.px8 },
  thinkingDots: { flexDirection: 'row', gap: 4 },
  dot: { width: 7, height: 7, borderRadius: Radius.full, backgroundColor: Colors.accent },
  thinkingLabel: { fontSize: FontSize.label, fontStyle: 'italic' },

  // ── Compose bar ───────────────────────────────────────────────────────────────
  compose: {
    paddingHorizontal: Spacing.px12,
    paddingTop: Spacing.px8,
    borderTopWidth: 1,
    borderTopColor: Colors.borderHairline,
    backgroundColor: Colors.surfaceGlassStrong,
  },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.px8 },
  input: {
    flex: 1,
    minHeight: 44, maxHeight: 120,
    backgroundColor: Colors.bgPrimary,
    borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.borderHairline, borderTopColor: Colors.borderGlass,
    paddingHorizontal: Spacing.px16, paddingVertical: Spacing.px12,
    fontSize: FontSize.body, color: Colors.textPrimary,
    fontFamily: FontFamily.sans, lineHeight: 20,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: Radius.full,
    backgroundColor: Colors.accentDeep,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    ...Shadow.inkPill,
  },
  sendBtnDisabled: {
    backgroundColor: Colors.surfaceGlassStrong, shadowOpacity: 0, elevation: 0,
  },
  pendingNote: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.px8,
    paddingVertical: Spacing.px12, justifyContent: 'center',
  },
  pendingText: { fontSize: FontSize.label, color: Colors.warning, fontWeight: '500' },
  closedNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.px8,
    paddingVertical: Spacing.px12, paddingHorizontal: Spacing.px8,
    backgroundColor: Colors.dangerLight + '55', borderRadius: Radius.md,
  },
  closedTextWrap: { flex: 1, gap: 2 },
  closedTitle: { fontSize: FontSize.label, color: Colors.danger, fontWeight: '700' },
  closedSub: { fontSize: FontSize.metadata, color: Colors.textSecondary, lineHeight: 16 },
})
