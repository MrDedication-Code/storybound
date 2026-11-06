import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { BookstoreStatus } from '@shared/bookstore'
import { readableError, storyboundApi, unwrap } from '../../lib/api'
import { Button, ErrorState, InlineNotice, LoadingState } from '../ui'
import { AccountForm } from './AccountForm'

export type StoreMember = Extract<BookstoreStatus, { phase: 'signed-in' }>

/** What everyone agrees to before using the store. */
function JoinBookstore({
  termsVersion,
  onJoined
}: {
  termsVersion: number
  onJoined: (status: BookstoreStatus) => void
}): React.JSX.Element {
  const [adult, setAdult] = useState(false)
  const [rules, setRules] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const join = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      onJoined(unwrap(await storyboundApi().bookstore.join(termsVersion)))
    } catch (caught) {
      setError(readableError(caught))
      setBusy(false)
    }
  }

  return (
    <section className="store-join">
      <h2>Before you come in</h2>
      <p>The Bookstore is a place to share books and find new ones. It has a few simple rules.</p>
      <ul>
        <li>You must be 18 or over.</li>
        <li>Only publish books you have the right to publish.</li>
        <li>No explicit sexual content, and nothing illegal or hateful.</li>
        <li>Say honestly how AI was used, and add content warnings.</li>
        <li>
          Every book is checked before it appears, and can be removed if it breaks these rules.
        </li>
      </ul>
      <p>
        Published books are public. The books in your library stay private unless you publish them.
      </p>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      <label className="store-check">
        <input
          checked={adult}
          type="checkbox"
          onChange={(event) => setAdult(event.target.checked)}
        />
        <span>I am 18 or over</span>
      </label>
      <label className="store-check">
        <input
          checked={rules}
          type="checkbox"
          onChange={(event) => setRules(event.target.checked)}
        />
        <span>I agree to the Bookstore rules</span>
      </label>
      <Button disabled={!adult || !rules || busy} variant="primary" onClick={() => void join()}>
        {busy ? 'Joining…' : 'Enter the Bookstore'}
      </Button>
    </section>
  )
}

/** Shows its children only to someone who can use the store. */
export function StoreGate({
  children
}: {
  children: (member: StoreMember) => ReactNode
}): React.JSX.Element {
  const [status, setStatus] = useState<BookstoreStatus | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async (): Promise<void> => {
    setError('')
    try {
      setStatus(unwrap(await storyboundApi().bookstore.status()))
    } catch (caught) {
      setError(readableError(caught))
    }
  }, [])

  useEffect(() => {
    void Promise.resolve().then(load)
  }, [load])

  if (error) return <ErrorState message={error} onRetry={() => void load()} />
  if (!status) return <LoadingState label="Opening the Bookstore…" />
  if (status.phase === 'unavailable') {
    return (
      <InlineNotice tone="info">
        The Bookstore is not available in this version of Storybound.
      </InlineNotice>
    )
  }
  if (status.phase === 'signed-out') return <AccountForm onDone={() => void load()} />
  if (status.suspended) {
    return (
      <InlineNotice tone="error">
        This account can no longer use the Bookstore.
        {status.suspensionReason ? ` ${status.suspensionReason}` : ''} The books in your library are
        not affected.
      </InlineNotice>
    )
  }
  if (!status.joined) {
    return <JoinBookstore termsVersion={status.termsVersion} onJoined={setStatus} />
  }
  return <>{children(status)}</>
}
