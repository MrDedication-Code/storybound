import {
  ArrowLeft,
  Bookmark,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  List,
  Highlighter,
  Minus,
  Pause,
  Play,
  Plus,
  Settings2,
  Square,
  StickyNote,
  Trash2,
  Volume2,
  X
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import type {
  ApplicationSettings,
  Annotation,
  Bookmark as BookmarkType,
  BookDetail,
  Chapter,
  ReaderFont,
  ReaderTheme,
  TextAlignment
} from '@shared/types'
import { calculateReadingProgress } from '@shared/text'
import { readableError, storyboundApi, unwrap } from '../lib/api'
import type { PrepareCloseDetail } from '../lib/events'
import { navigate, routes } from '../lib/routing'
import { Button, ErrorState, IconButton, InlineNotice, LoadingState, Modal } from '../components/ui'
import { StoryMarkdown } from '../components/StoryMarkdown'

interface ReaderPageProps {
  bookId: string
  chapterId?: string
  initialLocation?: number
  searchTerm?: string
  settings: ApplicationSettings
  updateSettings: (changes: Partial<ApplicationSettings>) => Promise<void>
  notify: (message: string) => void
}

type ReaderPanel = 'contents' | 'bookmarks' | 'annotations' | 'settings'

interface AnnotationDraft {
  kind: Annotation['kind']
  body: string
  color: string
  quote: string
  startOffset: number | null
  endOffset: number | null
  fallbackLocation: number
}

const READER_PANEL_ID = 'reader-panel'
const READER_PANEL_TITLE_ID = 'reader-panel-title'
const READER_PANEL_TABS = [
  {
    label: 'Contents',
    panel: 'contents',
    panelId: 'reader-panel-contents',
    tabId: 'reader-tab-contents'
  },
  {
    label: 'Bookmarks',
    panel: 'bookmarks',
    panelId: 'reader-panel-bookmarks',
    tabId: 'reader-tab-bookmarks'
  },
  {
    label: 'Notes',
    panel: 'annotations',
    panelId: 'reader-panel-annotations',
    tabId: 'reader-tab-annotations'
  },
  {
    label: 'Appearance',
    panel: 'settings',
    panelId: 'reader-panel-settings',
    tabId: 'reader-tab-settings'
  }
] as const satisfies ReadonlyArray<{
  label: string
  panel: ReaderPanel
  panelId: string
  tabId: string
}>

export function ReaderPage({
  bookId,
  chapterId,
  initialLocation,
  searchTerm,
  settings,
  updateSettings,
  notify
}: ReaderPageProps): React.JSX.Element {
  const [book, setBook] = useState<BookDetail | null>(null)
  const [chapter, setChapter] = useState<Chapter | null>(null)
  const [bookmarks, setBookmarks] = useState<BookmarkType[]>([])
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [panel, setPanel] = useState<ReaderPanel | null>(null)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [progress, setProgress] = useState(0)
  const [bookmarkOpen, setBookmarkOpen] = useState(false)
  const [bookmarkNote, setBookmarkNote] = useState('')
  const [bookmarkLabel, setBookmarkLabel] = useState('')
  const [bookmarkColor, setBookmarkColor] = useState('gold')
  const [editingBookmark, setEditingBookmark] = useState<BookmarkType | null>(null)
  const [annotationDraft, setAnnotationDraft] = useState<AnnotationDraft | null>(null)
  const [selectionDraft, setSelectionDraft] = useState<AnnotationDraft | null>(null)
  const [speechState, setSpeechState] = useState<'idle' | 'playing' | 'paused'>('idle')
  const [speechRate, setSpeechRate] = useState(1)
  const [speechOpen, setSpeechOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const panelTriggerRef = useRef<HTMLButtonElement | null>(null)
  const previousPanelRef = useRef<ReaderPanel | null>(null)
  const positionRef = useRef(0)
  const saveTimerRef = useRef<number | null>(null)

  useEffect(() => {
    const previousPanel = previousPanelRef.current
    if (panel && !previousPanel) {
      panelRef.current?.focus()
    } else if (!panel && previousPanel) {
      const trigger = panelTriggerRef.current
      if (trigger?.isConnected) trigger.focus()
      panelTriggerRef.current = null
    }
    previousPanelRef.current = panel
  }, [panel])

  const togglePanel = (nextPanel: ReaderPanel, trigger: HTMLButtonElement): void => {
    panelTriggerRef.current = trigger
    setPanel((currentPanel) => (currentPanel === nextPanel ? null : nextPanel))
  }

  const handlePanelTabKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    currentPanel: ReaderPanel
  ): void => {
    const currentIndex = READER_PANEL_TABS.findIndex((item) => item.panel === currentPanel)
    let nextIndex: number | null = null

    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % READER_PANEL_TABS.length
    else if (event.key === 'ArrowLeft')
      nextIndex = (currentIndex - 1 + READER_PANEL_TABS.length) % READER_PANEL_TABS.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = READER_PANEL_TABS.length - 1

    if (nextIndex === null) return
    event.preventDefault()
    const nextTab = READER_PANEL_TABS[nextIndex]
    setPanel(nextTab.panel)
    document.getElementById(nextTab.tabId)?.focus()
  }

  const load = useCallback(async (): Promise<void> => {
    setError('')
    try {
      const [bookResult, readingResult, bookmarksResult, annotationsResult] = await Promise.all([
        storyboundApi().books.get(bookId),
        storyboundApi().reading.get(bookId),
        storyboundApi().bookmarks.list(bookId),
        storyboundApi().annotations.list(bookId)
      ])
      const nextBook = unwrap(bookResult)
      const reading = unwrap(readingResult)
      const nextChapterId = chapterId ?? reading.chapterId ?? nextBook.chapters[0]?.id
      if (!nextChapterId) {
        setBook(nextBook)
        setBookmarks(unwrap(bookmarksResult))
        setAnnotations(unwrap(annotationsResult))
        return
      }
      const nextChapter = unwrap(await storyboundApi().chapters.get(nextChapterId))
      setBook(nextBook)
      setChapter(nextChapter)
      setBookmarks(unwrap(bookmarksResult))
      setAnnotations(unwrap(annotationsResult))
      if (!chapterId) navigate(routes.reader(bookId, nextChapterId))
      const restorePosition =
        initialLocation ?? (reading.chapterId === nextChapterId ? reading.scrollPosition : 0)
      positionRef.current = restorePosition
      const nextIndex = nextBook.chapters.findIndex((item) => item.id === nextChapterId)
      setProgress(
        initialLocation === undefined || nextIndex < 0
          ? reading.progressPercentage
          : calculateReadingProgress(nextIndex, nextBook.chapters.length, restorePosition)
      )
    } catch (caught) {
      setError(readableError(caught))
    }
  }, [bookId, chapterId, initialLocation])

  useEffect(() => {
    void Promise.resolve().then(load)
  }, [load, reload])

  const savePosition = useCallback(async (): Promise<boolean> => {
    if (!book || !chapter) return true
    const index = book.chapters.findIndex((item) => item.id === chapter.id)
    if (index < 0) return true
    const container = scrollRef.current
    const maximum = container ? container.scrollHeight - container.clientHeight : 1
    const positionWithinChapter = maximum <= 1 ? 1 : positionRef.current
    positionRef.current = positionWithinChapter
    const overall = calculateReadingProgress(index, book.chapters.length, positionWithinChapter)
    setProgress(overall)
    try {
      unwrap(
        await storyboundApi().reading.save({
          bookId,
          chapterId: chapter.id,
          scrollPosition: positionWithinChapter,
          progressPercentage: overall,
          hasFinishedCurrentContent: overall >= 99.5
        })
      )
      return true
    } catch (caught) {
      setError(`Reading position could not be saved: ${readableError(caught)}`)
      return false
    }
  }, [book, bookId, chapter])
  const prepareClose = useEffectEvent(async (): Promise<boolean> => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    return savePosition()
  })

  useEffect(() => {
    const container = scrollRef.current
    if (!container || !chapter) return
    const frame = window.requestAnimationFrame(() => {
      const maximum = Math.max(0, container.scrollHeight - container.clientHeight)
      if (maximum <= 1) {
        positionRef.current = 1
        void savePosition()
      } else {
        container.scrollTop = maximum * positionRef.current
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [chapter, savePosition])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
      void savePosition()
    }
  }, [savePosition])

  const handleScroll = (): void => {
    const container = scrollRef.current
    if (!container) return
    const maximum = container.scrollHeight - container.clientHeight
    positionRef.current = maximum <= 1 ? 1 : Math.min(1, Math.max(0, container.scrollTop / maximum))
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => void savePosition(), 500)
  }

  const goToChapter = async (nextId: string, location = 0): Promise<void> => {
    await savePosition()
    positionRef.current = location
    if (nextId === chapter?.id) {
      const container = scrollRef.current
      if (container) {
        const maximum = Math.max(0, container.scrollHeight - container.clientHeight)
        container.scrollTop = maximum * location
      }
      setPanel(null)
      return
    }
    navigate(routes.reader(bookId, nextId, location || undefined))
    setPanel(null)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      )
        return
      if (event.key === 'Escape') setPanel(null)
      if (!book || !chapter) return
      const index = book.chapters.findIndex((item) => item.id === chapter.id)
      if (
        (event.key === 'ArrowLeft' || event.key === 'PageUp') &&
        index > 0 &&
        scrollRef.current?.scrollTop === 0
      ) {
        event.preventDefault()
        void goToChapter(book.chapters[index - 1].id)
      } else if (
        (event.key === 'ArrowRight' || event.key === 'PageDown') &&
        index < book.chapters.length - 1
      ) {
        const container = scrollRef.current
        if (
          event.key === 'ArrowRight' ||
          (container && container.scrollTop + container.clientHeight >= container.scrollHeight - 4)
        ) {
          event.preventDefault()
          void goToChapter(book.chapters[index + 1].id)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  useEffect(() => {
    const closePanels = (): void => {
      setPanel(null)
      setBookmarkOpen(false)
    }
    window.addEventListener('storybound:escape', closePanels)
    return () => window.removeEventListener('storybound:escape', closePanels)
  }, [])

  useEffect(() => {
    const handlePrepareClose = (event: Event): void => {
      const closeEvent = event as CustomEvent<PrepareCloseDetail>
      closeEvent.detail.tasks.push(prepareClose())
    }
    window.addEventListener('storybound:prepare-close', handlePrepareClose)
    return () => window.removeEventListener('storybound:prepare-close', handlePrepareClose)
  }, [])

  const addBookmark = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!chapter) return
    setBusy(true)
    try {
      if (editingBookmark) {
        const updated = unwrap(
          await storyboundApi().bookmarks.update({
            id: editingBookmark.id,
            expectedRowVersion: editingBookmark.rowVersion,
            note: bookmarkNote.trim(),
            label: bookmarkLabel.trim(),
            color: bookmarkColor
          })
        )
        setBookmarks((current) =>
          current.map((bookmark) => (bookmark.id === updated.id ? updated : bookmark))
        )
        notify('Bookmark updated.')
      } else {
        const created = unwrap(
          await storyboundApi().bookmarks.create({
            bookId,
            chapterId: chapter.id,
            location: positionRef.current,
            note: bookmarkNote.trim(),
            label: bookmarkLabel.trim(),
            color: bookmarkColor
          })
        )
        setBookmarks((current) => [...current, created])
        notify('Bookmark added.')
      }
      setBookmarkOpen(false)
      setEditingBookmark(null)
      setBookmarkNote('')
      setBookmarkLabel('')
      setBookmarkColor('gold')
    } catch (caught) {
      setError(readableError(caught))
    } finally {
      setBusy(false)
    }
  }

  const removeBookmark = async (bookmark: BookmarkType): Promise<void> => {
    try {
      unwrap(await storyboundApi().bookmarks.remove(bookmark.id))
      setBookmarks((current) => current.filter((item) => item.id !== bookmark.id))
      notify('Bookmark removed.')
    } catch (caught) {
      setError(readableError(caught))
    }
  }

  const openBookmarkEditor = (bookmark?: BookmarkType): void => {
    setEditingBookmark(bookmark ?? null)
    setBookmarkNote(bookmark?.note ?? '')
    setBookmarkLabel(bookmark?.label ?? '')
    setBookmarkColor(bookmark?.color ?? 'gold')
    setBookmarkOpen(true)
  }

  const handleStorySelection = (container: HTMLElement): void => {
    if (!chapter) return
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      setSelectionDraft(null)
      return
    }
    const range = selection.getRangeAt(0)
    if (!container.contains(range.commonAncestorContainer)) return
    const quote = selection.toString().trim()
    if (!quote) return
    const source = chapter.content
    const expected = Math.round(positionRef.current * source.length)
    const candidates: number[] = []
    let offset = source.indexOf(quote)
    while (offset >= 0) {
      candidates.push(offset)
      offset = source.indexOf(quote, offset + Math.max(1, quote.length))
    }
    const startOffset =
      candidates.length > 0
        ? candidates.reduce((nearest, candidate) =>
            Math.abs(candidate - expected) < Math.abs(nearest - expected) ? candidate : nearest
          )
        : null
    setSelectionDraft({
      kind: 'highlight',
      body: '',
      color: 'gold',
      quote,
      startOffset,
      endOffset: startOffset === null ? null : startOffset + quote.length,
      fallbackLocation: positionRef.current
    })
  }

  const openAnnotation = (kind: Annotation['kind'], fromSelection = false): void => {
    const selected = fromSelection ? selectionDraft : null
    setAnnotationDraft(
      selected
        ? { ...selected, kind }
        : {
            kind,
            body: '',
            color: 'gold',
            quote: '',
            startOffset: null,
            endOffset: null,
            fallbackLocation: positionRef.current
          }
    )
    setSelectionDraft(null)
    window.getSelection()?.removeAllRanges()
  }

  const saveAnnotation = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!chapter || !annotationDraft) return
    setBusy(true)
    try {
      const created = unwrap(
        await storyboundApi().annotations.create({
          bookId,
          chapterId: chapter.id,
          kind: annotationDraft.kind,
          body: annotationDraft.body.trim(),
          color: annotationDraft.color,
          anchor: {
            startOffset: annotationDraft.startOffset,
            endOffset: annotationDraft.endOffset,
            fallbackLocation: annotationDraft.fallbackLocation,
            quote: annotationDraft.quote
          }
        })
      )
      setAnnotations((current) => [...current, created])
      setAnnotationDraft(null)
      notify(created.kind === 'highlight' ? 'Highlight saved.' : 'Note saved.')
    } catch (caught) {
      setError(readableError(caught))
    } finally {
      setBusy(false)
    }
  }

  const removeAnnotation = async (annotation: Annotation): Promise<void> => {
    try {
      unwrap(
        await storyboundApi().annotations.remove({
          id: annotation.id,
          expectedRowVersion: annotation.rowVersion
        })
      )
      setAnnotations((current) => current.filter((item) => item.id !== annotation.id))
      notify('Annotation removed.')
    } catch (caught) {
      setError(readableError(caught))
    }
  }

  const toggleSpeech = (): void => {
    if (!chapter) return
    const synthesis = window.speechSynthesis
    if (!synthesis || typeof SpeechSynthesisUtterance === 'undefined') {
      setError('Text-to-speech is not available on this computer.')
      return
    }
    if (speechState === 'playing') {
      synthesis.pause()
      setSpeechState('paused')
      return
    }
    if (speechState === 'paused') {
      synthesis.resume()
      setSpeechState('playing')
      return
    }
    const utterance = new SpeechSynthesisUtterance(`${chapter.title}. ${chapter.content}`)
    utterance.rate = speechRate
    utterance.onend = () => setSpeechState('idle')
    utterance.onerror = () => setSpeechState('idle')
    synthesis.cancel()
    synthesis.speak(utterance)
    setSpeechState('playing')
  }

  const stopSpeech = (): void => {
    window.speechSynthesis?.cancel()
    setSpeechState('idle')
  }

  useEffect(() => {
    return () => window.speechSynthesis?.cancel()
  }, [chapter?.id])

  const chapterHighlights = useMemo(
    () =>
      annotations
        .filter((annotation) => annotation.chapterId === chapter?.id && annotation.anchor.quote)
        .map((annotation) => ({
          id: annotation.id,
          quote: annotation.anchor.quote,
          color: annotation.color
        })),
    [annotations, chapter?.id]
  )

  if (error && !book)
    return (
      <main className="reader-state">
        <ErrorState message={error} onRetry={() => setReload((value) => value + 1)} />
      </main>
    )
  if (!book)
    return (
      <main className="reader-state">
        <LoadingState label="Opening the reader…" />
      </main>
    )
  if (!chapter)
    return (
      <main className="reader-state">
        <BookOpen size={34} />
        <h1>{book.title}</h1>
        <p>This book does not have a chapter to read yet.</p>
        <Button variant="primary" onClick={() => navigate(routes.editor(book.id))}>
          Add first chapter
        </Button>
      </main>
    )

  const index = book.chapters.findIndex((item) => item.id === chapter.id)
  const previous = index > 0 ? book.chapters[index - 1] : null
  const next = index < book.chapters.length - 1 ? book.chapters[index + 1] : null
  const chapterBookmarks = bookmarks.filter((item) => item.chapterId === chapter.id)
  const activePanel = panel ? READER_PANEL_TABS.find((item) => item.panel === panel)! : null

  return (
    <main
      className={`reader reader--${settings.readerTheme} reader--font-${settings.readerFont}`}
      data-route-main
      tabIndex={-1}
      style={
        {
          '--reader-size': `${settings.readerFontSize}px`,
          '--reader-leading': settings.lineHeight,
          '--reader-width': `${settings.columnWidth}px`,
          '--reader-paragraph-space': `${settings.paragraphSpacing}em`
        } as React.CSSProperties
      }
    >
      <header className="reader-header">
        <button
          className="reader-back"
          onClick={() => {
            void savePosition().then(() => navigate(routes.library()))
          }}
        >
          <ArrowLeft size={18} />
          <span>Library</span>
        </button>
        <div className="reader-title">
          <strong>{book.title}</strong>
          <span>{chapter.title}</span>
        </div>
        <div className="reader-tools">
          <IconButton
            aria-controls={READER_PANEL_ID}
            aria-expanded={panel === 'bookmarks'}
            className={panel === 'bookmarks' || chapterBookmarks.length ? 'is-active' : ''}
            icon={Bookmark}
            label="Bookmarks"
            onClick={(event) => togglePanel('bookmarks', event.currentTarget)}
          />
          <IconButton
            aria-controls={READER_PANEL_ID}
            aria-expanded={panel === 'annotations'}
            className={panel === 'annotations' || annotations.length ? 'is-active' : ''}
            icon={Highlighter}
            label="Highlights and notes"
            onClick={(event) => togglePanel('annotations', event.currentTarget)}
          />
          <IconButton
            aria-controls={READER_PANEL_ID}
            aria-expanded={panel === 'contents'}
            className={panel === 'contents' ? 'is-active' : ''}
            icon={List}
            label="Table of contents"
            onClick={(event) => togglePanel('contents', event.currentTarget)}
          />
          <IconButton
            aria-controls={READER_PANEL_ID}
            aria-expanded={panel === 'settings'}
            className={panel === 'settings' ? 'is-active' : ''}
            icon={Settings2}
            label="Reading settings"
            onClick={(event) => togglePanel('settings', event.currentTarget)}
          />
          <IconButton
            aria-expanded={speechOpen}
            className={speechState !== 'idle' ? 'is-active' : ''}
            icon={Volume2}
            label="Read aloud"
            onClick={() => setSpeechOpen((value) => !value)}
          />
        </div>
      </header>

      {speechOpen ? (
        <div className="reader-speech" role="region" aria-label="Read aloud controls">
          <Button icon={speechState === 'playing' ? Pause : Play} onClick={toggleSpeech}>
            {speechState === 'playing'
              ? 'Pause'
              : speechState === 'paused'
                ? 'Resume'
                : 'Read chapter'}
          </Button>
          <IconButton
            disabled={speechState === 'idle'}
            icon={Square}
            label="Stop reading aloud"
            onClick={stopSpeech}
          />
          <label>
            <span>Speed</span>
            <select
              value={speechRate}
              onChange={(event) => setSpeechRate(Number(event.target.value))}
            >
              <option value="0.75">0.75×</option>
              <option value="1">1×</option>
              <option value="1.25">1.25×</option>
              <option value="1.5">1.5×</option>
              <option value="2">2×</option>
            </select>
          </label>
          <span aria-live="polite">{speechState === 'idle' ? 'Ready' : speechState}</span>
        </div>
      ) : null}

      {error ? (
        <div className="reader-notice">
          <InlineNotice tone="error">{error}</InlineNotice>
          <IconButton icon={X} label="Dismiss error" onClick={() => setError('')} />
        </div>
      ) : null}

      {selectionDraft ? (
        <div className="reader-selection-tools" role="toolbar" aria-label="Selected text actions">
          <span>
            “{selectionDraft.quote.slice(0, 70)}
            {selectionDraft.quote.length > 70 ? '…' : ''}”
          </span>
          <Button icon={Highlighter} onClick={() => openAnnotation('highlight', true)}>
            Highlight
          </Button>
          <Button icon={StickyNote} onClick={() => openAnnotation('note', true)}>
            Add note
          </Button>
          <IconButton
            icon={X}
            label="Dismiss selected text actions"
            onClick={() => setSelectionDraft(null)}
          />
        </div>
      ) : null}

      <div
        ref={scrollRef}
        className="reader-scroll"
        data-testid="reader-scroll"
        onScroll={handleScroll}
      >
        <article
          className={`reader-page reader-prose ${settings.paragraphIndentation ? 'reader-prose--indented' : ''} ${settings.textAlignment === 'justify' ? 'reader-prose--justified' : ''}`}
          onMouseUp={(event) => handleStorySelection(event.currentTarget)}
        >
          <header className="reader-chapter-heading">
            <p>{book.title}</p>
            <h1>{chapter.title}</h1>
            <span aria-hidden="true">✦</span>
          </header>
          <StoryMarkdown highlight={searchTerm} highlights={chapterHighlights}>
            {chapter.content}
          </StoryMarkdown>
          <footer className="reader-end">
            <span aria-hidden="true">◆</span>
            <p>End of {chapter.title}</p>
          </footer>
          <nav className="reader-chapter-nav" aria-label="Chapter navigation">
            <Button
              disabled={!previous}
              icon={ChevronLeft}
              onClick={() => previous && void goToChapter(previous.id)}
            >
              {previous ? previous.title : 'Beginning'}
            </Button>
            <Button disabled={!next} onClick={() => next && void goToChapter(next.id)}>
              {next ? next.title : 'End of book'}
              <ChevronRight size={17} />
            </Button>
          </nav>
        </article>
      </div>

      <footer
        aria-label="Book reading progress"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={Math.round(progress)}
        className="reader-progress"
        role="progressbar"
      >
        <span>{Math.round(progress)}%</span>
        <span className="progress-track">
          <span style={{ width: `${progress}%` }} />
        </span>
        <span>
          {index + 1} of {book.chapters.length}
        </span>
      </footer>

      {panel && activePanel ? (
        <aside
          ref={panelRef}
          aria-labelledby={READER_PANEL_TITLE_ID}
          className="reader-panel"
          id={READER_PANEL_ID}
          tabIndex={-1}
        >
          <header>
            <div>
              <p className="eyebrow">{book.title}</p>
              <h2 id={READER_PANEL_TITLE_ID}>
                {panel === 'contents'
                  ? 'Contents'
                  : panel === 'bookmarks'
                    ? 'Bookmarks'
                    : panel === 'annotations'
                      ? 'Highlights & notes'
                      : 'Reading settings'}
              </h2>
            </div>
            <IconButton icon={X} label="Close reader panel" onClick={() => setPanel(null)} />
          </header>
          <div
            aria-label="Reader panels"
            aria-orientation="horizontal"
            className="reader-panel-tabs"
            role="tablist"
          >
            {READER_PANEL_TABS.map((item) => (
              <button
                aria-controls={item.panelId}
                aria-selected={panel === item.panel}
                id={item.tabId}
                key={item.panel}
                role="tab"
                tabIndex={panel === item.panel ? 0 : -1}
                onClick={() => setPanel(item.panel)}
                onKeyDown={(event) => handlePanelTabKeyDown(event, item.panel)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div
            aria-labelledby={activePanel.tabId}
            className="reader-panel-tabpanel"
            id={activePanel.panelId}
            role="tabpanel"
            tabIndex={0}
          >
            {panel === 'contents' ? (
              <ol className="reader-toc">
                {book.chapters.map((item, itemIndex) => (
                  <li className={item.id === chapter.id ? 'is-active' : ''} key={item.id}>
                    <button onClick={() => void goToChapter(item.id)}>
                      <span>{String(itemIndex + 1).padStart(2, '0')}</span>
                      <strong>{item.title}</strong>
                      {item.isRead ? <Check aria-label="Read" size={15} /> : null}
                    </button>
                  </li>
                ))}
              </ol>
            ) : panel === 'bookmarks' ? (
              <>
                <div className="reader-bookmark-actions">
                  <Button icon={Bookmark} variant="primary" onClick={() => openBookmarkEditor()}>
                    Add bookmark here
                  </Button>
                </div>
                {bookmarks.length ? (
                  <ul className="reader-bookmarks">
                    {bookmarks.map((item) => (
                      <li key={item.id}>
                        <button onClick={() => void goToChapter(item.chapterId, item.location)}>
                          <strong>{item.label || item.chapterTitle}</strong>
                          <span>
                            {item.label ? `${item.chapterTitle} · ` : ''}
                            {item.note || `${Math.round(item.location * 100)}% through the chapter`}
                          </span>
                        </button>
                        <Button variant="quiet" onClick={() => openBookmarkEditor(item)}>
                          Edit
                        </Button>
                        <IconButton
                          icon={Trash2}
                          label={`Remove bookmark in ${item.chapterTitle}`}
                          onClick={() => void removeBookmark(item)}
                        />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="reader-panel-empty">
                    <Bookmark size={28} />
                    <h3>No bookmarks yet</h3>
                    <p>Save a place or a short note while you read.</p>
                  </div>
                )}
              </>
            ) : panel === 'annotations' ? (
              <>
                <div className="reader-bookmark-actions">
                  <Button
                    icon={StickyNote}
                    variant="primary"
                    onClick={() => openAnnotation('note')}
                  >
                    Add note here
                  </Button>
                  <span>Select text on the page to highlight a passage.</span>
                </div>
                {annotations.length ? (
                  <ul className="reader-bookmarks reader-annotations">
                    {annotations.map((item) => (
                      <li data-color={item.color} key={item.id}>
                        <button
                          onClick={() =>
                            void goToChapter(item.chapterId, item.anchor.fallbackLocation)
                          }
                        >
                          <strong>
                            {item.kind === 'highlight'
                              ? item.anchor.quote || 'Highlight'
                              : item.body || 'Note'}
                          </strong>
                          <span>
                            {item.chapterTitle}
                            {item.body && item.kind === 'highlight' ? ` · ${item.body}` : ''}
                          </span>
                        </button>
                        <IconButton
                          icon={Trash2}
                          label={`Remove ${item.kind} in ${item.chapterTitle}`}
                          onClick={() => void removeAnnotation(item)}
                        />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="reader-panel-empty">
                    <Highlighter size={28} />
                    <h3>No highlights or notes yet</h3>
                    <p>Select a passage, or save a note at your current place.</p>
                  </div>
                )}
              </>
            ) : (
              <div className="reader-settings">
                <fieldset>
                  <legend>Page tone</legend>
                  <div className="segmented-control">
                    {(['light', 'sepia', 'dark'] as ReaderTheme[]).map((theme) => (
                      <button
                        aria-pressed={settings.readerTheme === theme}
                        className={`tone-swatch tone-swatch--${theme}`}
                        key={theme}
                        onClick={() => void updateSettings({ readerTheme: theme })}
                      >
                        {theme}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend>Typeface</legend>
                  <div className="segmented-control">
                    {(['literary', 'classic', 'modern'] as ReaderFont[]).map((font) => (
                      <button
                        aria-pressed={settings.readerFont === font}
                        className={`font-choice font-choice--${font}`}
                        key={font}
                        onClick={() => void updateSettings({ readerFont: font })}
                      >
                        {font}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend>Text size</legend>
                  <div className="stepper">
                    <IconButton
                      disabled={settings.readerFontSize <= 14}
                      icon={Minus}
                      label="Decrease reader font size"
                      onClick={() =>
                        void updateSettings({ readerFontSize: settings.readerFontSize - 1 })
                      }
                    />
                    <output>{settings.readerFontSize}px</output>
                    <IconButton
                      disabled={settings.readerFontSize >= 34}
                      icon={Plus}
                      label="Increase reader font size"
                      onClick={() =>
                        void updateSettings({ readerFontSize: settings.readerFontSize + 1 })
                      }
                    />
                  </div>
                </fieldset>
                <label className="range-field">
                  <span>
                    Line height <output>{settings.lineHeight.toFixed(1)}</output>
                  </span>
                  <input
                    max="2.2"
                    min="1.3"
                    step="0.1"
                    type="range"
                    value={settings.lineHeight}
                    onChange={(event) =>
                      void updateSettings({ lineHeight: Number(event.target.value) })
                    }
                  />
                </label>
                <label className="range-field">
                  <span>
                    Column width <output>{settings.columnWidth}px</output>
                  </span>
                  <input
                    max="1000"
                    min="480"
                    step="20"
                    type="range"
                    value={settings.columnWidth}
                    onChange={(event) =>
                      void updateSettings({ columnWidth: Number(event.target.value) })
                    }
                  />
                </label>
                <label className="range-field">
                  <span>
                    Paragraph spacing <output>{settings.paragraphSpacing.toFixed(1)}em</output>
                  </span>
                  <input
                    max="2"
                    min="0"
                    step="0.1"
                    type="range"
                    value={settings.paragraphSpacing}
                    onChange={(event) =>
                      void updateSettings({ paragraphSpacing: Number(event.target.value) })
                    }
                  />
                </label>
                <fieldset>
                  <legend>Alignment</legend>
                  <div className="segmented-control">
                    {(['left', 'justify'] as TextAlignment[]).map((alignment) => (
                      <button
                        aria-pressed={settings.textAlignment === alignment}
                        key={alignment}
                        onClick={() => void updateSettings({ textAlignment: alignment })}
                      >
                        {alignment}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <label className="switch-row">
                  <span>
                    <strong>First-line indent</strong>
                    <small>Indent new paragraphs</small>
                  </span>
                  <input
                    checked={settings.paragraphIndentation}
                    type="checkbox"
                    onChange={(event) =>
                      void updateSettings({ paragraphIndentation: event.target.checked })
                    }
                  />
                </label>
              </div>
            )}
          </div>
        </aside>
      ) : null}

      {bookmarkOpen ? (
        <Modal
          description={`Save your place in ${chapter.title}. A note is optional.`}
          onClose={() => {
            setBookmarkOpen(false)
            setEditingBookmark(null)
          }}
          size="small"
          title={editingBookmark ? 'Edit bookmark' : 'Add bookmark'}
        >
          <form className="form-stack" onSubmit={(event) => void addBookmark(event)}>
            <label className="field">
              <span>
                Label <small>Optional</small>
              </span>
              <input
                maxLength={240}
                placeholder="A memorable place"
                value={bookmarkLabel}
                onChange={(event) => setBookmarkLabel(event.target.value)}
              />
            </label>
            <label className="field">
              <span>
                Note <small>Optional</small>
              </span>
              <textarea
                autoFocus
                maxLength={500}
                placeholder="Why did you save this place?"
                rows={3}
                value={bookmarkNote}
                onChange={(event) => setBookmarkNote(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Colour</span>
              <select
                value={bookmarkColor}
                onChange={(event) => setBookmarkColor(event.target.value)}
              >
                <option value="gold">Gold</option>
                <option value="blue">Blue</option>
                <option value="green">Green</option>
                <option value="rose">Rose</option>
                <option value="purple">Purple</option>
              </select>
            </label>
            <div className="modal__actions">
              <Button
                onClick={() => {
                  setBookmarkOpen(false)
                  setEditingBookmark(null)
                }}
              >
                Cancel
              </Button>
              <Button disabled={busy} icon={Bookmark} type="submit" variant="primary">
                {editingBookmark ? 'Save bookmark' : 'Add bookmark'}
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}

      {annotationDraft ? (
        <Modal
          description={
            annotationDraft.quote
              ? `Save “${annotationDraft.quote.slice(0, 120)}${annotationDraft.quote.length > 120 ? '…' : ''}”`
              : `Save a note at your current place in ${chapter.title}.`
          }
          onClose={() => setAnnotationDraft(null)}
          size="small"
          title={annotationDraft.kind === 'highlight' ? 'Highlight passage' : 'Add reading note'}
        >
          <form className="form-stack" onSubmit={(event) => void saveAnnotation(event)}>
            <label className="field">
              <span>Type</span>
              <select
                value={annotationDraft.kind}
                onChange={(event) =>
                  setAnnotationDraft({
                    ...annotationDraft,
                    kind: event.target.value as Annotation['kind']
                  })
                }
              >
                <option value="highlight">Highlight</option>
                <option value="note">Note</option>
              </select>
            </label>
            <label className="field">
              <span>Colour</span>
              <select
                value={annotationDraft.color}
                onChange={(event) =>
                  setAnnotationDraft({ ...annotationDraft, color: event.target.value })
                }
              >
                <option value="gold">Gold</option>
                <option value="blue">Blue</option>
                <option value="green">Green</option>
                <option value="rose">Rose</option>
                <option value="purple">Purple</option>
              </select>
            </label>
            <label className="field">
              <span>
                Note <small>Optional for highlights</small>
              </span>
              <textarea
                autoFocus
                maxLength={100000}
                rows={4}
                value={annotationDraft.body}
                onChange={(event) =>
                  setAnnotationDraft({ ...annotationDraft, body: event.target.value })
                }
              />
            </label>
            <div className="modal__actions">
              <Button onClick={() => setAnnotationDraft(null)}>Cancel</Button>
              <Button
                disabled={busy || (annotationDraft.kind === 'note' && !annotationDraft.body.trim())}
                icon={annotationDraft.kind === 'highlight' ? Highlighter : StickyNote}
                type="submit"
                variant="primary"
              >
                Save {annotationDraft.kind}
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}
    </main>
  )
}
