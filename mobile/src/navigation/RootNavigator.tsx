import React from 'react'
import {
  NavigationContainer,
  createNavigationContainerRef,
} from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs'
import {
  View, Text, TouchableOpacity, StyleSheet,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Ionicons from 'react-native-vector-icons/Ionicons'
import { useAuth } from '../hooks/useAuth'
import { QRScanScreen } from '../screens/Auth/QRScanScreen'
import { RequestsListScreen } from '../screens/Requests/RequestsListScreen'
import { RequestDetailScreen } from '../screens/Requests/RequestDetailScreen'
import { SessionsScreen } from '../screens/Sessions/SessionsScreen'
import { ChatScreen } from '../screens/Sessions/ChatScreen'
import { FileBrowserScreen } from '../screens/Sessions/FileBrowserScreen'
import { RequestDetailScreen as RequestDetailFromChat } from '../screens/Requests/RequestDetailScreen'
import { MachinesScreen } from '../screens/Machines/MachinesScreen'
import { usePendingRequests } from '../hooks/useRequests'
import { useSessions } from '../hooks/useSessions'
import { usePushNotifications } from '../hooks/usePushNotifications'
import { Colors, Radius, Shadow, FontFamily, FontSize } from '../constants/colors'
import type {
  RootStackParamList,
  TabParamList,
  RequestsStackParamList,
  SessionsStackParamList,
} from '../types'

export const navigationRef = createNavigationContainerRef<RootStackParamList>()

const RootStack     = createNativeStackNavigator<RootStackParamList>()
const Tab           = createBottomTabNavigator<TabParamList>()
const RequestsStack = createNativeStackNavigator<RequestsStackParamList>()
const SessionsStack = createNativeStackNavigator<SessionsStackParamList>()

const HEADER_OPTS = {
  headerStyle:      { backgroundColor: Colors.cream },
  headerTintColor:  Colors.accentDeep,
  headerTitleStyle: { color: Colors.textPrimary, fontSize: FontSize.label, fontWeight: '600' as const },
  headerBackTitle:  'Back',
}

// ── Tab metadata ──────────────────────────────────────────────────────────────
const TAB_META: Record<string, {
  label:        string
  iconActive:   string
  iconInactive: string
}> = {
  RequestsTab: { label: 'Requests', iconActive: 'notifications', iconInactive: 'notifications-outline' },
  ChatsTab:    { label: 'Chats',    iconActive: 'chatbubbles',   iconInactive: 'chatbubbles-outline'   },
  MachinesTab: { label: 'Machines', iconActive: 'server',        iconInactive: 'server-outline'        },
}

// ── Single tab button ─────────────────────────────────────────────────────────
function TabButton({
  routeName, isFocused, badge, onPress,
}: {
  routeName: string
  isFocused: boolean
  badge:     number
  onPress:   () => void
}) {
  const meta = TAB_META[routeName] ?? {
    label: routeName, iconActive: 'ellipse', iconInactive: 'ellipse-outline',
  }

  return (
    <TouchableOpacity
      style={styles.tabBtn}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <View style={[styles.tabChip, isFocused && styles.tabChipActive]}>
        <Ionicons
          name={isFocused ? meta.iconActive : meta.iconInactive}
          size={26}
          color={isFocused ? Colors.tabActive : Colors.tabInactive}
        />
      </View>

      {badge > 0 && (
        <View style={[
          styles.badge,
          { backgroundColor: routeName === 'ChatsTab' ? Colors.successDark : Colors.danger },
        ]}>
          <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      )}
    </TouchableOpacity>
  )
}

// ── Floating glass pill tab bar ───────────────────────────────────────────────
type FloatingTabBarProps = BottomTabBarProps & {
  badges: Record<string, number>
}

function FloatingTabBar({ state, navigation, badges }: FloatingTabBarProps) {
  const insets = useSafeAreaInsets()

  return (
    <View
      style={[styles.tabBarWrap, { bottom: insets.bottom + 16 }]}
      pointerEvents="box-none"
    >
      <View style={styles.pill}>
        {state.routes.map((route, index) => {
          const isFocused = state.index === index

          const onPress = () => {
            const event = navigation.emit({
              type:              'tabPress',
              target:            route.key,
              canPreventDefault: true,
            })
            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name)
            }
          }

          return (
            <TabButton
              key={route.key}
              routeName={route.name}
              isFocused={isFocused}
              badge={badges[route.name] ?? 0}
              onPress={onPress}
            />
          )
        })}
      </View>
    </View>
  )
}

// ── Requests stack ────────────────────────────────────────────────────────────
function RequestsNavigator() {
  return (
    <RequestsStack.Navigator screenOptions={HEADER_OPTS}>
      <RequestsStack.Screen
        name="RequestsList"
        component={RequestsListScreen}
        options={{ headerShown: false }}
      />
      <RequestsStack.Screen
        name="RequestDetail"
        component={RequestDetailScreen}
        options={{ headerShown: false }}
      />
    </RequestsStack.Navigator>
  )
}

// ── Chats stack ───────────────────────────────────────────────────────────────
function ChatsNavigator() {
  return (
    <SessionsStack.Navigator screenOptions={HEADER_OPTS}>
      <SessionsStack.Screen
        name="ChatsList"
        component={SessionsScreen}
        options={{ headerShown: false }}
      />
      <SessionsStack.Screen
        name="Chat"
        component={ChatScreen}
        options={{ headerShown: false }}
      />
      <SessionsStack.Screen
        name="RequestDetail"
        component={RequestDetailFromChat}
        options={{ headerShown: false }}
      />
      <SessionsStack.Screen
        name="FileBrowser"
        component={FileBrowserScreen}
        options={({ route }) => ({ title: route.params.machineLabel })}
      />
    </SessionsStack.Navigator>
  )
}

// ── App navigator ─────────────────────────────────────────────────────────────
function AppNavigator() {
  const { data: pending  = [] } = usePendingRequests()
  const { data: sessions = [] } = useSessions()
  usePushNotifications()

  const pendingCount = pending.length
  const activeChats  = sessions.filter(s => s.pending_count > 0).reduce((n, s) => n + s.pending_count, 0)

  return (
    <Tab.Navigator
      screenOptions={{ headerShown: false }}
      tabBar={(props) => (
        <FloatingTabBar
          {...props}
          badges={{
            RequestsTab: pendingCount,
            ChatsTab:    activeChats,
          }}
        />
      )}
    >
      <Tab.Screen name="RequestsTab" component={RequestsNavigator} />
      <Tab.Screen name="ChatsTab"    component={ChatsNavigator} />
      <Tab.Screen name="MachinesTab" component={MachinesScreen} />
    </Tab.Navigator>
  )
}

// ── Root — auth guard ─────────────────────────────────────────────────────────
export function RootNavigator() {
  const { credentials, loading } = useAuth()
  if (loading) return null

  return (
    <NavigationContainer ref={navigationRef}>
      <RootStack.Navigator screenOptions={{ headerShown: false }}>
        {credentials
          ? <RootStack.Screen name="App"    component={AppNavigator} />
          : <RootStack.Screen name="SignIn" component={QRScanScreen} />
        }
      </RootStack.Navigator>
    </NavigationContainer>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  tabBarWrap: {
    position: 'absolute',
    left:     20,
    right:    20,
  },
  pill: {
    flexDirection:     'row',
    height:            76,
    borderRadius:      Radius.full,
    backgroundColor:   Colors.surfaceGlassStrong,
    borderWidth:       2.5,
    borderColor:       Colors.borderHairline,
    borderTopColor:    Colors.borderGlass,
    alignItems:        'center',
    paddingHorizontal: 8,
    ...Shadow.float,
  },
  tabBtn: {
    flex:           1,
    alignItems:     'center',
    justifyContent: 'center',
    height:         '100%',
  },
  tabChip: {
    width:          52,
    height:         52,
    borderRadius:   25,
    overflow:       'hidden',
    alignItems:     'center',
    justifyContent: 'center',
  },
  tabChipActive: {
    backgroundColor: Colors.accentLight,
  },
  badge: {
    position:          'absolute',
    top:               8,
    right:             '10%',
    minWidth:          16,
    height:            16,
    borderRadius:      Radius.full,
    alignItems:        'center',
    justifyContent:    'center',
    paddingHorizontal: 3,
    borderWidth:       2,
    borderColor:       Colors.cream,
  },
  badgeText: {
    fontSize:   9,
    color:      Colors.white,
    fontWeight: '700',
  },
})
