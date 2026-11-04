import { Download, Headphones, KeyRound, Play, Search, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { NarrationStatus, NarrationVoice } from '@shared/types'
import { readableError, storyboundApi, unwrap } from '../lib/api'
import { Button, ConfirmDialog, InlineNotice } from './ui'

const DEFAULT_STYLE = 'Rich, velvety, unhurried audiobook narration'
const PREVIEW_TEXT =
  'The lamp went out at midnight. Somewhere below, a door closed softly, and then there was nothing at all.'

interface ListeningSettingsProps {
  notify: (message: string) => void
}

/** Settings → Listening: which voice reads books aloud, and the Google voice's key and style. */
export function ListeningSettings({ notify }: ListeningSettingsProps): React.JSX.Element {
  const [status, setStatus] = useState<NarrationStatus | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [style, setStyle] = useState(DEFAULT_STYLE)
  const [search, setSearch] = useState('')
  const [voices, setVoices] = useState<NarrationVoice[] | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [confirmRemoveKokoro, setConfirmRemoveKokoro] = useState(false)
  const previewRef = useRef<HTMLAudioElement | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const next = unwrap(await storyboundApi().narration.status())
      setStatus(next)
      setStyle(next.gemini.style)
    } catch (caught) {
      setError(readableError(caught))
    }
  }, [])

  useEffect(() => {
    void Promise.resolve().then(refresh)
    return () => previewRef.current?.pause()
  }, [refresh])

  // While the free voice downloads, its progress is read every moment.
  const downloading = Boolean(status?.kokoro.progress) || busy === 'kokoro'
  useEffect(() => {
    if (!downloading) return
    const timer = window.setInterval(() => {
      void storyboundApi()
        .narration.status()
        .then((result) => {
          if (result.ok) setStatus(result.data)
        })
    }, 700)
    return () => window.clearInterval(timer)
  }, [downloading])

  const run = async (name: string, action: () => Promise<void>): Promise<void> => {
    setBusy(name)
    setError('')
    try {
      await action()
    } catch (caught) {
      setError(readableError(caught))
    } finally {
      setBusy('')
    }
  }

  const apply = (name: string, request: () => Promise<NarrationStatus>, message?: string): void =>
    void run(name, async () => {
      const next = await request()
      setStatus(next)
      setStyle(next.gemini.style)
      if (message) notify(message)
    })

  const findVoices = (query: string): void =>
    void run('search', async () => {
      const result = unwrap(
        await storyboundApi().narration.listVoices({ search: query.trim() || undefined })
      )
      setVoices(result.voices)
    })

  const preview = (voice: { id: string }, engine: 'gemini' | 'kokoro' = 'gemini'): void =>
    void run(`preview-${voice.id}`, async () => {
      const bytes = unwrap(
        await storyboundApi().narration.synthesize({
          text: PREVIEW_TEXT,
          style: null,
          voiceId: voice.id,
          engine
        })
      )
      previewRef.current?.pause()
      const audio = new Audio(
        URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'audio/wav' }))
      )
      previewRef.current = audio
      await audio.play()
    })

  const gemini = status?.gemini
  const canUseGoogle = Boolean(gemini?.hasKey && gemini.consented)
  const kokoro = status?.kokoro
  const kokoroVoiceName =
    kokoro?.voices.find((voice) => voice.id === kokoro.voiceId)?.name ?? 'George'
  const megabytes = (bytes: number): string => `${Math.round(bytes / 1_000_000)} MB`

  return (
    <section className="settings-section" id="listening">
      <div className="settings-section__heading">
        <div className="settings-icon">
          <Headphones size={20} />
        </div>
        <div>
          <h2>Listening</h2>
          <p>
            Choose the voice that reads your books aloud. Open a chapter and use Listen in the
            reader&apos;s toolbar; the page follows along and your place is saved as you go.
          </p>
        </div>
      </div>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}

      <div className="scheduled-backups assistant-block">
        <fieldset className="listening-voices">
          <legend>Voice</legend>
          <label className="switch-row">
            <span>
              <strong>Mac system voice</strong>
              <small>
                Free and offline. For a better system voice, download a Premium voice in macOS
                System Settings → Accessibility → Spoken Content.
              </small>
            </span>
            <input
              checked={status?.engine === 'system'}
              disabled={!status || Boolean(busy)}
              name="narration-engine"
              type="radio"
              onChange={() =>
                apply('engine', async () =>
                  unwrap(await storyboundApi().narration.update({ engine: 'system' }))
                )
              }
            />
          </label>
          <label className="switch-row">
            <span>
              <strong>Free voice · {kokoroVoiceName}</strong>
              <small>
                {kokoro?.installed
                  ? 'Kokoro, a natural voice that runs on this Mac. Free, offline, and private.'
                  : 'Download it below to use it.'}
              </small>
            </span>
            <input
              checked={status?.engine === 'kokoro'}
              disabled={!status || !kokoro?.installed || Boolean(busy)}
              name="narration-engine"
              type="radio"
              onChange={() =>
                apply(
                  'engine',
                  async () => unwrap(await storyboundApi().narration.update({ engine: 'kokoro' })),
                  'Books are now read in the free voice.'
                )
              }
            />
          </label>
          <label className="switch-row">
            <span>
              <strong>Google voice{gemini ? ` · ${gemini.voiceName}` : ''}</strong>
              <small>
                {canUseGoogle
                  ? 'Natural, expressive narration from Google, paid for with your own API key.'
                  : 'Add your Google API key and agree below to use it.'}
              </small>
            </span>
            <input
              checked={status?.engine === 'gemini'}
              disabled={!status || !canUseGoogle || Boolean(busy)}
              name="narration-engine"
              type="radio"
              onChange={() =>
                apply(
                  'engine',
                  async () => unwrap(await storyboundApi().narration.update({ engine: 'gemini' })),
                  'Books are now read in the Google voice.'
                )
              }
            />
          </label>
        </fieldset>
      </div>

      <div className="scheduled-backups assistant-block">
        <div className="scheduled-backups__heading">
          <div>
            <strong>Free voice</strong>
            <p>
              Kokoro is an open voice model that reads on this Mac, with no account, no cost, and
              nothing sent anywhere. It is downloaded once
              {kokoro ? ` (${megabytes(kokoro.downloadBytes)})` : ''} from Hugging Face and checked
              before use. It reads the words plainly; performance notes are for the Google voice.
            </p>
          </div>
          <Download aria-hidden="true" size={21} />
        </div>
        {kokoro?.installed ? (
          <>
            <ul className="listening-voice-list">
              {kokoro.voices.map((voice) => (
                <li
                  className={voice.id === kokoro.voiceId ? 'is-current' : undefined}
                  key={voice.id}
                >
                  <span>
                    <strong>{voice.name}</strong>
                    <small>{voice.description}</small>
                  </span>
                  <Button
                    disabled={Boolean(busy)}
                    icon={Play}
                    variant="quiet"
                    onClick={() => preview(voice, 'kokoro')}
                  >
                    {busy === `preview-${voice.id}` ? 'Loading…' : 'Preview'}
                  </Button>
                  <Button
                    disabled={Boolean(busy) || voice.id === kokoro.voiceId}
                    onClick={() =>
                      apply(
                        'voice',
                        async () =>
                          unwrap(
                            await storyboundApi().narration.update({ kokoroVoiceId: voice.id })
                          ),
                        `The free voice is now ${voice.name}.`
                      )
                    }
                  >
                    {voice.id === kokoro.voiceId ? 'Chosen' : 'Use'}
                  </Button>
                </li>
              ))}
            </ul>
            <div className="assistant-actions">
              <Button
                disabled={Boolean(busy)}
                icon={Trash2}
                variant="quiet"
                onClick={() => setConfirmRemoveKokoro(true)}
              >
                Remove download
              </Button>
            </div>
          </>
        ) : (
          <div className="assistant-actions">
            {kokoro?.progress ? (
              <progress
                aria-label="Downloading the free voice"
                className="listening-progress"
                max={kokoro.progress.total}
                value={kokoro.progress.received}
              />
            ) : null}
            <Button
              disabled={Boolean(busy) || !kokoro}
              icon={Download}
              variant="primary"
              onClick={() =>
                apply(
                  'kokoro',
                  async () => unwrap(await storyboundApi().narration.installKokoro()),
                  'The free voice is ready.'
                )
              }
            >
              {kokoro?.progress
                ? `Downloading… ${megabytes(kokoro.progress.received)} of ${megabytes(kokoro.progress.total)}`
                : 'Download the free voice'}
            </Button>
          </div>
        )}
      </div>

      <div className="scheduled-backups assistant-block">
        <div className="scheduled-backups__heading">
          <div>
            <strong>Google voice</strong>
            <p>
              Uses Google&apos;s Gemini text-to-speech with an API key from your own Google account,
              billed by Google as you go: roughly $4–9 for a full-length novel until the end of
              2026, about twice that after. Audio you have heard is kept on this Mac, so listening
              again costs nothing.
            </p>
          </div>
          <KeyRound aria-hidden="true" size={21} />
        </div>

        {gemini?.hasKey ? (
          <div className="assistant-actions">
            <span className="listening-key-saved">API key saved in your Mac&apos;s keychain.</span>
            <Button
              disabled={Boolean(busy)}
              icon={Trash2}
              variant="quiet"
              onClick={() => setConfirmRemove(true)}
            >
              Remove key
            </Button>
          </div>
        ) : (
          <form
            className="listening-key-form"
            onSubmit={(event) => {
              event.preventDefault()
              const key = apiKey
              apply(
                'key',
                async () => {
                  const next = unwrap(await storyboundApi().narration.setGeminiKey(key))
                  setApiKey('')
                  return next
                },
                'Google accepted the key.'
              )
            }}
          >
            <label>
              <span>Google API key</span>
              <input
                autoComplete="off"
                placeholder="Paste the key from Google AI Studio"
                spellCheck={false}
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </label>
            <Button disabled={Boolean(busy) || !apiKey.trim()} type="submit" variant="primary">
              {busy === 'key' ? 'Checking…' : 'Save key'}
            </Button>
          </form>
        )}

        <label className="switch-row">
          <span>
            <strong>Send chapter text to Google to make the audio</strong>
            <small>
              Only the passages you listen to are sent, with the voice and reading style. Use a key
              with billing set up: on Google&apos;s free tier, Google may use what you send to
              improve its products.
            </small>
          </span>
          <input
            checked={gemini?.consented ?? false}
            disabled={!status || Boolean(busy)}
            type="checkbox"
            onChange={(event) => {
              const geminiConsent = event.target.checked
              apply('consent', async () =>
                unwrap(
                  await storyboundApi().narration.update({
                    geminiConsent,
                    ...(geminiConsent ? {} : { engine: 'system' as const })
                  })
                )
              )
            }}
          />
        </label>

        {canUseGoogle ? (
          <>
            <form
              className="listening-key-form"
              onSubmit={(event) => {
                event.preventDefault()
                apply(
                  'style',
                  async () =>
                    unwrap(await storyboundApi().narration.update({ geminiStyle: style })),
                  'Reading style saved.'
                )
              }}
            >
              <label>
                <span>Reading style</span>
                <input
                  maxLength={500}
                  value={style}
                  onChange={(event) => setStyle(event.target.value)}
                />
              </label>
              <Button disabled={Boolean(busy)} type="submit">
                Save style
              </Button>
              <Button
                disabled={Boolean(busy) || style === DEFAULT_STYLE}
                variant="quiet"
                onClick={() => setStyle(DEFAULT_STYLE)}
              >
                Default
              </Button>
            </form>
            <p className="listening-hint">
              A paragraph that starts with a performance note, such as{' '}
              <code>[[hushed, urgent]]</code>, is read that way instead. Notes like{' '}
              <code>[[sigh]]</code> or <code>[[long pause]]</code> inside a line are performed and
              never shown in the reader.
            </p>

            <form
              className="listening-key-form"
              onSubmit={(event) => {
                event.preventDefault()
                findVoices(search)
              }}
            >
              <label>
                <span>Find a voice</span>
                <input
                  placeholder="Riko, storyteller, British, deep…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <Button disabled={Boolean(busy)} icon={Search} type="submit">
                {busy === 'search' ? 'Searching…' : 'Search'}
              </Button>
            </form>
            {voices ? (
              voices.length ? (
                <ul className="listening-voice-list">
                  {voices.map((voice) => (
                    <li
                      className={voice.id === gemini?.voiceId ? 'is-current' : undefined}
                      key={voice.id}
                    >
                      <span>
                        <strong>{voice.name}</strong>
                        <small>
                          {[voice.description, voice.pitch && `${voice.pitch} pitch`, voice.accent]
                            .filter(Boolean)
                            .join(' · ')}
                        </small>
                      </span>
                      <Button
                        disabled={Boolean(busy)}
                        icon={Play}
                        variant="quiet"
                        onClick={() => preview(voice)}
                      >
                        {busy === `preview-${voice.id}` ? 'Loading…' : 'Preview'}
                      </Button>
                      <Button
                        disabled={Boolean(busy) || voice.id === gemini?.voiceId}
                        onClick={() =>
                          apply(
                            'voice',
                            async () =>
                              unwrap(
                                await storyboundApi().narration.update({
                                  geminiVoiceId: voice.id,
                                  geminiVoiceName: voice.name
                                })
                              ),
                            `Books will be read by ${voice.name}.`
                          )
                        }
                      >
                        {voice.id === gemini?.voiceId ? 'Chosen' : 'Use'}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="listening-hint">No voices matched. Try a shorter word.</p>
              )
            ) : null}
          </>
        ) : null}
      </div>

      {confirmRemoveKokoro ? (
        <ConfirmDialog
          confirmLabel="Remove"
          dangerous
          description="The free voice's files are deleted from this Mac. You can download them again at any time."
          title="Remove the free voice?"
          onClose={() => setConfirmRemoveKokoro(false)}
          onConfirm={() => {
            setConfirmRemoveKokoro(false)
            apply(
              'remove-kokoro',
              async () => unwrap(await storyboundApi().narration.removeKokoro()),
              'The free voice was removed.'
            )
          }}
        />
      ) : null}
      {confirmRemove ? (
        <ConfirmDialog
          confirmLabel="Remove key"
          dangerous
          description="Storybound will stop using the Google voice on this Mac. Audio already made stays cached."
          title="Remove the Google API key?"
          onClose={() => setConfirmRemove(false)}
          onConfirm={() => {
            setConfirmRemove(false)
            apply(
              'remove',
              async () => unwrap(await storyboundApi().narration.clearGeminiKey()),
              'Google API key removed.'
            )
          }}
        />
      ) : null}
    </section>
  )
}
