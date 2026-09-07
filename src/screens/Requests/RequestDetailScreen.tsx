import React from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, StatusBar, Platform,
} from 'react-native'
import { useRoute, useNavigation } from '@react-navigation/native'
import type { RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { formatDistanceToNow } from 'date-fns'
import { useRequest, useDecideRequest } from '../../hooks/useRequests'
import { DiffViewer } from '../../components/DiffViewer/DiffViewer'
import { RiskBadge } from '../../components/RiskBadge'
import { GradientBackground } from '../../components/GradientBackground'
import { Colors, Spacing, Radius, FontSize, Shadow } from '../../constants/colors'
import { useAppStore } from '../../store/useAppStore'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Ionicons from 'react-native-vector-icons/Ionicons'
import type { RequestsStackParamList } from '../../types'

type Route = RouteProp<RequestsStackParamList, 'RequestDetail'>
type Nav   = NativeStackNavigationProp<RequestsStackParamList>

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace'

export function RequestDetailScreen() {
  const route      = useRoute<Route>()
  const navigation = useNavigation<Nav>()
  const { id }     = route.params

  const { data: request, isLoading } = useRequest(id)
  const decide    = useDecideRequest()
  const showToast = useAppStore(s => s.showToast)
  const insets    = useSafeAreaInsets()

  async function handleDecide(decision: 'approved' | 'denied') {
    if (!request) return
    const label = decision === 'approved' ? 'Approve' : 'Deny'
    Alert.alert(
      `${label} this request?`,
      request.summary,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text:  label,
          style: decision === 'denied' ? 'destructive' : 'default',
          onPress: async () => {
            try {
              await decide.mutateAsync({ id, decision })
              showToast(
                decision === 'approved' ? 'Request approved' : 'Request denied',
                decision === 'approved' ? 'success' : 'error'
              )
              navigation.goBack()
            } catch (err: any) {
              Alert.alert('Error', err.message ?? 'Failed to update request')
            }
          },
        },
      ]
    )
  }

  if (isLoading || !request) {
    return (
      <GradientBackground>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.accent} />
        </View>
      </GradientBackground>
    )
  }

  const alreadyDecided = request.status !== 'pending'
  const timeAgo = formatDistanceToNow(new Date(request.created_at), { addSuffix: true })
  const riskCfg = Colors.risk[request.risk_level] ?? Colors.risk.low

  return (
    <GradientBackground>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />

      {/* Custom back button row */}
      <View style={[styles.backRow, { paddingTop: insets.top + 4 }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={20} color={Colors.textSecondary} />
          <Text style={styles.backLabel}>Back</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header card ── */}
        <View style={styles.headerCard}>
          {/* Risk whisper */}
          <View style={[styles.whisper, { backgroundColor: riskCfg.whisper }]} />

          <View style={styles.headerTop}>
            <Text style={styles.toolName}>{request.tool_name}</Text>
            <RiskBadge level={request.risk_level} />
          </View>
          <Text style={styles.summary}>{request.summary}</Text>

          <View style={styles.divider} />

          <View style={styles.infoRow}>
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>MACHINE</Text>
              <View style={styles.machineRow}>
                <View style={[
                  styles.onlineDot,
                  { backgroundColor: request.machines?.is_online ? Colors.success : Colors.textTertiary },
                ]} />
                <Text style={styles.infoValue}>{request.machines?.label ?? 'Unknown'}</Text>
              </View>
            </View>
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>RISK</Text>
              <Text style={styles.infoValue} numberOfLines={2}>{request.risk_reason ?? '—'}</Text>
            </View>
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>TIME</Text>
              <Text style={styles.infoValue}>{timeAgo}</Text>
            </View>
          </View>
        </View>

        {/* ── Bash command ── */}
        {request.command && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>BASH COMMAND</Text>
            <View style={styles.codeBlock}>
              <Text style={styles.dollarSign}>$</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
                <Text style={styles.commandText} selectable>{request.command}</Text>
              </ScrollView>
            </View>
          </View>
        )}

        {/* ── Files ── */}
        {request.files_affected?.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>FILES · {request.files_affected.length}</Text>
            <View style={styles.filesCard}>
              {request.files_affected.map((f, i) => (
                <View key={i} style={[
                  styles.fileRow,
                  i < request.files_affected.length - 1 && styles.fileRowBorder,
                ]}>
                  <Ionicons name="document-outline" size={14} color={Colors.textTertiary} />
                  <Text style={styles.filePath} selectable numberOfLines={1}>{f}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ── Diff ── */}
        {request.diff && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>
              CHANGES · +{request.diff.grand_stats?.added ?? request.diff.stats?.added ?? 0}
              {'  '}−{request.diff.grand_stats?.removed ?? request.diff.stats?.removed ?? 0}
            </Text>
            <DiffViewer diff={request.diff} />
          </View>
        )}

        {/* ── Decision banner ── */}
        {alreadyDecided && (
          <View style={[
            styles.decidedBanner,
            {
              backgroundColor: request.status === 'approved' ? Colors.risk.low.bg : Colors.risk.critical.bg,
              borderColor:     request.status === 'approved' ? Colors.risk.low.border : Colors.risk.critical.border,
            },
          ]}>
            <Ionicons
              name={request.status === 'approved' ? 'checkmark-circle' : 'close-circle'}
              size={16}
              color={request.status === 'approved' ? Colors.risk.low.text : Colors.risk.critical.text}
            />
            <Text style={[
              styles.decidedText,
              { color: request.status === 'approved' ? Colors.risk.low.text : Colors.risk.critical.text },
            ]}>
              {request.status === 'approved' ? 'Approved' : 'Denied'}
              {request.decided_by ? ` via ${request.decided_by}` : ''}
            </Text>
          </View>
        )}

        <View style={{ height: 130 }} />
      </ScrollView>

      {/* ── Sticky footer ── */}
      {!alreadyDecided && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 92 }]}>
          <TouchableOpacity
            style={styles.denyBtn}
            onPress={() => handleDecide('denied')}
            disabled={decide.isPending}
            activeOpacity={0.8}
          >
            <Text style={styles.denyText}>Deny</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.approveBtn}
            onPress={() => handleDecide('approved')}
            disabled={decide.isPending}
            activeOpacity={0.8}
          >
            {decide.isPending
              ? <ActivityIndicator color={Colors.textInverse} />
              : <Text style={styles.approveText}>Approve</Text>
            }
          </TouchableOpacity>
        </View>
      )}
    </GradientBackground>
  )
}

const styles = StyleSheet.create({

  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Back row
  backRow: {
    paddingHorizontal: Spacing.px12,
    paddingBottom:     Spacing.px4,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           5,
    alignSelf:     'flex-start',
    paddingHorizontal: Spacing.px8,
    paddingVertical:   Spacing.px8,
  },
  backLabel: {
    fontSize:   FontSize.cardTitle,
    color:      Colors.textSecondary,
    fontWeight: '500',
  },

  scroll: { flex: 1 },
  content: {
    padding:       Spacing.px20,
    paddingTop:    Spacing.px8,
    paddingBottom: Spacing.px32,
    gap:           Spacing.px16,
  },

  // Header card
  headerCard: {
    backgroundColor: Colors.bgPrimary,
    borderRadius:    Radius.md,
    padding:         Spacing.px20,
    gap:             Spacing.px12,
    borderWidth:     1,
    borderColor:     Colors.borderHairline,
    borderTopColor:  Colors.borderGlass,
    overflow:        'hidden',
    ...Shadow.glassLow,
  },
  whisper: {
    position: 'absolute',
    top:      0,
    left:     0,
    right:    0,
    height:   56,
  },
  headerTop: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
  },
  toolName: {
    fontSize:      FontSize.displayM,
    fontWeight:    '500',
    fontFamily:    'Fraunces-SemiBold',
    color:         Colors.textPrimary,
    letterSpacing: -0.4,
  },
  summary: {
    fontSize:   FontSize.body,
    color:      Colors.textSecondary,
    lineHeight: 22,
  },
  divider: {
    height:          1,
    backgroundColor: Colors.borderHairline,
  },
  infoRow: {
    flexDirection: 'row',
    gap:           Spacing.px16,
  },
  infoItem: { flex: 1, gap: 4 },
  infoLabel: {
    fontSize:      FontSize.microLabel,
    color:         Colors.textTertiary,
    fontWeight:    '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  machineRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  onlineDot: { width: 5, height: 5, borderRadius: Radius.full },
  infoValue: {
    fontSize:   FontSize.label,
    color:      Colors.textPrimary,
    fontWeight: '500',
    flex:       1,
  },
  // Sections
  section: { gap: Spacing.px8 },
  sectionLabel: {
    fontSize:      FontSize.microLabel,
    fontWeight:    '600',
    color:         Colors.textTertiary,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },

  // Code block
  codeBlock: {
    flexDirection:   'row',
    backgroundColor: Colors.codeBg,
    borderRadius:    Radius.md,
    padding:         Spacing.px16,
    gap:             Spacing.px8,
    alignItems:      'flex-start',
  },
  dollarSign: {
    fontFamily: MONO,
    fontSize:   FontSize.monoSmall,
    color:      Colors.accent,
    lineHeight: 20,
    marginTop:  1,
  },
  commandText: {
    fontFamily: MONO,
    fontSize:   FontSize.monoSmall,
    color:      Colors.codeText,
    lineHeight: 20,
  },

  // Files card
  filesCard: {
    backgroundColor: Colors.bgPrimary,
    borderRadius:    Radius.sm,
    borderWidth:     1,
    borderColor:     Colors.borderHairline,
    borderTopColor:  Colors.borderGlass,
    overflow:        'hidden',
  },
  fileRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           Spacing.px8,
    padding:       Spacing.px12,
  },
  fileRowBorder: {
    borderBottomWidth: 1,
    borderColor:       Colors.borderHairline,
  },
  filePath: {
    fontFamily: MONO,
    fontSize:   FontSize.monoSmall,
    color:      Colors.textPrimary,
    flex:       1,
  },

  // Decision banner
  decidedBanner: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            Spacing.px8,
    borderRadius:   Radius.md,
    padding:        Spacing.px16,
    borderWidth:    1,
  },
  decidedText: {
    fontSize:   FontSize.label,
    fontWeight: '600',
    fontStyle:  'italic',
  },

  // Sticky footer
  footer: {
    position:        'absolute',
    bottom:          0,
    left:            0,
    right:           0,
    flexDirection:   'row',
    gap:             Spacing.px12,
    paddingHorizontal: Spacing.px20,
    paddingTop:      Spacing.px16,
    backgroundColor: Colors.surfaceGlassStrong,
    borderTopWidth:  1,
    borderColor:     Colors.borderHairline,
    borderTopColor:  Colors.borderGlass,
    alignItems:      'flex-end',
    ...Shadow.modal,
  },

  denyBtn: {
    flex:           1,
    height:         48,
    borderRadius:   Radius.full,
    borderWidth:    1.5,
    borderColor:    Colors.danger + '80',
    alignItems:     'center',
    justifyContent: 'center',
    marginBottom: Spacing.px12,
  },
  denyText: {
    fontSize:   FontSize.label,
    fontWeight: '600',
    color:      Colors.danger,
  },
  approveBtn: {
    flex:            1,
    height:          56,
    borderRadius:    Radius.full,
    backgroundColor: Colors.accentDeep,
    alignItems:      'center',
    justifyContent:  'center',
    marginBottom: Spacing.px12,
    ...Shadow.inkPill,
  },
  approveText: {
    fontSize:   FontSize.body,
    fontWeight: '600',
    color:      Colors.textInverse,
  },
})
