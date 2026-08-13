import { Pressable, StyleSheet, Text, View } from 'react-native'
import { storyboundColors } from '../theme'

interface AppHeaderProps {
  title: string
  subtitle?: string
  onBack?: () => void
  actionLabel?: string
  onAction?: () => void
  dark?: boolean
}

export function AppHeader({
  title,
  subtitle,
  onBack,
  actionLabel,
  onAction,
  dark = false
}: AppHeaderProps): React.JSX.Element {
  const foreground = dark ? storyboundColors.nightText : storyboundColors.text
  return (
    <View style={[styles.header, dark && styles.headerDark]}>
      <View style={styles.side}>
        {onBack ? (
          <Pressable
            accessibilityLabel="Go back"
            accessibilityRole="button"
            hitSlop={10}
            style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
            onPress={onBack}
          >
            <Text style={[styles.backGlyph, { color: foreground }]}>‹</Text>
          </Pressable>
        ) : null}
      </View>
      <View accessibilityRole="header" style={styles.copy}>
        <Text numberOfLines={1} style={[styles.title, { color: foreground }]}>
          {title}
        </Text>
        {subtitle ? (
          <Text
            numberOfLines={1}
            style={[styles.subtitle, dark && { color: storyboundColors.brassBright }]}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={[styles.side, styles.sideRight]}>
        {actionLabel && onAction ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
            onPress={onAction}
          >
            <Text style={[styles.actionText, dark && { color: storyboundColors.brassBright }]}>
              {actionLabel}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    minHeight: 62,
    alignItems: 'center',
    flexDirection: 'row',
    paddingHorizontal: 10,
    borderBottomColor: storyboundColors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    backgroundColor: storyboundColors.paperRaised
  },
  headerDark: {
    backgroundColor: storyboundColors.ink,
    borderBottomColor: storyboundColors.walnut
  },
  side: {
    width: 74,
    alignItems: 'flex-start'
  },
  sideRight: {
    alignItems: 'flex-end'
  },
  copy: {
    flex: 1,
    alignItems: 'center'
  },
  title: {
    fontFamily: 'serif',
    fontSize: 17,
    fontWeight: '700'
  },
  subtitle: {
    marginTop: 2,
    color: storyboundColors.muted,
    fontSize: 11
  },
  headerButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center'
  },
  backGlyph: {
    fontFamily: 'serif',
    fontSize: 40,
    lineHeight: 40
  },
  action: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 4
  },
  actionText: {
    color: storyboundColors.brass,
    fontSize: 14,
    fontWeight: '700'
  },
  pressed: {
    opacity: 0.55
  }
})
