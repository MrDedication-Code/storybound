import { useEffect, useState } from 'react'
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native'
import { storyboundColors } from '../../theme'
import type { PlacedPetal, Point } from './radialLayout'

/**
 * Petals that spring out from an origin one after another, like a hand of cards being fanned.
 * Positions are in the coordinates of the parent, which must fill the area they bloom into.
 */
export function RadialPetals({
  origin,
  petals,
  highlighted,
  showLabels = false,
  onPressIn,
  onPress
}: {
  origin: Point
  petals: PlacedPetal[]
  highlighted: string | null
  showLabels?: boolean
  onPressIn?: (petal: PlacedPetal) => void
  onPress: (petal: PlacedPetal) => void
}): React.JSX.Element {
  const [progress] = useState(() => petals.map(() => new Animated.Value(0)))

  useEffect(() => {
    Animated.stagger(
      22,
      progress.map((value) =>
        Animated.spring(value, {
          toValue: 1,
          friction: 6,
          tension: 120,
          useNativeDriver: true
        })
      )
    ).start()
  }, [progress])

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {petals.map((petal, index) => {
        const value = progress[index] ?? new Animated.Value(1)
        const active = highlighted === petal.key
        const half = petal.size / 2
        return (
          <Animated.View
            key={petal.key}
            pointerEvents="box-none"
            style={[
              styles.slot,
              {
                left: origin.x - half,
                top: origin.y - half,
                width: petal.size,
                opacity: value.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] }),
                transform: [
                  {
                    translateX: value.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, petal.x - origin.x]
                    })
                  },
                  {
                    translateY: value.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, petal.y - origin.y]
                    })
                  },
                  {
                    rotate: value.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['-40deg', '0deg']
                    })
                  },
                  { scale: value.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }
                ]
              }
            ]}
          >
            <Pressable
              accessibilityLabel={petal.label}
              accessibilityRole="button"
              accessibilityState={{ disabled: petal.disabled, selected: petal.tone === 'active' }}
              disabled={petal.disabled}
              style={[
                styles.petal,
                { width: petal.size, height: petal.size, borderRadius: half },
                petal.tone === 'danger' && styles.danger,
                petal.tone === 'active' && styles.activeTone,
                active && styles.highlighted,
                petal.disabled && styles.disabled
              ]}
              onPress={() => onPress(petal)}
              onPressIn={() => onPressIn?.(petal)}
            >
              <Text
                style={[
                  styles.glyph,
                  petal.glyphStyle === 'bold' && styles.bold,
                  petal.glyphStyle === 'italic' && styles.italic,
                  (active || petal.tone === 'active') && styles.glyphOnBrass,
                  petal.tone === 'danger' && !active && styles.glyphDanger
                ]}
              >
                {petal.glyph}
              </Text>
            </Pressable>
            {showLabels ? (
              <Text numberOfLines={1} style={styles.label}>
                {petal.label}
              </Text>
            ) : null}
          </Animated.View>
        )
      })}
    </View>
  )
}

/** A soft wash behind an open menu that fades in; tapping it closes the menu. */
export function RadialBackdrop({ onPress }: { onPress: () => void }): React.JSX.Element {
  const [fade] = useState(() => new Animated.Value(0))
  useEffect(() => {
    Animated.timing(fade, {
      toValue: 1,
      duration: 160,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true
    }).start()
  }, [fade])
  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: fade }]}>
      <Pressable
        accessibilityLabel="Close tools"
        style={StyleSheet.absoluteFill}
        onPress={onPress}
      />
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  slot: {
    position: 'absolute',
    alignItems: 'center'
  },
  petal: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: storyboundColors.brass,
    backgroundColor: storyboundColors.paperRaised,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 5
  },
  highlighted: {
    borderColor: storyboundColors.walnut,
    backgroundColor: storyboundColors.brass,
    transform: [{ scale: 1.2 }]
  },
  activeTone: {
    backgroundColor: storyboundColors.brass
  },
  danger: {
    borderColor: storyboundColors.danger
  },
  disabled: {
    opacity: 0.35
  },
  glyph: {
    color: storyboundColors.text,
    fontFamily: 'serif',
    fontSize: 20,
    lineHeight: 24
  },
  bold: {
    fontWeight: '900'
  },
  italic: {
    fontStyle: 'italic'
  },
  glyphOnBrass: {
    color: storyboundColors.ink
  },
  glyphDanger: {
    color: storyboundColors.danger
  },
  label: {
    marginTop: 4,
    width: 76,
    overflow: 'hidden',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 6,
    color: storyboundColors.nightText,
    backgroundColor: 'rgba(23, 19, 15, 0.78)',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center'
  },
  backdrop: {
    backgroundColor: 'rgba(23, 19, 15, 0.22)'
  }
})
