import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { AppHeader } from '../components/AppHeader'
import { BookArtwork } from '../components/BookArtwork'
import { PrimaryButton } from '../components/PrimaryButton'
import { ErrorScreen, LoadingScreen } from '../components/ScreenState'
import type { BookDetail, MobileRepository, ReadingState } from '../domain/contracts'
import { estimateReadingMinutes, formatCompactNumber } from '../domain/reading'
import { compactCaps, literaryHeading, storyboundColors, storyboundRadii } from '../theme'

export function BookDetailScreen({
  bookId,
  repository,
  onBack,
  onReadChapter,
  onEditChapter
}: {
  bookId: string
  repository: MobileRepository
  onBack: () => void
  onReadChapter: (chapterId: string) => void
  onEditChapter: (chapterId: string) => void
}): React.JSX.Element {
  const [book, setBook] = useState<BookDetail | null>(null)
  const [reading, setReading] = useState<ReadingState | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void Promise.all([repository.getBook(bookId), repository.getReadingState(bookId)])
      .then(([nextBook, nextReading]) => {
        if (!active) return
        setBook(nextBook)
        setReading(nextReading)
      })
      .catch((caught: unknown) => {
        if (active)
          setError(caught instanceof Error ? caught.message : 'This book could not be opened.')
      })
    return () => {
      active = false
    }
  }, [bookId, repository])

  if (error && !book) return <ErrorScreen message={error} onBack={onBack} />
  if (!book) return <LoadingScreen label="Opening book…" />

  const resumeChapter =
    book.chapters.find((chapter) => chapter.id === reading?.chapterId) ?? book.chapters[0]

  return (
    <View style={styles.screen}>
      <AppHeader title="Book details" onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <BookArtwork book={book} size="hero" />
          <View style={styles.heroCopy}>
            <Text style={compactCaps}>
              {book.status === 'completed' ? 'Completed' : 'Ongoing story'}
            </Text>
            <Text style={styles.title}>{book.title}</Text>
            {book.subtitle ? <Text style={styles.subtitle}>{book.subtitle}</Text> : null}
            <Text style={styles.author}>{book.authorName || 'Unknown author'}</Text>
            <Text style={styles.stats}>
              {book.chapterCount} {book.chapterCount === 1 ? 'chapter' : 'chapters'} ·{' '}
              {formatCompactNumber(book.totalWordCount)} words ·{' '}
              {estimateReadingMinutes(book.totalWordCount)} min
            </Text>
          </View>
        </View>

        {reading && reading.progressPercentage > 0 ? (
          <View style={styles.progressCard}>
            <View style={styles.progressHeading}>
              <Text style={styles.progressLabel}>Reading progress</Text>
              <Text style={styles.progressNumber}>{Math.round(reading.progressPercentage)}%</Text>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressValue, { width: `${reading.progressPercentage}%` }]} />
            </View>
          </View>
        ) : null}

        <Text style={styles.blurb}>{book.blurb}</Text>
        <PrimaryButton
          disabled={!resumeChapter}
          label={reading?.chapterId ? 'Continue reading' : 'Start reading'}
          onPress={() => resumeChapter && onReadChapter(resumeChapter.id)}
        />

        <View style={styles.chapterHeading}>
          <Text style={compactCaps}>Contents</Text>
          <Text style={styles.chapterCount}>{book.chapters.length}</Text>
        </View>
        <View style={styles.chapters}>
          {book.chapters.map((chapter, index) => (
            <View key={chapter.id} style={styles.chapterRow}>
              <Pressable
                accessibilityLabel={`Read ${chapter.title}`}
                accessibilityRole="button"
                style={({ pressed }) => [styles.chapterOpen, pressed && styles.pressed]}
                onPress={() => onReadChapter(chapter.id)}
              >
                <Text style={styles.chapterNumber}>{String(index + 1).padStart(2, '0')}</Text>
                <View style={styles.chapterCopy}>
                  <Text numberOfLines={2} style={styles.chapterTitle}>
                    {chapter.title}
                  </Text>
                  <Text style={styles.chapterMeta}>
                    {formatCompactNumber(chapter.wordCount)} words ·{' '}
                    {estimateReadingMinutes(chapter.wordCount)} min
                  </Text>
                </View>
              </Pressable>
              <Pressable
                accessibilityLabel={`Edit ${chapter.title}`}
                accessibilityRole="button"
                hitSlop={8}
                style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}
                onPress={() => onEditChapter(chapter.id)}
              >
                <Text style={styles.editLabel}>Edit</Text>
              </Pressable>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: storyboundColors.paper
  },
  content: {
    padding: 20,
    paddingBottom: 44
  },
  hero: {
    alignItems: 'center',
    gap: 24,
    paddingTop: 14
  },
  heroCopy: {
    alignItems: 'center'
  },
  title: {
    ...literaryHeading,
    marginTop: 7,
    fontSize: 32,
    lineHeight: 37,
    textAlign: 'center'
  },
  subtitle: {
    marginTop: 5,
    color: storyboundColors.muted,
    fontFamily: 'serif',
    fontSize: 16,
    textAlign: 'center'
  },
  author: {
    marginTop: 10,
    color: storyboundColors.brass,
    fontSize: 14,
    fontWeight: '700'
  },
  stats: {
    marginTop: 13,
    color: storyboundColors.muted,
    fontSize: 12
  },
  progressCard: {
    gap: 9,
    marginTop: 30,
    padding: 16,
    borderRadius: storyboundRadii.medium,
    backgroundColor: storyboundColors.parchment
  },
  progressHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  progressLabel: {
    color: storyboundColors.text,
    fontWeight: '600'
  },
  progressNumber: {
    color: storyboundColors.brass,
    fontWeight: '800'
  },
  progressTrack: {
    height: 4,
    overflow: 'hidden',
    borderRadius: 4,
    backgroundColor: storyboundColors.line
  },
  progressValue: {
    height: '100%',
    backgroundColor: storyboundColors.brass
  },
  blurb: {
    marginVertical: 26,
    color: storyboundColors.text,
    fontFamily: 'serif',
    fontSize: 17,
    lineHeight: 26,
    textAlign: 'center'
  },
  chapterHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 38,
    marginBottom: 8
  },
  chapterCount: {
    color: storyboundColors.muted,
    fontWeight: '700'
  },
  chapters: {
    borderTopColor: storyboundColors.line,
    borderTopWidth: StyleSheet.hairlineWidth
  },
  chapterRow: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomColor: storyboundColors.line,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  chapterOpen: {
    flex: 1,
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14
  },
  chapterNumber: {
    color: storyboundColors.brass,
    fontFamily: 'serif',
    fontSize: 15
  },
  chapterCopy: {
    flex: 1,
    minWidth: 0
  },
  chapterTitle: {
    color: storyboundColors.text,
    fontFamily: 'serif',
    fontSize: 17,
    fontWeight: '700'
  },
  chapterMeta: {
    marginTop: 5,
    color: storyboundColors.muted,
    fontSize: 12
  },
  editButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingLeft: 12
  },
  editLabel: {
    color: storyboundColors.brass,
    fontSize: 13,
    fontWeight: '700'
  },
  pressed: {
    opacity: 0.55
  }
})
