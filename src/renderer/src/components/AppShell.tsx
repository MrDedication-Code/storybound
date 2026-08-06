import {
  BookOpen,
  CircleHelp,
  LibraryBig,
  Menu,
  Plus,
  Search,
  Settings,
  Trash2,
  X
} from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { navigate, routes } from '../lib/routing'
import { Button, IconButton, VisuallyHidden } from './ui'

interface AppShellProps {
  active: 'library' | 'book' | 'editor' | 'search' | 'trash' | 'settings'
  children: ReactNode
  onAddBook: () => void
  onHelp: () => void
  searchTerm?: string
}

export function AppShell({
  active,
  children,
  onAddBook,
  onHelp,
  searchTerm = ''
}: AppShellProps): React.JSX.Element {
  const [query, setQuery] = useState(searchTerm)
  const [navOpen, setNavOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const focusSearch = (): void => searchRef.current?.focus()
    window.addEventListener('storybound:focus-search', focusSearch)
    return () => window.removeEventListener('storybound:focus-search', focusSearch)
  }, [])

  useEffect(() => {
    if (active === 'search') searchRef.current?.focus()
  }, [active])

  const submitSearch = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const clean = query.trim()
    if (clean) navigate(routes.search(clean))
  }

  const go = (path: string): void => {
    navigate(path)
    setNavOpen(false)
  }

  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault()
          const mainContent = document.getElementById('main-content')
          mainContent?.focus()
          mainContent?.scrollIntoView({ block: 'start' })
        }}
      >
        Skip to content
      </a>
      <aside
        className={`sidebar ${navOpen ? 'sidebar--open' : ''}`}
        aria-label="Primary navigation"
      >
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            <BookOpen size={21} />
          </span>
          <div>
            <strong>Storybound</strong>
            <span>Personal library</span>
          </div>
          <IconButton
            className="sidebar__close"
            icon={X}
            label="Close navigation"
            onClick={() => setNavOpen(false)}
          />
        </div>
        <nav className="nav-list">
          <button
            aria-current={
              active === 'library' || active === 'book' || active === 'editor' ? 'page' : undefined
            }
            className={
              active === 'library' || active === 'book' || active === 'editor' ? 'is-active' : ''
            }
            onClick={() => go(routes.library())}
          >
            <LibraryBig aria-hidden="true" size={19} />
            Library
          </button>
          <button
            aria-current={active === 'trash' ? 'page' : undefined}
            className={active === 'trash' ? 'is-active' : ''}
            onClick={() => go(routes.trash())}
          >
            <Trash2 aria-hidden="true" size={19} />
            Trash
          </button>
          <button
            aria-current={active === 'settings' ? 'page' : undefined}
            className={active === 'settings' ? 'is-active' : ''}
            onClick={() => go(routes.settings())}
          >
            <Settings aria-hidden="true" size={19} />
            Settings
          </button>
          <button
            onClick={() => {
              onHelp()
              setNavOpen(false)
            }}
          >
            <CircleHelp aria-hidden="true" size={19} />
            Getting started
          </button>
        </nav>
        <div className="sidebar__footer">
          <p>Local by design</p>
          <span>Online only when you explicitly approve an AI request.</span>
        </div>
      </aside>

      {navOpen ? (
        <button
          aria-label="Close navigation"
          className="sidebar-scrim"
          onClick={() => setNavOpen(false)}
        />
      ) : null}

      <div className="app-main">
        <header className="topbar">
          <IconButton
            className="menu-button"
            icon={Menu}
            label="Open navigation"
            onClick={() => setNavOpen(true)}
          />
          <form className="global-search" role="search" onSubmit={submitSearch}>
            <VisuallyHidden>
              <label htmlFor="global-search">Search all books and chapters</label>
            </VisuallyHidden>
            <Search aria-hidden="true" size={18} />
            <input
              id="global-search"
              ref={searchRef}
              autoComplete="off"
              placeholder="Search your library…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <kbd>⌘ K</kbd>
          </form>
          <Button icon={Plus} onClick={onAddBook} variant="primary">
            Add book
          </Button>
        </header>
        <main data-route-main id="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  )
}

export function Toast({ message }: { message: string }): React.JSX.Element {
  return (
    <div aria-live="polite" className="toast" role="status">
      {message}
    </div>
  )
}
