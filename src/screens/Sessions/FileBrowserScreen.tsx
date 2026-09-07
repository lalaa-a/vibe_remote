import React, { useEffect, useState, useCallback } from 'react'
import {
  View, Text, FlatList, StyleSheet,
  TouchableOpacity, ActivityIndicator,
  Alert, Platform, StatusBar,
} from 'react-native'
import Ionicons from 'react-native-vector-icons/Ionicons'
import { useRoute, useNavigation } from '@react-navigation/native'
import type { RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useFileTree } from '../../hooks/useFileTree'
import { GradientBackground } from '../../components/GradientBackground'
import { Colors, Spacing, Radius, FontSize, FontFamily, TAB_BOTTOM_INSET, Shadow } from '../../constants/colors'
import type { SessionsStackParamList, FsNode } from '../../types'

type Route = RouteProp<SessionsStackParamList, 'FileBrowser'>
type Nav   = NativeStackNavigationProp<SessionsStackParamList>

type FlatItem = { node: FsNode; depth: number }

function flattenTree(nodes: FsNode[], depth: number, expanded: Set<string>): FlatItem[] {
  const result: FlatItem[] = []
  for (const node of nodes) {
    result.push({ node, depth })
    if (node.type === 'dir' && expanded.has(node.path) && node.children) {
      result.push(...flattenTree(node.children, depth + 1, expanded))
    }
  }
  return result
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function FileBrowserScreen() {
  const route      = useRoute<Route>()
  const navigation = useNavigation<Nav>()
  const { sessionId, cwd } = route.params

  const { tree, error, loadPath, loading } = useFileTree(sessionId)
  const [expanded,    setExpanded]    = useState<Set<string>>(new Set())
  const [loadingPath, setLoadingPath] = useState<string | null>(null)

  useEffect(() => { loadPath('.') }, [])

  useEffect(() => {
    if (!tree) return
    const topDirs = tree.filter(n => n.type === 'dir').map(n => n.path)
    setExpanded(new Set(topDirs))
  }, [tree !== null])

  const handleNodePress = useCallback(async (item: FlatItem) => {
    const { node } = item
    if (node.type === 'file') return

    if (node.children === null) {
      setLoadingPath(node.path)
      await loadPath(node.path)
      setLoadingPath(null)
      setExpanded(prev => new Set([...prev, node.path]))
    } else {
      setExpanded(prev => {
        const next = new Set(prev)
        if (next.has(node.path)) next.delete(node.path)
        else next.add(node.path)
        return next
      })
    }
  }, [loadPath])

  const handleNodeLongPress = useCallback((node: FsNode) => {
    Alert.alert(node.name, node.path, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Use in prompt',
        onPress: () => {
          // Navigate back to Chat and set prefill so the compose bar is populated.
          // merge:true updates the existing Chat screen in the stack without
          // pushing a new one, so the back button still works correctly.
          navigation.navigate('Chat', {
            ...route.params,
            // FileBrowser params subset — Chat requires these at minimum:
            sessionId:       route.params.sessionId,
            machineLabel:    route.params.machineLabel,
            cwd:             route.params.cwd,
            machineIsOnline: true,
            harness:         'claude-code' as any,
            status:          'idle' as any,
            prefill:         `Look at ${node.path} and `,
          } as any)
        },
      },
    ])
  }, [navigation])

  const flatItems = tree ? flattenTree(tree, 0, expanded) : []

  function renderItem({ item }: { item: FlatItem }) {
    const { node, depth } = item
    const isDir      = node.type === 'dir'
    const isExpanded = isDir && expanded.has(node.path)
    const isLoading  = loadingPath === node.path

    return (
      <TouchableOpacity
        style={[styles.row, { paddingLeft: Spacing.px20 + depth * 16 }]}
        onPress={() => handleNodePress(item)}
        onLongPress={() => handleNodeLongPress(node)}
        activeOpacity={0.6}
        delayLongPress={400}
      >
        <Ionicons
          name={isDir ? (isExpanded ? 'chevron-down' : 'chevron-forward') : 'document-outline'}
          size={12}
          color={isDir ? Colors.accent : Colors.textTertiary}
          style={styles.nodeIcon}
        />
        <Text
          style={[styles.nodeName, isDir && styles.dirName]}
          numberOfLines={1}
        >
          {node.name}
        </Text>
        {isLoading && (
          <ActivityIndicator size="small" color={Colors.accent} />
        )}
        {!isDir && node.size !== undefined && (
          <Text style={styles.fileSize}>{formatSize(node.size)}</Text>
        )}
        {isDir && node.children === null && !isLoading && (
          <Text style={styles.lazyHint}>tap</Text>
        )}
      </TouchableOpacity>
    )
  }

  return (
    <GradientBackground>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />

      {/* Pinned path bar */}
      <View style={styles.pathBar}>
        <Ionicons name="folder-open-outline" size={13} color={Colors.textTertiary} />
        <Text style={styles.pathText} numberOfLines={1}>{cwd ?? '~'}/</Text>
        {loading && <ActivityIndicator size="small" color={Colors.accent} />}
      </View>

      {error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => loadPath('.')}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : loading && !tree ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.accent} />
          <Text style={styles.loadingText}>Loading file tree…</Text>
        </View>
      ) : (
        <FlatList
          data={flatItems}
          keyExtractor={item => item.node.path}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyText}>Empty directory</Text>
            </View>
          }
        />
      )}

      {/* Glass hint bar */}
      <View style={styles.hintBar}>
        <Ionicons name="finger-print-outline" size={12} color={Colors.textTertiary} />
        <Text style={styles.hintText}>Long-press any item to use path in a prompt</Text>
      </View>
    </GradientBackground>
  )
}

const styles = StyleSheet.create({
  pathBar: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               Spacing.px8,
    paddingHorizontal: Spacing.px20,
    paddingVertical:   Spacing.px12,
    backgroundColor:   Colors.surfaceGlassStrong,
    borderBottomWidth: 1,
    borderColor:       Colors.borderHairline,
    borderTopColor:    Colors.borderGlass,
    ...Shadow.glassLow,
  },
  pathText: {
    flex:       1,
    fontFamily: FontFamily.mono,
    fontSize:   FontSize.monoSmall,
    color:      Colors.textSecondary,
  },
  list: {
    paddingTop:    Spacing.px8,
    paddingBottom: TAB_BOTTOM_INSET,
  },
  row: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingRight:      Spacing.px20,
    paddingVertical:   Spacing.px8,
    gap:               Spacing.px8,
    borderBottomWidth: 1,
    borderColor:       Colors.borderHairline,
  },
  nodeIcon: {
    width:     14,
    textAlign: 'center',
  },
  nodeName: {
    flex:       1,
    fontFamily: FontFamily.mono,
    fontSize:   FontSize.monoSmall,
    color:      Colors.textPrimary,
  },
  dirName: {
    fontWeight: '600',
    color:      Colors.accent,
  },
  fileSize: {
    fontFamily: FontFamily.mono,
    fontSize:   FontSize.microLabel,
    color:      Colors.textTertiary,
    minWidth:   48,
    textAlign:  'right',
  },
  lazyHint: {
    fontSize:  FontSize.microLabel,
    color:     Colors.textTertiary,
    fontStyle: 'italic',
  },
  center: {
    flex:           1,
    alignItems:     'center',
    justifyContent: 'center',
    gap:            Spacing.px12,
    padding:        Spacing.px32,
  },
  loadingText: {
    fontSize: FontSize.label,
    color:    Colors.textSecondary,
  },
  emptyText: {
    fontSize:  FontSize.label,
    color:     Colors.textTertiary,
    fontStyle: 'italic',
  },
  errorText: {
    fontSize:  FontSize.label,
    color:     Colors.danger,
    textAlign: 'center',
  },
  retryBtn: {
    paddingHorizontal: Spacing.px20,
    paddingVertical:   Spacing.px8,
    borderRadius:      Radius.sm,
    borderWidth:       1,
    borderColor:       Colors.danger + '60',
  },
  retryText: {
    fontSize:   FontSize.label,
    fontWeight: '600',
    color:      Colors.danger,
  },
  hintBar: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'center',
    gap:               Spacing.px4,
    paddingVertical:   Spacing.px12,
    paddingBottom:     Platform.OS === 'ios' ? 32 : Spacing.px12,
    backgroundColor:   Colors.surfaceGlassStrong,
    borderTopWidth:    1,
    borderColor:       Colors.borderHairline,
    borderTopColor:    Colors.borderGlass,
  },
  hintText: {
    fontSize:  FontSize.microLabel,
    color:     Colors.textTertiary,
    fontStyle: 'italic',
  },
})
