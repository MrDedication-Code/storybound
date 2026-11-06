import { useState } from 'react'
import { REPORT_REASONS, type ReportReason } from '@shared/bookstore'
import { readableError, storyboundApi, unwrap } from '../../lib/api'
import { Button, InlineNotice, Modal } from '../ui'

export function ReportModal({
  listingId,
  title,
  onClose,
  onSent
}: {
  listingId: string
  title: string
  onClose: () => void
  onSent: () => void
}): React.JSX.Element {
  const [reason, setReason] = useState<ReportReason>('other')
  const [detail, setDetail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const send = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      unwrap(await storyboundApi().bookstore.report({ listingId, reason, detail }))
      onSent()
    } catch (caught) {
      setError(readableError(caught))
      setBusy(false)
    }
  }

  return (
    <Modal
      description="The author won’t see who sent this."
      onClose={onClose}
      size="small"
      title={`Report “${title}”`}
    >
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      <div className="form-grid">
        <label className="field">
          <span>What’s wrong?</span>
          <select
            value={reason}
            onChange={(event) => setReason(event.target.value as ReportReason)}
          >
            {REPORT_REASONS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Anything else we should know?</span>
          <textarea
            maxLength={2000}
            rows={4}
            value={detail}
            onChange={(event) => setDetail(event.target.value)}
          />
        </label>
      </div>
      <div className="modal__actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button disabled={busy} variant="primary" onClick={() => void send()}>
          {busy ? 'Sending…' : 'Send report'}
        </Button>
      </div>
    </Modal>
  )
}
