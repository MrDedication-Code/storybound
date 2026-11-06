import { useEffect, useState } from 'react'
import type { MyListing } from '@shared/bookstore'
import type { BookSummary } from '@shared/types'
import { readableError, storyboundApi, unwrap } from '../../lib/api'
import { Button, InlineNotice, LoadingState, Modal } from '../ui'
import { PublishModal } from './BookPublishing'

/** Choosing one of your own books to publish, without leaving the Bookstore. */
export function PublishPicker({
  penName,
  onClose,
  onPublished
}: {
  penName: string | null
  onClose: () => void
  onPublished: () => void
}): React.JSX.Element {
  const [books, setBooks] = useState<BookSummary[] | null>(null)
  const [listings, setListings] = useState<MyListing[]>([])
  const [chosen, setChosen] = useState<BookSummary | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = async (): Promise<void> => {
      try {
        const [mine, published] = await Promise.all([
          storyboundApi().books.list({ sort: 'title', limit: 1000 }),
          storyboundApi().bookstore.myListings()
        ])
        const nextListings = unwrap(published)
        const removed = new Set(
          nextListings.filter((item) => item.status === 'removed').map((item) => item.sourceBookId)
        )
        setListings(nextListings)
        setBooks(unwrap(mine).filter((book) => !book.share && !removed.has(book.id)))
      } catch (caught) {
        setError(readableError(caught))
      }
    }
    void load()
  }, [])

  if (chosen) {
    return (
      <PublishModal
        book={chosen}
        listing={listings.find((item) => item.sourceBookId === chosen.id) ?? null}
        penName={penName}
        onClose={onClose}
        onPublished={onPublished}
      />
    )
  }

  return (
    <Modal
      description="Choose one of your own books. It is checked before it appears."
      onClose={onClose}
      size="medium"
      title="Publish a book"
    >
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {!books && !error ? <LoadingState label="Finding your books…" /> : null}
      {books?.length === 0 ? <p>You have no books of your own to publish yet.</p> : null}
      {books?.length ? (
        <ul className="store-picker">
          {books.map((book) => (
            <li key={book.id}>
              <Button onClick={() => setChosen(book)}>
                {book.title}
                {listings.some((item) => item.sourceBookId === book.id) ? ' (published)' : ''}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </Modal>
  )
}
