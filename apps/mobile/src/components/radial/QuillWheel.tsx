import { useEffect, useRef, useState } from 'react'
import {
  Animated,
  PanResponder,
  StyleSheet,
  Text,
  View,
  type PanResponderInstance,
  type ViewInstance,
  type ViewStyle
} from 'react-native'
import { bloom, confirm, tick } from '../../haptics'
import { storyboundColors } from '../../theme'
import { RadialBackdrop, RadialPetals } from './RadialPetals'
import { layoutArc, petalAt, type PlacedPetal, type Point, type RadialItem } from './radialLayout'

const FAB_SIZE = 62
const EDGE = 18
const INNER_RADIUS = 104
const OUTER_RADIUS = 180

/**
 * The editor's writing tools on a quill button in the thumb's corner. Two rings of tools fan
 * out in a quarter circle above and left of it.
 *
 * - Press, slide to a tool, and let go: the tool is used and the wheel closes (a "marking
 *   menu", quick once the positions are familiar).
 * - Tap: the wheel stays open and tools are tapped one at a time; tap the quill or anywhere
 *   else to close it.
 */
export function QuillWheel({
  inner,
  outer,
  bottomInset,
  dimmed = false,
  onSelect
}: {
  /** Up to four tools on the near ring, the most used ones. */
  inner: RadialItem[]
  /** Up to five tools on the far ring. */
  outer: RadialItem[]
  /** Space taken at the bottom, such as the keyboard, that the button sits above. */
  bottomInset: number
  /** Fades the closed button, for focus mode. */
  dimmed?: boolean
  onSelect: (key: string) => void
}): React.JSX.Element {
  const [area, setArea] = useState({ width: 0, height: 0 })
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const [turn] = useState(() => new Animated.Value(0))

  const centre: Point = {
    x: area.width - EDGE - FAB_SIZE / 2,
    y: area.height - bottomInset - EDGE - FAB_SIZE / 2
  }
  // With the keyboard up on a small phone, the rings shrink to fit the space above the button.
  const scale = Math.min(1, Math.max(0.7, (centre.y - 40) / (OUTER_RADIUS + 40)))
  const petals: PlacedPetal[] = [
    ...layoutArc(centre, inner, { radius: INNER_RADIUS * scale, from: 90, to: 180, size: 46 }),
    ...layoutArc(centre, outer, { radius: OUTER_RADIUS * scale, from: 90, to: 180, size: 48 })
  ]

  const [controller] = useState(() => createWheelController({ setOpen, setHighlighted }))
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const overlayRef = useRef<ViewInstance>(null)
  useEffect(() => {
    controller.update({ open, petals, highlighted, offset, onSelect })
  })

  useEffect(() => {
    Animated.spring(turn, { toValue: open ? 1 : 0, friction: 7, useNativeDriver: true }).start()
  }, [open, turn])

  const caption = highlighted
    ? petals.find((petal) => petal.key === highlighted)?.label
    : 'Slide to a tool, or tap one'

  return (
    <View
      ref={overlayRef}
      pointerEvents="box-none"
      style={StyleSheet.absoluteFill}
      onLayout={(event) => {
        setArea({
          width: event.nativeEvent.layout.width,
          height: event.nativeEvent.layout.height
        })
        // Touches report positions on the screen; petals are placed within this view.
        overlayRef.current?.measureInWindow((x, y) => setOffset({ x, y }))
      }}
    >
      {open ? (
        <>
          <RadialBackdrop onPress={controller.close} />
          <DialPlate centre={centre} rings={[INNER_RADIUS * scale, OUTER_RADIUS * scale]} />
          <RadialPetals
            highlighted={highlighted}
            origin={centre}
            petals={petals}
            onPress={(petal) => controller.choose(petal.key, Boolean(petal.repeatable))}
            onPressIn={(petal) => {
              tick()
              controller.highlight(petal.key)
            }}
          />
          <View
            pointerEvents="none"
            style={[
              styles.caption,
              {
                right: EDGE,
                top: Math.max(8, centre.y - OUTER_RADIUS * scale - 64)
              }
            ]}
          >
            <Text style={styles.captionText}>{caption}</Text>
          </View>
        </>
      ) : null}
      <Animated.View
        accessibilityHint="Opens bold, italic, headings, dialogue, undo, and more"
        accessibilityLabel={open ? 'Close writing tools' : 'Writing tools'}
        accessibilityRole="button"
        accessible
        style={[
          styles.fab,
          {
            left: centre.x - FAB_SIZE / 2,
            top: centre.y - FAB_SIZE / 2,
            opacity: dimmed && !open ? 0.45 : 1,
            transform: [
              {
                rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '135deg'] })
              }
            ]
          }
        ]}
        {...controller.responder.panHandlers}
      >
        <View pointerEvents="none">
          <Text style={[styles.fabGlyph, !open && styles.quillGlyph]}>
            {open ? '+' : '✒\uFE0E'}
          </Text>
        </View>
      </Animated.View>
    </View>
  )
}

/** A soft disc with the two rings drawn faintly, so the tools read as one instrument. */
function DialPlate({ centre, rings }: { centre: Point; rings: number[] }): React.JSX.Element {
  const [grow] = useState(() => new Animated.Value(0))
  useEffect(() => {
    Animated.spring(grow, { toValue: 1, friction: 8, tension: 70, useNativeDriver: true }).start()
  }, [grow])
  const plate = (rings.at(-1) ?? 0) + 40
  const circle = (radius: number): ViewStyle => ({
    position: 'absolute',
    left: centre.x - radius,
    top: centre.y - radius,
    width: radius * 2,
    height: radius * 2,
    borderRadius: radius
  })
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        {
          opacity: grow,
          transformOrigin: `${centre.x}px ${centre.y}px`,
          transform: [{ scale: grow.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) }]
        }
      ]}
    >
      <View style={[circle(plate), styles.plate]} />
      {rings.map((radius) => (
        <View key={radius} style={[circle(radius), styles.ring]} />
      ))}
    </Animated.View>
  )
}

interface WheelState {
  open: boolean
  petals: PlacedPetal[]
  highlighted: string | null
  /** Where the wheel's area starts on the screen. */
  offset: Point
  onSelect: (key: string) => void
}

/**
 * The press-and-slide gesture lives outside React's render cycle: it is created once and is
 * told the latest layout after each render.
 */
interface WheelController {
  responder: PanResponderInstance
  close: () => void
  choose: (key: string, keepOpen: boolean) => void
  highlight: (key: string | null) => void
  update: (next: WheelState) => void
}

function createWheelController(actions: {
  setOpen: (open: boolean) => void
  setHighlighted: (key: string | null) => void
}): WheelController {
  let latest: WheelState = {
    open: false,
    petals: [],
    highlighted: null,
    offset: { x: 0, y: 0 },
    onSelect: () => undefined
  }
  let gesture = { wasOpen: false, moved: false }

  const highlight = (key: string | null): void => {
    latest = { ...latest, highlighted: key }
    actions.setHighlighted(key)
  }
  const close = (): void => {
    actions.setOpen(false)
    highlight(null)
  }
  const choose = (key: string, keepOpen: boolean): void => {
    confirm()
    latest.onSelect(key)
    if (!keepOpen) close()
  }

  const responder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      gesture = { wasOpen: latest.open, moved: false }
      if (!latest.open) {
        bloom()
        actions.setOpen(true)
      }
    },
    onPanResponderMove: (_event, state) => {
      if (Math.hypot(state.dx, state.dy) > 10) gesture.moved = true
      const finger = { x: state.moveX - latest.offset.x, y: state.moveY - latest.offset.y }
      const key = petalAt(latest.petals, finger)?.key ?? null
      if (key === latest.highlighted) return
      if (key) tick()
      highlight(key)
    },
    onPanResponderRelease: () => {
      const key = latest.highlighted
      if (gesture.moved && key) choose(key, false)
      else if (gesture.moved || gesture.wasOpen) close()
      // A plain tap on a closed quill leaves the wheel open for tapping tools.
      else highlight(null)
    },
    onPanResponderTerminate: () => highlight(null)
  })

  return {
    responder,
    close,
    choose,
    highlight,
    update(next: WheelState): void {
      latest = next
    }
  }
}

const styles = StyleSheet.create({
  plate: {
    backgroundColor: 'rgba(255, 250, 240, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(173, 135, 81, 0.45)'
  },
  ring: {
    borderWidth: 1,
    borderColor: 'rgba(173, 135, 81, 0.4)',
    borderStyle: 'dashed'
  },
  fab: {
    position: 'absolute',
    width: FAB_SIZE,
    height: FAB_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: FAB_SIZE / 2,
    borderWidth: 3,
    borderColor: storyboundColors.brassBright,
    backgroundColor: storyboundColors.walnut,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 8
  },
  fabGlyph: {
    color: storyboundColors.brassBright,
    fontSize: 28,
    lineHeight: 28,
    includeFontPadding: false,
    textAlign: 'center'
  },
  // The nib symbol sits low in its font; measured on Android, this centres it.
  quillGlyph: {
    transform: [{ translateY: -4 }]
  },
  caption: {
    position: 'absolute',
    maxWidth: 230,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: storyboundColors.ink
  },
  captionText: {
    color: storyboundColors.nightText,
    fontSize: 13,
    fontWeight: '700'
  }
})
