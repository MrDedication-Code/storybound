import { Check, Gift, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ParcelPreview, ParcelResult } from '@shared/sharing'
import { readableError } from '../../lib/api'
import { formatNumber } from '../../lib/format'
import { BookCover } from '../BookCover'
import { Button, InlineNotice } from '../ui'
import type { BookDetails } from './bookModel'
import { playCollect, playPaper } from './parcelSounds'
import { useParcelScene } from './useParcelScene'

type Phase = 'wrapped' | 'unwrapping' | 'open' | 'collecting'

interface ParcelModalProps {
  /** What the parcel says before it is opened. */
  parcel: {
    title: string
    authorName: string
    chapterCount: number
    mode: 'read-only' | 'editable'
  }
  eyebrow: string
  /** The heading while the parcel is still wrapped. */
  wrappedHeading: string
  label: string
  collectLabel: string
  open: () => Promise<ParcelPreview>
  collect: () => Promise<ParcelResult>
  /** Left out when there is no one to send a book back to. */
  decline?: () => Promise<void>
  onClose: () => void
  onCollected: (result: ParcelResult) => void
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
  eyebrow,
  wrappedHeading,
  label,
  collectLabel,
  open,
  collect,
  decline,
  onClose,
  onCollected
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
        const opened = await open()
        if (!cancelled) setPreview(opened)
      } catch (caught) {
        if (!cancelled) setError(readableError(caught))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

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

  const collectBook = async (): Promise<void> => {
    setPhase('collecting')
    setError('')
    try {
      const result = await collect()
      playCollect()
      await scene.current?.collect()
      onCollected(result)
    } catch (caught) {
      setPhase('open')
      setError(readableError(caught))
    }
  }

  const declineBook = async (): Promise<void> => {
    try {
      await decline?.()
    } catch (caught) {
      setError(readableError(caught))
    }
  }

  const wrapped = phase === 'wrapped'
  return (
    <div aria-label={label} className="parcel-stage" role="dialog">
      <header className="parcel-stage__header">
        <p className="eyebrow">{eyebrow}</p>
        <h2>{wrapped || phase === 'unwrapping' ? wrappedHeading : parcel.title}</h2>
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
              {decline ? (
                <Button disabled={busy} onClick={() => void declineBook()}>
                  Decline
                </Button>
              ) : null}
              <Button
                disabled={busy}
                icon={Check}
                variant="primary"
                onClick={() => void collectBook()}
              >
                {collectLabel}
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
