import { useEffect, useState } from 'react'
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { confirm } from '../haptics'
import { storyboundColors, storyboundRadii } from '../theme'
import { RadialBackdrop } from './radial/RadialPetals'

export interface DrawerTool {
  key: string
  glyph: string
  label: string
  /** A short second line, such as "On" for a switched-on setting. */
  detail?: string
  active?: boolean
  disabled?: boolean
}

/** A card of larger tools that unfolds from the writing-tools corner. */
export function ToolDrawer({
  tools,
  bottomInset,
  onSelect,
  onClose
}: {
  tools: DrawerTool[]
  bottomInset: number
  onSelect: (key: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [unfold] = useState(() => new Animated.Value(0))
  const [areaHeight, setAreaHeight] = useState(0)
  useEffect(() => {
    Animated.spring(unfold, { toValue: 1, friction: 7, tension: 90, useNativeDriver: true }).start()
  }, [unfold])

  return (
    <View
      pointerEvents="box-none"
      style={StyleSheet.absoluteFill}
      onLayout={(event) => setAreaHeight(event.nativeEvent.layout.height)}
    >
      <RadialBackdrop onPress={onClose} />
      <Animated.View
        accessibilityViewIsModal
        style={[
          styles.card,
          {
            bottom: bottomInset + 96,
            // On a short screen the tools scroll rather than run off the top.
            maxHeight: areaHeight ? Math.max(200, areaHeight - bottomInset - 96 - 12) : undefined,
            opacity: unfold,
            transformOrigin: 'bottom right',
            transform: [
              { scale: unfold.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) },
              { rotate: unfold.interpolate({ inputRange: [0, 1], outputRange: ['8deg', '0deg'] }) }
            ]
          }
        ]}
      >
        <Text style={styles.heading}>More tools</Text>
        <ScrollView contentContainerStyle={styles.grid}>
          {tools.map((tool) => (
            <Pressable
              accessibilityLabel={tool.detail ? `${tool.label}, ${tool.detail}` : tool.label}
              accessibilityRole="button"
              accessibilityState={{ disabled: tool.disabled, selected: tool.active }}
              disabled={tool.disabled}
              key={tool.key}
              style={({ pressed }) => [
                styles.tile,
                tool.active && styles.tileActive,
                pressed && styles.tilePressed,
                tool.disabled && styles.tileDisabled
              ]}
              onPress={() => {
                confirm()
                onSelect(tool.key)
              }}
            >
              <Text style={[styles.glyph, tool.active && styles.glyphActive]}>{tool.glyph}</Text>
              <Text numberOfLines={2} style={[styles.label, tool.active && styles.labelActive]}>
                {tool.label}
              </Text>
              {tool.detail ? (
                <Text style={[styles.detail, tool.active && styles.labelActive]}>
                  {tool.detail}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </ScrollView>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    right: 14,
    width: 292,
    maxWidth: '92%',
    padding: 14,
    gap: 10,
    borderRadius: storyboundRadii.large,
    borderWidth: 1,
    borderColor: storyboundColors.brass,
    backgroundColor: storyboundColors.ink,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 18,
    elevation: 12
  },
  heading: {
    color: storyboundColors.brassBright,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase'
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  tile: {
    width: '48%',
    flexGrow: 1,
    minHeight: 74,
    gap: 2,
    padding: 10,
    borderRadius: storyboundRadii.medium,
    backgroundColor: storyboundColors.inkRaised
  },
  tileActive: {
    backgroundColor: storyboundColors.brass
  },
  tilePressed: {
    opacity: 0.7
  },
  tileDisabled: {
    opacity: 0.35
  },
  glyph: {
    color: storyboundColors.brassBright,
    fontFamily: 'serif',
    fontSize: 20
  },
  glyphActive: {
    color: storyboundColors.ink
  },
  label: {
    color: storyboundColors.nightText,
    fontSize: 13,
    fontWeight: '700'
  },
  labelActive: {
    color: storyboundColors.ink
  },
  detail: {
    color: '#ab9b87',
    fontSize: 11
  }
})
