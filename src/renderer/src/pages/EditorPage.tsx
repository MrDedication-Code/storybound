import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bold,
  Check,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Copy,
  Eye,
  FilePlus2,
  Italic,
  ListRestart,
  Maximize2,
  Merge,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Redo2,
  Save,
  Search,
  History,
  Split,
  Target,
  Trash2,
  Undo2,
  WandSparkles,
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
  type PointerEvent as ReactPointerEvent
} from 'react'
import type {
  BookDetail,
  BookStatus,
  AiAssistantTask,
  Chapter,
  ChapterRevision,
  RecoveryDraft,
  SplitCandidate
} from '@shared/types'
import { countWords } from '@shared/text'
import { readableError, storyboundApi, unwrap } from '../lib/api'
import { onContentChanged, type PrepareCloseDetail } from '../lib/events'
import { formatNumber, nextChapterTitle } from '../lib/format'
import { navigate, routes, type BeforeNavigateDetail } from '../lib/routing'
import { applyStoryPaste, restorePasteCursor } from '../lib/storyPaste'
import {
  Button,
  ConfirmDialog,
  ErrorState,
  IconButton,
  InlineNotice,
  LoadingState,
  Modal
} from '../components/ui'
import { StoryMarkdown } from '../components/StoryMarkdown'
import { WritingGoalsModal } from '../components/WritingGoalsModal'
import { AiAssistantModal } from '../components/AiAssistantModal'

interface EditorPageProps {
  bookId: string
  chapterId?: string
  notify: (message: string) => void
}

type SaveState = 'saved' | 'saving' | 'unsaved' | 'failed'
type EditorView = 'edit' | 'split' | 'preview'

function initialSplitWidth(): number {
  try {
    const saved = Number(window.localStorage.getItem('storybound:editor-split-width'))
    return Number.isFinite(saved) && saved >= 25 && saved <= 75 ? saved : 50
  } catch {
    return 50
  }
}

export function EditorPage({ bookId, chapterId, notify }: EditorPageProps): React.JSX.Element {
  const [book, setBook] = useState<BookDetail | null>(null)
  const [chapter, setChapter] = useState<Chapter | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [recovery, setRecovery] = useState<RecoveryDraft | null>(null)
  const [externalChange, setExternalChange] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [editorView, setEditorView] = useState<EditorView>('edit')
  const [focusMode, setFocusMode] = useState(false)
  const [splitWidth, setSplitWidth] = useState(initialSplitWidth)
  const [findOpen, setFindOpen] = useState(false)
  const [findTerm, setFindTerm] = useState('')
  const [replaceTerm, setReplaceTerm] = useState('')
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [revisions, setRevisions] = useState<ChapterRevision[] | null>(null)
  const [selectedRevision, setSelectedRevision] = useState<ChapterRevision | null>(null)
  const [splitOpen, setSplitOpen] = useState(false)
  const [splitTitle, setSplitTitle] = useState('')
  const [splitOffset, setSplitOffset] = useState(0)
  const [splitCandidates, setSplitCandidates] = useState<SplitCandidate[] | null>(null)
  const [selectedSplits, setSelectedSplits] = useState<Set<number>>(new Set())
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [bookMetaOpen, setBookMetaOpen] = useState(false)
  const [writingGoalsOpen, setWritingGoalsOpen] = useState(false)
  const [aiAssistantOpen, setAiAssistantOpen] = useState(false)
  const [bookTitle, setBookTitle] = useState('')
  const [bookBlurb, setBookBlurb] = useState('')
  const [bookStatus, setBookStatus] = useState<BookStatus>('ongoing')
  const [busy, setBusy] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const findRef = useRef<HTMLInputElement>(null)
  const navigationSaveRef = useRef(false)
  const saveInFlightRef = useRef<Promise<Chapter | null> | null>(null)
  const saveLatestRef = useRef<() => Promise<Chapter | null>>(async () => null)
  const editVersionRef = useRef(0)
  const dirtyRef = useRef(false)
  const lastDurabilityRef = useRef<'none' | 'chapter' | 'recovery'>('none')
  const saveFailureVersionRef = useRef<number | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setError('')
    try {
      const bookPromise = storyboundApi().books.get(bookId)
      const chapterPromise = chapterId ? storyboundApi().chapters.get(chapterId) : null
      const recoveryPromise = chapterId ? storyboundApi().recovery.get(chapterId) : null
      const [bookResult, chapterResult, recoveryResult] = await Promise.all([
        bookPromise,
        chapterPromise,
        recoveryPromise
      ])
      const nextBook = unwrap(bookResult)
      setBook(nextBook)
      setBookTitle(nextBook.title)
      setBookBlurb(nextBook.blurb)
      setBookStatus(nextBook.status)

      if (chapterResult) {
        const nextChapter = unwrap(chapterResult)
        setChapter(nextChapter)
        setTitle(nextChapter.title)
        setContent(nextChapter.content)
        const draft = recoveryResult ? unwrap(recoveryResult) : null
        if (
          draft &&
          new Date(draft.savedAt).getTime() > new Date(nextChapter.updatedAt).getTime() &&
          (draft.title !== nextChapter.title || draft.content !== nextChapter.content)
        )
          setRecovery(draft)
        else setRecovery(null)
      } else {
        setChapter(null)
        setTitle(nextChapterTitle(nextBook.chapters.length))
        setContent('')
        setRecovery(null)
      }
      setDirty(false)
      dirtyRef.current = false
      editVersionRef.current = 0
      lastDurabilityRef.current = chapterResult ? 'chapter' : 'none'
      saveFailureVersionRef.current = null
      setSaveState('saved')
    } catch (caught) {
      setError(readableError(caught))
    }
  }, [bookId, chapterId])

  useEffect(() => {
    void Promise.resolve().then(load)
  }, [load, reload])

  useEffect(
    () =>
      onContentChanged((detail) => {
        if (detail.bookId !== bookId) return
        // Never overwrite unsaved typing with an assistant's change; reload only a clean editor.
        if (!dirtyRef.current) {
          setExternalChange(false)
          setReload((value) => value + 1)
        } else if (detail.chapterId === chapterId) {
          setExternalChange(true)
        }
      }),
    [bookId, chapterId]
  )

  useEffect(() => {
    try {
      window.localStorage.setItem('storybound:editor-split-width', String(splitWidth))
    } catch {
      // Layout persistence is a convenience; private storage modes may disable it.
    }
  }, [splitWidth])

  const saveChapter = useCallback((): Promise<Chapter | null> => {
    if (saveInFlightRef.current) return saveInFlightRef.current
    const task = (async (): Promise<Chapter | null> => {
      const cleanTitle = title.trim()
      const versionAtStart = editVersionRef.current
      if (!book || !cleanTitle) {
        saveFailureVersionRef.current = versionAtStart
        setError('Every chapter needs a title before it can be saved.')
        setSaveState('failed')
        return null
      }
      if (!dirtyRef.current && chapter) return chapter

      setSaveState('saving')
      setError('')
      saveFailureVersionRef.current = null
      let saved: Chapter
      if (chapter) {
        let recoverySaved = false
        let recoveryFailure = ''
        try {
          unwrap(
            await storyboundApi().recovery.save({
              chapterId: chapter.id,
              title: cleanTitle,
              content
            })
          )
          recoverySaved = true
          if (editVersionRef.current === versionAtStart) {
            lastDurabilityRef.current = 'recovery'
          }
        } catch (caught) {
          recoveryFailure = readableError(caught)
        }

        try {
          saved = unwrap(
            await storyboundApi().chapters.update({ id: chapter.id, title: cleanTitle, content })
          )
        } catch (caught) {
          if (!recoverySaved) {
            try {
              unwrap(
                await storyboundApi().recovery.save({
                  chapterId: chapter.id,
                  title: cleanTitle,
                  content
                })
              )
              recoverySaved = true
            } catch (recoveryCaught) {
              recoveryFailure = readableError(recoveryCaught)
            }
          }
          const hasNewerEdits = editVersionRef.current !== versionAtStart
          lastDurabilityRef.current = !hasNewerEdits && recoverySaved ? 'recovery' : 'none'
          saveFailureVersionRef.current = !hasNewerEdits && !recoverySaved ? versionAtStart : null
          setError(
            recoverySaved
              ? `${readableError(caught)} Your latest text is stored in a recovery draft.`
              : `${readableError(caught)} Recovery draft also failed: ${recoveryFailure || 'unknown error'}. Keep this editor open and try saving again.`
          )
          setSaveState('failed')
          return null
        }

        try {
          unwrap(await storyboundApi().recovery.clear(chapter.id))
        } catch (caught) {
          setError(
            `The chapter was saved, but its older recovery draft could not be cleared: ${readableError(caught)}`
          )
        }
      } else {
        try {
          saved = unwrap(
            await storyboundApi().chapters.create({ bookId, title: cleanTitle, content })
          )
        } catch (caught) {
          lastDurabilityRef.current = 'none'
          saveFailureVersionRef.current = versionAtStart
          setError(
            `${readableError(caught)} Your latest text remains in the editor. Try saving again before closing.`
          )
          setSaveState('failed')
          return null
        }
      }

      setChapter(saved)
      const hasNewerEdits = editVersionRef.current !== versionAtStart
      lastDurabilityRef.current = hasNewerEdits ? 'none' : 'chapter'
      saveFailureVersionRef.current = null
      if (!hasNewerEdits) {
        setTitle(saved.title)
        setContent(saved.content)
        setDirty(false)
        dirtyRef.current = false
        setSaveState('saved')
      } else {
        setSaveState('unsaved')
      }
      setBook((current) => {
        if (!current) return current
        const exists = current.chapters.some((item) => item.id === saved.id)
        return {
          ...current,
          chapters: exists
            ? current.chapters.map((item) => (item.id === saved.id ? saved : item))
            : [...current.chapters, saved]
        }
      })
      if (!chapterId && !hasNewerEdits) {
        navigate(routes.editor(bookId, saved.id), { bypassGuard: true, replace: true })
      }
      return saved
    })()
    saveInFlightRef.current = task
    void task.finally(() => {
      if (saveInFlightRef.current === task) saveInFlightRef.current = null
    })
    return task
  }, [book, bookId, chapter, chapterId, content, title])

  useEffect(() => {
    saveLatestRef.current = saveChapter
  }, [saveChapter])

  const flushLatestChapter = useCallback(async (): Promise<Chapter | null> => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const saved = await saveLatestRef.current()
      if (!dirtyRef.current) return saved
      if (lastDurabilityRef.current === 'recovery') return null
      if (saveFailureVersionRef.current === editVersionRef.current) return null
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
    }
    return null
  }, [])
  const saveFromCommand = useEffectEvent((): void => {
    void flushLatestChapter().then((saved) => {
      if (saved) notify('Chapter saved.')
    })
  })
  const beginNewChapterFromCommand = useEffectEvent((): void => {
    void beginNewChapter()
  })
  const beforeNavigate = useEffectEvent((event: CustomEvent<BeforeNavigateDetail>): void => {
    if (!dirtyRef.current) return
    event.preventDefault()
    if (navigationSaveRef.current) return
    navigationSaveRef.current = true
    void flushLatestChapter().then((saved) => {
      navigationSaveRef.current = false
      if (!saved && lastDurabilityRef.current !== 'recovery') return
      navigate(event.detail.path, { bypassGuard: true })
    })
  })
  const prepareClose = useEffectEvent(async (): Promise<boolean> => {
    if (!dirtyRef.current) return true
    const saved = await flushLatestChapter()
    return Boolean(saved && !dirtyRef.current) || lastDurabilityRef.current === 'recovery'
  })

  useEffect(() => {
    if (!dirty) return
    const recoveryTimer = chapter
      ? window.setTimeout(() => {
          const versionAtStart = editVersionRef.current
          void storyboundApi()
            .recovery.save({
              chapterId: chapter.id,
              title: title.trim() || chapter.title,
              content
            })
            .then((result) => {
              try {
                unwrap(result)
                if (editVersionRef.current === versionAtStart) {
                  lastDurabilityRef.current = 'recovery'
                }
              } catch (caught) {
                if (editVersionRef.current === versionAtStart) {
                  lastDurabilityRef.current = 'none'
                  setError(
                    `A recovery draft could not be saved: ${readableError(caught)} Storybound will keep this editor open if the chapter save also fails.`
                  )
                }
              }
            })
        }, 300)
      : null
    const saveTimer = window.setTimeout(() => void saveChapter(), 1000)
    return () => {
      if (recoveryTimer) window.clearTimeout(recoveryTimer)
      window.clearTimeout(saveTimer)
    }
  }, [chapter, content, dirty, saveChapter, title])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey)) return
      const key = event.key.toLocaleLowerCase()
      if (key === 's') {
        event.preventDefault()
        saveFromCommand()
      } else if (key === 'f') {
        event.preventDefault()
        setFindOpen(true)
        window.setTimeout(() => findRef.current?.focus(), 0)
      }
    }
    const handleNewChapter = (): void => beginNewChapterFromCommand()
    const handleSave = (): void => saveFromCommand()
    const handleFind = (): void => {
      setFindOpen(true)
      window.setTimeout(() => findRef.current?.focus(), 0)
    }
    const handleEscape = (): void => {
      setFindOpen(false)
      setSplitOpen(false)
      setSplitCandidates(null)
      setBookMetaOpen(false)
      setDeleteOpen(false)
    }
    const handleBeforeNavigate = (event: Event): void =>
      beforeNavigate(event as CustomEvent<BeforeNavigateDetail>)
    const handlePrepareClose = (event: Event): void => {
      const closeEvent = event as CustomEvent<PrepareCloseDetail>
      closeEvent.detail.tasks.push(prepareClose())
    }
    window.addEventListener('keydown', handleShortcut)
    window.addEventListener('storybound:new-chapter', handleNewChapter)
    window.addEventListener('storybound:save', handleSave)
    window.addEventListener('storybound:find', handleFind)
    window.addEventListener('storybound:escape', handleEscape)
    window.addEventListener('storybound:before-navigate', handleBeforeNavigate)
    window.addEventListener('storybound:prepare-close', handlePrepareClose)
    return () => {
      window.removeEventListener('keydown', handleShortcut)
      window.removeEventListener('storybound:new-chapter', handleNewChapter)
      window.removeEventListener('storybound:save', handleSave)
      window.removeEventListener('storybound:find', handleFind)
      window.removeEventListener('storybound:escape', handleEscape)
      window.removeEventListener('storybound:before-navigate', handleBeforeNavigate)
      window.removeEventListener('storybound:prepare-close', handlePrepareClose)
    }
  }, [])

  const markDirty = (): void => {
    editVersionRef.current += 1
    dirtyRef.current = true
    lastDurabilityRef.current = 'none'
    saveFailureVersionRef.current = null
    setDirty(true)
    setSaveState('unsaved')
  }

  const goToChapter = async (nextId: string): Promise<void> => {
    if (dirty) {
      const saved = await flushLatestChapter()
      if (!saved) return
    }
    navigate(routes.editor(bookId, nextId), { bypassGuard: true })
  }

  async function beginNewChapter(): Promise<void> {
    if (!chapter) {
      if (!dirty && !content.trim()) {
        textareaRef.current?.focus()
        return
      }
      const saved = await flushLatestChapter()
      if (!saved) return
      setChapter(null)
      setTitle(nextChapterTitle((book?.chapters.length ?? 0) + 1))
      setContent('')
      setDirty(false)
      dirtyRef.current = false
      setSaveState('saved')
      navigate(routes.editor(bookId), { bypassGuard: true, replace: true })
      textareaRef.current?.focus()
      return
    }
    if (dirty && !(await flushLatestChapter())) return
    navigate(routes.editor(bookId), { bypassGuard: true })
  }

  const saveAndAddAnother = async (): Promise<void> => {
    const saved = await flushLatestChapter()
    if (!saved) return
    setChapter(null)
    setTitle(nextChapterTitle((book?.chapters.length ?? 0) + 1))
    setContent('')
    setDirty(false)
    dirtyRef.current = false
    setSaveState('saved')
    navigate(routes.editor(bookId), { bypassGuard: true })
    window.setTimeout(() => textareaRef.current?.focus(), 0)
  }

  const applyMarkdown = (before: string, after = before, placeholder = 'text'): void => {
    const area = textareaRef.current
    if (!area) return
    const start = area.selectionStart
    const end = area.selectionEnd
    const selected = content.slice(start, end) || placeholder
    const next = `${content.slice(0, start)}${before}${selected}${after}${content.slice(end)}`
    setContent(next)
    markDirty()
    window.setTimeout(() => {
      area.focus()
      area.setSelectionRange(start + before.length, start + before.length + selected.length)
    }, 0)
  }

  const findMatches = useMemo(() => {
    if (!findTerm) return 0
    return content.toLocaleLowerCase().split(findTerm.toLocaleLowerCase()).length - 1
  }, [content, findTerm])

  const findNext = (): void => {
    const area = textareaRef.current
    if (!area || !findTerm) return
    const source = content.toLocaleLowerCase()
    let index = source.indexOf(findTerm.toLocaleLowerCase(), area.selectionEnd)
    if (index < 0) index = source.indexOf(findTerm.toLocaleLowerCase())
    if (index >= 0) {
      area.focus()
      area.setSelectionRange(index, index + findTerm.length)
    }
  }

  const replaceCurrent = (): void => {
    const area = textareaRef.current
    if (!area || !findTerm) return
    const selected = content.slice(area.selectionStart, area.selectionEnd)
    if (selected.toLocaleLowerCase() !== findTerm.toLocaleLowerCase()) {
      findNext()
      return
    }
    const start = area.selectionStart
    const nextContent = `${content.slice(0, start)}${replaceTerm}${content.slice(area.selectionEnd)}`
    setContent(nextContent)
    markDirty()
    window.setTimeout(() => {
      area.focus()
      area.setSelectionRange(start, start + replaceTerm.length)
    }, 0)
  }

  const replaceAll = (): void => {
    if (!findTerm) return
    const escaped = findTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const nextContent = content.replace(new RegExp(escaped, 'giu'), replaceTerm)
    if (nextContent === content) return
    setContent(nextContent)
    markDirty()
    window.setTimeout(() => textareaRef.current?.focus(), 0)
  }

  const openRevisions = async (): Promise<void> => {
    if (!chapter) return
    try {
      const saved = await flushLatestChapter()
      if (!saved) return
      setRevisions(unwrap(await storyboundApi().chapters.listRevisions(saved.id)))
      setSelectedRevision(null)
    } catch (caught) {
      setError(readableError(caught))
    }
  }

  const inspectRevision = async (revision: ChapterRevision): Promise<void> => {
    try {
      setSelectedRevision(unwrap(await storyboundApi().chapters.getRevision(revision.id)))
    } catch (caught) {
      setError(readableError(caught))
    }
  }

  const restoreRevision = async (): Promise<void> => {
    if (!chapter || !selectedRevision) return
    setBusy(true)
    try {
      const restored = unwrap(
        await storyboundApi().chapters.restoreRevision({
          chapterId: chapter.id,
          revisionId: selectedRevision.id
        })
      )
      setChapter(restored)
      setTitle(restored.title)
      setContent(restored.content)
      setDirty(false)
      dirtyRef.current = false
      setSaveState('saved')
      setRevisions(null)
      setSelectedRevision(null)
      notify('Earlier chapter version restored. The replaced version remains in history.')
    } catch (caught) {
      setError(readableError(caught))
    } finally {
      setBusy(false)
    }
  }

  const beginPaneResize = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const container = event.currentTarget.parentElement
    if (!container) return
    event.preventDefault()
    const move = (moveEvent: PointerEvent): void => {
      const bounds = container.getBoundingClientRect()
      const percentage = ((moveEvent.clientX - bounds.left) / Math.max(bounds.width, 1)) * 100
      setSplitWidth(Math.min(75, Math.max(25, percentage)))
    }
    const finish = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish, { once: true })
  }

  const openManualSplit = (): void => {
    const offset = textareaRef.current?.selectionStart ?? 0
    if (!chapter || offset <= 0 || offset >= content.length) {
      setError('Place the cursor within a saved chapter before splitting it.')
      return
    }
    setSplitOffset(offset)
    setSplitTitle(nextChapterTitle(book?.chapters.length ?? 0))
    setSplitOpen(true)
  }

  const performSplit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!chapter || !splitTitle.trim()) return
    setBusy(true)
    try {
      const saved = await flushLatestChapter()
      if (!saved) return
      const next = unwrap(
        await storyboundApi().chapters.split({
          chapterId: saved.id,
          offset: splitOffset,
          newTitle: splitTitle.trim()
        })
      )
      setSplitOpen(false)
      notify('Chapter split saved.')
      navigate(routes.editor(bookId, next.id), { bypassGuard: true })
    } catch (caught) {
      setError(readableError(caught))
    } finally {
      setBusy(false)
    }
  }

  const detectSplits = async (): Promise<void> => {
    if (!chapter) {
      setError('Save this chapter before looking for chapter headings.')
      return
    }
    const saved = await flushLatestChapter()
    if (!saved) return
    try {
      const candidates = unwrap(await storyboundApi().chapters.detectSplits(saved.id))
      setSplitCandidates(candidates)
      setSelectedSplits(new Set(candidates.map((candidate) => candidate.offset)))
    } catch (caught) {
      setError(readableError(caught))
    }
  }

  const applyDetectedSplits = async (): Promise<void> => {
    if (!chapter || !splitCandidates) return
    const chosen = splitCandidates.filter((candidate) => selectedSplits.has(candidate.offset))
    if (!chosen.length) return
    setBusy(true)
    try {
      unwrap(await storyboundApi().chapters.applyDetectedSplits(chapter.id, chosen))
      setSplitCandidates(null)
      notify(`Created ${chosen.length} new ${chosen.length === 1 ? 'chapter' : 'chapters'}.`)
      await load()
    } catch (caught) {
      setError(readableError(caught))
    } finally {
      setBusy(false)
    }
  }

  const mergeChapter = async (direction: 'previous' | 'next'): Promise<void> => {
    if (!chapter) return
    const saved = await flushLatestChapter()
    if (!saved) return
    try {
      const merged = unwrap(
        await storyboundApi().chapters.merge({ chapterId: saved.id, direction })
      )
      notify(`Merged with the ${direction} chapter.`)
      navigate(routes.editor(bookId, merged.id), { bypassGuard: true })
    } catch (caught) {
      setError(readableError(caught))
    }
  }

  const duplicate = async (): Promise<void> => {
    if (!chapter) return
    const saved = await flushLatestChapter()
    if (!saved) return
    try {
      const duplicateChapter = unwrap(await storyboundApi().chapters.duplicate(saved.id))
      notify('Chapter duplicated.')
      navigate(routes.editor(bookId, duplicateChapter.id), { bypassGuard: true })
    } catch (caught) {
      setError(readableError(caught))
    }
  }

  const deleteChapter = async (): Promise<void> => {
    if (!chapter) return
    setBusy(true)
    try {
      unwrap(await storyboundApi().chapters.remove(chapter.id))
      setDeleteOpen(false)
      notify(`“${chapter.title}” moved to chapter trash.`)
      navigate(routes.book(bookId), { bypassGuard: true })
    } catch (caught) {
      setError(readableError(caught))
    } finally {
      setBusy(false)
    }
  }

  const reorder = async (index: number, direction: -1 | 1): Promise<void> => {
    if (!book) return
    const target = index + direction
    if (target < 0 || target >= book.chapters.length) return
    const ids = book.chapters.map((item) => item.id)
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    try {
      const summaries = unwrap(await storyboundApi().chapters.reorder({ bookId, chapterIds: ids }))
      setBook({ ...book, chapters: summaries })
      notify('Chapter order saved.')
    } catch (caught) {
      setError(readableError(caught))
    }
  }

  const saveBookMetadata = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!book || !bookTitle.trim()) return
    setBusy(true)
    try {
      const updated = unwrap(
        await storyboundApi().books.update({
          id: book.id,
          title: bookTitle.trim(),
          blurb: bookBlurb,
          status: bookStatus
        })
      )
      setBook(updated)
      setBookMetaOpen(false)
      notify('Book details saved.')
    } catch (caught) {
      setError(readableError(caught))
    } finally {
      setBusy(false)
    }
  }

  const applyAiSuggestion = async (task: AiAssistantTask, suggestion: string): Promise<void> => {
    if (!book) return
    if (task === 'chapter-cleanup') {
      setContent(suggestion)
      markDirty()
      notify('AI suggestion applied as an unsaved edit. Review it, then save the chapter.')
      return
    }
    const updated = unwrap(await storyboundApi().books.update({ id: book.id, blurb: suggestion }))
    setBook(updated)
    setBookBlurb(updated.blurb)
    notify('Suggested blurb saved to the book.')
  }

  const restoreDraft = (): void => {
    if (!recovery) return
    setTitle(recovery.title)
    setContent(recovery.content)
    setRecovery(null)
    markDirty()
    notify('Recovery draft restored. Review it, then save when ready.')
  }

  const discardDraft = async (): Promise<void> => {
    if (!recovery) return
    try {
      unwrap(await storyboundApi().recovery.clear(recovery.chapterId))
      setRecovery(null)
      notify('Recovery draft discarded.')
    } catch (caught) {
      setError(readableError(caught))
    }
  }

  if (error && !book)
    return (
      <div className="editor-loading">
        <ErrorState message={error} onRetry={() => setReload((value) => value + 1)} />
      </div>
    )
  if (!book)
    return (
      <div className="editor-loading">
        <LoadingState label="Preparing the editor…" />
      </div>
    )

  const currentIndex = chapter ? book.chapters.findIndex((item) => item.id === chapter.id) : -1
  const previous = currentIndex > 0 ? book.chapters[currentIndex - 1] : null
  const next =
    currentIndex >= 0 && currentIndex < book.chapters.length - 1
      ? book.chapters[currentIndex + 1]
      : null

  return (
    <div
      className={`editor ${sidebarOpen ? '' : 'editor--sidebar-closed'} ${focusMode ? 'editor--focus' : ''}`}
    >
      <aside className="editor-sidebar" aria-label="Book chapters">
        <div className="editor-sidebar__header">
          <button
            onClick={async () => {
              if (dirty && !(await flushLatestChapter())) return
              navigate(routes.book(bookId), { bypassGuard: true })
            }}
          >
            <ArrowLeft size={17} />
            Book details
          </button>
          <button className="editor-book-title" onClick={() => setBookMetaOpen(true)}>
            <strong>{book.title}</strong>
            <span>Edit book details</span>
          </button>
        </div>
        <ol className="editor-chapters">
          {book.chapters.map((item, index) => (
            <li className={item.id === chapter?.id ? 'is-active' : ''} key={item.id}>
              <button className="editor-chapter-link" onClick={() => void goToChapter(item.id)}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{item.title}</strong>
              </button>
              <div className="editor-chapter-order">
                <IconButton
                  disabled={index === 0}
                  icon={ArrowUp}
                  label={`Move ${item.title} up`}
                  onClick={() => void reorder(index, -1)}
                />
                <IconButton
                  disabled={index === book.chapters.length - 1}
                  icon={ArrowDown}
                  label={`Move ${item.title} down`}
                  onClick={() => void reorder(index, 1)}
                />
              </div>
            </li>
          ))}
        </ol>
        <Button className="editor-add-chapter" icon={Plus} onClick={() => void beginNewChapter()}>
          New chapter
        </Button>
      </aside>

      <section className="editor-workspace">
        <header className="editor-topbar">
          <div className="editor-topbar__left">
            <IconButton
              icon={sidebarOpen ? PanelLeftClose : PanelLeftOpen}
              label={sidebarOpen ? 'Hide chapter list' : 'Show chapter list'}
              onClick={() => setSidebarOpen((value) => !value)}
            />
            <span className={`save-status save-status--${saveState}`} role="status">
              {saveState === 'saving' ? (
                'Saving…'
              ) : saveState === 'unsaved' ? (
                'Unsaved changes'
              ) : saveState === 'failed' ? (
                'Save failed'
              ) : (
                <>
                  <Check size={14} />
                  Saved
                </>
              )}
            </span>
          </div>
          <div className="editor-topbar__actions">
            <IconButton
              icon={Search}
              label="Find in chapter"
              onClick={() => {
                setFindOpen((value) => !value)
                window.setTimeout(() => findRef.current?.focus(), 0)
              }}
            />
            <div className="editor-view-switcher" aria-label="Editor view" role="group">
              <button aria-pressed={editorView === 'edit'} onClick={() => setEditorView('edit')}>
                Edit
              </button>
              <button aria-pressed={editorView === 'split'} onClick={() => setEditorView('split')}>
                <Columns2 aria-hidden="true" size={15} /> Split
              </button>
              <button
                aria-pressed={editorView === 'preview'}
                onClick={() => setEditorView('preview')}
              >
                <Eye aria-hidden="true" size={15} /> Preview
              </button>
            </div>
            {chapter ? (
              <IconButton
                icon={History}
                label="Chapter versions"
                onClick={() => void openRevisions()}
              />
            ) : null}
            <IconButton
              icon={Target}
              label="Writing goals and statistics"
              onClick={() => setWritingGoalsOpen(true)}
            />
            <IconButton
              icon={WandSparkles}
              label="Optional AI writing assistant"
              onClick={() => setAiAssistantOpen(true)}
            />
            <IconButton
              icon={focusMode ? Minimize2 : Maximize2}
              label={focusMode ? 'Exit focus mode' : 'Enter focus mode'}
              onClick={() => setFocusMode((value) => !value)}
            />
            <Button
              icon={Save}
              onClick={() =>
                void flushLatestChapter().then((saved) => {
                  if (saved) notify('Chapter saved.')
                })
              }
              variant="primary"
            >
              Save
            </Button>
          </div>
        </header>

        {recovery ? (
          <div className="recovery-banner" role="alert">
            <ListRestart aria-hidden="true" size={21} />
            <div>
              <strong>A newer recovery draft was found</strong>
              <span>
                Saved {new Date(recovery.savedAt).toLocaleString()}. Restore it or keep the last
                saved chapter.
              </span>
            </div>
            <Button onClick={restoreDraft} variant="primary">
              Restore draft
            </Button>
            <Button onClick={() => void discardDraft()}>Discard</Button>
          </div>
        ) : null}
        {externalChange ? (
          <div className="editor-error">
            <InlineNotice tone="info">
              An AI assistant changed this chapter while you were editing. Your unsaved edits are
              still here. Saving keeps your version, and the assistant’s version stays in Revisions.
            </InlineNotice>
            <IconButton icon={X} label="Dismiss notice" onClick={() => setExternalChange(false)} />
          </div>
        ) : null}
        {error ? (
          <div className="editor-error">
            <InlineNotice tone="error">{error}</InlineNotice>
            <IconButton icon={X} label="Dismiss error" onClick={() => setError('')} />
          </div>
        ) : null}
        {findOpen ? (
          <div className="find-bar">
            <Search aria-hidden="true" size={17} />
            <label>
              <span className="visually-hidden">Find in chapter</span>
              <input
                ref={findRef}
                placeholder="Find in this chapter…"
                value={findTerm}
                onChange={(event) => setFindTerm(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    findNext()
                  }
                }}
              />
            </label>
            <span>
              {findTerm ? `${findMatches} ${findMatches === 1 ? 'match' : 'matches'}` : ''}
            </span>
            <Button disabled={!findMatches} onClick={findNext}>
              Next
            </Button>
            <Button onClick={() => setReplaceOpen((value) => !value)}>
              {replaceOpen ? 'Hide replace' : 'Replace'}
            </Button>
            {replaceOpen ? (
              <>
                <label>
                  <span className="visually-hidden">Replace with</span>
                  <input
                    placeholder="Replace with…"
                    value={replaceTerm}
                    onChange={(event) => setReplaceTerm(event.target.value)}
                  />
                </label>
                <Button disabled={!findMatches} onClick={replaceCurrent}>
                  Replace
                </Button>
                <Button disabled={!findMatches} onClick={replaceAll}>
                  All
                </Button>
              </>
            ) : null}
            <IconButton icon={X} label="Close find" onClick={() => setFindOpen(false)} />
          </div>
        ) : null}

        <div className="editor-document">
          <input
            aria-label="Chapter title"
            className="chapter-title-input"
            maxLength={240}
            placeholder="Chapter title"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value)
              markDirty()
            }}
          />
          {editorView !== 'preview' ? (
            <div className="format-toolbar" aria-label="Text formatting" role="toolbar">
              <IconButton
                icon={Undo2}
                label="Undo"
                onClick={() => {
                  textareaRef.current?.focus()
                  document.execCommand('undo')
                }}
              />
              <IconButton
                icon={Redo2}
                label="Redo"
                onClick={() => {
                  textareaRef.current?.focus()
                  document.execCommand('redo')
                }}
              />
              <span className="toolbar-divider" />
              <IconButton icon={Bold} label="Bold" onClick={() => applyMarkdown('**')} />
              <IconButton icon={Italic} label="Italic" onClick={() => applyMarkdown('_')} />
              <button onClick={() => applyMarkdown('\n\n* * *\n\n', '', '')}>Scene break</button>
              <span className="toolbar-divider" />
              <button onClick={openManualSplit}>
                <Split size={16} />
                Split at cursor
              </button>
              <button onClick={() => void detectSplits()}>
                <FilePlus2 size={16} />
                Detect chapters
              </button>
              {chapter ? (
                <button onClick={() => void duplicate()}>
                  <Copy size={16} />
                  Duplicate
                </button>
              ) : null}
            </div>
          ) : null}
          <div
            className={`editor-panes editor-panes--${editorView}`}
            style={
              editorView === 'split'
                ? { gridTemplateColumns: `${splitWidth}% 9px minmax(0, 1fr)` }
                : undefined
            }
          >
            {editorView !== 'preview' ? (
              <textarea
                ref={textareaRef}
                aria-label="Chapter text"
                className="chapter-editor"
                placeholder="Paste or write the chapter here…"
                spellCheck
                value={content}
                onChange={(event) => {
                  setContent(event.target.value)
                  markDirty()
                }}
                onPaste={(event) => {
                  event.preventDefault()
                  const area = event.currentTarget
                  const edit = applyStoryPaste(
                    content,
                    area.selectionStart,
                    area.selectionEnd,
                    event.clipboardData
                  )
                  setContent(edit.value)
                  markDirty()
                  restorePasteCursor(area, edit.cursor)
                }}
              />
            ) : null}
            {editorView === 'split' ? (
              <button
                aria-label="Resize editor and preview panes"
                className="editor-pane-resizer"
                onDoubleClick={() => setSplitWidth(50)}
                onPointerDown={beginPaneResize}
              />
            ) : null}
            {editorView !== 'edit' ? (
              <article className="markdown-preview reader-prose">
                {content.trim() ? (
                  <StoryMarkdown>{content}</StoryMarkdown>
                ) : (
                  <p className="preview-empty">Your formatted chapter preview will appear here.</p>
                )}
              </article>
            ) : null}
          </div>
          <footer className="editor-footer">
            <span>{formatNumber(countWords(content))} words</span>
            <span>{formatNumber(content.length)} characters</span>
            {!chapter ? (
              <Button onClick={() => void saveAndAddAnother()}>Save & add another</Button>
            ) : null}
          </footer>
        </div>

        <footer className="editor-navigation">
          <Button
            disabled={!previous}
            icon={ChevronLeft}
            onClick={() => previous && void goToChapter(previous.id)}
          >
            {previous?.title ?? 'Previous'}
          </Button>
          <div className="editor-structure-actions">
            <Button
              disabled={!previous || !chapter}
              icon={Merge}
              onClick={() => void mergeChapter('previous')}
            >
              Merge previous
            </Button>
            <Button
              disabled={!next || !chapter}
              icon={Merge}
              onClick={() => void mergeChapter('next')}
            >
              Merge next
            </Button>
            {chapter ? (
              <Button icon={Trash2} variant="quiet" onClick={() => setDeleteOpen(true)}>
                Delete
              </Button>
            ) : null}
          </div>
          <Button disabled={!next} onClick={() => next && void goToChapter(next.id)}>
            {next?.title ?? 'Next'}
            <ChevronRight size={17} />
          </Button>
        </footer>
      </section>

      {revisions ? (
        <Modal
          description="Storybound keeps compressed snapshots before edits and structural changes. Restoring one also preserves your current text."
          onClose={() => {
            setRevisions(null)
            setSelectedRevision(null)
          }}
          size="large"
          title="Chapter versions"
        >
          {revisions.length ? (
            <div className="revision-browser">
              <ol>
                {revisions.map((revision) => (
                  <li key={revision.id}>
                    <button
                      aria-pressed={selectedRevision?.id === revision.id}
                      onClick={() => void inspectRevision(revision)}
                    >
                      <strong>Version {revision.revisionNumber}</strong>
                      <span>{revision.reason}</span>
                      <small>
                        {new Date(revision.createdAt).toLocaleString()} ·{' '}
                        {formatNumber(revision.wordCount)} words
                      </small>
                    </button>
                  </li>
                ))}
              </ol>
              <div className="revision-browser__preview">
                {selectedRevision?.content !== undefined ? (
                  <>
                    <h3>{selectedRevision.title}</h3>
                    <div className="reader-prose">
                      <StoryMarkdown>{selectedRevision.content}</StoryMarkdown>
                    </div>
                  </>
                ) : (
                  <p>Select a version to inspect it before restoring.</p>
                )}
              </div>
            </div>
          ) : (
            <div className="empty-section compact">
              <History size={27} />
              <h3>No earlier versions yet</h3>
              <p>A version appears after this chapter is edited or restructured.</p>
            </div>
          )}
          <div className="modal__actions">
            <Button onClick={() => setRevisions(null)}>Close</Button>
            <Button
              disabled={!selectedRevision || busy}
              onClick={() => void restoreRevision()}
              variant="primary"
            >
              Restore selected version
            </Button>
          </div>
        </Modal>
      ) : null}

      {splitOpen ? (
        <Modal
          description="The text after your cursor becomes a new chapter. Nothing is discarded."
          onClose={() => setSplitOpen(false)}
          size="small"
          title="Split chapter here"
        >
          <form className="form-stack" onSubmit={(event) => void performSplit(event)}>
            <label className="field">
              <span>New chapter title</span>
              <input
                required
                maxLength={240}
                value={splitTitle}
                onChange={(event) => setSplitTitle(event.target.value)}
              />
            </label>
            <div className="split-preview">
              <span>Current chapter</span>
              <strong>{formatNumber(splitOffset)} characters</strong>
              <span>New chapter</span>
              <strong>{formatNumber(content.length - splitOffset)} characters</strong>
            </div>
            <div className="modal__actions">
              <Button onClick={() => setSplitOpen(false)}>Cancel</Button>
              <Button disabled={busy} icon={Split} type="submit" variant="primary">
                Split chapter
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}

      {splitCandidates ? (
        <Modal
          description="Storybound found likely headings. Review every proposed split before applying."
          onClose={() => setSplitCandidates(null)}
          size="medium"
          title="Detected chapter headings"
        >
          {splitCandidates.length ? (
            <div className="detected-splits">
              {splitCandidates.map((candidate) => (
                <label key={candidate.offset}>
                  <input
                    checked={selectedSplits.has(candidate.offset)}
                    type="checkbox"
                    onChange={(event) =>
                      setSelectedSplits((current) => {
                        const nextSet = new Set(current)
                        if (event.target.checked) nextSet.add(candidate.offset)
                        else nextSet.delete(candidate.offset)
                        return nextSet
                      })
                    }
                  />
                  <span>
                    <strong>{candidate.title}</strong>
                    <small>Line {candidate.line}</small>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <div className="empty-section compact">
              <FilePlus2 size={27} />
              <h3>No likely chapter headings found</h3>
              <p>Try headings such as “Chapter Two”, “Prologue”, or “Epilogue”.</p>
            </div>
          )}
          <div className="modal__actions">
            <Button onClick={() => setSplitCandidates(null)}>Cancel</Button>
            <Button
              disabled={!selectedSplits.size || busy}
              icon={Split}
              onClick={() => void applyDetectedSplits()}
              variant="primary"
            >
              Apply {selectedSplits.size || ''} {selectedSplits.size === 1 ? 'split' : 'splits'}
            </Button>
          </div>
        </Modal>
      ) : null}

      {bookMetaOpen ? (
        <Modal
          description="Writing status and reading progress remain independent."
          onClose={() => setBookMetaOpen(false)}
          size="medium"
          title="Edit book details"
        >
          <form className="form-stack" onSubmit={(event) => void saveBookMetadata(event)}>
            <label className="field">
              <span>Book title</span>
              <input
                required
                maxLength={240}
                value={bookTitle}
                onChange={(event) => setBookTitle(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Blurb</span>
              <textarea
                rows={5}
                maxLength={20_000}
                value={bookBlurb}
                onChange={(event) => setBookBlurb(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Writing status</span>
              <select
                value={bookStatus}
                onChange={(event) => setBookStatus(event.target.value as BookStatus)}
              >
                <option value="ongoing">Ongoing</option>
                <option value="completed">Completed</option>
              </select>
            </label>
            <div className="modal__actions">
              <Button onClick={() => setBookMetaOpen(false)}>Cancel</Button>
              <Button disabled={busy} type="submit" variant="primary">
                Save details
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}

      {writingGoalsOpen ? (
        <WritingGoalsModal book={book} notify={notify} onClose={() => setWritingGoalsOpen(false)} />
      ) : null}

      {aiAssistantOpen ? (
        <AiAssistantModal
          book={book}
          chapterText={content}
          onApply={applyAiSuggestion}
          onClose={() => setAiAssistantOpen(false)}
        />
      ) : null}

      {deleteOpen && chapter ? (
        <ConfirmDialog
          busy={busy}
          confirmLabel="Move to chapter trash"
          dangerous
          description="The chapter will be hidden from the book and remain recoverable from Book Details."
          onClose={() => setDeleteOpen(false)}
          onConfirm={deleteChapter}
          title={`Move “${chapter.title}” to chapter trash?`}
        />
      ) : null}
    </div>
  )
}
