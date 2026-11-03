import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions
} from 'react-native'
import { AppHeader } from '../components/AppHeader'
import { BookArtwork } from '../components/BookArtwork'
import { BookDetailsSheet } from '../components/BookDetailsSheet'
import { Notice } from '../components/Notice'
import { PrimaryButton } from '../components/PrimaryButton'
import { PetalMenu } from '../components/radial/PetalMenu'
import type { Point, RadialItem } from '../components/radial/radialLayout'
import { ErrorScreen, LoadingScreen } from '../components/ScreenState'
import { TextFieldSheet } from '../components/TextFieldSheet'
import { TrashSheet } from '../components/TrashSheet'
import type {
  BookDetail,
  ChapterSummary,
  MobileRepository,
  ReadingState
} from '../domain/contracts'
import { estimateReadingMinutes, formatCompactNumber } from '../domain/reading'
import { tick } from '../haptics'
import { compactCaps, literaryHeading, storyboundColors, storyboundRadii } from '../theme'

type Sheet =
  { kind: 'details' } | { kind: 'rename'; chapter: ChapterSummary } | { kind: 'chapter-trash' }

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
  /** Omitted in reader mode, which hides every edit control. */
  onEditChapter?: (chapterId: string) => void
}): React.JSX.Element {
  const editing = Boolean(onEditChapter)
  const { width: windowWidth } = useWindowDimensions()
  const [book, setBook] = useState<BookDetail | null>(null)
  const [reading, setReading] = useState<ReadingState | null>(null)
  const [trashedCount, setTrashedCount] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<{ text: string; undo?: () => Promise<void> } | null>(null)
  const [menu, setMenu] = useState<{ chapter: ChapterSummary; origin: Point } | null>(null)
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [arranging, setArranging] = useState(false)

  const load = useCallback(
    () =>
      Promise.all([
        repository.getBook(bookId),
        repository.getReadingState(bookId),
        repository.listTrashedChapters(bookId)
      ]),
    [bookId, repository]
  )
  const show = ([nextBook, nextReading, trashed]: Awaited<ReturnType<typeof load>>): void => {
    setBook(nextBook)
    setReading(nextReading)
    setTrashedCount(trashed.length)
  }
  const reload = async (): Promise<void> => show(await load())

  useEffect(() => {
    let active = true
    void load()
      .then(([nextBook, nextReading, trashed]) => {
        if (!active) return
        setBook(nextBook)
        setReading(nextReading)
        setTrashedCount(trashed.length)
      })
      .catch((caught: unknown) => {
        if (active)
          setError(caught instanceof Error ? caught.message : 'This book could not be opened.')
      })
    return () => {
      active = false
    }
  }, [load])

  /** Runs a change, then shows the book as it now is; failures appear as a notice. */
  const change = async (action: () => Promise<unknown>, done?: string): Promise<void> => {
    try {
      await action()
      await reload()
      if (done) setNotice({ text: done })
    } catch (caught) {
      setNotice({ text: caught instanceof Error ? caught.message : 'That did not work.' })
    }
  }

  if (error && !book) return <ErrorScreen message={error} onBack={onBack} />
  if (!book) return <LoadingScreen label="Opening book…" />

  const resumeChapter =
    book.chapters.find((chapter) => chapter.id === reading?.chapterId) ?? book.chapters[0]

  const move = (chapter: ChapterSummary, step: number): void => {
    const ids = book.chapters.map((item) => item.id)
    const from = ids.indexOf(chapter.id)
    const to = from + step
    if (to < 0 || to >= ids.length) return
    ids.splice(from, 1)
    ids.splice(to, 0, chapter.id)
    tick()
    void change(() => repository.reorderChapters(book.id, ids))
  }

  const petals = (chapter: ChapterSummary): RadialItem[] => {
    const index = book.chapters.findIndex((item) => item.id === chapter.id)
    const last = index === book.chapters.length - 1
    return [
      { key: 'write', glyph: '✎', label: 'Write' },
      { key: 'rename', glyph: 'Aa', label: 'Rename' },
      { key: 'duplicate', glyph: '⧉', label: 'Duplicate' },
      { key: 'up', glyph: '↑', label: 'Move up', disabled: index === 0 },
      { key: 'down', glyph: '↓', label: 'Move down', disabled: last },
      { key: 'merge', glyph: '⇊', label: 'Merge next', disabled: last },
      { key: 'trash', glyph: '✕', label: 'Trash', tone: 'danger' }
    ]
  }

  const choose = (chapter: ChapterSummary, key: string): void => {
    switch (key) {
      case 'write':
        onEditChapter?.(chapter.id)
        return
      case 'rename':
        setSheet({ kind: 'rename', chapter })
        return
      case 'duplicate':
        void change(() => repository.duplicateChapter(chapter.id), `Copied “${chapter.title}”.`)
        return
      case 'up':
        move(chapter, -1)
        return
      case 'down':
        move(chapter, 1)
        return
      case 'merge': {
        const index = book.chapters.findIndex((item) => item.id === chapter.id)
        const next = book.chapters[index + 1]
        if (!next) return
        Alert.alert(
          'Merge these chapters?',
          `“${next.title}” is added to the end of “${chapter.title}”, then moved to Trash.`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Merge',
              onPress: () =>
                void change(
                  () => repository.mergeWithNextChapter(chapter.id),
                  `Merged into “${chapter.title}”.`
                )
            }
          ]
        )
        return
      }
      case 'trash':
        void change(() => repository.trashChapter(chapter.id)).then(() =>
          setNotice({
            text: `“${chapter.title}” moved to Trash.`,
            undo: () => repository.restoreChapter(chapter.id)
          })
        )
        return
    }
  }

  const addChapter = (): void => {
    void repository
      .createChapter(book.id)
      .then((created) => onEditChapter?.(created.id))
      .catch((caught: unknown) =>
        setNotice({ text: caught instanceof Error ? caught.message : 'That did not work.' })
      )
  }

  const trashBook = (): void => {
    Alert.alert(
      'Move this book to Trash?',
      'It leaves your library on every device. You can restore it from Trash on the library screen.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Move to Trash',
          style: 'destructive',
          onPress: () =>
            void repository
              .trashBook(book.id)
              .then(onBack)
              .catch((caught: unknown) =>
                setNotice({ text: caught instanceof Error ? caught.message : 'That did not work.' })
              )
        }
      ]
    )
  }

  return (
    <View style={styles.screen}>
      <AppHeader
        actionLabel={editing ? (arranging ? 'Done' : 'Edit') : undefined}
        title="Book details"
        onAction={
          editing
            ? () => (arranging ? setArranging(false) : setSheet({ kind: 'details' }))
            : undefined
        }
        onBack={onBack}
      />
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
            {book.seriesName ? (
              <Text style={styles.series}>
                {book.seriesName}
                {book.seriesPosition !== null ? ` · Book ${book.seriesPosition}` : ''}
              </Text>
            ) : null}
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

        {book.blurb ? <Text style={styles.blurb}>{book.blurb}</Text> : <View style={styles.gap} />}
        <PrimaryButton
          disabled={!resumeChapter}
          label={reading?.chapterId ? 'Continue reading' : 'Start reading'}
          onPress={() => resumeChapter && onReadChapter(resumeChapter.id)}
        />

        <View style={styles.chapterHeading}>
          <Text style={compactCaps}>Contents</Text>
          <Text style={styles.chapterCount}>{book.chapters.length}</Text>
        </View>
        {editing && !arranging && book.chapters.length > 1 ? (
          <Text style={styles.hint}>Hold a chapter for more: rename, move, merge, and more.</Text>
        ) : null}
        {arranging ? (
          <Text style={styles.hint}>Move chapters with the arrows. Changes save as you go.</Text>
        ) : null}
        <View style={styles.chapters}>
          {book.chapters.map((chapter, index) => (
            <View key={chapter.id} style={[styles.chapterRow, arranging && styles.arrangeRow]}>
              <Pressable
                accessibilityHint={editing ? 'Hold for chapter actions' : undefined}
                accessibilityLabel={`Read ${chapter.title}`}
                accessibilityRole="button"
                delayLongPress={320}
                disabled={arranging}
                style={({ pressed }) => [styles.chapterOpen, pressed && styles.pressed]}
                onLongPress={
                  editing
                    ? (event) => {
                        tick()
                        // The menu blooms from the middle of the row, leaving room on both sides.
                        setMenu({
                          chapter,
                          origin: { x: windowWidth / 2, y: event.nativeEvent.pageY }
                        })
                      }
                    : undefined
                }
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
              {arranging ? (
                <View style={styles.arrows}>
                  <ArrowButton
                    disabled={index === 0}
                    glyph="↑"
                    label={`Move ${chapter.title} up`}
                    onPress={() => move(chapter, -1)}
                  />
                  <ArrowButton
                    disabled={index === book.chapters.length - 1}
                    glyph="↓"
                    label={`Move ${chapter.title} down`}
                    onPress={() => move(chapter, 1)}
                  />
                </View>
              ) : onEditChapter ? (
                <Pressable
                  accessibilityLabel={`Write ${chapter.title}`}
                  accessibilityRole="button"
                  hitSlop={8}
                  style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}
                  onPress={() => onEditChapter(chapter.id)}
                >
                  <Text style={styles.editLabel}>Write</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>

        {editing ? (
          <View style={styles.editActions}>
            <PrimaryButton label="+ Add chapter" variant="secondary" onPress={addChapter} />
            <View style={styles.editRow}>
              <PrimaryButton
                disabled={book.chapters.length < 2}
                label={arranging ? 'Done arranging' : 'Arrange'}
                style={styles.editHalf}
                variant="quiet"
                onPress={() => setArranging((value) => !value)}
              />
              <PrimaryButton
                label={trashedCount ? `Chapter Trash (${trashedCount})` : 'Chapter Trash'}
                style={styles.editHalf}
                variant="quiet"
                onPress={() => setSheet({ kind: 'chapter-trash' })}
              />
            </View>
            <Pressable accessibilityRole="button" style={styles.danger} onPress={trashBook}>
              <Text style={styles.dangerLabel}>Move book to Trash</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>

      {notice ? (
        <Notice
          actionLabel={notice.undo ? 'Undo' : undefined}
          text={notice.text}
          onAction={() => {
            const undo = notice.undo
            setNotice(null)
            if (undo) void change(undo)
          }}
          onDismiss={() => setNotice(null)}
        />
      ) : null}

      {menu ? (
        <PetalMenu
          items={petals(menu.chapter)}
          origin={menu.origin}
          title={menu.chapter.title}
          onClose={() => setMenu(null)}
          onSelect={(key) => choose(menu.chapter, key)}
        />
      ) : null}
      {sheet?.kind === 'details' ? (
        <BookDetailsSheet
          confirmLabel="Save"
          heading="Book details"
          initial={{
            title: book.title,
            subtitle: book.subtitle,
            authorName: book.authorName,
            blurb: book.blurb,
            status: book.status,
            seriesName: book.seriesName,
            seriesPosition: book.seriesPosition
          }}
          onClose={() => setSheet(null)}
          onSave={async (details) => {
            setBook(await repository.updateBookDetails(book.id, details))
          }}
        />
      ) : null}
      {sheet?.kind === 'rename' ? (
        <TextFieldSheet
          confirmLabel="Rename"
          initialValue={sheet.chapter.title}
          label="Chapter title"
          title="Rename chapter"
          onClose={() => setSheet(null)}
          onConfirm={async (title) => {
            const current = await repository.getChapter(sheet.chapter.id)
            await repository.updateChapter({ id: current.id, title, content: current.content })
            await reload()
          }}
        />
      ) : null}
      {sheet?.kind === 'chapter-trash' ? (
        <TrashSheet
          load={async () =>
            (await repository.listTrashedChapters(book.id)).map((chapter) => ({
              id: chapter.id,
              title: chapter.title,
              detail: `${formatCompactNumber(chapter.wordCount)} words`
            }))
          }
          title="Chapter Trash"
          onClose={() => {
            setSheet(null)
            void reload()
          }}
          onRestore={(id) => repository.restoreChapter(id)}
        />
      ) : null}
    </View>
  )
}

function ArrowButton({
  glyph,
  label,
  disabled,
  onPress
}: {
  glyph: string
  label: string
  disabled: boolean
  onPress: () => void
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      style={({ pressed }) => [
        styles.arrow,
        pressed && styles.arrowPressed,
        disabled && styles.arrowDisabled
      ]}
      onPress={onPress}
    >
      <Text style={styles.arrowGlyph}>{glyph}</Text>
    </Pressable>
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
  series: {
    marginTop: 6,
    color: storyboundColors.muted,
    fontSize: 13,
    fontStyle: 'italic'
  },
  gap: {
    height: 26
  },
  hint: {
    marginBottom: 8,
    color: storyboundColors.muted,
    fontSize: 12
  },
  arrangeRow: {
    backgroundColor: storyboundColors.paperRaised
  },
  arrows: {
    flexDirection: 'row',
    gap: 8,
    paddingLeft: 8
  },
  arrow: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: storyboundColors.brass,
    backgroundColor: storyboundColors.paper
  },
  arrowPressed: {
    backgroundColor: storyboundColors.brass
  },
  arrowDisabled: {
    opacity: 0.3
  },
  arrowGlyph: {
    color: storyboundColors.text,
    fontSize: 20,
    fontWeight: '700'
  },
  editActions: {
    gap: 12,
    marginTop: 22
  },
  editRow: {
    flexDirection: 'row',
    gap: 10
  },
  editHalf: {
    flex: 1
  },
  danger: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18
  },
  dangerLabel: {
    color: storyboundColors.danger,
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
