import { Drama } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

/** Sounds and beats the Google voice performs where they are written. */
const SOUNDS = [
  'sigh',
  'laugh',
  'chuckle',
  'gasp',
  'whispers',
  'breath',
  'groan',
  'sob',
  'short pause',
  'long pause'
]

/** Ways a whole paragraph can be read, as starting points; any words work. */
const DIRECTIONS = [
  'hushed, urgent',
  'warm and tender',
  'cold, clipped',
  'breathless, frightened',
  'wry, amused',
  'grave and slow'
]

/**
 * The editor's Expression menu: performance notes for the narrating voice. They are written as
 * [[...]] in the chapter, heard when it is read aloud, and never shown to readers.
 */
export function ExpressionMenu({
  onSound,
  onDirection
}: {
  /** Adds a note where the cursor is, such as [[sigh]]. */
  onSound: (note: string) => void
  /** Starts the cursor's paragraph with a note for how all of it is read. */
  onDirection: (direction: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [direction, setDirection] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent | KeyboardEvent): void => {
      if (
        event instanceof KeyboardEvent
          ? event.key === 'Escape'
          : !rootRef.current?.contains(event.target as Node)
      ) {
        setOpen(false)
      }
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
    }
  }, [open])

  const direct = (value: string): void => {
    const clean = value
      .replace(/[[\]\n]/g, '')
      .trim()
      .slice(0, 100)
    if (!clean) return
    onDirection(clean)
    setDirection('')
    setOpen(false)
  }

  return (
    <div className="expression-menu" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <Drama size={16} />
        Expression
      </button>
      {open ? (
        <div aria-label="Performance notes" className="expression-menu__panel" role="dialog">
          <p className="expression-menu__hint">
            Heard when the chapter is read aloud in the Google voice; never shown to readers.
          </p>
          <strong>At the cursor</strong>
          <div className="expression-menu__chips">
            {SOUNDS.map((sound) => (
              <button
                key={sound}
                onClick={() => {
                  onSound(sound)
                  setOpen(false)
                }}
              >
                {sound}
              </button>
            ))}
          </div>
          <strong>How this paragraph is read</strong>
          <div className="expression-menu__chips">
            {DIRECTIONS.map((value) => (
              <button key={value} onClick={() => direct(value)}>
                {value}
              </button>
            ))}
          </div>
          <form
            className="expression-menu__custom"
            onSubmit={(event) => {
              event.preventDefault()
              direct(direction)
            }}
          >
            <input
              aria-label="Your own direction for this paragraph"
              maxLength={100}
              placeholder="Your own: e.g. trembling with anger"
              value={direction}
              onChange={(event) => setDirection(event.target.value)}
            />
            <button disabled={!direction.trim()} type="submit">
              Add
            </button>
          </form>
        </div>
      ) : null}
    </div>
  )
}
