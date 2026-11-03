import { useState } from 'react'
import { Modal, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { confirm, tick } from '../../haptics'
import { storyboundColors } from '../../theme'
import { RadialBackdrop, RadialPetals } from './RadialPetals'
import { layoutAround, type Point, type RadialItem } from './radialLayout'

/**
 * A menu that blooms around the point a finger long-pressed, with a label on every petal.
 * It fans towards the middle of the screen, so it is never cut off at an edge.
 */
export function PetalMenu({
  origin,
  title,
  items,
  onSelect,
  onClose
}: {
  /** Where the long press happened, in window coordinates. */
  origin: Point
  /** What the menu is for, shown at its centre (a chapter title, say). */
  title: string
  items: RadialItem[]
  onSelect: (key: string) => void
  onClose: () => void
}): React.JSX.Element {
  const window = useWindowDimensions()
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const petals = layoutAround(origin, items, window)

  return (
    <Modal
      navigationBarTranslucent
      statusBarTranslucent
      transparent
      animationType="none"
      visible
      onRequestClose={onClose}
    >
      <View style={StyleSheet.absoluteFill}>
        <RadialBackdrop onPress={onClose} />
        <View
          pointerEvents="none"
          style={[styles.centre, { left: origin.x - 70, top: origin.y - 26 }]}
        >
          <Text numberOfLines={2} style={styles.title}>
            {title}
          </Text>
        </View>
        <RadialPetals
          showLabels
          highlighted={highlighted}
          origin={origin}
          petals={petals}
          onPress={(petal) => {
            confirm()
            onClose()
            onSelect(petal.key)
          }}
          onPressIn={(petal) => {
            tick()
            setHighlighted(petal.key)
          }}
        />
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  centre: {
    position: 'absolute',
    width: 140,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: storyboundColors.brass,
    backgroundColor: storyboundColors.ink
  },
  title: {
    color: storyboundColors.nightText,
    fontFamily: 'serif',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center'
  }
})
