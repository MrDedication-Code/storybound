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

/** Highlight colours matching the desktop reader: a solid swatch and a see-through wash. */
export const highlightColors: Record<string, { swatch: string; wash: string }> = {
  gold: { swatch: '#f4c95d', wash: 'rgba(244, 201, 93, 0.42)' },
  blue: { swatch: '#6aa9ff', wash: 'rgba(106, 169, 255, 0.36)' },
  green: { swatch: '#65c998', wash: 'rgba(101, 201, 152, 0.36)' },
  pink: { swatch: '#f27eb0', wash: 'rgba(242, 126, 176, 0.36)' },
  purple: { swatch: '#ad8bf0', wash: 'rgba(173, 139, 240, 0.36)' },
  orange: { swatch: '#f29b5b', wash: 'rgba(242, 155, 91, 0.36)' }
}

export function highlightColor(color: string): { swatch: string; wash: string } {
  return highlightColors[color] ?? highlightColors.gold
}

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
