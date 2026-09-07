import React, { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert, ScrollView,
} from 'react-native'
import { useRoute, useNavigation } from '@react-navigation/native'
import type { RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useSendPrompt } from '../../hooks/useSessions'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Colors, Spacing, Radius, FontSize, FontFamily, Shadow } from '../../constants/colors'
import type { SessionsStackParamList } from '../../types'

type Route = RouteProp<SessionsStackParamList, 'PromptCompose'>
type Nav   = NativeStackNavigationProp<SessionsStackParamList>

const TEMPLATES = [
  { label: 'Refactor',  text: 'Refactor this code to be cleaner and more maintainable. ' },
  { label: 'Add tests', text: 'Add comprehensive tests for the current code. ' },
  { label: 'Fix bug',   text: 'Investigate and fix the bug in ' },
  { label: 'Explain',   text: 'Explain what this code does and how it works. ' },
]

export function PromptComposeScreen() {
  const route      = useRoute<Route>()
  const navigation = useNavigation<Nav>()
  const { sessionId, prefill } = route.params

  const [prompt, setPrompt] = useState(prefill ?? '')
  const sendPrompt = useSendPrompt()
  const insets     = useSafeAreaInsets()

  async function handleSend() {
    const text = prompt.trim()
    if (!text) return
    try {
      await sendPrompt.mutateAsync({ prompt: text, sessionId })
      navigation.goBack()
    } catch (err: any) {
      Alert.alert('Failed to send', err.message ?? 'Please try again')
    }
  }

  function applyTemplate(text: string) {
    setPrompt(prev => prev ? prev + '\n' + text : text)
  }

  const canSend = prompt.trim().length > 0 && !sendPrompt.isPending

  return (
    <KeyboardAvoidingView
      style={styles.overlay}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 92 }]}>
        {/* Handle */}
        <View style={styles.handle} />

        {/* Title */}
        <Text style={styles.title}>{'Send a\nprompt.'}</Text>
        <Text style={styles.subtitle}>
          Delivered when Claude is idle with no pending approvals.
        </Text>

        {/* Template chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.templates}
        >
          {TEMPLATES.map(t => (
            <TouchableOpacity
              key={t.label}
              style={styles.chip}
              onPress={() => applyTemplate(t.text)}
              activeOpacity={0.7}
            >
              <Text style={styles.chipText}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Input */}
        <TextInput
          style={styles.input}
          value={prompt}
          onChangeText={setPrompt}
          placeholder="Run the test suite and fix any failures…"
          placeholderTextColor={Colors.textTertiary}
          multiline
          autoFocus
          textAlignVertical="top"
          maxLength={2000}
        />

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.charCount}>{prompt.length} / 2000</Text>

          <View style={styles.footerActions}>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={() => navigation.goBack()}
              activeOpacity={0.7}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]}
              onPress={handleSend}
              disabled={!canSend}
              activeOpacity={0.8}
            >
              {sendPrompt.isPending
                ? <ActivityIndicator size="small" color={Colors.textInverse} />
                : <Text style={styles.sendText}>Send</Text>
              }
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex:           1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(31,20,14,0.40)',
  },
  sheet: {
    backgroundColor:      Colors.surfaceGlassStrong,
    borderTopLeftRadius:  Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderTopWidth:       1,
    borderLeftWidth:      1,
    borderRightWidth:     1,
    borderColor:          Colors.borderGlass,
    paddingHorizontal:    Spacing.px20,
    paddingTop:           Spacing.px12,
    paddingBottom:        Spacing.px24,
    gap:                  Spacing.px12,
    ...Shadow.modal,
  },
  handle: {
    width:           40,
    height:          4,
    borderRadius:    Radius.full,
    backgroundColor: Colors.border,
    alignSelf:       'center',
    marginBottom:    Spacing.px4,
  },
  title: {
    fontSize:      FontSize.displayM,
    fontWeight:    '500',
    fontFamily:    FontFamily.serifBold,
    color:         Colors.textPrimary,
    letterSpacing: -0.4,
    lineHeight:    FontSize.displayM * 1.05,
  },
  subtitle: {
    fontSize:   FontSize.label,
    color:      Colors.textSecondary,
    lineHeight: 18,
    marginTop:  -Spacing.px4,
  },

  templates: {
    flexDirection: 'row',
    gap:           Spacing.px4,
    paddingBottom: 2,
  },
  chip: {
    paddingHorizontal: Spacing.px12,
    paddingVertical:   6,
    borderRadius:      Radius.full,
    backgroundColor:   Colors.surfaceGlass,
    borderWidth:       1,
    borderColor:       Colors.borderHairline,
    borderTopColor:    Colors.borderGlass,
  },
  chipText: {
    fontSize:   FontSize.label,
    fontWeight: '500',
    color:      Colors.textSecondary,
  },

  input: {
    borderWidth:     1,
    borderColor:     Colors.borderHairline,
    borderTopColor:  Colors.borderGlass,
    borderRadius:    Radius.md,
    padding:         Spacing.px12,
    fontSize:        FontSize.body,
    fontFamily:      FontFamily.sans,
    color:           Colors.codeText,
    backgroundColor: Colors.codeBg,
    minHeight:       120,
    maxHeight:       240,
    lineHeight:      22,
  },

  footer: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    marginTop:      Spacing.px4,
  },
  charCount: {
    fontSize: FontSize.metadata,
    color:    Colors.textTertiary,
  },
  footerActions: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           Spacing.px8,
  },
  cancelBtn: {
    paddingHorizontal: Spacing.px16,
    paddingVertical:   Spacing.px12,
    minHeight:         44,
    justifyContent:    'center',
  },
  cancelText: {
    fontSize:   FontSize.label,
    color:      Colors.textTertiary,
    fontWeight: '500',
  },
  sendBtn: {
    paddingHorizontal: Spacing.px24,
    height:            56,
    borderRadius:      Radius.full,
    backgroundColor:   Colors.accentDeep,
    minWidth:          100,
    alignItems:        'center',
    justifyContent:    'center',
    ...Shadow.inkPill,
  },
  sendBtnDisabled: {
    backgroundColor: Colors.border,
    shadowOpacity:   0,
    elevation:       0,
  },
  sendText: {
    fontSize:   FontSize.body,
    fontWeight: '600',
    color:      Colors.textInverse,
  },
})
