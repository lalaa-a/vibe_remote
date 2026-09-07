import { useEffect } from 'react'
import { Platform } from 'react-native'
import {
  getMessaging,
  getToken,
  onMessage,
  onTokenRefresh,
  setBackgroundMessageHandler,
  getInitialNotification,
} from '@react-native-firebase/messaging'
import notifee, {
  AndroidImportance,
  AndroidVisibility,
  EventType,
} from '@notifee/react-native'
import { registerPushToken } from '../api/server'
import { navigationRef } from '../navigation/RootNavigator'

// ── Request permission (Android 13+ requires explicit permission) ─────────────
async function requestPermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    const { PermissionsAndroid } = require('react-native')
    if (Platform.Version >= 33) {
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
      )
      return result === PermissionsAndroid.RESULTS.GRANTED
    }
    return true
  }

  const { requestPermission: reqPerm, AuthorizationStatus } = await import(
    '@react-native-firebase/messaging'
  )
  const authStatus = await reqPerm(getMessaging())
  return (
    authStatus === AuthorizationStatus.AUTHORIZED ||
    authStatus === AuthorizationStatus.PROVISIONAL
  )
}

// ── Save FCM token via server so the backend can send pushes ──────────────────
async function savePushToken(token: string) {
  try {
    await registerPushToken(token, Platform.OS)
    console.log('[FCM] Push token registered with server')
  } catch (e: any) {
    console.warn('[FCM] Failed to register push token:', e?.message ?? e)
  }
}

// ── Create the notification channel (Android only) ───────────────────────────
async function ensureChannel() {
  await notifee.createChannel({
    id:         'agent-requests',
    name:       'Agent requests',
    importance: AndroidImportance.HIGH,
    visibility: AndroidVisibility.PUBLIC,
    vibration:  true,
    sound:      'default',
  })
}

// ── Display an incoming FCM message as a local notification ──────────────────
// Server sends data-only messages — title/body live in remoteMessage.data.
async function displayNotification(remoteMessage: any) {
  const title = remoteMessage.data?.title
             ?? remoteMessage.notification?.title
             ?? 'Approval needed'
  const body  = remoteMessage.data?.body
             ?? remoteMessage.notification?.body
             ?? 'A tool-use request is waiting'

  await notifee.displayNotification({
    title,
    body,
    data: remoteMessage.data,
    android: {
      channelId:   'agent-requests',
      importance:  AndroidImportance.HIGH,
      pressAction: { id: 'default' },
      tag:         remoteMessage.data?.requestId,
    },
  })
}

// ── Navigate to a request detail screen from anywhere in the app ──────────────
// Uses a navigation ref so this works regardless of the calling component's
// position in the navigator tree (avoids "not handled by any navigator" error).
function navigateToRequest(requestId: string) {
  if (!navigationRef.isReady()) return
  // Navigate through: RootStack(App) → Tab(RequestsTab) → RequestsStack(RequestDetail)
  navigationRef.navigate('App', {
    screen: 'RequestsTab',
    params: {
      screen: 'RequestDetail',
      params: { id: requestId },
    },
  })
}

// ── Hook — call once in AppNavigator (inside NavigationContainer) ─────────────
export function usePushNotifications() {
  useEffect(() => {
    let unsubForeground: (() => void) | undefined
    let unsubNotifee:    (() => void) | undefined

    async function setup() {
      try {
        const m = getMessaging()

        const granted = await requestPermission()
        if (!granted) return

        await ensureChannel()

        const token = await getToken(m)
        await savePushToken(token)

        unsubForeground = onMessage(m, displayNotification)
        const unsubRefresh = onTokenRefresh(m, savePushToken)

        unsubNotifee = notifee.onForegroundEvent(({ type, detail }) => {
          if (type === EventType.PRESS) {
            const requestId = detail.notification?.data?.requestId as string | undefined
            if (requestId) navigateToRequest(requestId)
          }
        })

        return unsubRefresh
      } catch (e) {
        console.warn('[FCM] Push notification setup failed:', e)
      }
    }

    const cleanup = setup()

    // Killed-app tap: check notifee (our displayed notifications) first,
    // then Firebase (notifications that bypassed the background handler).
    notifee.getInitialNotification().then(n => {
      const id = n?.notification?.data?.requestId as string | undefined
      if (id) setTimeout(() => navigateToRequest(id), 500)
    }).catch(() => {})

    try {
      getInitialNotification(getMessaging()).then(msg => {
        if (msg?.data?.requestId) {
          setTimeout(() => navigateToRequest(msg.data!.requestId as string), 500)
        }
      })
    } catch (_) {}

    return () => {
      cleanup.then(unsub => unsub?.())
      unsubForeground?.()
      unsubNotifee?.()
    }
  }, [])
}

// ── Background message handler — register in index.js before AppRegistry ──────
export function registerBackgroundHandler() {
  try {
    setBackgroundMessageHandler(getMessaging(), async remoteMessage => {
      await ensureChannel()
      await displayNotification(remoteMessage)
    })
  } catch (e) {
    console.warn('[FCM] registerBackgroundHandler failed:', e)
  }
}
