import { Platform } from 'react-native'

// ── Gradient ─────────────────────────────────────────────────────────────────
export const Gradient = {
  sky: ['#C76B4A', '#FBEFE4', '#FBF6EE'] as const,
  skyLocations: [0, 0.55, 1] as const,
}

// ── Colors ───────────────────────────────────────────────────────────────────
export const Colors = {
  // Surfaces
  bgGradientTop:      '#C76B4A',
  bgGradientBottom:   '#FBEFE4',
  pageBg:             '#EFE7D2',
  cream:              '#FBF6EE',
  creamDeep:          '#F2E7D7',
  surface:            '#FFFBF5',
  surfaceGlass:       'rgba(255, 247, 240, 0.72)',
  surfaceGlassStrong: 'rgba(255, 247, 240, 0.88)',

  // Borders
  border:         'rgba(120, 60, 40, 0.10)',
  borderGlass:    'rgba(255, 255, 255, 0.60)',
  borderHairline: 'rgba(120, 60, 40, 0.06)',

  // Text
  textPrimary:   '#1F140E',
  textSecondary: '#5A4A3F',
  textTertiary:  '#8C7A6E',
  textInverse:   '#FBF6EE',

  // Accent — ember/terracotta
  accent:        '#E47A4E',
  accentDeep:    '#C0552B',
  accentLight:   '#FCDFCD',
  inkBlack:      '#111111',
  inkBlackHover: '#222222',

  // Semantic
  danger:      '#C84038',
  dangerLight: '#F4CFCB',
  warning:     '#D69A2C',
  success:     '#7AA56F',
  successDark: '#3F6B3A',
  info:        '#6A8FB3',

  // Code surfaces (dark)
  codeBg:       '#1B1614',
  codeBgRaised: '#241D1A',
  codeText:     '#F0E6DA',

  // Diff line surfaces (warm-tinted)
  diffAdd:     { bg: 'rgba(63,107,58,0.22)',  text: '#A8D5A0', prefix: '#7AA56F' },
  diffRemove:  { bg: 'rgba(200,64,56,0.20)',  text: '#F0A09A', prefix: '#C84038' },
  diffContext: { bg: 'transparent',           text: '#9C8C80', prefix: '#5A4A3F' },

  focusRing: '#E47A4E',

  // Tab bar
  tabActive:   '#C0552B',
  tabInactive: 'rgba(31, 20, 14, 0.45)',

  white: '#FFFFFF',
  black: '#000000',

  // ── Risk tiers ──────────────────────────────────────────────────────────────
  risk: {
    low:      { bg: '#E8EFE2', text: '#3F6B3A', border: '#C9DCC0', dot: '#7AA56F', whisper: 'rgba(122,165,111,0.07)' },
    medium:   { bg: '#FBEBC9', text: '#8A5A12', border: '#EBD49A', dot: '#D69A2C', whisper: 'rgba(214,154,44,0.07)' },
    high:     { bg: '#F8DCC8', text: '#9A4322', border: '#ECC2A4', dot: '#D46A38', whisper: 'rgba(212,106,56,0.07)' },
    critical: { bg: '#F4CFCB', text: '#8A2A26', border: '#E5ADA7', dot: '#C84038', whisper: 'rgba(200,64,56,0.08)' },
  },

  // ── Tool palettes ────────────────────────────────────────────────────────────
  tool: {
    Bash:      { bg: '#1B1614', text: '#F0E6DA', dot: '#E47A4E' },
    Write:     { bg: '#FBEBC9', text: '#8A5A12', dot: '#D69A2C' },
    Edit:      { bg: '#E8EFE2', text: '#3F6B3A', dot: '#7AA56F' },
    MultiEdit: { bg: '#E0E6F0', text: '#34507A', dot: '#6A8FB3' },
    Read:      { bg: '#EDE8F5', text: '#4A3470', dot: '#8B6CC4' },
    unknown:   { bg: '#EFE7DC', text: '#5A4A3F', dot: '#8C7A6E' },
  },

  // ── Backward-compatible aliases ──────────────────────────────────────────────
  bg:          '#FBF6EE',
  bgPrimary:   '#FBF6EE',
  bgSecondary: '#FFFBF5',
  cardBg:      'rgba(255, 247, 240, 0.72)',
  borderLight: 'rgba(120, 60, 40, 0.06)',
  primary:     '#E47A4E',
  primaryDark: '#C0552B',
  primaryLight:'#FCDFCD',
  shadow:      'rgba(120, 60, 40, 0.08)',
}

// ── Typography ────────────────────────────────────────────────────────────────
export const FontFamily = {
  serif:       'Fraunces-Regular',
  serifBold:   'Fraunces-SemiBold',
  serifItalic: 'Fraunces-Italic',
  sans:        'Inter',
  loraItalic:  'Lora-MediumItalic',
  mono:        Platform.OS === 'ios' ? 'Menlo' : 'JetBrainsMono-Regular',
}

export const FontSize = {
  displayXL:  36,
  displayL:   30,
  displayM:   24,
  cardTitle:  17,
  body:       15,
  bodyEmph:   15,
  label:      13,
  labelStrong:13,
  metadata:   12,
  mono:       13,
  monoSmall:  12,
  microLabel: 11,

  // legacy aliases
  xs:  12,
  sm:  14,
  md:  15,
  lg:  17,
  xl:  24,
  xxl: 30,
}

// ── Spacing ──────────────────────────────────────────────────────────────────
export const Spacing = {
  px0:  0,
  px2:  2,
  px4:  4,
  px8:  8,
  px12: 12,
  px16: 16,
  px20: 20,
  px24: 24,
  px32: 32,
  px40: 40,
  px56: 56,

  // legacy
  xs:   4,
  sm:   8,
  md:   12,
  lg:   16,
  xl:   20,
  xxl:  24,
  xxxl: 32,
}

// ── Radius ───────────────────────────────────────────────────────────────────
export const Radius = {
  xs:   8,
  sm:   12,
  md:   16,
  lg:   22,
  xl:   28,
  xl2:  36,
  full: 999,
}

// ── Shadows (warm-tinted) ─────────────────────────────────────────────────────
export const Shadow = {
  glassLow: {
    shadowColor:   '#783C28',
    shadowOffset:  { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius:  24,
    elevation:     5,
  },
  glassHigh: {
    shadowColor:   '#783C28',
    shadowOffset:  { width: 0, height: 16 },
    shadowOpacity: 0.16,
    shadowRadius:  40,
    elevation:     10,
  },
  inkPill: {
    shadowColor:   '#000',
    shadowOffset:  { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius:  20,
    elevation:     8,
  },
  modal: {
    shadowColor:   '#783C28',
    shadowOffset:  { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius:  28,
    elevation:     8,
  },
  // legacy aliases
  card: {},
  float: {
    shadowColor:   '#783C28',
    shadowOffset:  { width: 0, height: 16 },
    shadowOpacity: 0.16,
    shadowRadius:  40,
    elevation:     10,
  },
}

// ── Tab bar bottom inset ──────────────────────────────────────────────────────
// 60 (bar) + 20 (bottom margin) + safe area
export const TAB_BOTTOM_INSET = 104
