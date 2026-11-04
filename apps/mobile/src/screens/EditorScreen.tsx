import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  AppState,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputInstance,
  type ViewInstance
} from 'react-native'
import { AppHeader } from '../components/AppHeader'
import { FindBar } from '../components/FindBar'
import { Notice } from '../components/Notice'
import { QuillWheel } from '../components/radial/QuillWheel'
import type { RadialItem } from '../components/radial/radialLayout'
import { ErrorScreen, LoadingScreen } from '../components/ScreenState'
import { ExpressionSheet } from '../components/ExpressionSheet'
import { TextFieldSheet } from '../components/TextFieldSheet'
import { ToolDrawer, type DrawerTool } from '../components/ToolDrawer'
import { VersionsSheet } from '../components/VersionsSheet'
import type { BookDetail, Chapter, MobilePreferences, MobileRepository } from '../domain/contracts'
import {
  directParagraph,
  EditHistory,
  insertPerformanceNote,
  insertSceneBreak,
  insertText,
  replaceAllMatches,
  smartenTyping,
  suggestSplitTitle,
  toggleEmphasis,
  toggleHeading,
  wrapDialogue,
  type TextEdit
} from '../domain/editing'
import { countWords, formatCompactNumber } from '../domain/reading'
import { useKeyboardOverlap } from '../hooks/useKeyboardOverlap'
import { storyboundColors, storyboundRadii } from '../theme'

type Selection = TextEdit['selection']
type Sheet =
  | { kind: 'versions' }
  | { kind: 'split'; offset: number; suggestion: string }
  | { kind: 'expression' }

const FOOTER_HEIGHT = 54
const AUTOSAVE_MS = 1200

/** Where the cursor lands after the keyboard changed the text, for undo to return to. */
function caretAfter(previous: string, next: string): Selection {
  let index = 0
  while (index < previous.length && previous[index] === next[index]) index += 1
  const caret = index + Math.max(0, next.length - previous.length)
  return { start: caret, end: caret }
}

export function EditorScreen({
  bookId,
  chapterId,
  repository,
  preferences,
  onChangePreferences,
  onBack,
  onRead,
  onOpenChapter,
  registerBackHandler
}: {
  bookId: string
  chapterId: string
  repository: MobileRepository
  preferences: Pick<MobilePreferences, 'smartPunctuation'>
  onChangePreferences: (changes: Partial<MobilePreferences>) => void
  onBack: () => void
  onRead: (chapterId: string) => void
  /** Opens another chapter of this book in the editor, in place of this one. */
  onOpenChapter: (chapterId: string) => void
  registerBackHandler: (handler: (() => void) | null) => void
}): React.JSX.Element {
  const [book, setBook] = useState<BookDetail | null>(null)
  const [chapter, setChapter] = useState<Chapter | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [startingWords, setStartingWords] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'failed'>('saved')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<{ text: string; open?: string } | null>(null)
  const [forcedSelection, setForcedSelection] = useState<Selection | undefined>(undefined)
  const [history, setHistory] = useState(
    () => new EditHistory({ value: '', selection: { start: 0, end: 0 } })
  )
  const [findOpen, setFindOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const editVersionRef = useRef(0)
  const selectionRef = useRef<Selection>({ start: 0, end: 0 })
  const contentRef = useRef<TextInputInstance>(null)
  const rootRef = useRef<ViewInstance>(null)
  const { overlap, remeasure } = useKeyboardOverlap(rootRef)

  const loadChapter = useCallback((next: Chapter): void => {
    setChapter(next)
    setTitle(next.title)
    setContent(next.content)
    setDirty(false)
    setSaveState('saved')
    setHistory(new EditHistory({ value: next.content, selection: { start: 0, end: 0 } }))
    selectionRef.current = { start: 0, end: 0 }
  }, [])

  useEffect(() => {
    let active = true
    void Promise.all([repository.getChapter(chapterId), repository.getBook(bookId)])
      .then(([next, nextBook]) => {
        if (!active) return
        if (next.bookId !== bookId) throw new Error('That chapter does not belong to this book.')
        setBook(nextBook)
        setStartingWords(next.wordCount)
        loadChapter(next)
      })
      .catch((caught: unknown) => {
        if (active)
          setError(caught instanceof Error ? caught.message : 'The chapter could not be opened.')
      })
    return () => {
      active = false
    }
  }, [bookId, chapterId, loadChapter, repository])

  const save = useCallback(async (): Promise<Chapter | null> => {
    if (!chapter) return null
    const cleanTitle = title.trim()
    if (!cleanTitle) {
      setError('Every chapter needs a title before it can be saved.')
      setSaveState('failed')
      return null
    }
    const version = editVersionRef.current
    setSaveState('saving')
    setError('')
    try {
      const updated = await repository.updateChapter({ id: chapter.id, title: cleanTitle, content })
      setChapter(updated)
      if (editVersionRef.current === version) {
        setDirty(false)
        setSaveState('saved')
      }
      return updated
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The chapter could not be saved.')
      setSaveState('failed')
      return null
    }
  }, [chapter, content, repository, title])

  useEffect(() => {
    if (!dirty || !chapter) return
    const timer = setTimeout(() => void save(), AUTOSAVE_MS)
    return () => clearTimeout(timer)
  }, [chapter, content, dirty, save, title])

  // Switching apps (or the phone locking) saves straight away rather than after the pause.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && dirty) void save()
    })
    return () => subscription.remove()
  }, [dirty, save])

  const markDirty = (): void => {
    editVersionRef.current += 1
    setDirty(true)
    setSaveState('saved')
  }

  /** Saves pending typing first, for tools that work on the stored chapter. */
  const settled = async (): Promise<Chapter | null> => (dirty ? save() : chapter)

  const applyEdit = (next: TextEdit, kind: 'typing' | 'tool'): void => {
    setContent(next.value)
    setForcedSelection(next.selection)
    selectionRef.current = next.selection
    history.record(next, kind)
    markDirty()
  }

  const showHistoryStep = (step: TextEdit | null): void => {
    if (!step) return
    setContent(step.value)
    setForcedSelection(step.selection)
    selectionRef.current = step.selection
    markDirty()
  }

  const requestBack = useCallback((): void => {
    if (!dirty) {
      onBack()
      return
    }
    void save().then((saved) => {
      if (saved) {
        onBack()
        return
      }
      Alert.alert('This chapter did not save', 'Leave anyway and lose the latest changes?', [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Leave', style: 'destructive', onPress: onBack }
      ])
    })
  }, [dirty, onBack, save])

  useEffect(() => {
    registerBackHandler(requestBack)
    return () => registerBackHandler(null)
  }, [registerBackHandler, requestBack])

  if (error && !chapter) return <ErrorScreen message={error} onBack={onBack} />
  if (!chapter || !book) return <LoadingScreen label="Opening the editor…" />

  const chapterIndex = book.chapters.findIndex((item) => item.id === chapter.id)
  const previousChapter = chapterIndex > 0 ? book.chapters[chapterIndex - 1] : null
  const nextChapter = book.chapters[chapterIndex + 1] ?? null
  const wordCount = countWords(content)
  const sessionWords = wordCount - startingWords
  const current = (): TextEdit => ({ value: content, selection: selectionRef.current })

  const inner: RadialItem[] = [
    { key: 'undo', glyph: '↺', label: 'Undo', disabled: !history.canUndo, repeatable: true },
    { key: 'redo', glyph: '↻', label: 'Redo', disabled: !history.canRedo, repeatable: true },
    { key: 'italic', glyph: 'I', label: 'Italic', glyphStyle: 'italic' },
    { key: 'bold', glyph: 'B', label: 'Bold', glyphStyle: 'bold' }
  ]
  const outer: RadialItem[] = [
    { key: 'more', glyph: '⋯', label: 'More tools' },
    { key: 'scene', glyph: '✦', label: 'Scene break' },
    { key: 'dash', glyph: '—', label: 'Em dash' },
    { key: 'dialogue', glyph: '“”', label: 'Dialogue quotes' },
    { key: 'heading', glyph: 'H', label: 'Heading', glyphStyle: 'bold' }
  ]

  const runTool = (key: string): void => {
    switch (key) {
      case 'undo':
        showHistoryStep(history.undo())
        return
      case 'redo':
        showHistoryStep(history.redo())
        return
      case 'bold':
        applyEdit(toggleEmphasis(current(), '**'), 'tool')
        break
      case 'italic':
        applyEdit(toggleEmphasis(current(), '*'), 'tool')
        break
      case 'heading':
        applyEdit(toggleHeading(current()), 'tool')
        break
      case 'dialogue':
        applyEdit(wrapDialogue(current()), 'tool')
        break
      case 'dash':
        applyEdit(insertText(current(), '—'), 'tool')
        break
      case 'scene':
        applyEdit(insertSceneBreak(current()), 'tool')
        break
      case 'more':
        // The card needs the room; none of its tools type into the chapter.
        Keyboard.dismiss()
        setDrawerOpen(true)
        return
    }
    contentRef.current?.focus()
  }

  const drawerTools: DrawerTool[] = [
    {
      key: 'expression',
      glyph: '♪',
      label: 'Expression',
      detail: 'Notes for the voice that reads aloud'
    },
    { key: 'find', glyph: '⌕', label: 'Find & replace' },
    { key: 'split', glyph: '✂', label: 'Split chapter here', detail: 'At the cursor' },
    { key: 'versions', glyph: '⟲', label: 'Earlier versions' },
    {
      key: 'focus',
      glyph: '◎',
      label: 'Focus mode',
      detail: focusMode ? 'On' : 'Off',
      active: focusMode
    },
    {
      key: 'smart',
      glyph: '‘’',
      label: 'Smart punctuation',
      detail: preferences.smartPunctuation ? 'On' : 'Off',
      active: preferences.smartPunctuation
    },
    { key: 'preview', glyph: '▷', label: 'Read this chapter' },
    {
      key: 'previous',
      glyph: '‹',
      label: 'Previous chapter',
      detail: previousChapter?.title,
      disabled: !previousChapter
    },
    {
      key: 'next',
      glyph: '›',
      label: 'Next chapter',
      detail: nextChapter?.title,
      disabled: !nextChapter
    }
  ]

  const runDrawerTool = (key: string): void => {
    setDrawerOpen(false)
    switch (key) {
      case 'find':
        setFindOpen(true)
        return
      case 'focus':
        setFocusMode((value) => !value)
        return
      case 'smart':
        onChangePreferences({ smartPunctuation: !preferences.smartPunctuation })
        return
      case 'split': {
        const offset = selectionRef.current.start
        void settled().then((saved) => {
          if (!saved) return
          setSheet({
            kind: 'split',
            offset,
            suggestion: suggestSplitTitle(
              saved.content.slice(offset),
              `Chapter ${chapterIndex + 2}`
            )
          })
        })
        return
      }
      case 'expression':
        setSheet({ kind: 'expression' })
        return
      case 'versions':
        void settled().then((saved) => saved && setSheet({ kind: 'versions' }))
        return
      case 'preview':
        void settled().then((saved) => saved && onRead(saved.id))
        return
      case 'previous':
      case 'next': {
        const target = key === 'previous' ? previousChapter : nextChapter
        if (target) void settled().then((saved) => saved && onOpenChapter(target.id))
        return
      }
    }
  }

  const splitOffset = sheet?.kind === 'split' ? sheet.offset : 0
  const splitPreview = content.slice(splitOffset).trim().slice(0, 90)

  return (
    <View ref={rootRef} style={styles.screen} onLayout={remeasure}>
      <View style={[styles.column, { paddingBottom: overlap }]}>
        {focusMode ? null : (
          <AppHeader
            actionLabel={saveState === 'saving' ? 'Saving…' : dirty ? 'Save' : 'Saved'}
            subtitle={`Chapter ${chapterIndex + 1} of ${book.chapters.length}`}
            title={book.title}
            onAction={() => void save()}
            onBack={requestBack}
          />
        )}
        {findOpen ? (
          <FindBar
            content={content}
            onClose={() => setFindOpen(false)}
            onReplace={(match, replacement) =>
              applyEdit(insertText({ value: content, selection: match }, replacement), 'tool')
            }
            onReplaceAll={(query, replacement, matchCase) => {
              const result = replaceAllMatches(content, query, replacement, matchCase)
              applyEdit({ value: result.value, selection: { start: 0, end: 0 } }, 'tool')
              setNotice({
                text: `Replaced ${result.count} ${result.count === 1 ? 'match' : 'matches'}.`
              })
            }}
            onShowMatch={(match) => {
              contentRef.current?.focus()
              setForcedSelection(match)
              selectionRef.current = match
            }}
          />
        ) : null}
        <View style={styles.editor}>
          {focusMode ? null : (
            <>
              <TextInput
                accessibilityLabel="Chapter title"
                maxLength={240}
                placeholder="Chapter title"
                placeholderTextColor={storyboundColors.muted}
                style={styles.titleInput}
                value={title}
                onChangeText={(value) => {
                  setTitle(value)
                  markDirty()
                }}
              />
              <View style={styles.rule} />
            </>
          )}
          <TextInput
            ref={contentRef}
            accessibilityLabel="Chapter text"
            autoCapitalize="sentences"
            multiline
            placeholder="Begin your chapter…"
            placeholderTextColor={storyboundColors.muted}
            scrollEnabled
            selection={forcedSelection}
            style={[styles.contentInput, focusMode && styles.contentFocus]}
            textAlignVertical="top"
            value={content}
            onChangeText={(next) => {
              const smart = preferences.smartPunctuation ? smartenTyping(content, next) : null
              if (smart) {
                applyEdit(smart, 'typing')
                return
              }
              setContent(next)
              setForcedSelection(undefined)
              history.record({ value: next, selection: caretAfter(content, next) }, 'typing')
              markDirty()
            }}
            onSelectionChange={(event) => {
              const selection = event.nativeEvent.selection
              selectionRef.current = selection
              history.moveCursor(selection)
              if (
                forcedSelection &&
                forcedSelection.start === selection.start &&
                forcedSelection.end === selection.end
              ) {
                setForcedSelection(undefined)
              }
            }}
          />
        </View>
        {error ? (
          <Pressable accessibilityRole="button" onPress={() => setError('')}>
            <Text style={styles.error}>{error}</Text>
          </Pressable>
        ) : null}
        {notice ? (
          <Notice
            actionLabel={notice.open ? 'Open it' : undefined}
            text={notice.text}
            onAction={() => {
              const target = notice.open
              setNotice(null)
              if (target) onOpenChapter(target)
            }}
            onDismiss={() => setNotice(null)}
          />
        ) : null}
        {focusMode ? null : (
          <View style={styles.footer}>
            <Text accessibilityLiveRegion="polite" style={styles.wordCount}>
              {formatCompactNumber(wordCount)} {wordCount === 1 ? 'word' : 'words'}
              {sessionWords
                ? ` · ${sessionWords > 0 ? '+' : '−'}${formatCompactNumber(Math.abs(sessionWords))} this session`
                : ''}
            </Text>
          </View>
        )}
      </View>

      {focusMode ? (
        <Pressable
          accessibilityRole="button"
          style={styles.exitFocus}
          onPress={() => setFocusMode(false)}
        >
          <Text style={styles.exitFocusLabel}>Exit focus</Text>
        </Pressable>
      ) : null}

      {drawerOpen ? (
        <ToolDrawer
          bottomInset={overlap + (focusMode ? 0 : FOOTER_HEIGHT)}
          tools={drawerTools}
          onClose={() => setDrawerOpen(false)}
          onSelect={runDrawerTool}
        />
      ) : (
        <QuillWheel
          bottomInset={overlap + (focusMode ? 0 : FOOTER_HEIGHT)}
          dimmed={focusMode}
          inner={inner}
          outer={outer}
          onSelect={runTool}
        />
      )}

      {sheet?.kind === 'versions' ? (
        <VersionsSheet
          load={() => repository.listChapterRevisions(chapter.id)}
          onClose={() => setSheet(null)}
          onRestore={async (revision) => {
            const restored = await repository.restoreChapterRevision(revision.id)
            // Text brought back is not new writing, so the session count stays where it was.
            setStartingWords(restored.wordCount - sessionWords)
            loadChapter(restored)
            setNotice({ text: 'Version restored. The text it replaced is kept in versions.' })
          }}
        />
      ) : null}
      {sheet?.kind === 'expression' ? (
        <ExpressionSheet
          onClose={() => setSheet(null)}
          onDirection={(direction) => applyEdit(directParagraph(current(), direction), 'tool')}
          onSound={(note) => applyEdit(insertPerformanceNote(current(), note), 'tool')}
        />
      ) : null}
      {sheet?.kind === 'split' ? (
        <TextFieldSheet
          confirmLabel="Split here"
          initialValue={sheet.suggestion}
          label="New chapter title"
          message={
            splitPreview
              ? `The new chapter starts with “${splitPreview}${splitPreview.length >= 90 ? '…' : ''}”`
              : 'Put the cursor where the new chapter should start, then try again.'
          }
          title="Split chapter"
          onClose={() => setSheet(null)}
          onConfirm={async (newTitle) => {
            const created = await repository.splitChapter({
              id: chapter.id,
              offset: splitOffset,
              newTitle
            })
            const shortened = await repository.getChapter(chapter.id)
            // Text moved to the new chapter is not deleted writing.
            setStartingWords(shortened.wordCount - sessionWords)
            loadChapter(shortened)
            setBook(await repository.getBook(bookId))
            setNotice({ text: `“${created.title}” now follows this chapter.`, open: created.id })
          }}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: storyboundColors.paper
  },
  column: {
    flex: 1
  },
  editor: {
    flex: 1,
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    paddingHorizontal: 22,
    paddingTop: 18
  },
  titleInput: {
    minHeight: 62,
    padding: 0,
    color: storyboundColors.text,
    fontFamily: 'serif',
    fontSize: 27,
    fontWeight: '700'
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    marginBottom: 14,
    backgroundColor: storyboundColors.line
  },
  contentInput: {
    flex: 1,
    padding: 0,
    // Room to scroll the last lines clear of the writing-tools button.
    paddingBottom: 96,
    color: storyboundColors.text,
    fontFamily: 'serif',
    fontSize: 18,
    lineHeight: 30
  },
  contentFocus: {
    paddingTop: 36,
    fontSize: 19,
    lineHeight: 32
  },
  error: {
    marginHorizontal: 18,
    marginBottom: 8,
    padding: 11,
    overflow: 'hidden',
    borderRadius: storyboundRadii.small,
    color: storyboundColors.danger,
    backgroundColor: '#f0d7d1',
    fontSize: 12,
    textAlign: 'center'
  },
  footer: {
    height: FOOTER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    borderTopColor: storyboundColors.line,
    borderTopWidth: StyleSheet.hairlineWidth,
    backgroundColor: storyboundColors.paperRaised
  },
  wordCount: {
    color: storyboundColors.muted,
    fontSize: 12,
    fontVariant: ['tabular-nums']
  },
  exitFocus: {
    position: 'absolute',
    top: 10,
    right: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: 'rgba(23, 19, 15, 0.08)'
  },
  exitFocusLabel: {
    color: storyboundColors.muted,
    fontSize: 12,
    fontWeight: '700'
  }
})
