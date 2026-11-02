import type { ReactNode } from 'react'
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type ViewStyle
} from 'react-native'
import { ANNOTATION_COLORS } from '../domain/contracts'
import { highlightColor, storyboundColors, storyboundRadii } from '../theme'

/** A panel that slides up over the reader; tapping above it closes it. */
export function BottomSheet({
  children,
  onClose,
  style
}: {
  children: ReactNode
  onClose: () => void
  style?: ViewStyle
}): React.JSX.Element {
  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.backdrop}
      >
        <Pressable accessibilityLabel="Close" style={styles.dismiss} onPress={onClose} />
        <View style={[styles.sheet, style]}>{children}</View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

/** The six highlight colours the desktop reader also offers. */
export function ColorChoices({
  value,
  label,
  onChange
}: {
  value: string
  /** What the colour is for, read out with each choice, e.g. "highlight". */
  label: string
  onChange: (color: string) => void
}): React.JSX.Element {
  return (
    <View accessibilityRole="radiogroup" style={styles.colors}>
      {ANNOTATION_COLORS.map((color) => (
        <Pressable
          accessibilityLabel={`${color} ${label}`}
          accessibilityRole="radio"
          accessibilityState={{ selected: value === color }}
          hitSlop={4}
          key={color}
          style={[
            styles.swatch,
            { backgroundColor: highlightColor(color).swatch },
            value === color && styles.swatchSelected
          ]}
          onPress={() => onChange(color)}
        />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(23, 19, 15, 0.42)'
  },
  dismiss: {
    flex: 1
  },
  sheet: {
    gap: 14,
    maxHeight: '86%',
    padding: 20,
    paddingBottom: 34,
    borderTopLeftRadius: storyboundRadii.large,
    borderTopRightRadius: storyboundRadii.large,
    backgroundColor: storyboundColors.paperRaised
  },
  colors: {
    flexDirection: 'row',
    gap: 14
  },
  swatch: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: 'transparent'
  },
  swatchSelected: {
    borderColor: storyboundColors.text
  }
})
