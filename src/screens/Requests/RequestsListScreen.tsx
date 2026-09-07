import React, { useState, useRef, useEffect, useMemo } from 'react'
import {
  View, Text, FlatList, StyleSheet, ScrollView,
  RefreshControl, TouchableOpacity, StatusBar, Animated,
} from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Ionicons from 'react-native-vector-icons/Ionicons'
import { usePendingRequests, useHistory, useDecideRequest } from '../../hooks/useRequests'
import { RequestCard } from '../../components/RequestCard'
import { GradientBackground } from '../../components/GradientBackground'
import { LiveBadge } from '../../components/LiveBadge'
import { Colors, Spacing, FontSize, Radius, Shadow, FontFamily, TAB_BOTTOM_INSET } from '../../constants/colors'
import type { RequestsStackParamList, PendingRequest } from '../../types'

type Nav        = NativeStackNavigationProp<RequestsStackParamList>
type Filter     = 'pending' | 'approved' | 'denied'
type ToolFilter = 'all' | 'bash' | 'file-edit' | 'read'

// ── Skeleton card ─────────────────────────────────────────────────────────────
function SkeletonCard({ anim }: { anim: Animated.Value }) {
  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0.9] })
  return (
    <Animated.View style={[styles.skeletonCard, { opacity }]}>
      <View style={styles.skeletonTop}>
        <View style={styles.skeletonDot} />
        <View style={styles.skeletonTag} />
        <View style={styles.skeletonBadge} />
      </View>
      <View style={styles.skeletonLine} />
      <View style={[styles.skeletonLine, { width: '65%' }]} />
      <View style={styles.skeletonMeta} />
    </Animated.View>
  )
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

// ── Screen ────────────────────────────────────────────────────────────────────
export function RequestsListScreen() {
  const navigation = useNavigation<Nav>()
  const insets     = useSafeAreaInsets()
  const [filter, setFilter] = useState<Filter>('pending')

  const { data: pending = [], isLoading, refetch, isRefetching } = usePendingRequests()
  const { data: history = [] } = useHistory()
  const decide = useDecideRequest()
  const [toolFilter, setToolFilter] = useState<ToolFilter>('all')

  const shimmer = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [])

  const all = useMemo(() => [...pending, ...history], [pending, history])

  const displayData: PendingRequest[] = useMemo(() => {
    const byStatus =
      filter === 'pending'  ? pending :
      filter === 'approved' ? history.filter(r => r.status === 'approved') :
                              history.filter(r => r.status === 'denied')

    return byStatus.filter(item => {
      if (toolFilter === 'all')       return true
      if (toolFilter === 'bash')      return item.tool_name === 'Bash'
      if (toolFilter === 'file-edit') return ['Edit', 'Write', 'MultiEdit'].includes(item.tool_name)
      if (toolFilter === 'read')      return item.tool_name === 'Read'
      return true
    })
  }, [filter, toolFilter, pending, history])

  const counts: Record<Filter, number> = {
    pending:  pending.length,
    approved: history.filter(r => r.status === 'approved').length,
    denied:   history.filter(r => r.status === 'denied').length,
  }

  const bashCount     = all.filter(r => r.tool_name === 'Bash').length
  const fileEditCount = all.filter(r => ['Edit', 'Write', 'MultiEdit'].includes(r.tool_name)).length
  const readCount     = all.filter(r => r.tool_name === 'Read').length

  function renderItem({ item }: { item: PendingRequest }) {
    return (
      <RequestCard
        request={item}
        onPress={() => navigation.navigate('RequestDetail', { id: item.id })}
        onApprove={filter === 'pending' ? () => decide.mutate({ id: item.id, decision: 'approved' }) : undefined}
        onDeny={filter === 'pending'    ? () => decide.mutate({ id: item.id, decision: 'denied'   }) : undefined}
      />
    )
  }

  return (
    <GradientBackground>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View>
          <Text style={styles.appName}>Vibe Remote</Text>
          <Text style={styles.title}>Requests</Text>
        </View>
        <LiveBadge />
      </View>

      {/* Filter chips */}
      <View style={styles.filtersWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
        >
          <FilterChip
            label="Pending"
            count={counts.pending}
            active={filter === 'pending'}
            onPress={() => { setFilter('pending'); setToolFilter('all') }}
          />
          <FilterChip
            label="Approved"
            count={counts.approved}
            active={filter === 'approved'}
            onPress={() => { setFilter('approved'); setToolFilter('all') }}
          />
          <FilterChip
            label="Denied"
            count={counts.denied}
            active={filter === 'denied'}
            onPress={() => { setFilter('denied'); setToolFilter('all') }}
          />
          <View style={styles.chipDivider} />
          <FilterChip
            label="All"
            active={toolFilter === 'all'}
            onPress={() => setToolFilter('all')}
          />
          <FilterChip
            label="Bash"
            count={bashCount}
            active={toolFilter === 'bash'}
            onPress={() => setToolFilter('bash')}
          />
          <FilterChip
            label="File Edit"
            count={fileEditCount}
            active={toolFilter === 'file-edit'}
            onPress={() => setToolFilter('file-edit')}
          />
          <FilterChip
            label="Read"
            count={readCount}
            active={toolFilter === 'read'}
            onPress={() => setToolFilter('read')}
          />
        </ScrollView>
      </View>

      {/* List */}
      <FlatList
        data={displayData}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        contentContainerStyle={
          displayData.length === 0 ? styles.emptyContainer : styles.listContent
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
          isLoading ? (
            <View style={styles.skeletons}>
              <SkeletonCard anim={shimmer} />
              <SkeletonCard anim={shimmer} />
              <SkeletonCard anim={shimmer} />
            </View>
          ) : (
            <View style={styles.empty}>
              <View style={styles.emptyIconWrap}>
                <Ionicons
                  name={filter === 'pending' ? 'checkmark-circle-outline'
                    : filter === 'approved'   ? 'checkmark-circle'
                    : 'close-circle-outline'}
                  size={48}
                  color={Colors.accentDeep}
                />
              </View>
              <Text style={styles.emptyTitle}>
                {filter === 'pending'  ? 'All clear,\nno requests.'  :
                 filter === 'approved' ? 'Nothing\napproved yet.'     :
                                         'Nothing\ndenied yet.'}
              </Text>
              <Text style={styles.emptySub}>
                {filter === 'pending'
                  ? "You'll see new requests here the moment Claude needs you."
                  : 'Decided requests appear here once processed.'}
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
    paddingBottom:     Spacing.px12,
  },
  appName: {
    fontSize:   28,
    fontFamily: FontFamily.serifItalic,
    color:      Colors.textPrimary,
    lineHeight: 32,
  },
  title: {
    fontSize:   FontSize.cardTitle,
    fontFamily: FontFamily.loraItalic,
    fontWeight: '500',
    color:      Colors.textTertiary,
    letterSpacing: 0.3,
  },
  // Filter chips
  filtersWrap: {
    paddingBottom: Spacing.px8,
  },
  filters: {
    flexDirection:     'row',
    paddingHorizontal: Spacing.px20,
    paddingVertical:   Spacing.px8,
    gap:               Spacing.px4,
    alignItems:        'center',
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
    width:            1,
    height:           20,
    backgroundColor:  Colors.border,
    marginHorizontal: 2,
  },

  listContent: {
    paddingTop:    Spacing.px4,
    paddingBottom: TAB_BOTTOM_INSET,
  },

  // Skeleton
  skeletons: {
    paddingTop: Spacing.px4,
    gap:        12,
  },
  skeletonCard: {
    backgroundColor: Colors.surfaceGlass,
    marginHorizontal: Spacing.px20,
    borderRadius:    Radius.xl,
    borderWidth:     1,
    borderColor:     Colors.borderHairline,
    padding:         Spacing.px20,
    gap:             Spacing.px12,
  },
  skeletonTop: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           Spacing.px8,
  },
  skeletonDot:  { width: 6,  height: 6,  borderRadius: Radius.full, backgroundColor: Colors.creamDeep },
  skeletonTag:  { flex: 1,   height: 12, borderRadius: Radius.sm,   backgroundColor: Colors.creamDeep, maxWidth: 60 },
  skeletonBadge:{ width: 52, height: 20, borderRadius: Radius.full, backgroundColor: Colors.creamDeep },
  skeletonLine: { width: '100%', height: 14, borderRadius: Radius.sm, backgroundColor: Colors.creamDeep },
  skeletonMeta: { width: 140,    height: 10, borderRadius: Radius.sm, backgroundColor: Colors.creamDeep },

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
})
