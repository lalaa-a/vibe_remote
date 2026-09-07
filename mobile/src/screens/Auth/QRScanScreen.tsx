import React, { useState, useRef, useEffect } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, StatusBar, Animated, Platform,
} from 'react-native'
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useCodeScanner,
} from 'react-native-vision-camera'
import {
  verifyCredentials,
  saveCredentials,
  type MachineCredentials,
} from '../../api/server'
import { useAppStore } from '../../store/useAppStore'
import Config from 'react-native-config'
import { GradientBackground } from '../../components/GradientBackground'
import { Colors, Spacing, Radius, FontSize, FontFamily, Shadow } from '../../constants/colors'

interface QRPayload {
  machineId:   string
  apiKey:      string
  supabaseUrl: string
  apiUrl:      string
}

const FRAME  = 240
const CORNER = 28
const BORDER = 3

// ── Pulsing scan brackets ─────────────────────────────────────────────────────
function ScanBrackets({ connected }: { connected: boolean }) {
  const scale = useRef(new Animated.Value(1)).current

  useEffect(() => {
    if (connected) {
      Animated.spring(scale, {
        toValue: 1.08, useNativeDriver: true, tension: 80, friction: 5,
      }).start()
      return
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.03, duration: 1500, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1.00, duration: 1500, useNativeDriver: true }),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [connected])

  const cornerColor = connected ? Colors.success : Colors.accent

  return (
    <Animated.View style={[styles.frame, { transform: [{ scale }] }]}>
      <View style={[styles.corner, styles.tl, { borderColor: cornerColor }]} />
      <View style={[styles.corner, styles.tr, { borderColor: cornerColor }]} />
      <View style={[styles.corner, styles.bl, { borderColor: cornerColor }]} />
      <View style={[styles.corner, styles.br, { borderColor: cornerColor }]} />
    </Animated.View>
  )
}

export function QRScanScreen() {
  const setCredentials  = useAppStore(s => s.setCredentials)
  const { hasPermission, requestPermission } = useCameraPermission()
  const device          = useCameraDevice('back')
  const [loading,   setLoading]   = useState(false)
  const [connected, setConnected] = useState(false)
  const [statusMsg, setStatusMsg] = useState('Waiting for QR…')
  const isProcessing = useRef(false)

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes) => {
      if (isProcessing.current) return

      const raw = codes[0]?.value
      if (!raw) return

      let payload: QRPayload
      try { payload = JSON.parse(raw) } catch { return }

      if (!payload.machineId || !payload.apiKey) return

      const apiUrl = payload.apiUrl || Config.API_URL || ''
      if (!apiUrl) { setStatusMsg('No API URL in QR code'); return }

      isProcessing.current = true
      setLoading(true)
      setStatusMsg('Connecting…')

      const creds: MachineCredentials = {
        machineId:   payload.machineId,
        apiKey:      payload.apiKey,
        supabaseUrl: payload.supabaseUrl ?? '',
        apiUrl,
      }

      verifyCredentials(creds)
        .then(() => {
          setConnected(true)
          setStatusMsg('Connected!')
          saveCredentials(creds)
          setTimeout(() => setCredentials(creds), 600)
        })
        .catch((err: any) => {
          setStatusMsg(err.message ?? 'Connection failed')
          Alert.alert(
            'Connection failed',
            err.message ?? 'Could not connect to machine.',
            [{ text: 'Try again', onPress: () => {
              isProcessing.current = false
              setLoading(false)
              setStatusMsg('Waiting for QR…')
            }}]
          )
        })
    },
  })

  // ── No camera permission ──────────────────────────────────────────────────
  if (!hasPermission) {
    return (
      <GradientBackground>
        <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />
        <View style={styles.permCenter}>
          <View style={styles.logoBox}>
            <Text style={styles.logoInitials}>VR</Text>
          </View>
          <Text style={styles.permTitle}>Camera access needed</Text>
          <Text style={styles.permSub}>
            Point your camera at the QR code shown on the Vibe Remote desktop app to connect your machine.
          </Text>
          <TouchableOpacity style={styles.inkBtn} onPress={requestPermission} activeOpacity={0.8}>
            <Text style={styles.inkBtnText}>Grant camera access</Text>
          </TouchableOpacity>
        </View>
      </GradientBackground>
    )
  }

  if (!device) {
    return (
      <GradientBackground>
        <View style={styles.permCenter}>
          <Text style={styles.permSub}>No camera found on this device.</Text>
        </View>
      </GradientBackground>
    )
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={!loading}
        codeScanner={codeScanner}
      />

      {/* Dark overlay */}
      <View style={styles.overlay}>
        {/* Top */}
        <View style={styles.topSection}>
          <View style={styles.logoBox}>
            <Text style={styles.logoInitials}>VR</Text>
          </View>
          <Text style={styles.cameraTitle}>Vibe Remote</Text>
          <Text style={styles.cameraSubtitle}>
            Scan the QR code shown on the desktop app dashboard.
          </Text>
        </View>

        {/* Scan frame */}
        <View style={styles.frameWrap}>
          <ScanBrackets connected={connected} />
          {loading && (
            <View style={styles.spinnerWrap}>
              <ActivityIndicator size="large" color={Colors.success} />
            </View>
          )}
        </View>

        {/* Status pill */}
        <View style={styles.bottomSection}>
          <View style={[
            styles.statusPill,
            connected && { backgroundColor: Colors.risk.low.bg, borderColor: Colors.risk.low.border },
          ]}>
            <Text style={[styles.statusText, connected && { color: Colors.risk.low.text }]}>
              {statusMsg}
            </Text>
          </View>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex:            1,
    backgroundColor: '#000',
  },

  // Permission fallback (on gradient)
  permCenter: {
    flex:              1,
    justifyContent:    'center',
    alignItems:        'center',
    paddingHorizontal: Spacing.px32,
    paddingTop:        Spacing.px56,
    gap:               Spacing.px16,
  },
  logoBox: {
    width:           60,
    height:          60,
    borderRadius:    Radius.lg,
    backgroundColor: Colors.accentLight,
    alignItems:      'center',
    justifyContent:  'center',
    marginBottom:    Spacing.px8,
  },
  logoInitials: {
    fontSize:      16,
    fontWeight:    '700',
    fontFamily:    FontFamily.serifBold,
    color:         Colors.accentDeep,
    letterSpacing: 1,
  },
  permTitle: {
    fontSize:      FontSize.displayM,
    fontWeight:    '500',
    fontFamily:    FontFamily.serifBold,
    color:         Colors.textPrimary,
    textAlign:     'center',
    letterSpacing: -0.4,
  },
  permSub: {
    fontSize:   FontSize.body,
    color:      Colors.textSecondary,
    textAlign:  'center',
    lineHeight: 22,
    maxWidth:   280,
  },
  inkBtn: {
    marginTop:       Spacing.px8,
    height:          56,
    borderRadius:    Radius.full,
    backgroundColor: Colors.inkBlack,
    paddingHorizontal: Spacing.px32,
    alignItems:      'center',
    justifyContent:  'center',
    ...Shadow.inkPill,
  },
  inkBtnText: {
    fontSize:   FontSize.body,
    fontWeight: '600',
    color:      Colors.textInverse,
  },

  // Camera overlay
  overlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'space-between',
    alignItems:     'center',
  },
  topSection: {
    alignItems:        'center',
    paddingTop:        Platform.OS === 'ios' ? 72 : 56,
    paddingHorizontal: Spacing.px32,
    gap:               Spacing.px8,
    backgroundColor:   'rgba(0,0,0,0.55)',
    width:             '100%',
    paddingBottom:     Spacing.px24,
  },
  cameraTitle: {
    fontSize:      FontSize.displayM,
    fontWeight:    '700',
    color:         '#FFFFFF',
    letterSpacing: -0.3,
  },
  cameraSubtitle: {
    fontSize:   FontSize.label,
    color:      'rgba(255,255,255,0.70)',
    textAlign:  'center',
    lineHeight: 20,
  },

  // Scan brackets
  frameWrap: {
    alignItems:     'center',
    justifyContent: 'center',
  },
  frame: {
    width:          FRAME,
    height:         FRAME,
    justifyContent: 'center',
    alignItems:     'center',
  },
  corner: {
    position: 'absolute',
    width:    CORNER,
    height:   CORNER,
  },
  tl: { top: 0, left: 0,  borderTopWidth: BORDER,    borderLeftWidth:  BORDER, borderTopLeftRadius:     6 },
  tr: { top: 0, right: 0, borderTopWidth: BORDER,    borderRightWidth: BORDER, borderTopRightRadius:    6 },
  bl: { bottom: 0, left: 0,  borderBottomWidth: BORDER, borderLeftWidth:  BORDER, borderBottomLeftRadius:  6 },
  br: { bottom: 0, right: 0, borderBottomWidth: BORDER, borderRightWidth: BORDER, borderBottomRightRadius: 6 },
  spinnerWrap: {
    position:       'absolute',
    alignItems:     'center',
    justifyContent: 'center',
  },

  // Status
  bottomSection: {
    paddingBottom:     Platform.OS === 'ios' ? 60 : 40,
    paddingHorizontal: Spacing.px32,
    alignItems:        'center',
    width:             '100%',
    backgroundColor:   'rgba(0,0,0,0.55)',
    paddingTop:        Spacing.px24,
  },
  statusPill: {
    backgroundColor:   'rgba(0,0,0,0.50)',
    borderRadius:      Radius.full,
    paddingHorizontal: Spacing.px16,
    paddingVertical:   Spacing.px8,
    borderWidth:       1,
    borderColor:       'rgba(255,255,255,0.15)',
  },
  statusText: {
    fontSize:   FontSize.label,
    color:      'rgba(255,255,255,0.80)',
    fontWeight: '500',
    textAlign:  'center',
  },
})
