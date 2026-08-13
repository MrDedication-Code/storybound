import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { BookArtwork } from '../components/BookArtwork'
import { ErrorScreen, LoadingScreen } from '../components/ScreenState'
import type { BookSummary, MobileRepository } from '../domain/contracts'
import { estimateReadingMinutes, formatCompactNumber } from '../domain/reading'
import { compactCaps, literaryHeading, storyboundColors, storyboundRadii } from '../theme'

export function LibraryScreen({
  repository,
  onOpenBook,
  onOpenSync
}: {
  repository: MobileRepository
  onOpenBook: (bookId: string) => void
  onOpenSync: () => void
}): React.JSX.Element {
  const [books, setBooks] = useState<BookSummary[] | null>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void repository
      .listBooks()
      .then((nextBooks) => {
        if (active) setBooks(nextBooks)
      })
      .catch((caught: unknown) => {
        if (active)
          setError(
            caught instanceof Error ? caught.message : 'The local library could not be opened.'
          )
      })
    return () => {
      active = false
    }
  }, [repository])

  if (error && !books) return <ErrorScreen message={error} />
  if (!books) return <LoadingScreen label="Opening your mobile library…" />

  const normalized = query.trim().toLocaleLowerCase()
  const filtered = normalized
    ? books.filter((book) =>
        `${book.title} ${book.authorName} ${book.blurb}`.toLocaleLowerCase().includes(normalized)
      )
    : books
  const continueReading = books.find((book) => book.lastReadAt && book.progressPercentage < 100)

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      style={styles.screen}
    >
      <View style={styles.topbar}>
        <View>
          <Text style={styles.wordmark}>Storybound</Text>
          <Text style={styles.localLabel}>Offline mobile preview</Text>
        </View>
        <Pressable
          accessibilityLabel="Open sync settings"
          accessibilityRole="button"
          hitSlop={10}
          style={({ pressed }) => [styles.syncButton, pressed && styles.pressed]}
          onPress={onOpenSync}
        >
          <Text style={styles.syncGlyph}>◎</Text>
        </Pressable>
      </View>

      <TextInput
        accessibilityLabel="Search local library"
        autoCapitalize="none"
        clearButtonMode="while-editing"
        placeholder="Search titles, authors, or remembered lines"
        placeholderTextColor={storyboundColors.muted}
        returnKeyType="search"
        style={styles.search}
        value={query}
        onChangeText={setQuery}
      />

      {continueReading && !normalized ? (
        <View style={styles.section}>
          <Text style={compactCaps}>Continue reading</Text>
          <Pressable
            accessibilityHint={`You are ${Math.round(continueReading.progressPercentage)} percent through this book`}
            accessibilityRole="button"
            style={({ pressed }) => [styles.continueCard, pressed && styles.pressed]}
            onPress={() => onOpenBook(continueReading.id)}
          >
            <BookArtwork book={continueReading} size="compact" />
            <View style={styles.continueCopy}>
              <Text numberOfLines={1} style={styles.continueTitle}>
                {continueReading.title}
              </Text>
              <Text style={styles.meta}>
                {Math.round(continueReading.progressPercentage)}% complete
              </Text>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressValue,
                    { width: `${Math.max(3, continueReading.progressPercentage)}%` }
                  ]}
                />
              </View>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.sectionHeading}>
        <View>
          <Text style={compactCaps}>{normalized ? 'Search results' : 'Your library'}</Text>
          <Text style={styles.heading}>
            {filtered.length === 1 ? '1 book' : `${filtered.length} books`}
          </Text>
        </View>
        <View style={styles.offlineBadge}>
          <Text style={styles.offlineBadgeText}>Local</Text>
        </View>
      </View>

      {filtered.length ? (
        <View style={styles.books}>
          {filtered.map((book) => (
            <Pressable
              accessibilityRole="button"
              key={book.id}
              style={({ pressed }) => [styles.bookRow, pressed && styles.pressed]}
              onPress={() => onOpenBook(book.id)}
            >
              <BookArtwork book={book} />
              <View style={styles.bookCopy}>
                <Text numberOfLines={2} style={styles.bookTitle}>
                  {book.title}
                </Text>
                <Text numberOfLines={1} style={styles.author}>
                  {book.authorName || 'Unknown author'}
                </Text>
                <Text numberOfLines={3} style={styles.blurb}>
                  {book.blurb}
                </Text>
                <Text style={styles.meta}>
                  {book.chapterCount} {book.chapterCount === 1 ? 'chapter' : 'chapters'} ·{' '}
                  {formatCompactNumber(book.totalWordCount)} words ·{' '}
                  {estimateReadingMinutes(book.totalWordCount)} min
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyMark}>◇</Text>
          <Text style={styles.emptyTitle}>No matching books</Text>
          <Text style={styles.blurb}>Try a shorter title, author, or phrase.</Text>
        </View>
      )}

      <View style={styles.previewNotice}>
        <Text style={styles.previewTitle}>Preview library</Text>
        <Text style={styles.previewCopy}>
          This app is intentionally offline. Sample stories, edits, and reading progress are stored
          in a private SQLite database on this device.
        </Text>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: storyboundColors.paper
  },
  content: {
    padding: 20,
    paddingBottom: 42
  },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 22
  },
  wordmark: {
    ...literaryHeading,
    fontSize: 32,
    letterSpacing: -0.8
  },
  localLabel: {
    marginTop: 2,
    color: storyboundColors.brass,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6
  },
  syncButton: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 23,
    borderColor: storyboundColors.line,
    borderWidth: 1,
    backgroundColor: storyboundColors.paperRaised
  },
  syncGlyph: {
    color: storyboundColors.walnut,
    fontSize: 26
  },
  search: {
    minHeight: 50,
    marginBottom: 26,
    paddingHorizontal: 16,
    borderColor: storyboundColors.line,
    borderRadius: storyboundRadii.medium,
    borderWidth: 1,
    color: storyboundColors.text,
    backgroundColor: storyboundColors.paperRaised,
    fontSize: 15
  },
  section: {
    gap: 10,
    marginBottom: 30
  },
  continueCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    borderRadius: storyboundRadii.medium,
    backgroundColor: storyboundColors.ink
  },
  continueCopy: {
    flex: 1,
    gap: 5
  },
  continueTitle: {
    color: storyboundColors.nightText,
    fontFamily: 'serif',
    fontSize: 19,
    fontWeight: '700'
  },
  progressTrack: {
    height: 3,
    overflow: 'hidden',
    borderRadius: 3,
    backgroundColor: storyboundColors.walnut
  },
  progressValue: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: storyboundColors.brassBright
  },
  chevron: {
    color: storyboundColors.brassBright,
    fontFamily: 'serif',
    fontSize: 34
  },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 15
  },
  heading: {
    ...literaryHeading,
    marginTop: 3,
    fontSize: 23
  },
  offlineBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: '#dfeae2'
  },
  offlineBadgeText: {
    color: storyboundColors.success,
    fontSize: 12,
    fontWeight: '700'
  },
  books: {
    gap: 4
  },
  bookRow: {
    flexDirection: 'row',
    gap: 18,
    paddingVertical: 17,
    borderBottomColor: storyboundColors.line,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  bookCopy: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 4
  },
  bookTitle: {
    ...literaryHeading,
    fontSize: 21,
    lineHeight: 25
  },
  author: {
    marginTop: 4,
    color: storyboundColors.brass,
    fontSize: 13,
    fontWeight: '600'
  },
  blurb: {
    marginTop: 10,
    color: storyboundColors.muted,
    fontSize: 14,
    lineHeight: 20
  },
  meta: {
    marginTop: 9,
    color: storyboundColors.muted,
    fontSize: 12
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 50
  },
  emptyMark: {
    color: storyboundColors.brass,
    fontSize: 40
  },
  emptyTitle: {
    ...literaryHeading,
    marginTop: 8,
    fontSize: 20
  },
  previewNotice: {
    marginTop: 30,
    padding: 17,
    borderColor: storyboundColors.line,
    borderRadius: storyboundRadii.medium,
    borderWidth: 1,
    backgroundColor: storyboundColors.parchment
  },
  previewTitle: {
    color: storyboundColors.text,
    fontWeight: '700'
  },
  previewCopy: {
    marginTop: 6,
    color: storyboundColors.muted,
    fontSize: 13,
    lineHeight: 19
  },
  pressed: {
    opacity: 0.65
  }
})
