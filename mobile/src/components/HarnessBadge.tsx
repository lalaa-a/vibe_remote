import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { Colors, Radius, FontSize, Spacing } from '../constants/colors'
import type { HarnessId } from '../types'

// Visual config per harness — falls back to a neutral style for unknown harnesses.
const HARNESS_CFG: Record<string, { label: string; bg: string; text: string; border: string }> = {
  'claude-code': {
    label:  'Claude',
    bg:     'rgba(214, 154, 44, 0.12)',
    text:   Colors.warning,
    border: 'rgba(214, 154, 44, 0.25)',
  },
  'opencode': {
    label:  'OpenCode',
    bg:     'rgba(106, 143, 179, 0.12)',
    text:   Colors.info,
    border: 'rgba(106, 143, 179, 0.25)',
  },
  'gemini-cli': {
    label:  'Gemini',
    bg:     'rgba(122, 165, 111, 0.12)',
    text:   Colors.successDark,
    border: 'rgba(122, 165, 111, 0.25)',
  },
}

const FALLBACK = {
  bg:     Colors.surfaceGlassStrong,
  text:   Colors.textTertiary,
  border: Colors.borderHairline,
}

interface Props {
  harness: HarnessId
  /** 'sm' is the default (for list cards); 'xs' for tighter contexts */
  size?: 'xs' | 'sm'
}

export function HarnessBadge({ harness, size = 'sm' }: Props) {
  const cfg   = HARNESS_CFG[harness] ?? { ...FALLBACK, label: harness }
  const label = cfg.label ?? harness

  return (
    <View style={[
      styles.pill,
      size === 'xs' && styles.pillXs,
      { backgroundColor: cfg.bg, borderColor: cfg.border },
    ]}>
      <Text style={[styles.text, size === 'xs' && styles.textXs, { color: cfg.text }]}>
        {label}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: Spacing.px8,
    paddingVertical:   2,
    borderRadius:      Radius.full,
    borderWidth:       1,
    alignSelf:         'flex-start',
  },
  pillXs: {
    paddingHorizontal: 5,
    paddingVertical:   1,
  },
  text: {
    fontSize:      FontSize.microLabel,
    fontWeight:    '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  textXs: {
    fontSize: 10,
  },
})
