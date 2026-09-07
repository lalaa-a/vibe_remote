import React, { useRef, useEffect } from 'react'
import { View, Text, StyleSheet, Animated } from 'react-native'
import { Colors, Spacing, Radius, FontSize } from '../constants/colors'

export function LiveBadge() {
  const pulse = useRef(new Animated.Value(1)).current

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.9, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,   duration: 900, useNativeDriver: true }),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [])

  return (
    <View style={styles.container}>
      <View style={styles.dotWrap}>
        <Animated.View style={[styles.dotPulse, { transform: [{ scale: pulse }] }]} />
        <View style={styles.dot} />
      </View>
      <Text style={styles.text}>live</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               Spacing.px4,
    backgroundColor:   Colors.surfaceGlassStrong,
    borderRadius:      Radius.full,
    paddingHorizontal: Spacing.px8,
    paddingVertical:   4,
    borderWidth:       1,
    borderColor:       Colors.borderHairline,
  },
  dotWrap: {
    width:          8,
    height:         8,
    alignItems:     'center',
    justifyContent: 'center',
  },
  dotPulse: {
    position:        'absolute',
    width:           8,
    height:          8,
    borderRadius:    Radius.full,
    backgroundColor: Colors.accent,
    opacity:         0.30,
  },
  dot: {
    width:           8,
    height:          8,
    borderRadius:    Radius.full,
    backgroundColor: Colors.accent,
  },
  text: {
    fontSize:  FontSize.label,
    color:     Colors.textSecondary,
    fontStyle: 'italic',
  },
})
