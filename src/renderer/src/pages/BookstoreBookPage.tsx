import { ArrowLeft, Ban, BookOpen, Flag, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { AI_USES, BOOKSTORE_GENRES, CONTENT_WARNINGS, type StoreListing } from '@shared/bookstore'
import { BookCover } from '../components/BookCover'
import { ReportModal } from '../components/bookstore/ReportModal'
import { StoreGate, type StoreMember } from '../components/bookstore/StoreGate'
import { ParcelModal } from '../components/parcel/ParcelModal'
import { Button, ErrorState, InlineNotice, LoadingState, Modal } from '../components/ui'
import { readableError, storyboundApi, unwrap } from '../lib/api'
import { formatNumber } from '../lib/format'
import { navigate, routes } from '../lib/routing'

function labelOf<T extends { id: string; label: string }>(items: readonly T[], id: string): string {
  return items.find((item) => item.id === id)?.label ?? id
}

function Listing({
  listingId,
  member,
  notify
}: {
  listingId: string
  member: StoreMember
  notify: (message: string) => void
}): React.JSX.Element {
  const [listing, setListing] = useState<StoreListing | null>(null)
  const [error, setError] = useState('')
  const [unwrapping, setUnwrapping] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [reason, setReason] = useState('')
  const [suspending, setSuspending] = useState(false)
  const [suspendReason, setSuspendReason] = useState('')
  const [removeBooks, setRemoveBooks] = useState(true)

  const load = useCallback(async (): Promise<void> => {
    setError('')
    try {
      setListing(unwrap(await storyboundApi().bookstore.listing(listingId)))
    } catch (caught) {
      setError(readableError(caught))
    }
  }, [listingId])

  useEffect(() => {
    void Promise.resolve().then(load)
  }, [load])

  const open = useCallback(
    async () => unwrap(await storyboundApi().bookstore.openBook(listingId)),
    [listingId]
  )

  const remove = async (): Promise<void> => {
    try {
      unwrap(await storyboundApi().bookstore.remove({ listingId, reason }))
      notify('The book was removed from the Bookstore.')
      navigate(routes.bookstore())
    } catch (caught) {
      setError(readableError(caught))
      setRemoving(false)
    }
  }

  const suspend = async (): Promise<void> => {
    try {
      unwrap(
        await storyboundApi().bookstore.suspend({
          listingId,
          reason: suspendReason,
          removeBooks
        })
      )
      notify('The account was suspended.')
      navigate(routes.bookstoreReview())
    } catch (caught) {
      setError(readableError(caught))
      setSuspending(false)
    }
  }

  if (error) return <ErrorState message={error} onRetry={() => void load()} />
  if (!listing) return <LoadingState label="Opening the book…" />

  return (
    <>
      <section className="store-detail">
        <BookCover
          bookId={listing.id}
          coverImageUrl={listing.coverThumb}
          coverStyle={listing.coverStyle}
          size="hero"
          title={listing.title}
        />
        <div>
          <p className="eyebrow">{labelOf(BOOKSTORE_GENRES, listing.genre)}</p>
          <h1>{listing.title}</h1>
          {listing.subtitle ? <p className="store-detail__subtitle">{listing.subtitle}</p> : null}
          <p className="store-detail__author">by {listing.authorName}</p>
          <p className="store-detail__facts">
            {listing.chapterCount} {listing.chapterCount === 1 ? 'chapter' : 'chapters'} ·{' '}
            {formatNumber(listing.wordCount)} words · {labelOf(AI_USES, listing.aiUse)}
          </p>
          {listing.contentWarnings.length ? (
            <p className="store-detail__warnings">
              Content warnings:{' '}
              {listing.contentWarnings.map((item) => labelOf(CONTENT_WARNINGS, item)).join(', ')}
            </p>
          ) : null}
          <p className="store-detail__blurb">{listing.blurb}</p>
          <div className="store-detail__actions">
            {listing.libraryBookId ? (
              <Button
                icon={BookOpen}
                variant="primary"
                onClick={() => navigate(routes.book(listing.libraryBookId!))}
              >
                Open in your library
              </Button>
            ) : listing.mine ? (
              <InlineNotice tone="info">This is your book.</InlineNotice>
            ) : (
              <Button icon={Plus} variant="primary" onClick={() => setUnwrapping(true)}>
                Add to library
              </Button>
            )}
            {!listing.mine ? (
              <Button icon={Flag} variant="quiet" onClick={() => setReporting(true)}>
                Report
              </Button>
            ) : null}
            {member.isAdmin ? (
              <Button icon={Trash2} variant="danger" onClick={() => setRemoving(true)}>
                Remove
              </Button>
            ) : null}
            {member.isAdmin && !listing.mine ? (
              <Button icon={Ban} variant="danger" onClick={() => setSuspending(true)}>
                Suspend author
              </Button>
            ) : null}
          </div>
        </div>
      </section>
      {unwrapping ? (
        <ParcelModal
          collect={async () => unwrap(await storyboundApi().bookstore.collectBook(listingId))}
          collectLabel="Add to library"
          eyebrow="Bookstore"
          label={`${listing.title} from the Bookstore`}
          open={open}
          parcel={{
            title: listing.title,
            authorName: listing.authorName,
            chapterCount: listing.chapterCount,
            mode: 'read-only'
          }}
          wrappedHeading="Your book has arrived"
          onClose={() => setUnwrapping(false)}
          onCollected={(result) => {
            setUnwrapping(false)
            navigate(routes.book(result.bookId))
          }}
        />
      ) : null}
      {reporting ? (
        <ReportModal
          listingId={listing.id}
          title={listing.title}
          onClose={() => setReporting(false)}
          onSent={() => {
            setReporting(false)
            notify('Thank you. The report was sent.')
          }}
        />
      ) : null}
      {suspending ? (
        <Modal
          description="They can no longer read or publish in the Bookstore. The books in their library are not affected. You can lift this later on the Review page."
          onClose={() => setSuspending(false)}
          size="small"
          title={`Suspend ${listing.authorName}?`}
        >
          <label className="field">
            <span>Reason, shown to them</span>
            <textarea
              maxLength={2000}
              rows={3}
              value={suspendReason}
              onChange={(event) => setSuspendReason(event.target.value)}
            />
          </label>
          <label className="store-check">
            <input
              checked={removeBooks}
              type="checkbox"
              onChange={(event) => setRemoveBooks(event.target.checked)}
            />
            <span>
              Also remove all their books. Readers’ copies move to Trash, and this can’t be undone.
            </span>
          </label>
          <div className="modal__actions">
            <Button onClick={() => setSuspending(false)}>Cancel</Button>
            <Button
              disabled={!suspendReason.trim()}
              variant="danger"
              onClick={() => void suspend()}
            >
              Suspend
            </Button>
          </div>
        </Modal>
      ) : null}
      {removing ? (
        <Modal
          description="It leaves the Bookstore, and readers' copies move to their Trash. The reason is shown to them."
          onClose={() => setRemoving(false)}
          size="small"
          title={`Remove “${listing.title}”?`}
        >
          <label className="field">
            <span>Reason</span>
            <textarea
              maxLength={2000}
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <div className="modal__actions">
            <Button onClick={() => setRemoving(false)}>Cancel</Button>
            <Button disabled={!reason.trim()} variant="danger" onClick={() => void remove()}>
              Remove book
            </Button>
          </div>
        </Modal>
      ) : null}
    </>
  )
}

export function BookstoreBookPage({
  listingId,
  notify
}: {
  listingId: string
  notify: (message: string) => void
}): React.JSX.Element {
  return (
    <div className="page page--bookstore">
      <button className="store-back" onClick={() => navigate(routes.bookstore())}>
        <ArrowLeft aria-hidden="true" size={17} />
        Bookstore
      </button>
      <StoreGate>
        {(member) => <Listing listingId={listingId} member={member} notify={notify} />}
      </StoreGate>
    </div>
  )
}
