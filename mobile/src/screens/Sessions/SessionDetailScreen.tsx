import React from 'react'
import {
  View, Text, StyleSheet,
  TouchableOpacity, StatusBar, ActivityIndicator,
  SectionList,
} from 'react-native'
import { useRoute, useNavigation } from '@react-navigation/native'
import type { RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { formatDistanceToNow } from 'date-fns'
import Ionicons from 'react-native-vector-icons/Ionicons'
import { useSessionRequests, usePrompts, useCancelPrompt } from '../../hooks/useSessions'
import { useDecideRequest } from '../../hooks/useRequests'
import { RequestCard } from '../../components/RequestCard'
import { GradientBackground } from '../../components/GradientBackground'
import { Colors, Spacing, Radius, FontSize, Shadow, TAB_BOTTOM_INSET } from '../../constants/colors'
import type { SessionsStackParamList, PendingRequest, MobileCommand } from '../../types'

type Route = RouteProp<SessionsStackParamList, 'SessionDetail'>
type Nav   = NativeStackNavigationProp<SessionsStackParamList>

export function SessionDetailScreen() {
  const route      = useRoute<Route>()
  const navigation = useNavigation<Nav>()
  const insets     = useSafeAreaInsets()
  const { sessionId, machineLabel, cwd, machineIsOnline } = route.params

  const { data: requests = [], isLoading: reqLoading } = useSessionRequests(sessionId)
  const { data: allPrompts = [] }                      = usePrompts()
  const cancelPrompt                                   = useCancelPrompt()
  const decide                                         = useDecideRequest()

  const prompts = allPrompts.filter(p => p.session_id === sessionId)

  return (
    <GradientBackground>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />

      {/* Custom header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={20} color={Colors.textSecondary} />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.cwd} numberOfLines={1}>{cwd ?? '~'}</Text>
          <Text style={styles.machine}>{machineLabel}</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={[styles.actionBtn, !machineIsOnline && styles.actionBtnDisabled]}
            onPress={() => navigation.navigate('FileBrowser', { sessionId, machineLabel, cwd })}
            activeOpacity={0.7}
            disabled={!machineIsOnline}
          >
            <Text style={[styles.actionBtnText, !machineIsOnline && styles.actionBtnTextDisabled]}>
              {machineIsOnline ? 'Files' : 'Offline'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnPrompt]}
            onPress={() => navigation.navigate('PromptCompose', { sessionId })}
            activeOpacity={0.8}
          >
            <Text style={styles.actionBtnPromptText}>Prompt</Text>
          </TouchableOpacity>
        </View>
      </View>

      <SectionList
        contentContainerStyle={styles.listContent}
        sections={[
          {
            title: `PENDING REQUESTS${requests.length > 0 ? ` · ${requests.length}` : ''}`,
            data:  requests,
            key:   'requests',
          },
          {
            title: `SENT PROMPTS${prompts.length > 0 ? ` · ${prompts.length}` : ''}`,
            data:  prompts,
            key:   'prompts',
          },
        ]}
        keyExtractor={(item: PendingRequest | MobileCommand) => item.id}
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionHeader}>{section.title}</Text>
        )}
        renderItem={({ item, section }) => {
          if (section.key === 'requests') {
            const req = item as PendingRequest
            return (
              <RequestCard
                request={req}
                onPress={() => navigation.navigate('RequestDetail', { id: req.id })}
                onApprove={() => decide.mutate({ id: req.id, decision: 'approved' })}
                onDeny={() => decide.mutate({ id: req.id, decision: 'denied' })}
              />
            )
          }
          const cmd = item as MobileCommand
          return <PromptRow cmd={cmd} onCancel={() => cancelPrompt.mutate(cmd.id)} />
        }}
        ListEmptyComponent={null}
        renderSectionFooter={({ section }) => {
          if (section.key === 'requests' && !reqLoading && requests.length === 0) {
            return (
              <View style={styles.sectionEmpty}>
                <Text style={styles.sectionEmptyText}>No pending requests.</Text>
              </View>
            )
          }
          if (section.key === 'prompts' && prompts.length === 0) {
            return (
              <View style={styles.sectionEmpty}>
                <Text style={styles.sectionEmptyText}>No prompts sent yet.</Text>
              </View>
            )
          }
          return null
        }}
        stickySectionHeadersEnabled={false}
      />

      {reqLoading && (
        <ActivityIndicator style={styles.loader} size="small" color={Colors.accent} />
      )}
    </GradientBackground>
  )
}

function PromptRow({ cmd, onCancel }: { cmd: MobileCommand; onCancel: () => void }) {
  const STATUS_ICON: Record<string, string> = {
    pending:   'hourglass-outline',
    delivered: 'checkmark-circle',
    cancelled: 'close-circle',
  }
  const STATUS_COLOR: Record<string, string> = {
    pending:   Colors.warning,
    delivered: Colors.success,
    cancelled: Colors.textTertiary,
  }

  const iconName = STATUS_ICON[cmd.status] ?? 'ellipsis-horizontal'
  const color    = STATUS_COLOR[cmd.status] ?? Colors.textTertiary
  const timeAgo  = formatDistanceToNow(new Date(cmd.created_at), { addSuffix: true })

  return (
    <View style={styles.promptRow}>
      <Ionicons name={iconName} size={16} color={color} style={{ marginTop: 2 }} />
      <View style={styles.promptBody}>
        <Text style={styles.promptText} numberOfLines={2}>{cmd.prompt}</Text>
        <Text style={styles.promptMeta}>{cmd.status} · {timeAgo}</Text>
      </View>
      {cmd.status === 'pending' && (
        <TouchableOpacity onPress={onCancel} style={styles.cancelBtn} activeOpacity={0.7}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection:  'row',
    alignItems:     'center',
    paddingLeft:    Spacing.px12,
    paddingRight:   Spacing.px20,
    paddingBottom:  Spacing.px16,
    gap:            Spacing.px8,
  },
  backBtn: {
    width:          36,
    height:         36,
    alignItems:     'center',
    justifyContent: 'center',
    flexShrink:     0,
  },
  headerInfo: { flex: 1, gap: 2 },
  cwd: {
    fontSize:   FontSize.mono,
    fontWeight: '600',
    color:      Colors.textPrimary,
  },
  machine: {
    fontSize: FontSize.metadata,
    color:    Colors.textTertiary,
  },
  headerActions: {
    flexDirection: 'row',
    gap:           Spacing.px8,
  },
  actionBtn: {
    paddingHorizontal: Spacing.px12,
    paddingVertical:   Spacing.px8,
    borderRadius:      Radius.sm,
    borderWidth:       1,
    borderColor:       Colors.borderHairline,
    borderTopColor:    Colors.borderGlass,
    backgroundColor:   Colors.surfaceGlassStrong,
    minHeight:         36,
    justifyContent:    'center',
  },
  actionBtnPrompt: {
    backgroundColor: Colors.inkBlack,
    borderColor:     Colors.inkBlack,
    ...Shadow.inkPill,
  },
  actionBtnDisabled: { opacity: 0.45 },
  actionBtnText: {
    fontSize:   FontSize.label,
    fontWeight: '500',
    color:      Colors.textSecondary,
  },
  actionBtnTextDisabled: { color: Colors.textTertiary },
  actionBtnPromptText: {
    fontSize:   FontSize.label,
    fontWeight: '600',
    color:      Colors.textInverse,
  },
  listContent: {
    paddingBottom: TAB_BOTTOM_INSET,
  },
  sectionHeader: {
    fontSize:          FontSize.microLabel,
    fontWeight:        '600',
    color:             Colors.textTertiary,
    textTransform:     'uppercase',
    letterSpacing:     0.6,
    paddingHorizontal: Spacing.px20,
    paddingTop:        Spacing.px16,
    paddingBottom:     Spacing.px8,
  },
  sectionEmpty: {
    marginHorizontal: Spacing.px20,
    paddingVertical:  Spacing.px16,
    alignItems:       'center',
    backgroundColor:  Colors.surfaceGlassStrong,
    borderRadius:     Radius.md,
    borderWidth:      1,
    borderColor:      Colors.borderHairline,
  },
  sectionEmptyText: {
    fontSize:  FontSize.label,
    color:     Colors.textTertiary,
    fontStyle: 'italic',
  },
  loader: {
    position: 'absolute',
    top:      Spacing.px20,
    right:    Spacing.px20,
  },

  promptRow: {
    flexDirection:     'row',
    alignItems:        'flex-start',
    gap:               Spacing.px12,
    marginHorizontal:  Spacing.px20,
    marginVertical:    4,
    backgroundColor:   Colors.surfaceGlass,
    borderRadius:      Radius.md,
    borderWidth:       1,
    borderColor:       Colors.borderHairline,
    borderTopColor:    Colors.borderGlass,
    padding:           Spacing.px12,
    ...Shadow.glassLow,
  },
  promptBody: { flex: 1, gap: 3 },
  promptText: {
    fontSize:   FontSize.label,
    color:      Colors.textPrimary,
    lineHeight: 18,
  },
  promptMeta: {
    fontSize:  FontSize.metadata,
    color:     Colors.textTertiary,
  },
  cancelBtn: {
    paddingHorizontal: Spacing.px8,
    paddingVertical:   3,
    borderRadius:      Radius.sm,
    borderWidth:       1,
    borderColor:       Colors.warning + '60',
  },
  cancelText: {
    fontSize:   FontSize.metadata,
    color:      Colors.warning,
    fontWeight: '500',
  },
})
