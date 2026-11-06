import { useState, type FormEvent } from 'react'
import { readableError, storyboundApi, unwrap } from '../../lib/api'
import { Button, InlineNotice } from '../ui'

type Mode = 'sign-in' | 'sign-up' | 'forgot' | 'reset'

const MINIMUM_PASSWORD = 10

/** Signing in or creating an account. An account does not turn sync on. */
export function AccountForm({ onDone }: { onDone: () => void }): React.JSX.Element {
  const [mode, setMode] = useState<Mode>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const switchTo = (next: Mode): void => {
    setMode(next)
    setError('')
    setNotice('')
    setPassword('')
  }

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (mode === 'sign-in') {
        unwrap(await storyboundApi().sync.signIn({ email, password }))
        onDone()
      } else if (mode === 'sign-up') {
        unwrap(await storyboundApi().sync.signUp({ email, password }))
        onDone()
      } else if (mode === 'forgot') {
        unwrap(await storyboundApi().sync.requestPasswordReset({ email }))
        switchTo('reset')
        setNotice('If that email has an account, a code is on its way. Enter it below.')
      } else {
        unwrap(await storyboundApi().sync.resetPassword({ email, code, password }))
        onDone()
      }
    } catch (caught) {
      setError(readableError(caught))
    } finally {
      setBusy(false)
    }
  }

  const heading = {
    'sign-in': 'Sign in',
    'sign-up': 'Create an account',
    forgot: 'Reset your password',
    reset: 'Choose a new password'
  }[mode]
  const asksForPassword = mode !== 'forgot'
  const newPassword = mode === 'sign-up' || mode === 'reset'

  return (
    <form className="account-form" onSubmit={(event) => void submit(event)}>
      <h2>{heading}</h2>
      {mode === 'sign-up' ? (
        <p>Your books stay on your device. Sync is separate, and stays off until you turn it on.</p>
      ) : null}
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {notice ? <InlineNotice tone="info">{notice}</InlineNotice> : null}
      <label className="field">
        <span>Email</span>
        <input
          autoComplete="email"
          required
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      {mode === 'reset' ? (
        <label className="field">
          <span>Code from the email</span>
          <input
            autoComplete="one-time-code"
            inputMode="numeric"
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </label>
      ) : null}
      {asksForPassword ? (
        <label className="field">
          <span>{mode === 'reset' ? 'New password' : 'Password'}</span>
          <input
            autoComplete={newPassword ? 'new-password' : 'current-password'}
            minLength={newPassword ? MINIMUM_PASSWORD : undefined}
            required
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {newPassword ? <small>At least {MINIMUM_PASSWORD} characters.</small> : null}
        </label>
      ) : null}
      <Button disabled={busy} type="submit" variant="primary">
        {busy
          ? 'One moment…'
          : mode === 'sign-up'
            ? 'Create account'
            : mode === 'forgot'
              ? 'Email me a code'
              : mode === 'reset'
                ? 'Save new password'
                : 'Sign in'}
      </Button>
      <div className="account-form__links">
        {mode === 'sign-in' ? (
          <>
            <button type="button" onClick={() => switchTo('sign-up')}>
              Create an account
            </button>
            <button type="button" onClick={() => switchTo('forgot')}>
              Forgot your password?
            </button>
          </>
        ) : (
          <button type="button" onClick={() => switchTo('sign-in')}>
            Back to sign in
          </button>
        )}
      </div>
    </form>
  )
}
