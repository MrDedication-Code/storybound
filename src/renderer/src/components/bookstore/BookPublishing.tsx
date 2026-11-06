import { Store } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  AI_USES,
  BOOKSTORE_GENRES,
  CONTENT_WARNINGS,
  type AiUse,
  type BookstoreGenre,
  type BookstoreStatus,
  type ContentWarning,
  type MyListing
} from '@shared/bookstore'
import type { BookDetail } from '@shared/types'
import { readableError, storyboundApi, unwrap } from '../../lib/api'
import { navigate, routes } from '../../lib/routing'
import { Button, InlineNotice, Modal } from '../ui'

function statusLine(listing: MyListing): string {
  if (listing.status === 'removed') {
    return `Removed from the Bookstore. ${listing.removalReason ?? ''}`
  }
  if (listing.status === 'withdrawn') return 'Withdrawn. New readers can no longer add it.'
  if (listing.latestStatus === 'rejected') {
    return `Not approved. ${listing.latestReason ?? ''}`
  }
  if (listing.latestStatus === 'pending') {
    return listing.status === 'live'
      ? 'Live. An update is waiting for review.'
      : 'Waiting for review.'
  }
  const readers = `${listing.addCount} ${listing.addCount === 1 ? 'reader has' : 'readers have'}`
  return `Live in the Bookstore. ${readers} added it.`
}

function PublishModal({
  book,
  listing,
  penName,
  onClose,
  onPublished
}: {
  book: BookDetail
  listing: MyListing | null
  penName: string | null
  onClose: () => void
  onPublished: (listings: MyListing[]) => void
}): React.JSX.Element {
  const [name, setName] = useState(penName ?? '')
  const [blurb, setBlurb] = useState(listing?.blurb ?? book.blurb ?? '')
  const [genre, setGenre] = useState<BookstoreGenre>(listing?.genre ?? 'fantasy')
  const [warnings, setWarnings] = useState<ContentWarning[]>(listing?.contentWarnings ?? [])
  const [aiUse, setAiUse] = useState<AiUse>(listing?.aiUse ?? 'assisted')
  const [rights, setRights] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ready = rights && name.trim().length >= 2 && blurb.trim().length >= 20

  const toggleWarning = (warning: ContentWarning): void =>
    setWarnings((current) =>
      current.includes(warning) ? current.filter((item) => item !== warning) : [...current, warning]
    )

  const publish = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      if (name.trim() !== penName) unwrap(await storyboundApi().bookstore.setPenName(name.trim()))
      onPublished(
        unwrap(
          await storyboundApi().bookstore.publish({
            bookId: book.id,
            blurb: blurb.trim(),
            genre,
            contentWarnings: warnings,
            aiUse,
            rightsConfirmed: true
          })
        )
      )
    } catch (caught) {
      setError(readableError(caught))
      setBusy(false)
    }
  }

  return (
    <Modal
      description="Every book is checked before it appears in the Bookstore."
      onClose={onClose}
      size="medium"
      title={listing ? `Update “${book.title}”` : `Publish “${book.title}”`}
    >
      <InlineNotice tone="info">
        A published book is public. Anyone with an account can read it, and it is stored in a way
        Storybound can read, unlike the books you sync.
      </InlineNotice>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      <div className="form-grid">
        <label className="field">
          <span>Pen name</span>
          <input maxLength={60} value={name} onChange={(event) => setName(event.target.value)} />
          <small>Shown on your books. It can be your real name, but it doesn’t have to be.</small>
        </label>
        <label className="field">
          <span>Blurb</span>
          <textarea
            maxLength={4000}
            rows={5}
            value={blurb}
            onChange={(event) => setBlurb(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Genre</span>
          <select
            value={genre}
            onChange={(event) => setGenre(event.target.value as BookstoreGenre)}
          >
            {BOOKSTORE_GENRES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="store-options">
          <legend>Content warnings</legend>
          {CONTENT_WARNINGS.map((item) => (
            <label className="store-check" key={item.id}>
              <input
                checked={warnings.includes(item.id)}
                type="checkbox"
                onChange={() => toggleWarning(item.id)}
              />
              <span>{item.label}</span>
            </label>
          ))}
        </fieldset>
        <fieldset className="store-options store-options--stacked">
          <legend>How was AI used?</legend>
          {AI_USES.map((item) => (
            <label className="store-check" key={item.id}>
              <input
                checked={aiUse === item.id}
                name="ai-use"
                type="radio"
                onChange={() => setAiUse(item.id)}
              />
              <span>
                {item.label}
                <small>{item.detail}</small>
              </span>
            </label>
          ))}
        </fieldset>
        <label className="store-check">
          <input
            checked={rights}
            type="checkbox"
            onChange={(event) => setRights(event.target.checked)}
          />
          <span>
            I have the right to publish this book, it follows the Bookstore rules, and I agree that
            readers may have it read aloud by AI voices, including Google’s.
          </span>
        </label>
      </div>
      <div className="modal__actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button disabled={!ready || busy} variant="primary" onClick={() => void publish()}>
          {busy ? 'Publishing…' : 'Send for review'}
        </Button>
      </div>
    </Modal>
  )
}

/** Publishing a book of your own, and how it is getting on. */
export function BookPublishing({
  book,
  notify
}: {
  book: BookDetail
  notify: (message: string) => void
}): React.JSX.Element | null {
  const [status, setStatus] = useState<BookstoreStatus | null>(null)
  const [listings, setListings] = useState<MyListing[]>([])
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (): Promise<void> => {
    const current = await storyboundApi().bookstore.status()
    if (!current.ok) return
    setStatus(current.data)
    if (current.data.phase === 'signed-in' && current.data.joined) {
      const mine = await storyboundApi().bookstore.myListings()
      if (mine.ok) setListings(mine.data)
    }
  }, [])

  useEffect(() => {
    void Promise.resolve().then(load)
  }, [load])

  const withdraw = async (listing: MyListing): Promise<void> => {
    setError('')
    try {
      setListings(unwrap(await storyboundApi().bookstore.withdraw(listing.id)))
      notify('Withdrawn. People who already have it keep their copy.')
    } catch (caught) {
      setError(readableError(caught))
    }
  }

  if (!status || status.phase === 'unavailable') return null
  const listing = listings.find((item) => item.sourceBookId === book.id) ?? null
  const member = status.phase === 'signed-in' && status.joined
  return (
    <section className="content-section" aria-labelledby="publish-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Bookstore</p>
          <h2 id="publish-heading">Share it with everyone</h2>
        </div>
      </div>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      <p className="store-publish__status">
        {listing ? statusLine(listing) : 'Publish this book for anyone with an account to read.'}
      </p>
      <div className="store-publish__actions">
        {!member ? (
          <Button icon={Store} onClick={() => navigate(routes.bookstore())}>
            Open the Bookstore
          </Button>
        ) : listing?.status !== 'removed' ? (
          <Button icon={Store} onClick={() => setOpen(true)}>
            {listing ? 'Send an update' : 'Publish to the Bookstore'}
          </Button>
        ) : null}
        {listing && listing.status !== 'withdrawn' && listing.status !== 'removed' ? (
          <Button variant="quiet" onClick={() => void withdraw(listing)}>
            Withdraw
          </Button>
        ) : null}
      </div>
      {open && status.phase === 'signed-in' ? (
        <PublishModal
          book={book}
          listing={listing}
          penName={status.penName}
          onClose={() => setOpen(false)}
          onPublished={(next) => {
            setListings(next)
            setOpen(false)
            void load()
            notify('Sent for review. You will see the result here.')
          }}
        />
      ) : null}
    </section>
  )
}
