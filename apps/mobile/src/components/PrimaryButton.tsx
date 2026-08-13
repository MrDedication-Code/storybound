import { Pressable, StyleSheet, Text, type ViewStyle } from 'react-native'
import { storyboundColors, storyboundRadii } from '../theme'

export function PrimaryButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  style
}: {
  label: string
  onPress: () => void
  variant?: 'primary' | 'secondary' | 'quiet'
  disabled?: boolean
  style?: ViewStyle
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary'
          ? styles.primary
          : variant === 'secondary'
            ? styles.secondary
            : styles.quiet,
        pressed && styles.pressed,
        disabled && styles.disabled,
        style
      ]}
      onPress={onPress}
    >
      <Text
        style={[styles.label, variant === 'primary' ? styles.primaryLabel : styles.secondaryLabel]}
      >
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: storyboundRadii.small,
    paddingHorizontal: 18
  },
  primary: {
    backgroundColor: storyboundColors.walnut
  },
  secondary: {
    backgroundColor: storyboundColors.paperRaised,
    borderColor: storyboundColors.line,
    borderWidth: 1
  },
  quiet: {
    backgroundColor: 'transparent'
  },
  label: {
    fontSize: 15,
    fontWeight: '700'
  },
  primaryLabel: {
    color: storyboundColors.nightText
  },
  secondaryLabel: {
    color: storyboundColors.text
  },
  pressed: {
    opacity: 0.72,
    transform: [{ scale: 0.99 }]
  },
  disabled: {
    opacity: 0.45
  }
})
