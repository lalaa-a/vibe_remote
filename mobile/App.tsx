import React from 'react'
import { View, Text, StyleSheet, StatusBar } from 'react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { RootNavigator } from './src/navigation/RootNavigator'
import { useAppStore } from './src/store/useAppStore'
import { Colors, FontSize, Radius, Spacing } from './src/constants/colors'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry:             2,
      retryDelay:        1000,
      staleTime:         30_000,
      gcTime:            5 * 60_000,
    },
    mutations: {
      retry: 1,
    },
  },
})

// ── Toast notification ────────────────────────────────────────────────────────
function Toast() {
  const toast = useAppStore(s => s.toast)
  if (!toast) return null

  return (
    <View style={[
      styles.toast,
      { backgroundColor: toast.type === 'success' ? Colors.success : Colors.danger }
    ]}>
      <Text style={styles.toastText}>{toast.message}</Text>
    </View>
  )
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar barStyle="dark-content" />
          <RootNavigator />
          <Toast />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  toast: {
    position:        'absolute',
    bottom:          90,
    left:            Spacing.lg,
    right:           Spacing.lg,
    borderRadius:    Radius.md,
    padding:         Spacing.md,
    alignItems:      'center',
    zIndex:          9999,
  },
  toastText: {
    color:      Colors.white,
    fontSize:   FontSize.sm,
    fontWeight: '600',
  },
})
