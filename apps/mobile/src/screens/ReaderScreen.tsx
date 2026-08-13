import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent
} from 'react-native'
import { AppHeader } from '../components/AppHeader'
import { PrimaryButton } from '../components/PrimaryButton'
import { ErrorScreen, LoadingScreen } from '../components/ScreenState'
import type {
  BookDetail,
  Chapter,
  MobileRepository,
  ReaderTheme,
  ReadingState
} from '../domain/contracts'
import { calculateReadingProgress, parseStoryBlocks } from '../domain/reading'
import { storyboundColors } from '../theme'

const readerPalettes: Record<
  ReaderTheme,
  { background: string; foreground: string; muted: string; line: string }
> = {
  paper: {
    background: storyboundColors.paperRaised,
    foreground: storyboundColors.text,
    muted: storyboundColors.muted,
    line: storyboundColors.line
  },
  sepia: {
    background: '#eee1c6',
    foreground: '#3d3022',
    muted: '#79664d',
    line: '#cdbb9a'
  },
  night: {
    background: storyboundColors.ink,
    foreground: storyboundColors.nightText,
    muted: '#ab9b87',
    line: storyboundColors.walnut
  }
}

export function ReaderScreen({
  bookId,
  initialChapterId,
  repository,
  onBack,
  onEditChapter
}: {
  bookId: string
  initialChapterId?: string
  repository: MobileRepository
  onBack: () => void
  onEditChapter: (chapterId: string) => void
}): React.JSX.Element {
  const [book, setBook] = useState<BookDetail | null>(null)
  const [chapter, setChapter] = useState<Chapter | null>(null)
  const [reading, setReading] = useState<ReadingState | null>(null)
  const [theme, setTheme] = useState<ReaderTheme>('sepia')
  const [fontSize, setFontSize] = useState(19)
  const [controlsOpen, setControlsOpen] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const scrollRef = useRef<ScrollView>(null)
  const viewportHeightRef = useRef(0)
  const contentHeightRef = useRef(0)
  const positionRef = useRef(0)
  const restorePendingRef = useRef(true)
  const lastSaveAtRef = useRef(0)

  const loadChapter = useCallback(
    async (
      nextBook: BookDetail,
      chapterId: string,
      restore: ReadingState | null
    ): Promise<void> => {
      const nextChapter = await repository.getChapter(chapterId)
      setChapter(nextChapter)
      const index = nextBook.chapters.findIndex((item) => item.id === nextChapter.id)
      const position = restore?.chapterId === nextChapter.id ? restore.scrollPosition : 0
      positionRef.current = position
      restorePendingRef.current = true
      setProgress(calculateReadingProgress(index, nextBook.chapters.length, position))
    },
    [repository]
  )

  useEffect(() => {
    let active = true
    const load = async (): Promise<void> => {
      try {
        const [nextBook, nextReading] = await Promise.all([
          repository.getBook(bookId),
          repository.getReadingState(bookId)
        ])
        if (!active) return
        const nextChapterId =
          initialChapterId ?? nextReading.chapterId ?? nextBook.chapters[0]?.id ?? null
        setBook(nextBook)
        setReading(nextReading)
        if (nextChapterId) await loadChapter(nextBook, nextChapterId, nextReading)
      } catch (caught) {
        if (active)
          setError(caught instanceof Error ? caught.message : 'The reader could not be opened.')
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [bookId, initialChapterId, loadChapter, repository])

  const restoreScroll = (): void => {
    if (!restorePendingRef.current) return
    const available = Math.max(0, contentHeightRef.current - viewportHeightRef.current)
    if (available <= 0) return
    restorePendingRef.current = false
    scrollRef.current?.scrollTo({ animated: false, y: available * positionRef.current })
  }

  const persistPosition = useCallback(
    async (force = false): Promise<void> => {
      if (!book || !chapter) return
      const now = Date.now()
      if (!force && now - lastSaveAtRef.current < 900) return
      lastSaveAtRef.current = now
      const index = book.chapters.findIndex((item) => item.id === chapter.id)
      const overall = calculateReadingProgress(index, book.chapters.length, positionRef.current)
      setProgress(overall)
      try {
        const next = await repository.saveReadingState({
          bookId,
          chapterId: chapter.id,
          scrollPosition: positionRef.current,
          progressPercentage: overall
        })
        setReading(next)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Reading progress could not be saved.')
      }
    },
    [book, bookId, chapter, repository]
  )

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
    const available = Math.max(0, contentSize.height - layoutMeasurement.height)
    positionRef.current = available <= 1 ? 1 : Math.min(1, Math.max(0, contentOffset.y / available))
    if (book && chapter) {
      const index = book.chapters.findIndex((item) => item.id === chapter.id)
      setProgress(calculateReadingProgress(index, book.chapters.length, positionRef.current))
    }
    void persistPosition()
  }

  const goToChapter = async (chapterId: string): Promise<void> => {
    if (!book) return
    await persistPosition(true)
    await loadChapter(book, chapterId, null)
    scrollRef.current?.scrollTo({ animated: false, y: 0 })
  }

  if (error && (!book || !chapter)) return <ErrorScreen message={error} onBack={onBack} />
  if (!book || !chapter) return <LoadingScreen label="Preparing the next page…" />

  const palette = readerPalettes[theme]
  const chapterIndex = book.chapters.findIndex((item) => item.id === chapter.id)
  const previous = chapterIndex > 0 ? book.chapters[chapterIndex - 1] : null
  const next = chapterIndex < book.chapters.length - 1 ? book.chapters[chapterIndex + 1] : null
  const blocks = parseStoryBlocks(chapter.content)

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <AppHeader
        actionLabel={controlsOpen ? 'Done' : 'Text'}
        dark={theme === 'night'}
        subtitle={chapter.title}
        title={book.title}
        onAction={() => setControlsOpen((value) => !value)}
        onBack={() => {
          void persistPosition(true).then(onBack)
        }}
      />

      {controlsOpen ? (
        <View
          style={[
            styles.controls,
            { backgroundColor: palette.background, borderColor: palette.line }
          ]}
        >
          <View style={styles.controlGroup}>
            {(['paper', 'sepia', 'night'] as const).map((value) => (
              <Pressable
                accessibilityRole="button"
                key={value}
                style={[
                  styles.themeChoice,
                  { borderColor: theme === value ? storyboundColors.brass : palette.line },
                  theme === value && styles.activeChoice
                ]}
                onPress={() => setTheme(value)}
              >
                <View
                  style={[styles.themeDot, { backgroundColor: readerPalettes[value].background }]}
                />
                <Text style={[styles.themeLabel, { color: palette.foreground }]}>{value}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.sizeControls}>
            <Pressable
              accessibilityLabel="Make text smaller"
              accessibilityRole="button"
              disabled={fontSize <= 15}
              style={styles.sizeButton}
              onPress={() => setFontSize((value) => Math.max(15, value - 2))}
            >
              <Text style={[styles.sizeLabel, { color: palette.foreground }]}>A−</Text>
            </Pressable>
            <Text style={[styles.sizeValue, { color: palette.muted }]}>{fontSize}px</Text>
            <Pressable
              accessibilityLabel="Make text larger"
              accessibilityRole="button"
              disabled={fontSize >= 31}
              style={styles.sizeButton}
              onPress={() => setFontSize((value) => Math.min(31, value + 2))}
            >
              <Text style={[styles.sizeLabel, { color: palette.foreground }]}>A+</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {error ? (
        <Pressable
          accessibilityRole="button"
          style={styles.errorBanner}
          onPress={() => setError('')}
        >
          <Text style={styles.errorText}>{error} Tap to dismiss.</Text>
        </Pressable>
      ) : null}

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.readerContent}
        scrollEventThrottle={64}
        style={{ backgroundColor: palette.background }}
        onContentSizeChange={(_width, height) => {
          contentHeightRef.current = height
          restoreScroll()
        }}
        onLayout={(event: LayoutChangeEvent) => {
          viewportHeightRef.current = event.nativeEvent.layout.height
          restoreScroll()
        }}
        onMomentumScrollEnd={() => void persistPosition(true)}
        onScroll={handleScroll}
      >
        <View style={styles.chapterHeading}>
          <Text style={[styles.kicker, { color: palette.muted }]}>
            Chapter {chapterIndex + 1} of {book.chapters.length}
          </Text>
          <Text style={[styles.chapterTitle, { color: palette.foreground }]}>{chapter.title}</Text>
          <Text style={[styles.ornament, { color: storyboundColors.brass }]}>✦</Text>
        </View>

        <View accessibilityRole="text" style={styles.prose}>
          {blocks.length ? (
            blocks.map((block, index) =>
              block.kind === 'divider' ? (
                <Text key={`divider-${index}`} style={[styles.divider, { color: palette.muted }]}>
                  ◆
                </Text>
              ) : block.kind === 'heading' ? (
                <Text
                  key={`heading-${index}`}
                  style={[
                    styles.proseHeading,
                    { color: palette.foreground, fontSize: fontSize + 4 }
                  ]}
                >
                  {block.text}
                </Text>
              ) : (
                <Text
                  key={`paragraph-${index}`}
                  selectable
                  style={[
                    styles.paragraph,
                    { color: palette.foreground, fontSize, lineHeight: fontSize * 1.72 }
                  ]}
                >
                  {block.text}
                </Text>
              )
            )
          ) : (
            <Text style={[styles.emptyChapter, { color: palette.muted }]}>
              This chapter is empty.
            </Text>
          )}
        </View>

        <View style={[styles.chapterActions, { borderTopColor: palette.line }]}>
          <PrimaryButton
            label="Edit chapter"
            variant="quiet"
            onPress={() => onEditChapter(chapter.id)}
          />
          <View style={styles.chapterNavigation}>
            <PrimaryButton
              disabled={!previous}
              label={previous ? '← Previous' : 'Beginning'}
              style={styles.navButton}
              variant="secondary"
              onPress={() => previous && void goToChapter(previous.id)}
            />
            <PrimaryButton
              disabled={!next}
              label={next ? 'Next →' : 'End'}
              style={styles.navButton}
              variant="secondary"
              onPress={() => next && void goToChapter(next.id)}
            />
          </View>
        </View>
      </ScrollView>

      <View
        accessibilityLabel={`${Math.round(progress)} percent through ${book.title}`}
        accessibilityRole="progressbar"
        style={[
          styles.progressFooter,
          { backgroundColor: palette.background, borderColor: palette.line }
        ]}
      >
        <Text style={[styles.progressText, { color: palette.muted }]}>{Math.round(progress)}%</Text>
        <View style={[styles.progressTrack, { backgroundColor: palette.line }]}>
          <View style={[styles.progressValue, { width: `${progress}%` }]} />
        </View>
        <Text style={[styles.progressText, { color: palette.muted }]}>
          {reading?.chapterId ? `${chapterIndex + 1}/${book.chapters.length}` : 'New'}
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1
  },
  controls: {
    gap: 12,
    padding: 14,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  controlGroup: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8
  },
  themeChoice: {
    minWidth: 82,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 22,
    borderWidth: 1
  },
  activeChoice: {
    borderWidth: 2
  },
  themeDot: {
    width: 16,
    height: 16,
    borderColor: storyboundColors.line,
    borderRadius: 8,
    borderWidth: 1
  },
  themeLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'capitalize'
  },
  sizeControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12
  },
  sizeButton: {
    minWidth: 50,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center'
  },
  sizeLabel: {
    fontFamily: 'serif',
    fontSize: 18,
    fontWeight: '700'
  },
  sizeValue: {
    minWidth: 48,
    textAlign: 'center'
  },
  errorBanner: {
    padding: 10,
    backgroundColor: '#f0d7d1'
  },
  errorText: {
    color: storyboundColors.danger,
    fontSize: 12,
    textAlign: 'center'
  },
  readerContent: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingTop: 48,
    paddingBottom: 30
  },
  chapterHeading: {
    alignItems: 'center',
    marginBottom: 34
  },
  kicker: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.3,
    textTransform: 'uppercase'
  },
  chapterTitle: {
    marginTop: 12,
    fontFamily: 'serif',
    fontSize: 32,
    fontWeight: '700',
    lineHeight: 38,
    textAlign: 'center'
  },
  ornament: {
    marginTop: 18,
    fontSize: 15
  },
  prose: {
    width: '100%'
  },
  paragraph: {
    marginBottom: 22,
    fontFamily: 'serif'
  },
  proseHeading: {
    marginTop: 13,
    marginBottom: 16,
    fontFamily: 'serif',
    fontWeight: '700',
    lineHeight: 31
  },
  divider: {
    marginVertical: 22,
    fontSize: 14,
    textAlign: 'center'
  },
  emptyChapter: {
    fontFamily: 'serif',
    fontSize: 17,
    fontStyle: 'italic',
    textAlign: 'center'
  },
  chapterActions: {
    gap: 12,
    marginTop: 34,
    paddingTop: 20,
    borderTopWidth: StyleSheet.hairlineWidth
  },
  chapterNavigation: {
    flexDirection: 'row',
    gap: 12
  },
  navButton: {
    flex: 1
  },
  progressFooter: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth
  },
  progressText: {
    minWidth: 30,
    fontSize: 11,
    fontVariant: ['tabular-nums']
  },
  progressTrack: {
    flex: 1,
    height: 3,
    overflow: 'hidden',
    borderRadius: 3
  },
  progressValue: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: storyboundColors.brass
  }
})
