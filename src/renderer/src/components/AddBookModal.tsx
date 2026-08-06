import { BookPlus, ImagePlus, LoaderCircle } from 'lucide-react'
import { useEffect, useEffectEvent, useState, type FormEvent } from 'react'
import type { BookDetail, BookStatus } from '@shared/types'
import { readableError, storyboundApi, unwrap } from '../lib/api'
import type { PrepareCloseDetail } from '../lib/events'
import { applyStoryPaste, restorePasteCursor } from '../lib/storyPaste'
import { Button, ConfirmDialog, InlineNotice, Modal } from './ui'

interface AddBookModalProps {
  onClose: () => void
  onCreated: (book: BookDetail, warning?: string) => void
}

export function AddBookModal({ onClose, onCreated }: AddBookModalProps): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [blurb, setBlurb] = useState('')
  const [status, setStatus] = useState<BookStatus>('ongoing')
  const [chapterTitle, setChapterTitle] = useState('')
  const [chapterContent, setChapterContent] = useState('')
  const [chooseCover, setChooseCover] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [discardConfirm, setDiscardConfirm] = useState(false)
  const hasUnsavedInput = Boolean(
    title.trim() ||
    blurb.trim() ||
    chapterTitle.trim() ||
    chapterContent.trim() ||
    chooseCover ||
    status !== 'ongoing'
  )
  const requestClose = (): void => {
    if (hasUnsavedInput) {
      setDiscardConfirm(true)
      return
    }
    onClose()
  }
  const prepareClose = useEffectEvent((event: CustomEvent<PrepareCloseDetail>): void => {
    if (hasUnsavedInput) {
      setError('Finish creating this book or close this form before quitting Storybound.')
    }
    event.detail.tasks.push(Promise.resolve(!hasUnsavedInput && !busy))
  })

  useEffect(() => {
    const handlePrepareClose = (event: Event): void =>
      prepareClose(event as CustomEvent<PrepareCloseDetail>)
    window.addEventListener('storybound:prepare-close', handlePrepareClose)
    return () => window.removeEventListener('storybound:prepare-close', handlePrepareClose)
  }, [])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const cleanTitle = title.trim()
    if (!cleanTitle) {
      setError('Give your book a title before creating it.')
      return
    }

    setBusy(true)
    setError('')
    let book: BookDetail
    try {
      book = unwrap(
        await storyboundApi().books.create({
          title: cleanTitle,
          blurb: blurb.trim(),
          status,
          initialChapterTitle: chapterTitle.trim() || undefined,
          initialChapterContent: chapterContent || undefined
        })
      )
    } catch (caught) {
      setError(readableError(caught))
      setBusy(false)
      return
    }

    if (chooseCover) {
      try {
        const coverResult = unwrap(await storyboundApi().books.chooseCover(book.id))
        if (coverResult) book = coverResult
      } catch (caught) {
        onCreated(
          book,
          `The book was created, but its cover could not be added: ${readableError(caught)} You can choose another cover from Book Details.`
        )
        return
      }
    }
    onCreated(book)
  }

  return (
    <>
      <Modal
        description="Start with as much or as little as you have. Only the title is required."
        onClose={onClose}
        onRequestClose={requestClose}
        size="large"
        title="Create a new book"
      >
        <form className="form-stack" onSubmit={(event) => void handleSubmit(event)}>
          <div className="form-grid form-grid--two">
            <label className="field">
              <span>
                Book title <strong aria-hidden="true">*</strong>
              </span>
              <input
                autoComplete="off"
                maxLength={240}
                placeholder="The name on the cover"
                required
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Writing status</span>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as BookStatus)}
              >
                <option value="ongoing">Ongoing</option>
                <option value="completed">Completed</option>
              </select>
            </label>
          </div>
          <label className="field">
            <span>
              Blurb <small>Optional</small>
            </span>
            <textarea
              maxLength={20_000}
              placeholder="A few lines to help you remember the story…"
              rows={3}
              value={blurb}
              onChange={(event) => setBlurb(event.target.value)}
            />
          </label>
          <div className="form-divider">
            <span>Begin with a chapter</span>
          </div>
          <label className="field">
            <span>
              Chapter title <small>Optional</small>
            </span>
            <input
              maxLength={240}
              placeholder="Chapter 1"
              value={chapterTitle}
              onChange={(event) => setChapterTitle(event.target.value)}
            />
          </label>
          <label className="field">
            <span>
              Chapter text <small>Optional</small>
            </span>
            <textarea
              className="paste-area"
              placeholder="Paste your first chapter here…"
              rows={7}
              value={chapterContent}
              onChange={(event) => setChapterContent(event.target.value)}
              onPaste={(event) => {
                event.preventDefault()
                const area = event.currentTarget
                const edit = applyStoryPaste(
                  chapterContent,
                  area.selectionStart,
                  area.selectionEnd,
                  event.clipboardData
                )
                setChapterContent(edit.value)
                restorePasteCursor(area, edit.cursor)
              }}
            />
          </label>
          <label className="choice-row">
            <input
              checked={chooseCover}
              type="checkbox"
              onChange={(event) => setChooseCover(event.target.checked)}
            />
            <ImagePlus aria-hidden="true" size={18} />
            <span>
              Choose a cover after creating
              <small>PNG, JPG, JPEG or WebP from your computer</small>
            </span>
          </label>
          {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
          <div className="modal__actions">
            <Button disabled={busy} onClick={requestClose}>
              Cancel
            </Button>
            <Button
              disabled={busy}
              icon={busy ? LoaderCircle : BookPlus}
              type="submit"
              variant="primary"
            >
              {busy ? 'Creating…' : 'Create book'}
            </Button>
          </div>
        </form>
      </Modal>
      {discardConfirm ? (
        <ConfirmDialog
          confirmLabel="Discard draft"
          dangerous
          description="The title, blurb, and chapter text entered here will be lost."
          onClose={() => setDiscardConfirm(false)}
          onConfirm={onClose}
          title="Discard this new book?"
        />
      ) : null}
    </>
  )
}
