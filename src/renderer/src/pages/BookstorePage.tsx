import { ClipboardCheck, Search } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { BOOKSTORE_GENRES, type BookstoreGenre, type StoreCard } from '@shared/bookstore'
import { BookCover } from '../components/BookCover'
import { StoreGate, type StoreMember } from '../components/bookstore/StoreGate'
import { Button, ErrorState, LoadingState } from '../components/ui'
import { readableError, storyboundApi, unwrap } from '../lib/api'
import { formatNumber } from '../lib/format'
import { navigate, routes } from '../lib/routing'

type Sort = 'new' | 'popular'

function StoreBook({ book }: { book: StoreCard }): React.JSX.Element {
  return (
    <button className="store-book" onClick={() => navigate(routes.bookstoreBook(book.id))}>
      <BookCover
        bookId={book.id}
        coverImageUrl={book.coverThumb}
        coverStyle={book.coverStyle}
        title={book.title}
      />
      <strong>{book.title}</strong>
      <small>{book.authorName}</small>
      <small>
        {BOOKSTORE_GENRES.find((genre) => genre.id === book.genre)?.label} ·{' '}
        {formatNumber(book.wordCount)} words
      </small>
    </button>
  )
}

function Shelves({ member }: { member: StoreMember }): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [genre, setGenre] = useState<BookstoreGenre | null>(null)
  const [sort, setSort] = useState<Sort>('new')
  const [books, setBooks] = useState<StoreCard[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [page, setPage] = useState(0)
  const [error, setError] = useState('')

  const load = useCallback(
    async (nextPage: number): Promise<void> => {
      setError('')
      try {
        const result = unwrap(
          await storyboundApi().bookstore.browse({ query: search, genre, sort, page: nextPage })
        )
        setBooks((current) =>
          nextPage === 0 ? result.items : [...(current ?? []), ...result.items]
        )
        setHasMore(result.hasMore)
        setPage(nextPage)
      } catch (caught) {
        setError(readableError(caught))
      }
    },
    [genre, search, sort]
  )

  useEffect(() => {
    void Promise.resolve().then(() => load(0))
  }, [load])

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    setSearch(query.trim())
  }

  return (
    <>
      <div className="store-tools">
        <form role="search" onSubmit={submit}>
          <Search aria-hidden="true" size={17} />
          <input
            aria-label="Search the Bookstore"
            placeholder="Search by title or author"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </form>
        <select
          aria-label="Genre"
          value={genre ?? ''}
          onChange={(event) => setGenre((event.target.value || null) as BookstoreGenre | null)}
        >
          <option value="">All genres</option>
          {BOOKSTORE_GENRES.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Sort by"
          value={sort}
          onChange={(event) => setSort(event.target.value as Sort)}
        >
          <option value="new">Newest</option>
          <option value="popular">Most added</option>
        </select>
        {member.isAdmin ? (
          <Button icon={ClipboardCheck} onClick={() => navigate(routes.bookstoreReview())}>
            Review
          </Button>
        ) : null}
      </div>
      {error ? (
        <ErrorState message={error} onRetry={() => void load(0)} />
      ) : !books ? (
        <LoadingState label="Finding books…" />
      ) : books.length ? (
        <>
          <div className="store-grid">
            {books.map((book) => (
              <StoreBook book={book} key={book.id} />
            ))}
          </div>
          {hasMore ? (
            <div className="store-more">
              <Button onClick={() => void load(page + 1)}>Show more</Button>
            </div>
          ) : null}
        </>
      ) : (
        <section className="empty-filter">
          <h2>{search || genre ? 'Nothing found' : 'No books here yet'}</h2>
          <p>
            {search || genre
              ? 'Try another search or genre.'
              : 'Publish a book from its page in your library to be the first.'}
          </p>
        </section>
      )}
    </>
  )
}

export function BookstorePage(): React.JSX.Element {
  return (
    <div className="page page--bookstore">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Books from other readers</p>
          <h1>Bookstore</h1>
          <p>Find something new to read, or share a book of your own.</p>
        </div>
      </header>
      <StoreGate>{(member) => <Shelves member={member} />}</StoreGate>
    </div>
  )
}
