import { Send, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { BookShare } from '@shared/sharing'
import { readableError, storyboundApi, unwrap } from '../../lib/api'
import { formatDate } from '../../lib/format'
import { Button, IconButton, InlineNotice } from '../ui'
import { playWhoosh } from './parcelSounds'

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function whatChanged(share: BookShare): string {
  const parts = [
    share.newChapters ? plural(share.newChapters, 'new chapter') : '',
    share.changedChapters ? plural(share.changedChapters, 'revised chapter') : '',
    share.removedChapters ? plural(share.removedChapters, 'removed chapter') : '',
    share.detailsChanged ? 'new details' : ''
  ].filter(Boolean)
  return parts.join(', ')
}

/** Who this book has gone to, and a way to send them what they have not had yet. */
export function BookSharing({
  bookId,
  refreshKey,
  notify
}: {
  bookId: string
  refreshKey: number
  notify: (message: string) => void
}): React.JSX.Element | null {
  const [shares, setShares] = useState<BookShare[]>([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async (): Promise<void> => {
    const result = await storyboundApi().sharing.listShares(bookId)
    if (result.ok) setShares(result.data)
  }, [bookId])

  useEffect(() => {
    void Promise.resolve().then(load)
  }, [load, refreshKey])

  const sendUpdate = async (share: BookShare): Promise<void> => {
    setBusy(share.id)
    setError('')
    try {
      unwrap(await storyboundApi().sharing.sendUpdate({ shareId: share.id }))
      playWhoosh()
      notify(`Sent to ${share.contact.name}.`)
      await load()
    } catch (caught) {
      setError(readableError(caught))
    } finally {
      setBusy('')
    }
  }

  const stop = async (share: BookShare): Promise<void> => {
    try {
      unwrap(await storyboundApi().sharing.stop(share.id))
      notify(`You can no longer send updates to ${share.contact.name}. They keep their copy.`)
      await load()
    } catch (caught) {
      setError(readableError(caught))
    }
  }

  if (!shares.length) return null
  return (
    <section className="content-section" aria-labelledby="sharing-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Shared</p>
          <h2 id="sharing-heading">Who has this book</h2>
        </div>
      </div>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      <ul className="share-list">
        {shares.map((share) => {
          const changes = whatChanged(share)
          return (
            <li key={share.id}>
              <span>
                <strong>{share.contact.name}</strong>
                <small>
                  {share.mode === 'read-only' ? 'Read only' : 'Editable'} · Last sent{' '}
                  {formatDate(share.lastSentAt)}
                  {changes ? ` · ${changes} to send` : ' · Up to date'}
                </small>
              </span>
              <Button
                disabled={Boolean(busy) || !changes}
                icon={Send}
                variant={changes ? 'primary' : 'secondary'}
                onClick={() => void sendUpdate(share)}
              >
                {busy === share.id ? 'Sending…' : 'Send update'}
              </Button>
              <IconButton
                disabled={Boolean(busy)}
                icon={Trash2}
                label={`Stop sending updates to ${share.contact.name}`}
                onClick={() => void stop(share)}
              />
            </li>
          )
        })}
      </ul>
    </section>
  )
}
