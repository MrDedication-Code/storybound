import { Lock, PenLine, Send } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { BookDetail } from '@shared/types'
import type { ShareContact, ShareMode, SharingStatus } from '@shared/sharing'
import { readableError, storyboundApi, unwrap } from '../../lib/api'
import { navigate, routes } from '../../lib/routing'
import { Button, InlineNotice, Modal } from '../ui'
import type { BookDetails } from './bookModel'
import { playPaper, playWhoosh } from './parcelSounds'
import { useParcelScene } from './useParcelScene'

interface ShareBookModalProps {
  book: BookDetail
  onClose: () => void
  onSent: () => void
}

/** Chooses who a book goes to and how, then wraps it up and sends it. */
export function ShareBookModal({ book, onClose, onSent }: ShareBookModalProps): React.JSX.Element {
  const [status, setStatus] = useState<SharingStatus | null>(null)
  const [contacts, setContacts] = useState<ShareContact[]>([])
  const [contact, setContact] = useState('')
  const [address, setAddress] = useState('')
  const [name, setName] = useState('')
  const [senderName, setSenderName] = useState('')
  const [mode, setMode] = useState<ShareMode>('read-only')
  const [bibleChoice, setBibleChoice] = useState<boolean | null>(null)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [nextStatus, nextContacts] = await Promise.all([
          storyboundApi().sharing.status(),
          storyboundApi().sharing.contacts()
        ])
        if (cancelled) return
        const loaded = unwrap(nextStatus)
        setStatus(loaded)
        setSenderName((current) => current || loaded.senderName)
        setContacts(unwrap(nextContacts))
      } catch (caught) {
        if (!cancelled) setError(readableError(caught))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const includeBible = bibleChoice ?? mode === 'editable'
  const chosen = contacts.find((item) => item.address === contact)
  const recipientName = chosen?.name ?? name.trim()
  const recipientAddress = chosen?.address ?? address
  const ready = Boolean(senderName.trim() && recipientName && recipientAddress.trim())

  if (sending) {
    return (
      <SendingParcel
        book={book}
        input={{
          bookId: book.id,
          address: recipientAddress,
          name: recipientName,
          senderName: senderName.trim(),
          mode,
          includeBible
        }}
        recipient={recipientName}
        onDone={onSent}
        onFailed={(message) => {
          setError(message)
          setSending(false)
        }}
      />
    )
  }

  return (
    <Modal
      description="It goes privately, wrapped so that only they can open it."
      onClose={onClose}
      size="medium"
      title={`Send “${book.title}”`}
    >
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {status && !status.available ? (
        <>
          <InlineNotice tone="info">
            Sending a book needs sync. Turn it on in Settings → Sync & devices, then come back.
          </InlineNotice>
          <div className="modal__actions">
            <Button onClick={onClose}>Close</Button>
            <Button
              variant="primary"
              onClick={() => {
                onClose()
                navigate(routes.settings())
              }}
            >
              Open Settings
            </Button>
          </div>
        </>
      ) : (
        <form
          className="share-form"
          onSubmit={(event) => {
            event.preventDefault()
            if (ready) setSending(true)
          }}
        >
          <label>
            <span>Your name, as they will see it</span>
            <input
              maxLength={120}
              value={senderName}
              onChange={(event) => setSenderName(event.target.value)}
            />
          </label>
          {contacts.length ? (
            <label>
              <span>Send to</span>
              <select value={contact} onChange={(event) => setContact(event.target.value)}>
                <option value="">Someone new</option>
                {contacts.map((item) => (
                  <option key={item.address} value={item.address}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {!chosen ? (
            <div className="share-form__pair">
              <label>
                <span>Their name</span>
                <input
                  maxLength={120}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label>
                <span>Their Storybound address</span>
                <input
                  placeholder="K7QM-2XPD-9RTA-HF4W"
                  spellCheck={false}
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                />
              </label>
            </div>
          ) : null}
          <fieldset className="share-form__modes">
            <legend>What they can do</legend>
            <label className={mode === 'read-only' ? 'is-chosen' : undefined}>
              <input
                checked={mode === 'read-only'}
                name="share-mode"
                type="radio"
                onChange={() => setMode('read-only')}
              />
              <Lock aria-hidden="true" size={18} />
              <span>
                <strong>Read only</strong>
                <small>They can read, highlight and listen, but not change it.</small>
              </span>
            </label>
            <label className={mode === 'editable' ? 'is-chosen' : undefined}>
              <input
                checked={mode === 'editable'}
                name="share-mode"
                type="radio"
                onChange={() => setMode('editable')}
              />
              <PenLine aria-hidden="true" size={18} />
              <span>
                <strong>Editable</strong>
                <small>They get their own copy to change. Yours stays as it is.</small>
              </span>
            </label>
          </fieldset>
          <label className="switch-row">
            <span>
              <strong>Include the story bible</strong>
              <small>
                {mode === 'read-only'
                  ? 'Off for readers, because it can spoil what happens next.'
                  : 'Useful for someone working on the book with you.'}
              </small>
            </span>
            <input
              checked={includeBible}
              type="checkbox"
              onChange={(event) => setBibleChoice(event.target.checked)}
            />
          </label>
          <div className="modal__actions">
            <Button onClick={onClose}>Cancel</Button>
            <Button disabled={!ready} icon={Send} type="submit" variant="primary">
              Wrap and send
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}

function SendingParcel({
  book,
  input,
  recipient,
  onDone,
  onFailed
}: {
  book: BookDetail
  input: Parameters<ReturnType<typeof storyboundApi>['sharing']['shareBook']>[0]
  recipient: string
  onDone: () => void
  onFailed: (message: string) => void
}): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [sent, setSent] = useState(false)
  const details = useMemo<BookDetails>(
    () => ({
      seed: book.id,
      title: book.title,
      subtitle: book.subtitle,
      authorName: book.authorName,
      blurb: book.blurb,
      coverStyle: book.coverStyle,
      coverUrl: book.coverImageUrl,
      coverPositionX: book.coverPositionX,
      coverPositionY: book.coverPositionY,
      wordCount: book.totalWordCount
    }),
    [book]
  )
  const { scene, ready, failed } = useParcelScene(canvas, details, false)
  const started = useRef(false)

  useEffect(() => {
    if ((!ready && !failed) || started.current) return
    started.current = true
    void (async () => {
      const request = storyboundApi().sharing.shareBook(input)
      try {
        const wrapped = scene.current?.wrapAndSend(
          () => playPaper(1.25),
          () => playWhoosh()
        )
        const [result] = await Promise.all([request, wrapped])
        unwrap(result)
        setSent(true)
        window.setTimeout(onDone, 1_500)
      } catch (caught) {
        onFailed(readableError(caught))
      }
    })()
  }, [failed, input, onDone, onFailed, ready, scene])

  return (
    <div aria-label="Sending your book" className="parcel-stage" role="dialog">
      <header className="parcel-stage__header">
        <p className="eyebrow">Parcel</p>
        <h2>{sent ? `On its way to ${recipient}` : `Wrapping “${book.title}”`}</h2>
        <p>{sent ? 'They will see it next time they open Storybound.' : ' '}</p>
      </header>
      <div className="parcel-stage__scene">
        <canvas className="parcel-stage__canvas" ref={canvas} />
      </div>
      <footer className="parcel-stage__footer" />
    </div>
  )
}
