import { Platform, StatusBar } from 'react-native'
import { StoryboundCar } from '../modules/storybound-car'

/**
 * The Android status bar's height in points. React Native's StatusBar.currentHeight is read once
 * when the app's JavaScript starts, and is 0 when Android Auto started it with no screen open.
 */
export function statusBarHeight(): number {
  if (Platform.OS !== 'android') return 0
  const measured = StoryboundCar?.statusBarHeight() ?? 0
  return measured > 0 ? measured : (StatusBar.currentHeight ?? 0)
}
