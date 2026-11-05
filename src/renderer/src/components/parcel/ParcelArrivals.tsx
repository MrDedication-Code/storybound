import { Package } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { ParcelResult, ParcelSummary } from '@shared/sharing'
import { readableError, storyboundApi, unwrap } from '../../lib/api'
import { navigate, routes } from '../../lib/routing'
import { Button, InlineNotice, Modal } from '../ui'
import { ParcelModal } from './ParcelModal'
import { playCollect } from './parcelSounds'

const CHECK_MILLISECONDS = 60_000

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function describeResult(result: ParcelResult): string {
  if (result.stale) return `“${result.title}” is already up to date.`
  const parts = [
    result.added ? `${plural(result.added, 'new chapter')} added` : '',
    result.revised ? `${plural(result.revised, 'chapter')} revised` : '',
    result.keptYours
      ? `${plural(result.keptYours, 'chapter')} you edited kept, with their version in Revisions`
      : ''
  ].filter(Boolean)
  return parts.length ? `${result.title}: ${parts.join(', ')}.` : `“${result.title}” is up to date.`
}

function announceChange(result: ParcelResult, message: string): void {
  window.dispatchEvent(
    new CustomEvent('storybound:content-changed', {
      detail: { bookId: result.bookId, chapterId: null, message }
    })
  )
}

/** Watches for parcels, and shows them when they arrive. Lives over every page. */
export function ParcelArrivals(): React.JSX.Element | null {
  const [parcels, setParcels] = useState<ParcelSummary[]>([])
  const [open, setOpen] = useState<ParcelSummary | null>(null)

  const check = useCallback(async (): Promise<void> => {
    const result = await storyboundApi().sharing.listParcels()
    // Being offline, or not using sync, is no reason to interrupt anyone.
    if (result.ok) setParcels(result.data)
  }, [])

  useEffect(() => {
    void Promise.resolve().then(check)
    const timer = window.setInterval(() => void check(), CHECK_MILLISECONDS)
    const onFocus = (): void => void check()
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [check])

  const finish = (parcel: ParcelSummary): void => {
    setOpen(null)
    setParcels((current) => current.filter((item) => item.id !== parcel.id))
  }

  const next = parcels[0]
  return (
    <>
      {next && !open ? (
        <button className="parcel-chip" onClick={() => setOpen(next)}>
          <span className="parcel-chip__box" aria-hidden="true">
            <Package size={22} />
          </span>
          <span>
            <strong>
              {next.kind === 'update'
                ? `${next.senderName} sent new chapters`
                : `${next.senderName} sent you a book`}
            </strong>
            <small>
              {next.title}
              {parcels.length > 1 ? ` · and ${parcels.length - 1} more` : ''}
            </small>
          </span>
        </button>
      ) : null}
      {open?.kind === 'book' ? (
        <ParcelModal
          parcel={open}
          onClose={() => setOpen(null)}
          onCollected={(result) => {
            finish(open)
            navigate(routes.book(result.bookId))
          }}
          onDeclined={() => finish(open)}
        />
      ) : null}
      {open?.kind === 'update' ? (
        <UpdateParcel parcel={open} onClose={() => setOpen(null)} onDone={() => finish(open)} />
      ) : null}
    </>
  )
}

function UpdateParcel({
  parcel,
  onClose,
  onDone
}: {
  parcel: ParcelSummary
  onClose: () => void
  onDone: () => void
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const add = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await storyboundApi().sharing.openParcel(parcel.id)
      const result = unwrap(await storyboundApi().sharing.acceptParcel(parcel.id))
      playCollect()
      announceChange(result, describeResult(result))
      onDone()
    } catch (caught) {
      setError(readableError(caught))
      setBusy(false)
    }
  }

  return (
    <Modal
      description={`${parcel.senderName} has added to “${parcel.title}”.`}
      onClose={onClose}
      size="small"
      title={
        parcel.newChapterCount
          ? plural(parcel.newChapterCount, 'new chapter')
          : 'An update to your book'
      }
    >
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      <p className="parcel-update__note">
        Your place, highlights and notes stay as they are.
        {parcel.mode === 'editable' ? ' Any chapter you changed keeps your version.' : ''}
      </p>
      <div className="modal__actions">
        <Button disabled={busy} onClick={onClose}>
          Later
        </Button>
        <Button disabled={busy} variant="primary" onClick={() => void add()}>
          {busy ? 'Adding…' : 'Add to my book'}
        </Button>
      </div>
    </Modal>
  )
}
