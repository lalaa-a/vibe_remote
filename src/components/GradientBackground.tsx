import React from 'react'
import { View, StyleSheet, ViewStyle } from 'react-native'
import { Colors } from '../constants/colors'

interface Props {
  children: React.ReactNode
  style?:   ViewStyle
}

export function GradientBackground({ children, style }: Props) {
  return (
    <View style={[styles.root, style]}>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex:            1,
    backgroundColor: Colors.pageBg,
  },
})
