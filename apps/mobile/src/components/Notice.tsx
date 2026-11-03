import { Pressable, StyleSheet, Text, View } from 'react-native'
import { storyboundColors, storyboundRadii } from '../theme'

/** A short dark message with an optional action, such as Undo after moving to Trash. */
export function Notice({
  text,
  actionLabel,
  onAction,
  onDismiss
}: {
  text: string
  actionLabel?: string
  onAction?: () => void
  onDismiss: () => void
}): React.JSX.Element {
  return (
    <View accessibilityLiveRegion="polite" style={styles.notice}>
      <Text style={styles.text}>{text}</Text>
      {actionLabel && onAction ? (
        <Pressable accessibilityRole="button" hitSlop={8} onPress={onAction}>
          <Text style={styles.action}>{actionLabel}</Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityLabel="Dismiss"
        accessibilityRole="button"
        hitSlop={8}
        onPress={onDismiss}
      >
        <Text style={styles.action}>✕</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginHorizontal: 14,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: storyboundRadii.medium,
    backgroundColor: storyboundColors.ink
  },
  text: {
    flex: 1,
    color: storyboundColors.nightText,
    fontSize: 13
  },
  action: {
    color: storyboundColors.brassBright,
    fontSize: 13,
    fontWeight: '700'
  }
})
