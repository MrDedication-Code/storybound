import { useCallback, useEffect, useState } from 'react'
import { Keyboard, Platform, StatusBar, type ViewInstance } from 'react-native'

/**
 * How much of a view the on-screen keyboard covers. Android may or may not shrink the window
 * for the keyboard, depending on the device and edge-to-edge mode, so instead of guessing, this
 * measures where the view ends and where the keyboard begins.
 */
export function useKeyboardOverlap(view: React.RefObject<ViewInstance | null>): {
  overlap: number
  remeasure: () => void
} {
  const [keyboardTop, setKeyboardTop] = useState<number | null>(null)
  const [viewBottom, setViewBottom] = useState<number | null>(null)

  const remeasure = useCallback((): void => {
    view.current?.measureInWindow((_x, y, _width, height) => setViewBottom(y + height))
  }, [view])

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const show = Keyboard.addListener(showEvent, (event) => {
      // The keyboard reports its top from the top of the screen, but Android measures views
      // from below the status bar.
      const statusBar = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0
      setKeyboardTop(event.endCoordinates.screenY - statusBar)
      // Android may have resized the window for the keyboard; measure after it settles.
      setTimeout(remeasure, 60)
    })
    const hide = Keyboard.addListener(hideEvent, () => {
      setKeyboardTop(null)
      setTimeout(remeasure, 60)
    })
    return () => {
      show.remove()
      hide.remove()
    }
  }, [remeasure])

  const overlap =
    keyboardTop === null || viewBottom === null ? 0 : Math.max(0, viewBottom - keyboardTop)
  return { overlap, remeasure }
}
