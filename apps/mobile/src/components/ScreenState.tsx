import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { storyboundColors } from '../theme'
import { PrimaryButton } from './PrimaryButton'

export function LoadingScreen({ label }: { label: string }): React.JSX.Element {
  return (
    <View accessibilityLiveRegion="polite" style={styles.state}>
      <ActivityIndicator color={storyboundColors.brass} size="large" />
      <Text style={styles.copy}>{label}</Text>
    </View>
  )
}

export function ErrorScreen({
  message,
  onBack,
  actionLabel = 'Go back'
}: {
  message: string
  onBack?: () => void
  actionLabel?: string
}): React.JSX.Element {
  return (
    <View accessibilityLiveRegion="assertive" style={styles.state}>
      <Text style={styles.mark}>!</Text>
      <Text style={styles.title}>This page could not be opened</Text>
      <Text style={styles.copy}>{message}</Text>
      {onBack ? <PrimaryButton label={actionLabel} onPress={onBack} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  state: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 28,
    backgroundColor: storyboundColors.paper
  },
  mark: {
    width: 48,
    height: 48,
    borderRadius: 24,
    overflow: 'hidden',
    textAlign: 'center',
    color: storyboundColors.paperRaised,
    backgroundColor: storyboundColors.danger,
    fontSize: 32,
    fontWeight: '700'
  },
  title: {
    color: storyboundColors.text,
    fontFamily: 'serif',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center'
  },
  copy: {
    color: storyboundColors.muted,
    lineHeight: 21,
    textAlign: 'center'
  }
})
