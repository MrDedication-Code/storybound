import type { TextStyle, ViewStyle } from 'react-native'

export const storyboundColors = {
  ink: '#17130f',
  inkRaised: '#241c16',
  walnut: '#3d2b20',
  paper: '#f5efe3',
  paperRaised: '#fffaf0',
  parchment: '#e9dcc4',
  brass: '#ad8751',
  brassBright: '#d5b67d',
  text: '#2d251e',
  muted: '#74685c',
  line: '#d7c9b3',
  nightText: '#f2e8d6',
  danger: '#a14d43',
  success: '#466c58'
} as const

export const storyboundRadii = {
  small: 10,
  medium: 16,
  large: 24
} as const

export const storyboundShadow: ViewStyle = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.14,
  shadowRadius: 18,
  elevation: 4
}

export const literaryHeading: TextStyle = {
  fontFamily: 'serif',
  color: storyboundColors.text,
  fontWeight: '700'
}

export const compactCaps: TextStyle = {
  color: storyboundColors.brass,
  fontSize: 12,
  fontWeight: '700',
  letterSpacing: 1.4,
  textTransform: 'uppercase'
}
