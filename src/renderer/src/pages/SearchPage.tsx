import { ArrowRight, BookOpen, FileText, Search, SearchX, Users } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { SearchResult } from '@shared/types'
import { readableError, storyboundApi, unwrap } from '../lib/api'
import { navigate, routes } from '../lib/routing'
import { Button, ErrorState, InlineNotice, LoadingState } from '../components/ui'

export function SearchPage({ term }: { term: string }): React.JSX.Element {
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)

  const load = useCallback(async (): Promise<void> => {
    if (!term.trim()) {
      setResults([])
      return
    }
    setError('')
    try {
      setResults(unwrap(await storyboundApi().search.query(term)))
    } catch (caught) {
      setError(readableError(caught))
    }
  }, [term])

  useEffect(() => {
    void Promise.resolve().then(load)
  }, [load, reload])

  if (error && !results)
    return (
      <div className="page">
        <ErrorState message={error} onRetry={() => setReload((value) => value + 1)} />
      </div>
    )

  const bookResults = results?.filter((result) => result.type === 'book') ?? []
  const chapterResults = results?.filter((result) => result.type === 'chapter') ?? []
  const referenceResults = results?.filter((result) => result.type === 'story-entity') ?? []

  return (
    <div className="page page--search">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Across every shelf</p>
          <h1>Search results</h1>
          <p>
            {term ? (
              <>
                Matches for <strong>“{term}”</strong>
              </>
            ) : (
              'Enter a title, chapter, or phrase in the search field.'
            )}
          </p>
        </div>
        {results ? (
          <span className="book-count">
            {results.length} {results.length === 1 ? 'result' : 'results'}
          </span>
        ) : null}
      </header>
      {error && results ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {!results ? (
        <LoadingState label="Searching your library…" />
      ) : !term ? (
        <div className="empty-filter">
          <Search size={32} />
          <h2>What are you looking for?</h2>
          <p>Search by book title, chapter name, or any remembered line.</p>
        </div>
      ) : !results.length ? (
        <div className="empty-filter">
          <SearchX size={32} />
          <h2>No passages found</h2>
          <p>Try a shorter phrase or check the spelling.</p>
          <Button onClick={() => navigate(routes.library())}>Return to Library</Button>
        </div>
      ) : (
        <div className="search-groups">
          {bookResults.length ? (
            <section>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Books</p>
                  <h2>
                    {bookResults.length} {bookResults.length === 1 ? 'match' : 'matches'}
                  </h2>
                </div>
              </div>
              <ul className="search-results">
                {bookResults.map((result, index) => (
                  <SearchResultRow
                    key={`${result.bookId}:${index}`}
                    onError={setError}
                    result={result}
                    term={term}
                  />
                ))}
              </ul>
            </section>
          ) : null}
          {chapterResults.length ? (
            <section>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Chapters & passages</p>
                  <h2>
                    {chapterResults.length} {chapterResults.length === 1 ? 'match' : 'matches'}
                  </h2>
                </div>
              </div>
              <ul className="search-results">
                {chapterResults.map((result, index) => (
                  <SearchResultRow
                    key={`${result.chapterId}:${index}`}
                    onError={setError}
                    result={result}
                    term={term}
                  />
                ))}
              </ul>
            </section>
          ) : null}
          {referenceResults.length ? (
            <section>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Story bible & timeline</p>
                  <h2>
                    {referenceResults.length} {referenceResults.length === 1 ? 'match' : 'matches'}
                  </h2>
                </div>
              </div>
              <ul className="search-results">
                {referenceResults.map((result, index) => (
                  <SearchResultRow
                    key={`${result.storyEntityId}:${index}`}
                    onError={setError}
                    result={result}
                    term={term}
                  />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </div>
  )
}

function SearchResultRow({
  result,
  term,
  onError
}: {
  result: SearchResult
  term: string
  onError: (message: string) => void
}): React.JSX.Element {
  const [opening, setOpening] = useState(false)
  const openResult = async (): Promise<void> => {
    if (!result.chapterId) {
      navigate(routes.book(result.bookId))
      return
    }
    setOpening(true)
    onError('')
    try {
      const hit = unwrap(await storyboundApi().search.locate({ chapterId: result.chapterId, term }))
      navigate(routes.reader(result.bookId, result.chapterId, hit.location, hit.matchedTerm))
    } catch (caught) {
      onError(readableError(caught))
    } finally {
      setOpening(false)
    }
  }
  return (
    <li>
      <button disabled={opening} onClick={() => void openResult()}>
        <span className="search-result__icon">
          {result.type === 'book' ? (
            <BookOpen aria-hidden="true" size={20} />
          ) : result.type === 'story-entity' ? (
            <Users aria-hidden="true" size={20} />
          ) : (
            <FileText aria-hidden="true" size={20} />
          )}
        </span>
        <span className="search-result__copy">
          <span>
            {result.bookTitle}
            {result.chapterTitle ? ` · ${result.chapterTitle}` : ''}
          </span>
          <strong>{result.type === 'book' ? result.bookTitle : result.chapterTitle}</strong>
          <small>
            {result.excerpt ? (
              <HighlightText term={term} text={result.excerpt} />
            ) : (
              'Open this result in Storybound.'
            )}
          </small>
        </span>
        <ArrowRight aria-hidden="true" size={18} />
      </button>
    </li>
  )
}

function HighlightText({ text, term }: { text: string; term: string }): React.JSX.Element {
  if (!term) return <>{text}</>
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? <mark key={`${part}:${index}`}>{part}</mark> : part
      )}
    </>
  )
}
