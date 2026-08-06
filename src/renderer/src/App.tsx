import { BookOpen, Home } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { APP_NAME, type ApplicationSettings, type BookDetail } from '@shared/types'
import { AddBookModal } from './components/AddBookModal'
import { HelpModal } from './components/HelpModal'
import { AppShell, Toast } from './components/AppShell'
import { Button, ErrorState, LoadingState } from './components/ui'
import { readableError, storyboundApi, unwrap } from './lib/api'
import type { PrepareCloseDetail } from './lib/events'
import { navigate, routes, useRoute } from './lib/routing'
import { DEFAULT_SETTINGS } from './lib/settings'

const BookPage = lazy(() =>
  import('./pages/BookPage').then((module) => ({ default: module.BookPage }))
)
const EditorPage = lazy(() =>
  import('./pages/EditorPage').then((module) => ({ default: module.EditorPage }))
)
const LibraryPage = lazy(() =>
  import('./pages/LibraryPage').then((module) => ({ default: module.LibraryPage }))
)
const ReaderPage = lazy(() =>
  import('./pages/ReaderPage').then((module) => ({ default: module.ReaderPage }))
)
const SearchPage = lazy(() =>
  import('./pages/SearchPage').then((module) => ({ default: module.SearchPage }))
)
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage }))
)
const TrashPage = lazy(() =>
  import('./pages/TrashPage').then((module) => ({ default: module.TrashPage }))
)

function PageFallback(): React.JSX.Element {
  return (
    <div className="page-loading">
      <LoadingState label="Opening page…" />
    </div>
  )
}

function App(): React.JSX.Element {
  const route = useRoute()
  const [settings, setSettings] = useState<ApplicationSettings>(DEFAULT_SETTINGS)
  const [settingsError, setSettingsError] = useState('')
  const [addBookOpen, setAddBookOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [toast, setToast] = useState('')
  const preparingCloseRef = useRef(false)

  useEffect(() => {
    let active = true
    void storyboundApi()
      .settings.get()
      .then(async (result) => {
        if (!active) return
        try {
          const loaded = unwrap(result)
          setSettings(loaded)
          if (!loaded.hasSeenGettingStarted) {
            setHelpOpen(true)
            const updated = unwrap(
              await storyboundApi().settings.update({ hasSeenGettingStarted: true })
            )
            if (active) setSettings(updated)
          }
        } catch (caught) {
          setSettingsError(readableError(caught))
        }
      })
      .catch((caught: unknown) => {
        if (active) setSettingsError(readableError(caught))
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.appTheme = settings.appTheme
    document.documentElement.classList.toggle('reduced-motion', settings.reducedMotion)
  }, [settings.appTheme, settings.reducedMotion])

  const routeFocusKey =
    route.name === 'book'
      ? `${route.name}:${route.bookId}`
      : route.name === 'editor' || route.name === 'reader'
        ? `${route.name}:${route.bookId}:${route.chapterId ?? ''}`
        : route.name === 'search'
          ? `${route.name}:${route.term}`
          : route.name
  const pageTitle =
    route.name === 'library'
      ? 'Library'
      : route.name === 'book'
        ? 'Book details'
        : route.name === 'editor'
          ? 'Editor'
          : route.name === 'reader'
            ? 'Reader'
            : route.name === 'search'
              ? route.term
                ? `Search: ${route.term}`
                : 'Search'
              : route.name === 'trash'
                ? 'Trash'
                : route.name === 'settings'
                  ? 'Settings'
                  : 'Page not found'

  useEffect(() => {
    document.title = `${pageTitle} — ${APP_NAME}`
    const frame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[data-route-main]')?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [pageTitle, routeFocusKey])

  const notify = useCallback((message: string): void => {
    setToast(message)
    window.setTimeout(() => setToast((current) => (current === message ? '' : current)), 3200)
  }, [])

  const updateSettings = useCallback(
    async (changes: Partial<ApplicationSettings>): Promise<void> => {
      const previous = settings
      setSettings((current) => ({ ...current, ...changes }))
      setSettingsError('')
      try {
        setSettings(unwrap(await storyboundApi().settings.update(changes)))
      } catch (caught) {
        setSettings(previous)
        setSettingsError(readableError(caught))
      }
    },
    [settings]
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey)) return
      const target = event.target
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      const key = event.key.toLocaleLowerCase()
      if (key === 'k') {
        event.preventDefault()
        if (route.name === 'reader') navigate(routes.search(''))
        else window.dispatchEvent(new Event('storybound:focus-search'))
      } else if (event.key === ',') {
        event.preventDefault()
        navigate(routes.settings())
      } else if (key === 'n' && event.shiftKey && route.name === 'editor') {
        event.preventDefault()
        window.dispatchEvent(new Event('storybound:new-chapter'))
      } else if (key === 'n' && !event.shiftKey && !typing) {
        event.preventDefault()
        setAddBookOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [route.name])

  useEffect(() => {
    const prepareClose = async (): Promise<void> => {
      if (preparingCloseRef.current) return
      preparingCloseRef.current = true
      const tasks: Promise<boolean>[] = []
      window.dispatchEvent(
        new CustomEvent<PrepareCloseDetail>('storybound:prepare-close', { detail: { tasks } })
      )
      const results = await Promise.allSettled(tasks)
      const ready = results.every((result) => result.status === 'fulfilled' && result.value)
      try {
        unwrap(await storyboundApi().app.confirmClose(ready))
      } catch (caught) {
        setSettingsError(`Storybound could not finish preparing to close: ${readableError(caught)}`)
      } finally {
        preparingCloseRef.current = false
      }
    }

    const handleCommand = (event: Event): void => {
      const command = (event as CustomEvent<string>).detail
      if (command === 'new-book') {
        window.dispatchEvent(new Event('storybound:save'))
        setAddBookOpen(true)
      } else if (command === 'new-chapter') {
        window.dispatchEvent(new Event('storybound:new-chapter'))
      } else if (command === 'save') {
        window.dispatchEvent(new Event('storybound:save'))
      } else if (command === 'find') {
        window.dispatchEvent(new Event('storybound:find'))
      } else if (command === 'search-library') {
        if (route.name === 'reader') navigate(routes.search(''))
        else window.dispatchEvent(new Event('storybound:focus-search'))
      } else if (command === 'settings') {
        window.dispatchEvent(new Event('storybound:save'))
        navigate(routes.settings())
      } else if (command === 'escape') {
        setAddBookOpen(false)
        window.dispatchEvent(new Event('storybound:escape'))
      } else if (command === 'prepare-close') {
        void prepareClose()
      } else if (command === 'help') {
        setHelpOpen(true)
      }
    }
    window.addEventListener('storybound:command', handleCommand)
    return () => window.removeEventListener('storybound:command', handleCommand)
  }, [route.name])

  const handleCreated = (book: BookDetail, warning?: string): void => {
    setAddBookOpen(false)
    notify(warning ?? `“${book.title}” added to your library.`)
    navigate(routes.editor(book.id, book.chapters[0]?.id))
  }

  let content: React.JSX.Element
  let active: 'library' | 'book' | 'editor' | 'search' | 'trash' | 'settings' = 'library'

  switch (route.name) {
    case 'library':
      content = (
        <LibraryPage
          defaultSort={settings.defaultLibrarySort}
          key={settings.defaultLibrarySort}
          notify={notify}
          onAddBook={() => setAddBookOpen(true)}
        />
      )
      break
    case 'book':
      active = 'book'
      content = <BookPage bookId={route.bookId} notify={notify} />
      break
    case 'editor':
      active = 'editor'
      content = <EditorPage bookId={route.bookId} chapterId={route.chapterId} notify={notify} />
      break
    case 'reader':
      return (
        <>
          <Suspense fallback={<PageFallback />}>
            <ReaderPage
              bookId={route.bookId}
              chapterId={route.chapterId}
              initialLocation={route.location}
              searchTerm={route.searchTerm}
              notify={notify}
              settings={settings}
              updateSettings={updateSettings}
            />
          </Suspense>
          {settingsError ? (
            <div className="global-error" role="alert">
              {settingsError}
            </div>
          ) : null}
          {toast ? <Toast message={toast} /> : null}
          {addBookOpen ? (
            <AddBookModal onClose={() => setAddBookOpen(false)} onCreated={handleCreated} />
          ) : null}
          {helpOpen ? (
            <HelpModal
              onClose={() => setHelpOpen(false)}
              onCreateBook={() => setAddBookOpen(true)}
            />
          ) : null}
        </>
      )
    case 'search':
      active = 'search'
      content = <SearchPage term={route.term} />
      break
    case 'trash':
      active = 'trash'
      content = <TrashPage notify={notify} />
      break
    case 'settings':
      active = 'settings'
      content = <SettingsPage notify={notify} settings={settings} updateSettings={updateSettings} />
      break
    default:
      content = (
        <div className="page">
          <ErrorState
            message="The address does not point to a Storybound page."
            title="This page is missing"
          />
          <Button
            className="not-found-home"
            icon={Home}
            onClick={() => navigate(routes.library())}
            variant="primary"
          >
            Return to Library
          </Button>
        </div>
      )
  }

  return (
    <>
      <AppShell
        active={active}
        key={route.name === 'search' ? `search:${route.term}` : route.name}
        onAddBook={() => setAddBookOpen(true)}
        onHelp={() => setHelpOpen(true)}
        searchTerm={route.name === 'search' ? route.term : ''}
      >
        {settingsError && route.name !== 'settings' ? (
          <div className="global-error" role="alert">
            <BookOpen aria-hidden="true" size={17} />
            Settings could not be loaded: {settingsError}
          </div>
        ) : null}
        <Suspense fallback={<PageFallback />}>{content}</Suspense>
      </AppShell>
      {addBookOpen ? (
        <AddBookModal onClose={() => setAddBookOpen(false)} onCreated={handleCreated} />
      ) : null}
      {helpOpen ? (
        <HelpModal onClose={() => setHelpOpen(false)} onCreateBook={() => setAddBookOpen(true)} />
      ) : null}
      {toast ? <Toast message={toast} /> : null}
    </>
  )
}

export default App
