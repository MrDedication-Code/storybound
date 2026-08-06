import { CheckCheck, FileText, Import, LoaderCircle } from 'lucide-react'
import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  parseDirectImport,
  type DirectImportFormat,
  type DirectImportFormatHint,
  type DirectImportWarning
} from '@shared/directImport'
import { applyStoryPaste, restorePasteCursor } from '../lib/storyPaste'
import { Button, ConfirmDialog, InlineNotice, Modal } from './ui'

export interface DirectImportSubmission {
  title: string
  chapters: Array<{ title: string; content: string }>
  source: {
    format: DirectImportFormat
    fileName?: string
    originalCharacterCount: number
    processedCharacterCount: number
    sourceLineCount: number
    truncated: boolean
    warnings: DirectImportWarning[]
  }
}

export interface DirectImportModalProps {
  onClose: () => void
  onConfirm: (submission: DirectImportSubmission) => void | Promise<void>
  initialContent?: string
  fileName?: string
}

function selectedChapterIndexes(count: number): Set<number> {
  return new Set(Array.from({ length: count }, (_, index) => index))
}

export function DirectImportModal({
  onClose,
  onConfirm,
  initialContent = '',
  fileName: initialFileName
}: DirectImportModalProps): React.JSX.Element {
  const [initialResult] = useState(() =>
    parseDirectImport({ content: initialContent, fileName: initialFileName })
  )
  const [content, setContent] = useState(initialContent)
  const [fileName, setFileName] = useState(initialFileName)
  const [formatHint, setFormatHint] = useState<DirectImportFormatHint>('auto')
  const [title, setTitle] = useState(initialResult.title)
  const [selected, setSelected] = useState(() =>
    selectedChapterIndexes(initialResult.chapters.length)
  )
  const [discardConfirm, setDiscardConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const result = useMemo(
    () => parseDirectImport({ content, fileName, format: formatHint }),
    [content, fileName, formatHint]
  )
  const selectedCount = result.chapters.filter((_, index) => selected.has(index)).length
  const hasInput = Boolean(content || title !== initialResult.title || formatHint !== 'auto')

  const applySource = (
    nextContent: string,
    nextFormat: DirectImportFormatHint,
    nextFileName = fileName
  ): void => {
    const nextResult = parseDirectImport({
      content: nextContent,
      fileName: nextFileName,
      format: nextFormat
    })
    setContent(nextContent)
    setFormatHint(nextFormat)
    setFileName(nextFileName)
    setTitle(nextResult.title)
    setSelected(selectedChapterIndexes(nextResult.chapters.length))
    setError('')
  }

  const handleFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      applySource(await file.text(), formatHint, file.name)
    } catch {
      setError('That text file could not be read. Try pasting its contents instead.')
    }
  }

  const requestClose = (): void => {
    if (hasInput) setDiscardConfirm(true)
    else onClose()
  }

  const handleConfirm = async (): Promise<void> => {
    const cleanTitle = title.trim()
    if (!cleanTitle) {
      setError('Give the imported book a title.')
      return
    }
    const chapters = result.chapters
      .filter((_, index) => selected.has(index))
      .map((chapter) => ({ title: chapter.title, content: chapter.content }))
    if (chapters.length === 0) {
      setError('Select at least one chapter to import.')
      return
    }

    setBusy(true)
    setError('')
    try {
      await onConfirm({
        title: cleanTitle,
        chapters,
        source: {
          format: result.format,
          fileName,
          originalCharacterCount: result.preview.originalCharacterCount,
          processedCharacterCount: result.preview.processedCharacterCount,
          sourceLineCount: result.preview.sourceLineCount,
          truncated: result.preview.truncated,
          warnings: result.warnings
        }
      })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The import could not be completed.')
      setBusy(false)
    }
  }

  const toggleAll = (): void => {
    setSelected(
      selectedCount === result.chapters.length
        ? new Set()
        : selectedChapterIndexes(result.chapters.length)
    )
    setError('')
  }

  return (
    <>
      <Modal
        description="Paste a conversation or story draft, review what was detected, then choose the chapters to keep."
        onClose={onClose}
        onRequestClose={requestClose}
        size="large"
        title="Import story text"
      >
        <div className="direct-import">
          <div className="direct-import__source">
            <div className="form-grid form-grid--two">
              <label className="field">
                <span>Source type</span>
                <select
                  aria-describedby="direct-import-format-help"
                  value={formatHint}
                  onChange={(event) =>
                    applySource(content, event.target.value as DirectImportFormatHint)
                  }
                >
                  <option value="auto">Detect automatically</option>
                  <option value="chat">ChatGPT, Claude or Gemini</option>
                  <option value="markdown">Markdown</option>
                  <option value="txt">Plain text</option>
                </select>
                <small id="direct-import-format-help">
                  Detected as {result.format === 'txt' ? 'plain text' : result.format}.
                </small>
              </label>
              <div className="direct-import__file-choice">
                <span>Or open a text file</span>
                <input
                  ref={fileInputRef}
                  accept=".txt,.md,.markdown,text/plain,text/markdown"
                  className="visually-hidden"
                  tabIndex={-1}
                  type="file"
                  onChange={(event) => void handleFile(event)}
                />
                <Button icon={FileText} onClick={() => fileInputRef.current?.click()}>
                  Choose file
                </Button>
              </div>
            </div>
            <label className="field">
              <span>Story or conversation text</span>
              <textarea
                className="direct-import__textarea"
                placeholder="Paste text from ChatGPT, Claude, Gemini, Markdown, or a plain-text draft…"
                rows={10}
                value={content}
                onChange={(event) => applySource(event.target.value, formatHint)}
                onPaste={(event) => {
                  event.preventDefault()
                  const area = event.currentTarget
                  const edit = applyStoryPaste(
                    content,
                    area.selectionStart,
                    area.selectionEnd,
                    event.clipboardData
                  )
                  applySource(edit.value, formatHint)
                  restorePasteCursor(area, edit.cursor)
                }}
              />
            </label>
          </div>

          <section aria-labelledby="direct-import-preview-title" className="direct-import__preview">
            <div className="direct-import__preview-heading">
              <div>
                <p className="eyebrow">Live preview</p>
                <h3 id="direct-import-preview-title">
                  {result.chapters.length} chapter{result.chapters.length === 1 ? '' : 's'} detected
                </h3>
              </div>
              <Button
                disabled={result.chapters.length === 0}
                icon={CheckCheck}
                variant="quiet"
                onClick={toggleAll}
              >
                {selectedCount === result.chapters.length ? 'Clear all' : 'Select all'}
              </Button>
            </div>

            <label className="field">
              <span>Book title</span>
              <input
                maxLength={240}
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value)
                  setError('')
                }}
              />
            </label>

            {result.warnings.length > 0 ? (
              <div aria-label="Import warnings" className="direct-import__warnings" role="status">
                <strong>Review before importing</strong>
                <ul>
                  {result.warnings.map((warning, index) => (
                    <li key={`${warning.code}-${warning.line ?? index}`}>{warning.message}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div aria-label="Detected chapters" className="direct-import__chapters">
              {result.chapters.map((chapter, index) => (
                <label
                  className="direct-import__chapter"
                  key={`${index}-${chapter.sourceStartLine}`}
                >
                  <input
                    checked={selected.has(index)}
                    type="checkbox"
                    onChange={(event) => {
                      const next = new Set(selected)
                      if (event.target.checked) next.add(index)
                      else next.delete(index)
                      setSelected(next)
                      setError('')
                    }}
                  />
                  <span>
                    <strong>{chapter.title}</strong>
                    <small>
                      Lines {chapter.sourceStartLine}–{chapter.sourceEndLine}
                    </small>
                    <span className="direct-import__excerpt">
                      {chapter.content.trim() || 'This chapter has no text.'}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </section>
        </div>

        {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
        <div className="modal__actions">
          <Button disabled={busy} onClick={requestClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || !content.trim() || selectedCount === 0}
            icon={busy ? LoaderCircle : Import}
            variant="primary"
            onClick={() => void handleConfirm()}
          >
            {busy
              ? 'Importing…'
              : `Import ${selectedCount} chapter${selectedCount === 1 ? '' : 's'}`}
          </Button>
        </div>
      </Modal>
      {discardConfirm ? (
        <ConfirmDialog
          confirmLabel="Discard import"
          dangerous
          description="The pasted text and chapter selection will be lost."
          onClose={() => setDiscardConfirm(false)}
          onConfirm={onClose}
          title="Discard this import?"
        />
      ) : null}
    </>
  )
}
