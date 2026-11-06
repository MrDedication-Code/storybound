import { ArrowLeft, Check, Flag, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  AI_USES,
  BOOKSTORE_GENRES,
  CONTENT_WARNINGS,
  REPORT_REASONS,
  type ReviewBook,
  type ReviewItem,
  type StoreReport,
  type SuspendedMember
} from '@shared/bookstore'
import { StoreGate } from '../components/bookstore/StoreGate'
import { StoryMarkdown } from '../components/StoryMarkdown'
import { Button, ErrorState, InlineNotice, LoadingState, Modal } from '../components/ui'
import { readableError, storyboundApi, unwrap } from '../lib/api'
import { formatDate, formatNumber } from '../lib/format'
import { navigate, routes } from '../lib/routing'

function labelOf(items: readonly { id: string; label: string }[], id: string): string {
  return items.find((item) => item.id === id)?.label ?? id
}

function ReviewBookModal({
  item,
  onClose,
  onDecided
}: {
  item: ReviewItem
  onClose: () => void
  onDecided: (queue: ReviewItem[]) => void
}): React.JSX.Element {
  const [book, setBook] = useState<ReviewBook | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const opened = unwrap(
          await storyboundApi().bookstore.readForReview({
            listingId: item.id,
            version: item.version
          })
        )
        if (!cancelled) setBook(opened)
      } catch (caught) {
        if (!cancelled) setError(readableError(caught))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [item.id, item.version])

  const decide = async (approve: boolean): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      onDecided(
        unwrap(
          await storyboundApi().bookstore.decide({
            listingId: item.id,
            version: item.version,
            approve,
            reason
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
      description={`by ${item.authorName} · ${labelOf(BOOKSTORE_GENRES, item.genre)} · ${labelOf(AI_USES, item.aiUse)}`}
      onClose={onClose}
      size="large"
      title={item.title}
    >
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {book?.titleMismatch ? (
        <InlineNotice tone="error">
          The file’s title, “{book.title}”, doesn’t match the listing.
        </InlineNotice>
      ) : null}
      <p className="store-review__blurb">{item.blurb}</p>
      {item.contentWarnings.length ? (
        <p>
          Warnings: {item.contentWarnings.map((id) => labelOf(CONTENT_WARNINGS, id)).join(', ')}
        </p>
      ) : null}
      {!book && !error ? <LoadingState label="Fetching the book…" /> : null}
      {book ? (
        <div className="store-review__text">
          {book.chapters.map((chapter, index) => (
            <article key={`${index}-${chapter.title}`}>
              <h3>{chapter.title}</h3>
              <StoryMarkdown>{chapter.content}</StoryMarkdown>
            </article>
          ))}
        </div>
      ) : null}
      <label className="field">
        <span>Reason, shown to the author if you don’t approve it</span>
        <textarea
          maxLength={2000}
          rows={2}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <div className="modal__actions">
        <Button
          disabled={busy || !reason.trim()}
          icon={X}
          variant="danger"
          onClick={() => void decide(false)}
        >
          Don’t approve
        </Button>
        <Button
          disabled={busy || !book}
          icon={Check}
          variant="primary"
          onClick={() => void decide(true)}
        >
          Approve
        </Button>
      </div>
    </Modal>
  )
}

function ReviewDesk({ notify }: { notify: (message: string) => void }): React.JSX.Element {
  const [queue, setQueue] = useState<ReviewItem[] | null>(null)
  const [reports, setReports] = useState<StoreReport[]>([])
  const [suspended, setSuspended] = useState<SuspendedMember[]>([])
  const [open, setOpen] = useState<ReviewItem | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async (): Promise<void> => {
    setError('')
    try {
      const [waiting, reported, blocked] = await Promise.all([
        storyboundApi().bookstore.reviewQueue(),
        storyboundApi().bookstore.reports(),
        storyboundApi().bookstore.suspended()
      ])
      setQueue(unwrap(waiting))
      setReports(unwrap(reported))
      setSuspended(unwrap(blocked))
    } catch (caught) {
      setError(readableError(caught))
    }
  }, [])

  useEffect(() => {
    void Promise.resolve().then(load)
  }, [load])

  const close = async (report: StoreReport): Promise<void> => {
    try {
      setReports(
        unwrap(
          await storyboundApi().bookstore.closeReport({
            reportId: report.id,
            outcome: 'No action needed'
          })
        )
      )
    } catch (caught) {
      setError(readableError(caught))
    }
  }

  const lift = async (member: SuspendedMember): Promise<void> => {
    try {
      setSuspended(unwrap(await storyboundApi().bookstore.unsuspend(member.ownerId)))
      notify('The suspension was lifted.')
    } catch (caught) {
      setError(readableError(caught))
    }
  }

  if (error) return <ErrorState message={error} onRetry={() => void load()} />
  if (!queue) return <LoadingState label="Opening the review queue…" />
  return (
    <>
      <section className="content-section" aria-labelledby="queue-heading">
        <h2 id="queue-heading">Waiting for review</h2>
        {queue.length ? (
          <ul className="store-list">
            {queue.map((item) => (
              <li key={`${item.id}-${item.version}`}>
                <span>
                  <strong>{item.title}</strong>
                  <small>
                    {item.authorName} · {formatNumber(item.wordCount)} words ·{' '}
                    {item.isUpdate ? 'Update' : 'New book'} · {formatDate(item.submittedAt)}
                  </small>
                </span>
                <Button onClick={() => setOpen(item)}>Read</Button>
              </li>
            ))}
          </ul>
        ) : (
          <p>Nothing is waiting.</p>
        )}
      </section>
      <section className="content-section" aria-labelledby="reports-heading">
        <h2 id="reports-heading">Reports</h2>
        {reports.length ? (
          <ul className="store-list">
            {reports.map((report) => (
              <li key={report.id}>
                <span>
                  <strong>{report.title ?? 'A book'}</strong>
                  <small>
                    {labelOf(REPORT_REASONS, report.reason)}
                    {report.detail ? ` · ${report.detail}` : ''}
                  </small>
                </span>
                <Button
                  icon={Flag}
                  onClick={() => navigate(routes.bookstoreBook(report.listingId))}
                >
                  Open
                </Button>
                <Button variant="quiet" onClick={() => void close(report)}>
                  No action
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p>No open reports.</p>
        )}
      </section>
      {suspended.length ? (
        <section className="content-section" aria-labelledby="suspended-heading">
          <h2 id="suspended-heading">Suspended</h2>
          <ul className="store-list">
            {suspended.map((member) => (
              <li key={member.ownerId}>
                <span>
                  <strong>{member.penName ?? 'A reader'}</strong>
                  <small>
                    {formatDate(member.suspendedAt)}
                    {member.reason ? ` · ${member.reason}` : ''}
                  </small>
                </span>
                <Button variant="quiet" onClick={() => void lift(member)}>
                  Lift
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {open ? (
        <ReviewBookModal
          item={open}
          onClose={() => setOpen(null)}
          onDecided={(next) => {
            setQueue(next)
            setOpen(null)
            notify('Decision saved.')
          }}
        />
      ) : null}
    </>
  )
}

export function BookstoreReviewPage({
  notify
}: {
  notify: (message: string) => void
}): React.JSX.Element {
  return (
    <div className="page page--bookstore">
      <button className="store-back" onClick={() => navigate(routes.bookstore())}>
        <ArrowLeft aria-hidden="true" size={17} />
        Bookstore
      </button>
      <header className="page-heading">
        <div>
          <p className="eyebrow">Bookstore</p>
          <h1>Review</h1>
        </div>
      </header>
      <StoreGate>
        {(member) =>
          member.isAdmin ? (
            <ReviewDesk notify={notify} />
          ) : (
            <InlineNotice tone="error">This page is only for reviewers.</InlineNotice>
          )
        }
      </StoreGate>
    </div>
  )
}
