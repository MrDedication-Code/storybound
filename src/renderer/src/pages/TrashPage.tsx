import { ArchiveRestore, ArrowLeft, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { BookSummary } from '@shared/types'
import { readableError, storyboundApi, unwrap } from '../lib/api'
import { formatDate } from '../lib/format'
import { navigate, routes } from '../lib/routing'
import { BookCover } from '../components/BookCover'
import { Button, ConfirmDialog, ErrorState, InlineNotice, LoadingState } from '../components/ui'

interface TrashPageProps {
  notify: (message: string) => void
}

export function TrashPage({ notify }: TrashPageProps): React.JSX.Element {
  const [books, setBooks] = useState<BookSummary[] | null>(null)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [removeBook, setRemoveBook] = useState<BookSummary | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setError('')
    try {
      const all = unwrap(
        await storyboundApi().books.list({ includeArchived: true, sort: 'recently-updated' })
      )
      setBooks(all.filter((book) => book.isArchived))
    } catch (caught) {
      setError(readableError(caught))
    }
  }, [])

  useEffect(() => {
    void Promise.resolve().then(load)
  }, [load, reload])

  const restore = async (book: BookSummary): Promise<void> => {
    try {
      unwrap(await storyboundApi().books.restore(book.id))
      setBooks((current) => current?.filter((item) => item.id !== book.id) ?? null)
      notify(`Restored “${book.title}” to your Library.`)
    } catch (caught) {
      setError(readableError(caught))
    }
  }

  const removePermanently = async (): Promise<void> => {
    if (!removeBook) return
    setBusy(true)
    try {
      unwrap(await storyboundApi().books.removePermanently(removeBook.id))
      setBooks((current) => current?.filter((item) => item.id !== removeBook.id) ?? null)
      notify(`Permanently deleted “${removeBook.title}”.`)
      setRemoveBook(null)
    } catch (caught) {
      setError(readableError(caught))
      setRemoveBook(null)
    } finally {
      setBusy(false)
    }
  }

  if (error && !books)
    return (
      <div className="page">
        <ErrorState message={error} onRetry={() => setReload((value) => value + 1)} />
      </div>
    )

  return (
    <div className="page page--trash">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Recoverable books</p>
          <h1>Trash</h1>
          <p>Books remain here until you choose to delete them permanently.</p>
        </div>
      </header>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {!books ? (
        <LoadingState label="Opening Trash…" />
      ) : books.length ? (
        <ul className="trash-list">
          {books.map((book) => (
            <li key={book.id}>
              <BookCover
                bookId={book.id}
                coverImageUrl={book.coverImageUrl}
                coverPositionX={book.coverPositionX}
                coverPositionY={book.coverPositionY}
                coverStyle={book.coverStyle}
                size="compact"
                title={book.title}
              />
              <div>
                <strong>{book.title}</strong>
                <span>
                  {book.chapterCount} {book.chapterCount === 1 ? 'chapter' : 'chapters'} · Last
                  changed {formatDate(book.updatedAt)}
                </span>
              </div>
              <Button icon={ArchiveRestore} onClick={() => void restore(book)}>
                Restore
              </Button>
              <Button icon={Trash2} variant="danger" onClick={() => setRemoveBook(book)}>
                Delete permanently
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <section className="empty-filter">
          <Trash2 aria-hidden="true" size={32} />
          <h2>Trash is empty</h2>
          <p>Books moved here can be restored until you delete them permanently.</p>
          <Button icon={ArrowLeft} onClick={() => navigate(routes.library())}>
            Return to Library
          </Button>
        </section>
      )}
      {removeBook ? (
        <ConfirmDialog
          busy={busy}
          confirmLabel="Delete forever"
          dangerous
          description="This permanently deletes the book, every chapter, its cover, reading position, and bookmarks. This cannot be undone."
          onClose={() => setRemoveBook(null)}
          onConfirm={removePermanently}
          title={`Permanently delete “${removeBook.title}”?`}
        />
      ) : null}
    </div>
  )
}
