import * as Haptics from 'expo-haptics'

// Feedback is a nicety: a device without a vibration motor, or one with haptics switched off,
// simply stays still.
export function tick(): void {
  void Haptics.selectionAsync().catch(() => undefined)
}

export function bloom(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined)
}

export function confirm(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined)
}
