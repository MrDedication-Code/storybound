import { StyleSheet, Text, View } from 'react-native'
import type { BookSummary } from '../domain/contracts'
import { storyboundRadii, storyboundShadow } from '../theme'

const tones: Record<BookSummary['coverTone'], { from: string; ink: string }> = {
  forest: { from: '#234338', ink: '#e7dbb5' },
  moonlit: { from: '#26354f', ink: '#ece1c5' },
  ember: { from: '#653729', ink: '#f1d8ae' }
}

export function BookArtwork({
  book,
  size = 'card'
}: {
  book: Pick<BookSummary, 'title' | 'coverTone'>
  size?: 'card' | 'hero' | 'compact'
}): React.JSX.Element {
  const tone = tones[book.coverTone]
  const initials = book.title
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 3)
    .map((word) => word[0]?.toLocaleUpperCase())
    .join('')
  return (
    <View
      accessibilityLabel={`Cover of ${book.title}`}
      accessibilityRole="image"
      style={[
        styles.cover,
        size === 'hero' ? styles.hero : size === 'compact' ? styles.compact : styles.card,
        { backgroundColor: tone.from }
      ]}
    >
      <View style={[styles.rule, { backgroundColor: tone.ink }]} />
      <Text numberOfLines={size === 'compact' ? 2 : 4} style={[styles.title, { color: tone.ink }]}>
        {book.title}
      </Text>
      {size !== 'compact' ? (
        <Text style={[styles.initials, { color: tone.ink }]}>{initials}</Text>
      ) : null}
      <Text style={[styles.imprint, { color: tone.ink }]}>STORYBOUND</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  cover: {
    overflow: 'hidden',
    justifyContent: 'space-between',
    borderRadius: storyboundRadii.small,
    padding: 12,
    borderColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    ...storyboundShadow
  },
  card: {
    width: 104,
    height: 156
  },
  hero: {
    width: 164,
    height: 246,
    padding: 17
  },
  compact: {
    width: 58,
    height: 82,
    padding: 7
  },
  rule: {
    width: 32,
    height: 1,
    opacity: 0.65
  },
  title: {
    fontFamily: 'serif',
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 19
  },
  initials: {
    opacity: 0.33,
    fontFamily: 'serif',
    fontSize: 28,
    fontWeight: '700'
  },
  imprint: {
    opacity: 0.7,
    fontSize: 7,
    fontWeight: '700',
    letterSpacing: 1.2
  }
})
