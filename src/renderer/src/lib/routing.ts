import { useSyncExternalStore } from 'react'

export type Route =
  | { name: 'library' }
  | { name: 'book'; bookId: string }
  | { name: 'editor'; bookId: string; chapterId?: string }
  | {
      name: 'reader'
      bookId: string
      chapterId?: string
      location?: number
      searchTerm?: string
    }
  | { name: 'search'; term: string }
  | { name: 'trash' }
  | { name: 'settings' }
  | { name: 'not-found' }

export interface BeforeNavigateDetail {
  path: string
}

interface NavigateOptions {
  bypassGuard?: boolean
  replace?: boolean
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

function snapshot(): string {
  return window.location.hash || '#/library'
}

export function useRoute(): Route {
  return parseRoute(useSyncExternalStore(subscribe, snapshot, () => '#/library'))
}

export function parseRoute(hash: string): Route {
  const value = hash.replace(/^#/, '') || '/library'
  const [pathname, queryString = ''] = value.split('?')
  const segments = pathname.split('/').filter(Boolean).map(decodeURIComponent)

  if (segments.length === 0 || segments[0] === 'library') return { name: 'library' }
  if (segments[0] === 'book' && segments[1]) return { name: 'book', bookId: segments[1] }
  if (segments[0] === 'edit' && segments[1]) {
    return { name: 'editor', bookId: segments[1], chapterId: segments[2] }
  }
  if (segments[0] === 'read' && segments[1]) {
    const rawLocation = new URLSearchParams(queryString).get('at')
    const parsedLocation = rawLocation === null ? undefined : Number(rawLocation)
    const location =
      parsedLocation !== undefined && Number.isFinite(parsedLocation)
        ? Math.min(1, Math.max(0, parsedLocation))
        : undefined
    const searchTerm = new URLSearchParams(queryString).get('find')?.trim() || undefined
    return { name: 'reader', bookId: segments[1], chapterId: segments[2], location, searchTerm }
  }
  if (segments[0] === 'search') {
    return { name: 'search', term: new URLSearchParams(queryString).get('q') ?? '' }
  }
  if (segments[0] === 'trash') return { name: 'trash' }
  if (segments[0] === 'settings') return { name: 'settings' }
  return { name: 'not-found' }
}

export function navigate(path: string, options: NavigateOptions = {}): void {
  if (!options.bypassGuard) {
    const allowed = window.dispatchEvent(
      new CustomEvent<BeforeNavigateDetail>('storybound:before-navigate', {
        cancelable: true,
        detail: { path }
      })
    )
    if (!allowed) return
  }
  const next = path.startsWith('#') ? path : `#${path.startsWith('/') ? path : `/${path}`}`
  if (window.location.hash === next) {
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  } else if (options.replace) {
    window.history.replaceState(null, '', next)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  } else {
    window.location.hash = next
  }
}

export const routes = {
  library: (): string => '/library',
  book: (bookId: string): string => `/book/${encodeURIComponent(bookId)}`,
  editor: (bookId: string, chapterId?: string): string =>
    `/edit/${encodeURIComponent(bookId)}${chapterId ? `/${encodeURIComponent(chapterId)}` : ''}`,
  reader: (bookId: string, chapterId?: string, location?: number, searchTerm?: string): string => {
    const query = new URLSearchParams()
    if (location !== undefined) query.set('at', String(Math.min(1, Math.max(0, location))))
    if (searchTerm?.trim()) query.set('find', searchTerm.trim())
    const queryString = query.toString()
    return `/read/${encodeURIComponent(bookId)}${chapterId ? `/${encodeURIComponent(chapterId)}` : ''}${queryString ? `?${queryString}` : ''}`
  },
  search: (term: string): string => `/search?q=${encodeURIComponent(term)}`,
  trash: (): string => '/trash',
  settings: (): string => '/settings'
}
