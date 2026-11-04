import { Pressable, StyleSheet, Text, View } from 'react-native'
import { listeningSession } from '../narration'
import { useListening } from '../narration/useListening'
import { storyboundColors } from '../theme'

/** A slim player at the foot of other screens while a book is being read aloud. */
export function ListeningBar({
  onOpen
}: {
  onOpen: (bookId: string, chapterId: string | null) => void
}): React.JSX.Element | null {
  const listening = useListening()
  if (!listening.bookId || listening.status === 'idle') return null
  const bookId = listening.bookId
  const playing = listening.status === 'playing'
  return (
    <View style={styles.bar}>
      <Pressable
        accessibilityHint="Opens the book at the passage being read"
        accessibilityRole="button"
        style={({ pressed }) => [styles.copy, pressed && styles.pressed]}
        onPress={() => onOpen(bookId, listening.chapterId)}
      >
        <Text numberOfLines={1} style={styles.title}>
          {listening.bookTitle}
        </Text>
        <Text numberOfLines={1} style={styles.subtitle}>
          {listening.error
            ? listening.error
            : listening.status === 'loading'
              ? `Preparing · ${listening.chapterTitle}`
              : listening.chapterTitle}
        </Text>
      </Pressable>
      <Pressable
        accessibilityLabel={playing ? 'Pause' : 'Play'}
        accessibilityRole="button"
        hitSlop={8}
        style={({ pressed }) => [styles.button, styles.play, pressed && styles.pressed]}
        onPress={() => listeningSession().toggle()}
      >
        <Text style={styles.glyph}>{(playing ? '⏸' : '▶') + '︎'}</Text>
      </Pressable>
      <Pressable
        accessibilityLabel="Stop listening"
        accessibilityRole="button"
        hitSlop={8}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        onPress={() => listeningSession().stop()}
      >
        <Text style={styles.glyph}>✕</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderTopColor: storyboundColors.brass,
    borderTopWidth: 1,
    backgroundColor: storyboundColors.walnut
  },
  copy: {
    flex: 1
  },
  title: {
    color: storyboundColors.nightText,
    fontFamily: 'serif',
    fontSize: 15,
    fontWeight: '700'
  },
  subtitle: {
    marginTop: 2,
    color: storyboundColors.brassBright,
    fontSize: 12
  },
  button: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21
  },
  play: {
    borderColor: storyboundColors.brassBright,
    borderWidth: 1.5
  },
  glyph: {
    color: storyboundColors.nightText,
    fontSize: 18,
    includeFontPadding: false
  },
  pressed: {
    opacity: 0.6
  }
})
