import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { storyboundColors } from '../theme'
import { BottomSheet } from './BottomSheet'
import { PrimaryButton } from './PrimaryButton'
import { sheetStyles } from './sheetStyles'

/** Sounds and beats the Google voice performs where they are written. */
const SOUNDS = [
  'sigh',
  'laugh',
  'chuckle',
  'gasp',
  'whispers',
  'breath',
  'groan',
  'sob',
  'short pause',
  'long pause'
]

/** Ways a whole paragraph can be read, as starting points; any words work. */
const DIRECTIONS = [
  'hushed, urgent',
  'warm and tender',
  'cold, clipped',
  'breathless, frightened',
  'wry, amused',
  'grave and slow'
]

/**
 * Performance notes for the narrating voice: written as [[...]] in the chapter, heard when it is
 * read aloud in the Google voice, and never shown in the reader.
 */
export function ExpressionSheet({
  onSound,
  onDirection,
  onClose
}: {
  onSound: (note: string) => void
  onDirection: (direction: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [custom, setCustom] = useState('')
  const direct = (value: string): void => {
    const clean = value
      .replace(/[[\]\n]/gu, '')
      .trim()
      .slice(0, 100)
    if (!clean) return
    onDirection(clean)
    onClose()
  }
  return (
    <BottomSheet onClose={onClose}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={sheetStyles.title}>Expression</Text>
        <Text style={sheetStyles.message}>
          Notes for the narrating voice. They are heard when the chapter is read aloud in the Google
          voice and never shown to readers.
        </Text>
        <Text style={styles.heading}>At the cursor</Text>
        <View style={styles.chips}>
          {SOUNDS.map((sound) => (
            <Chip
              key={sound}
              label={sound}
              onPress={() => {
                onSound(sound)
                onClose()
              }}
            />
          ))}
        </View>
        <Text style={styles.heading}>How this paragraph is read</Text>
        <View style={styles.chips}>
          {DIRECTIONS.map((direction) => (
            <Chip key={direction} label={direction} onPress={() => direct(direction)} />
          ))}
        </View>
        <TextInput
          maxLength={100}
          placeholder="Your own: e.g. trembling with anger"
          placeholderTextColor={storyboundColors.muted}
          returnKeyType="done"
          style={sheetStyles.input}
          value={custom}
          onChangeText={setCustom}
          onSubmitEditing={() => direct(custom)}
        />
        <PrimaryButton
          disabled={!custom.trim()}
          label="Add to this paragraph"
          variant="secondary"
          onPress={() => direct(custom)}
        />
      </ScrollView>
    </BottomSheet>
  )
}

function Chip({ label, onPress }: { label: string; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={4}
      style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
      onPress={onPress}
    >
      <Text style={styles.chipLabel}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  content: {
    gap: 12
  },
  heading: {
    marginTop: 4,
    color: storyboundColors.text,
    fontSize: 13,
    fontWeight: '700'
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  chip: {
    minHeight: 38,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderColor: storyboundColors.brass,
    borderRadius: 19,
    borderWidth: 1,
    backgroundColor: 'rgba(173, 135, 81, 0.1)'
  },
  chipLabel: {
    color: storyboundColors.walnut,
    fontSize: 14,
    fontWeight: '600'
  },
  pressed: {
    opacity: 0.6
  }
})
