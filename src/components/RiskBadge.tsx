import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import Ionicons from 'react-native-vector-icons/Ionicons'
import { Colors, Radius, FontSize } from '../constants/colors'
import type { RiskLevel } from '../types'

interface Props {
  level:     RiskLevel
  showIcon?: boolean
}

const RISK_CONFIG: Record<RiskLevel, { label: string; icon: string }> = {
  low:      { label: 'Low',      icon: 'checkmark'     },
  medium:   { label: 'Medium',   icon: 'alert-outline' },
  high:     { label: 'High',     icon: 'alert'         },
  critical: { label: 'Critical', icon: 'close'         },
}

export function RiskBadge({ level, showIcon = true }: Props) {
  const cfg   = RISK_CONFIG[level] ?? RISK_CONFIG.low
  const color = Colors.risk[level] ?? Colors.risk.low

  return (
    <View style={[styles.badge, { backgroundColor: color.bg, borderColor: color.border }]}>
      <Ionicons name={cfg.icon} size={10} color={color.text} />
      <Text style={[styles.label, { color: color.text }]}>{cfg.label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               3,
    paddingHorizontal: 8,
    paddingVertical:   3,
    borderRadius:      Radius.full,
    borderWidth:       1,
  },
  label: {
    fontSize:      FontSize.microLabel,
    fontWeight:    '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
})
