import { ClipboardCopy, Mail } from 'lucide-react'
import { useEffect, useState } from 'react'
import { readableError, storyboundApi, unwrap } from '../lib/api'
import { Button, InlineNotice } from './ui'

/** Settings → Sync & devices: the code other people use to send books here. */
export function SharingAddress({
  notify
}: {
  notify: (message: string) => void
}): React.JSX.Element | null {
  const [address, setAddress] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const status = unwrap(await storyboundApi().sharing.status())
        if (!cancelled) setAddress(status.address)
      } catch (caught) {
        if (!cancelled) setError(readableError(caught))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (error) return <InlineNotice tone="error">{error}</InlineNotice>
  if (!address) return null
  return (
    <div className="scheduled-backups assistant-block">
      <div className="scheduled-backups__heading">
        <div>
          <strong>Your Storybound address</strong>
          <p>Give this to someone so they can send you a book. It is safe to share.</p>
        </div>
        <Mail aria-hidden="true" size={21} />
      </div>
      <div className="assistant-actions">
        <code className="share-address">{address}</code>
        <Button
          icon={ClipboardCopy}
          onClick={() =>
            void storyboundApi()
              .sharing.copyAddress()
              .then((result) => notify(unwrap(result).message))
              .catch((caught: unknown) => setError(readableError(caught)))
          }
        >
          Copy
        </Button>
      </div>
    </div>
  )
}
