import { Bot, KeyRound, Sparkles } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { AiAssistantTask, BookDetail } from '@shared/types'
import { readableError, storyboundApi, unwrap } from '../lib/api'
import { Button, InlineNotice, Modal } from './ui'

interface AiAssistantModalProps {
  book: BookDetail
  chapterText: string
  onApply: (task: AiAssistantTask, text: string) => void | Promise<void>
  onClose: () => void
}

export function AiAssistantModal({
  book,
  chapterText,
  onApply,
  onClose
}: AiAssistantModalProps): React.JSX.Element {
  const [task, setTask] = useState<AiAssistantTask>('chapter-cleanup')
  const [apiKey, setApiKey] = useState('')
  const [consented, setConsented] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [applying, setApplying] = useState(false)

  const runAssistant = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!consented) {
      setError('Confirm that you want to send this text to OpenAI for this one request.')
      return
    }
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const response = unwrap(
        await storyboundApi().data.aiAssist({
          apiKey,
          task,
          text: chapterText,
          context: `Book title: ${book.title}\nExisting blurb: ${book.blurb || '(none)'}`
        })
      )
      setResult(response.text)
    } catch (caught) {
      setError(readableError(caught))
    } finally {
      setBusy(false)
    }
  }

  const applyResult = async (): Promise<void> => {
    if (!result?.trim()) return
    setApplying(true)
    setError('')
    try {
      await onApply(task, result.trim())
      onClose()
    } catch (caught) {
      setError(readableError(caught))
    } finally {
      setApplying(false)
    }
  }

  return (
    <Modal
      description="An optional, explicit online helper for one bounded edit. The rest of Storybound remains offline."
      onClose={onClose}
      size="large"
      title="AI writing assistant"
    >
      <form className="ai-assistant" onSubmit={(event) => void runAssistant(event)}>
        <InlineNotice tone="info">
          Running this sends the current chapter and basic book context to OpenAI. Storybound sets
          <code> store: false</code>, never saves your API key, and will not send anything until you
          press the button below. API usage may incur charges on your OpenAI account.
        </InlineNotice>
        {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
        <div className="form-grid form-grid--two">
          <label className="field">
            <span>Task</span>
            <select
              value={task}
              onChange={(event) => {
                setTask(event.target.value as AiAssistantTask)
                setResult(null)
              }}
            >
              <option value="chapter-cleanup">Lightly clean this chapter</option>
              <option value="blurb">Suggest a book blurb</option>
            </select>
          </label>
          <label className="field">
            <span>
              <KeyRound aria-hidden="true" size={14} /> OpenAI API key
            </span>
            <input
              autoComplete="off"
              maxLength={2048}
              placeholder="Used once, kept only in this window"
              required
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </label>
        </div>
        <div className="ai-assistant__source">
          <Bot aria-hidden="true" size={18} />
          <span>
            {chapterText.length.toLocaleString()} characters will be sent using GPT-5.6 Luna.
            Storybound limits each request to 50,000 characters.
          </span>
        </div>
        <label className="switch-row ai-assistant__consent">
          <span>
            <strong>Send this text for this request</strong>
            <small>This consent applies once and is not remembered.</small>
          </span>
          <input
            aria-label="Consent to send this text to OpenAI"
            checked={consented}
            type="checkbox"
            onChange={(event) => setConsented(event.target.checked)}
          />
        </label>
        <div className="ai-assistant__run">
          <Button
            disabled={busy || chapterText.length === 0 || chapterText.length > 50_000}
            icon={Sparkles}
            type="submit"
            variant="primary"
          >
            {busy ? 'Waiting for OpenAI…' : 'Send one request'}
          </Button>
        </div>
        {result !== null ? (
          <label className="field ai-assistant__result">
            <span>Review and edit the suggestion before applying</span>
            <textarea
              aria-label="AI suggestion"
              rows={14}
              value={result}
              onChange={(event) => setResult(event.target.value)}
            />
          </label>
        ) : null}
        <div className="modal__actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            disabled={!result?.trim() || applying}
            onClick={() => void applyResult()}
            variant="primary"
          >
            {task === 'chapter-cleanup' ? 'Replace chapter text' : 'Use as book blurb'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
