import React from 'react'
import {
  View, Text, FlatList, StyleSheet,
  RefreshControl, StatusBar, TouchableOpacity, Alert, ActivityIndicator,
} from 'react-native'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Ionicons from 'react-native-vector-icons/Ionicons'
import { fetchMachines } from '../../api/machines'
import { fetchHarnessState, desireHarnessToggle } from '../../api/server'
import { useAuth } from '../../hooks/useAuth'
import { GradientBackground } from '../../components/GradientBackground'
import { HarnessBadge } from '../../components/HarnessBadge'
import { Colors, Spacing, Radius, FontSize, FontFamily, Shadow, TAB_BOTTOM_INSET } from '../../constants/colors'
import type { Machine, MachineHarness } from '../../types'

// ── Harness panel (per machine) ───────────────────────────────────────────────
function HarnessPanel({ machineId, isOnline }: { machineId: string; isOnline: boolean }) {
  const queryClient = useQueryClient()

  const { data: harnesses = [], isLoading } = useQuery({
    queryKey:        ['harnesses', machineId],
    queryFn:         () => fetchHarnessState(machineId),
    refetchInterval: 30_000,
    enabled:         isOnline,
  })

  const toggle = useMutation({
    mutationFn: ({ harness, enabled }: { harness: string; enabled: boolean }) =>
      desireHarnessToggle(machineId, harness, enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['harnesses', machineId] }),
  })

  const installed = harnesses.filter(h => h.installed)
  if (!isOnline && installed.length === 0) return null
  if (isLoading) {
    return (
      <View style={hStyles.loading}>
        <ActivityIndicator size="small" color={Colors.textTertiary} />
      </View>
    )
  }
  if (installed.length === 0) return null

  return (
    <View style={hStyles.panel}>
      <Text style={hStyles.panelTitle}>HARNESS MOBILE SUPPORT</Text>
      {installed.map(h => (
        <View key={h.harness} style={hStyles.row}>
          <View style={hStyles.rowLeft}>
            <HarnessBadge harness={h.harness} size="sm" />
            {h.version && <Text style={hStyles.version}>v{h.version}</Text>}
          </View>
          <TouchableOpacity
            style={[hStyles.toggleBtn, h.mobile_enabled && hStyles.toggleBtnOn]}
            onPress={() => toggle.mutate({ harness: h.harness, enabled: !h.mobile_enabled })}
            disabled={toggle.isPending || !isOnline}
            activeOpacity={0.75}
          >
            <View style={[hStyles.thumb, h.mobile_enabled && hStyles.thumbOn]} />
          </TouchableOpacity>
        </View>
      ))}
      {!isOnline && (
        <Text style={hStyles.offlineNote}>Machine offline — toggles apply when it reconnects.</Text>
      )}
    </View>
  )
}

// ── Machine card ──────────────────────────────────────────────────────────────
function MachineCard({ machine }: { machine: Machine }) {
  const lastSeen = machine.last_seen
    ? formatDistanceToNow(new Date(machine.last_seen), { addSuffix: true })
    : 'Never'
  const isOnline = machine.is_online

  return (
    <View style={styles.card}>
      <View style={styles.cardTopRow}>
        <View style={styles.nameRow}>
          <View style={[
            styles.statusDot,
            { backgroundColor: isOnline ? Colors.success : Colors.borderHairline },
          ]} />
          <Text style={styles.machineLabel} numberOfLines={1}>{machine.label}</Text>
        </View>
        <View style={[
          styles.statusPill,
          {
            backgroundColor: isOnline
              ? 'rgba(122,165,111,0.15)'
              : Colors.surfaceGlassStrong,
            borderColor: isOnline ? Colors.success + '60' : Colors.borderHairline,
          },
        ]}>
          <Text style={[
            styles.statusText,
            { color: isOnline ? Colors.successDark : Colors.textTertiary },
          ]}>
            {isOnline ? 'ONLINE' : 'OFFLINE'}
          </Text>
        </View>
      </View>

      <Text style={styles.machineId} numberOfLines={1}>{machine.id}</Text>

      <View style={styles.cardBottomRow}>
        <View style={styles.lastSeenRow}>
          <Ionicons name="time-outline" size={14} color={Colors.textTertiary} />
          <Text style={styles.lastSeen}>Last seen {lastSeen}</Text>
        </View>
      </View>

      <HarnessPanel machineId={machine.id} isOnline={isOnline} />
    </View>
  )
}

export function MachinesScreen() {
  const { signOut } = useAuth()
  const insets = useSafeAreaInsets()
  const { data: machines = [], isRefetching, refetch } = useQuery({
    queryKey:        ['machines'],
    queryFn:         fetchMachines,
    refetchInterval: 30_000,
  })

  const online  = machines.filter(m => m.is_online).length
  const offline = machines.length - online

  function handleDisconnect() {
    Alert.alert(
      'Disconnect',
      'Remove this machine pairing? You will need to scan the QR code again.',
      [
        { text: 'Cancel',     style: 'cancel' },
        { text: 'Disconnect', style: 'destructive', onPress: signOut },
      ]
    )
  }

  return (
    <GradientBackground>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />

      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View>
          <Text style={styles.appName}>Vibe Remote</Text>
          <Text style={styles.title}>Machines</Text>
        </View>
        <TouchableOpacity
          onPress={handleDisconnect}
          style={styles.disconnectBtn}
          activeOpacity={0.7}
        >
          <Ionicons name="log-out-outline" size={14} color={Colors.danger} />
          <Text style={styles.disconnectText}>Disconnect</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={machines}
        keyExtractor={m => m.id}
        renderItem={({ item }) => <MachineCard machine={item} />}
        contentContainerStyle={
          machines.length === 0 ? styles.emptyContainer : styles.listContent
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
          <View style={styles.empty}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="server-outline" size={48} color={Colors.accentDeep} />
            </View>
            <Text style={styles.emptyTitle}>{'No machines\nregistered yet.'}</Text>
            <Text style={styles.emptySub}>
              Run{' '}
              <Text style={styles.code}>node scripts/setup.js</Text>
              {' '}on each machine.
            </Text>
          </View>
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
  disconnectBtn: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               Spacing.px4,
    paddingHorizontal: Spacing.px12,
    paddingVertical:   Spacing.px8,
    borderRadius:      Radius.full,
    backgroundColor:   Colors.dangerLight + 'AA',
    borderWidth:       1,
    borderColor:       Colors.danger + '40',
  },
  disconnectText: {
    fontSize:  FontSize.label,
    color:     Colors.danger,
    fontWeight:'600',
  },
  listContent: {
    paddingHorizontal: Spacing.px20,
    paddingTop:        Spacing.px4,
    paddingBottom:     TAB_BOTTOM_INSET,
    gap:               Spacing.px12,
  },
  card: {
    backgroundColor: Colors.bgPrimary,
    borderRadius:    Radius.md,
    paddingHorizontal: Spacing.px16,
    paddingTop:      Spacing.px16,
    paddingBottom:   Spacing.px12,
    borderWidth:     1,
    borderColor:     Colors.borderHairline,
    gap:             Spacing.px8,
    ...Shadow.glassLow,
  },
  cardTopRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    gap:            Spacing.px8,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           Spacing.px8,
    flex:          1,
  },
  statusDot: {
    width:        9,
    height:       9,
    borderRadius: Radius.full,
    flexShrink:   0,
  },
  machineLabel: {
    fontSize:   FontSize.cardTitle,
    fontFamily: FontFamily.loraItalic,
    fontWeight: '600',
    color:      Colors.textPrimary,
    flex:       1,
  },
  machineId: {
    fontSize:    FontSize.monoSmall,
    fontFamily:  FontFamily.mono,
    color:       Colors.textTertiary,
    paddingLeft: 17,
  },
  statusPill: {
    paddingHorizontal: Spacing.px8,
    paddingVertical:   3,
    borderRadius:      Radius.full,
    borderWidth:       1,
    flexShrink:        0,
  },
  statusText: {
    fontSize:      FontSize.microLabel,
    fontWeight:    '700',
    letterSpacing: 0.5,
  },
  cardBottomRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    paddingTop:     Spacing.px4,
  },
  lastSeenRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           Spacing.px4,
  },
  lastSeen: {
    fontSize: FontSize.metadata,
    color:    Colors.textTertiary,
  },
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
  },
  code: {
    fontSize: FontSize.monoSmall,
    color:    Colors.accent,
  },
})

// Separate stylesheet so the panel styles don't pollute the main one
const hStyles = StyleSheet.create({
  loading: {
    paddingVertical: Spacing.px8,
    alignItems:      'center',
  },
  panel: {
    marginTop:    Spacing.px8,
    paddingTop:   Spacing.px12,
    borderTopWidth: 1,
    borderTopColor: Colors.borderHairline,
    gap:          Spacing.px8,
  },
  panelTitle: {
    fontSize:      FontSize.microLabel,
    fontWeight:    '600',
    color:         Colors.textTertiary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom:  Spacing.px4,
  },
  row: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           Spacing.px8,
  },
  version: {
    fontSize:  FontSize.metadata,
    color:     Colors.textTertiary,
    fontStyle: 'italic',
  },
  toggleBtn: {
    width:        44,
    height:       24,
    borderRadius: Radius.full,
    backgroundColor: Colors.borderHairline,
    borderWidth:  1,
    borderColor:  Colors.borderHairline,
    justifyContent: 'center',
    padding:      2,
  },
  toggleBtnOn: {
    backgroundColor: Colors.successDark,
    borderColor:     Colors.successDark,
  },
  thumb: {
    width:        18,
    height:       18,
    borderRadius: Radius.full,
    backgroundColor: Colors.textTertiary,
  },
  thumbOn: {
    backgroundColor: '#fff',
    alignSelf:       'flex-end',
  },
  offlineNote: {
    fontSize:  FontSize.metadata,
    color:     Colors.textTertiary,
    fontStyle: 'italic',
    marginTop: Spacing.px4,
  },
})
