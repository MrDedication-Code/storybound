import { Check, Gift, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ParcelPreview, ParcelResult, ParcelSummary } from '@shared/sharing'
import { readableError, storyboundApi, unwrap } from '../../lib/api'
import { formatNumber } from '../../lib/format'
import { BookCover } from '../BookCover'
import { Button, InlineNotice } from '../ui'
import type { BookDetails } from './bookModel'
import { playCollect, playPaper } from './parcelSounds'
import { useParcelScene } from './useParcelScene'

type Phase = 'wrapped' | 'unwrapping' | 'open' | 'collecting'

interface ParcelModalProps {
  parcel: ParcelSummary
  onClose: () => void
  onCollected: (result: ParcelResult) => void
  onDeclined: () => void
}

function detailsOf(preview: ParcelPreview): BookDetails {
  return {
    seed: preview.bookId,
    title: preview.title,
    subtitle: preview.subtitle,
    authorName: preview.authorName,
    blurb: preview.blurb,
    coverStyle: preview.coverStyle,
    coverUrl: preview.coverDataUrl,
    coverPositionX: preview.coverPositionX,
    coverPositionY: preview.coverPositionY,
    wordCount: preview.wordCount
  }
}

/** A new book arriving: the parcel, the unwrapping, and the book itself. */
export function ParcelModal({
  parcel,
  onClose,
  onCollected,
  onDeclined
}: ParcelModalProps): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [preview, setPreview] = useState<ParcelPreview | null>(null)
  const [storedPhase, setPhase] = useState<Phase>('wrapped')
  const [error, setError] = useState('')
  const details = useMemo(() => (preview ? detailsOf(preview) : null), [preview])
  const { scene, ready, failed } = useParcelScene(canvas, details, true)
  // With no 3D there is no parcel to unwrap, so the book is simply shown.
  const phase = failed && storedPhase === 'wrapped' ? 'open' : storedPhase

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const opened = unwrap(await storyboundApi().sharing.openParcel(parcel.id))
        if (!cancelled) setPreview(opened)
      } catch (caught) {
        if (!cancelled) setError(readableError(caught))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [parcel.id])

  useEffect(() => {
    if (ready) void scene.current?.arrive()
  }, [ready, scene])

  const busy = phase === 'unwrapping' || phase === 'collecting'
  useEffect(() => {
    const handleKey = (event: KeyboardEvent): void => {
      const stage = scene.current
      if (event.key === 'Escape' && !busy) onClose()
      if (!stage || phase !== 'open') return
      if (event.key === 'ArrowLeft') stage.turn(-0.25, 0)
      if (event.key === 'ArrowRight') stage.turn(0.25, 0)
      if (event.key === 'ArrowUp') stage.turn(0, -0.2)
      if (event.key === 'ArrowDown') stage.turn(0, 0.2)
      if (event.key === '+' || event.key === '=') stage.zoom(0.88)
      if (event.key === '-') stage.zoom(1.14)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [busy, onClose, phase, scene])

  const unwrapParcel = async (): Promise<void> => {
    if (phase !== 'wrapped' || !ready) return
    setPhase('unwrapping')
    await scene.current?.unwrap(() => playPaper(1.25))
    setPhase('open')
  }

  const collect = async (): Promise<void> => {
    setPhase('collecting')
    setError('')
    try {
      const result = unwrap(await storyboundApi().sharing.acceptParcel(parcel.id))
      playCollect()
      await scene.current?.collect()
      onCollected(result)
    } catch (caught) {
      setPhase('open')
      setError(readableError(caught))
    }
  }

  const decline = async (): Promise<void> => {
    try {
      unwrap(await storyboundApi().sharing.declineParcel(parcel.id))
      onDeclined()
    } catch (caught) {
      setError(readableError(caught))
    }
  }

  const wrapped = phase === 'wrapped'
  return (
    <div aria-label={`A book from ${parcel.senderName}`} className="parcel-stage" role="dialog">
      <header className="parcel-stage__header">
        <p className="eyebrow">Parcel</p>
        <h2>
          {wrapped || phase === 'unwrapping'
            ? `${parcel.senderName} sent you a book`
            : parcel.title}
        </h2>
        {wrapped ? (
          <p>{ready ? 'Click the parcel to unwrap it.' : 'Fetching your parcel…'}</p>
        ) : phase === 'open' || phase === 'collecting' ? (
          <p>
            {parcel.authorName ? `by ${parcel.authorName} · ` : ''}
            {preview
              ? `${parcel.chapterCount} chapters · ${formatNumber(preview.wordCount)} words`
              : ''}
          </p>
        ) : (
          <p>&nbsp;</p>
        )}
      </header>

      {!busy ? (
        <button aria-label="Close for now" className="parcel-stage__close" onClick={onClose}>
          <X size={20} />
        </button>
      ) : null}

      <div className="parcel-stage__scene">
        {failed && preview ? (
          <div className="parcel-stage__flat">
            <BookCover
              bookId={preview.bookId}
              coverImageUrl={preview.coverDataUrl}
              coverStyle={preview.coverStyle}
              size="hero"
              title={preview.title}
            />
            <p>{preview.blurb}</p>
          </div>
        ) : (
          <canvas
            aria-label={
              wrapped ? 'A parcel wrapped in brown paper' : `The book ${parcel.title}, in 3D`
            }
            className={`parcel-stage__canvas${wrapped ? ' is-wrapped' : ''}`}
            ref={canvas}
            onClick={() => void unwrapParcel()}
          />
        )}
      </div>

      <footer className="parcel-stage__footer">
        {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
        {phase === 'open' || phase === 'collecting' ? (
          <>
            <p className="parcel-stage__hint">
              {!failed ? 'Drag to turn it. Scroll to zoom. ' : ''}
              {parcel.mode === 'read-only'
                ? 'You can read, highlight and listen, but not change it.'
                : 'You can read and edit your own copy.'}
              {preview?.hasBible ? ' Its story bible is included.' : ''}
            </p>
            <div className="parcel-stage__actions">
              <Button disabled={busy} onClick={() => void decline()}>
                Decline
              </Button>
              <Button disabled={busy} icon={Check} variant="primary" onClick={() => void collect()}>
                Collect
              </Button>
            </div>
          </>
        ) : wrapped ? (
          <div className="parcel-stage__actions">
            <Button
              disabled={!ready}
              icon={Gift}
              variant="primary"
              onClick={() => void unwrapParcel()}
            >
              Unwrap
            </Button>
          </div>
        ) : null}
      </footer>
    </div>
  )
}
