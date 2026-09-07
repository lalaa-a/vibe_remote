import React, { useRef } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet,
} from 'react-native'
import { Swipeable } from 'react-native-gesture-handler'
import { formatDistanceToNow } from 'date-fns'
import Ionicons from 'react-native-vector-icons/Ionicons'
import { Colors, Spacing, Radius, FontSize, FontFamily, Shadow } from '../constants/colors'
import { RiskBadge } from './RiskBadge'
import { HarnessBadge } from './HarnessBadge'
import type { PendingRequest } from '../types'

interface Props {
  request:    PendingRequest
  onPress:    () => void
  onApprove?: () => void
  onDeny?:    () => void
}

export function RequestCard({ request, onPress, onApprove, onDeny }: Props) {
  const swipeRef     = useRef<Swipeable>(null)
  const toolCfg      = Colors.tool[request.tool_name as keyof typeof Colors.tool]
                       ?? Colors.tool.unknown
  const riskCfg      = Colors.risk[request.risk_level] ?? Colors.risk.low
  const timeAgo      = formatDistanceToNow(new Date(request.created_at), { addSuffix: true })
  const isCliPending = request.status === 'cli_pending'
  const canDecide    = request.status === 'pending'

  function handleApprove() {
    swipeRef.current?.close()
    onApprove?.()
  }

  function handleDeny() {
    swipeRef.current?.close()
    onDeny?.()
  }

  function renderLeftActions() {
    return (
      <TouchableOpacity style={styles.approveAction} onPress={handleApprove} activeOpacity={0.85}>
        <Ionicons name="checkmark" size={22} color={Colors.white} />
        <Text style={styles.actionLabel}>Approve</Text>
      </TouchableOpacity>
    )
  }

  function renderRightActions() {
    return (
      <TouchableOpacity style={styles.denyAction} onPress={handleDeny} activeOpacity={0.85}>
        <Ionicons name="close" size={22} color={Colors.white} />
        <Text style={styles.actionLabel}>Deny</Text>
      </TouchableOpacity>
    )
  }

  return (
    <Swipeable
      ref={swipeRef}
      renderLeftActions={canDecide && onApprove ? renderLeftActions : undefined}
      renderRightActions={canDecide && onDeny   ? renderRightActions : undefined}
      friction={2}
      overshootLeft={false}
      overshootRight={false}
      containerStyle={styles.swipeContainer}
    >
      <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
        {/* Risk whisper gradient at top */}
        <View style={[styles.whisper, { backgroundColor: riskCfg.whisper }]} />

        <View style={styles.body}>
          {/* Top row — tool badge + risk badge */}
          <View style={styles.topRow}>
            <View style={styles.toolRow}>
              <View style={[styles.toolDot, { backgroundColor: toolCfg.dot }]} />
              <Text style={styles.toolName}>{request.tool_name}</Text>
              {isCliPending && (
                <View style={styles.cliPill}>
                  <Text style={styles.cliText}>CLI</Text>
                </View>
              )}
            </View>
            <RiskBadge level={request.risk_level} />
          </View>

          {/* Summary */}
          <Text style={styles.summeryPathText} numberOfLines={3}>{request.summary}</Text>

          {/* Divider */}
          <View style={styles.divider} />

          {/* Meta row */}
          <View style={styles.metaRow}>
            <View style={styles.machineRow}>
              <View style={[
                styles.machineDot,
                { backgroundColor: request.machines?.is_online ? Colors.success : Colors.textTertiary },
              ]} />
              <Text style={styles.machineText}>
                {request.machines?.label ?? 'Unknown'}
              </Text>
              <Text style={styles.metaSep}>·</Text>
              <Text style={styles.timeText}>{timeAgo}</Text>
            </View>
            {request.harness && request.harness !== 'claude-code' && (
              <HarnessBadge harness={request.harness} size="xs" />
            )}
          </View>
        </View>
      </TouchableOpacity>
    </Swipeable>
  )
}

const styles = StyleSheet.create({
  swipeContainer: {
    marginHorizontal: Spacing.px20,
    marginVertical:   6,
  },
  card: {
    backgroundColor: Colors.bgPrimary,
    borderRadius:    Radius.md,
    borderWidth:     1,
    borderColor:     Colors.borderHairline,
    shadowColor:     '#A08060',
    shadowOffset:    { width: 0, height: 5 },
    shadowOpacity:   0.13,
    shadowRadius:    20,
    elevation:       5,
    overflow:        'hidden',
    
  },
  whisper: {
    position: 'absolute',
    top:      0,
    left:     0,
    right:    0,
    height:   50,
  },
  body: {
    padding: Spacing.px20,
    gap:     Spacing.px8,
  },
  topRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
  },
  toolRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           Spacing.px8,
  },
  toolDot: {
    width:        6,
    height:       6,
    borderRadius: Radius.full,
  },
  toolName: {
    fontSize:  FontSize.label,
    fontStyle: 'italic',
    color:     Colors.textSecondary,
    fontWeight:'500',
  },
  cliPill: {
    backgroundColor:   Colors.surfaceGlassStrong,
    paddingHorizontal: 6,
    paddingVertical:   1,
    borderRadius:      Radius.full,
    borderWidth:       1,
    borderColor:       Colors.borderHairline,
  },
  cliText: {
    fontSize:      FontSize.microLabel,
    color:         Colors.textTertiary,
    fontWeight:    '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  summary: {
    fontSize:   FontSize.cardTitle,
    color:      Colors.textPrimary,
    lineHeight: FontSize.cardTitle * 1.3,
    fontWeight: '500',
  },
  filesCol: {
    gap: 4,
  },
  pathRow: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               Spacing.px8,
    backgroundColor:   'rgba(0,0,0,0.04)',
    borderRadius:      Radius.sm,
    paddingHorizontal: Spacing.px12,
    paddingVertical:   Spacing.px8,
  },
  pathText: {
    fontFamily: FontFamily.mono,
    fontSize:   FontSize.monoSmall,
    color:      Colors.textSecondary,
    flex:       1,
  },

  summeryPathText: {
    fontFamily: FontFamily.mono,
    fontSize:   FontSize.body,
    color:      Colors.textSecondary,
  },

  moreFiles: {
    fontSize:  FontSize.metadata,
    color:     Colors.textTertiary,
  },
  divider: {
    height:          1,
    backgroundColor: Colors.borderHairline,
    marginVertical:  Spacing.px4,
  },
  metaRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
  },
  machineRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           5,
  },
  machineDot: {
    width:        5,
    height:       5,
    borderRadius: Radius.full,
  },
  machineText: {
    fontSize:  FontSize.metadata,
    color:     Colors.textSecondary,
    fontWeight:'500',
  },
  metaSep: {
    fontSize: FontSize.metadata,
    color:    Colors.textTertiary,
  },
  timeText: {
    fontSize: FontSize.metadata,
    color:    Colors.textTertiary,
  },

  // Swipe actions
  approveAction: {
    backgroundColor: Colors.successDark,
    justifyContent:  'center',
    alignItems:      'center',
    paddingHorizontal: Spacing.px24,
    gap:             4,
    borderTopLeftRadius:    Radius.xl,
    borderBottomLeftRadius: Radius.xl,
  },
  denyAction: {
    backgroundColor: Colors.danger,
    justifyContent:  'center',
    alignItems:      'center',
    paddingHorizontal: Spacing.px24,
    gap:             4,
    borderTopRightRadius:    Radius.xl,
    borderBottomRightRadius: Radius.xl,
  },
  actionLabel: {
    color:      Colors.white,
    fontSize:   FontSize.label,
    fontWeight: '600',
  },
})
