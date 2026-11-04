import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pcm16ToWav } from '@storybound/narration'
import type { CredentialProtector } from '../../src/main/cloud/secureCredentials'
import { NarrationController } from '../../src/main/narration/controller'

const protector: CredentialProtector = {
  isEncryptionAvailable: () => true,
  encryptString: async (value) => Buffer.from(value.split('').reverse().join('')),
  decryptString: async (value) => ({
    value: value.toString().split('').reverse().join(''),
    shouldReEncrypt: false
  })
}

const KEY = 'AIzaFakeKeyForTestsOnly_1234567890'
const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

interface FakeGoogle {
  fetchImpl: typeof fetch
  requests: Array<{ url: string; body: unknown }>
  audio: Uint8Array
}

function fakeGoogle(options: { failSpeechTimes?: number; status?: number } = {}): FakeGoogle {
  const requests: Array<{ url: string; body: unknown }> = []
  let failures = options.failSpeechTimes ?? 0
  const audio = pcm16ToWav(new Uint8Array([1, 0, 2, 0]), 24000)
  const fetchImpl = vi.fn(async (url: string, init: { body?: string }) => {
    requests.push({ url, body: init.body ? JSON.parse(init.body) : null })
    if (url.includes('/voices')) {
      return Response.json({
        voices: [
          {
            id: 'voices/riko-storyteller',
            display_name: 'Riko',
            description: 'Confident and clear.'
          }
        ]
      })
    }
    if (failures > 0) {
      failures -= 1
      return Response.json({ error: { message: 'busy' } }, { status: options.status ?? 503 })
    }
    return Response.json({
      steps: [
        {
          type: 'model_output',
          content: [{ type: 'audio', data: Buffer.from(audio).toString('base64') }]
        }
      ]
    })
  })
  return { fetchImpl: fetchImpl as unknown as typeof fetch, requests, audio }
}

function controller(google: FakeGoogle): {
  narration: NarrationController
  path: string
} {
  const path = mkdtempSync(join(tmpdir(), 'storybound-narration-'))
  directories.push(path)
  return { narration: new NarrationController(path, protector, google.fetchImpl), path }
}

describe('listening on the Mac', () => {
  it('checks and keeps the Google key out of plain sight, and finds Riko by ID', async () => {
    const google = fakeGoogle()
    const { narration, path } = controller(google)
    expect((await narration.status()).gemini).toMatchObject({ hasKey: false, voiceName: 'Riko' })

    const status = await narration.setGeminiKey(`  ${KEY}  `)
    expect(status.gemini).toMatchObject({ hasKey: true, voiceId: 'voices/riko-storyteller' })
    expect(google.requests[0].url).toContain('/voices?page_size=100&search=Riko')
    // Stored encrypted, never as readable text, and never in the settings file.
    expect(readFileSync(join(path, 'narration-credentials.bin')).includes(KEY)).toBe(false)
    expect(readFileSync(join(path, 'narration.json'), 'utf8')).not.toContain(KEY)

    expect((await narration.clearGeminiKey()).gemini.hasKey).toBe(false)
  })

  it('needs agreement before the Google voice reads anything', async () => {
    const google = fakeGoogle()
    const { narration } = controller(google)
    await narration.setGeminiKey(KEY)
    await expect(narration.update({ engine: 'gemini' })).rejects.toThrow('Agree')
    await expect(narration.synthesize({ text: 'Hello.', style: null })).rejects.toThrow('Agree')
    const status = await narration.update({ engine: 'gemini', geminiConsent: true })
    expect(status).toMatchObject({ engine: 'gemini', gemini: { consented: true } })
  })

  it('reads a passage once and plays it again from the cache', async () => {
    const google = fakeGoogle()
    const { narration, path } = controller(google)
    await narration.setGeminiKey(KEY)
    await narration.update({ engine: 'gemini', geminiConsent: true })

    const first = await narration.synthesize({ text: 'The lamp went out.', style: 'hushed' })
    const again = await narration.synthesize({ text: 'The lamp went out.', style: 'hushed' })
    expect(Buffer.from(first)).toEqual(Buffer.from(google.audio))
    expect(Buffer.from(again)).toEqual(Buffer.from(google.audio))
    const speechRequests = google.requests.filter((request) =>
      request.url.endsWith('/interactions')
    )
    expect(speechRequests).toHaveLength(1)
    expect(speechRequests[0].body).toMatchObject({
      model: 'gemini-3.8-flash-tts',
      input: [{ content: [{ text: 'The lamp went out.', annotations: [{ style: 'hushed' }] }] }],
      generation_config: { speech_config: [{ voice: 'voices/riko-storyteller' }] }
    })
    expect(readdirSync(join(path, 'narration-cache'))).toHaveLength(1)

    // A passage without its own direction uses the chosen default style.
    await narration.synthesize({ text: 'Morning came.', style: null })
    expect(google.requests.at(-1)?.body).toMatchObject({
      input: [
        { content: [{ annotations: [{ style: 'Rich, velvety, unhurried audiobook narration' }] }] }
      ]
    })
  })

  it('waits and retries when Google is busy, but not when the key is refused', async () => {
    const busy = fakeGoogle({ failSpeechTimes: 1 })
    const first = controller(busy).narration
    await first.setGeminiKey(KEY)
    await first.update({ engine: 'gemini', geminiConsent: true })
    // One real two-second wait before the retry.
    await expect(first.synthesize({ text: 'Retry me.', style: null })).resolves.toBeInstanceOf(
      Uint8Array
    )

    const refused = fakeGoogle({ failSpeechTimes: 5, status: 403 })
    const { narration, path } = controller(refused)
    await narration.setGeminiKey(KEY)
    await narration.update({ engine: 'gemini', geminiConsent: true })
    await expect(narration.synthesize({ text: 'No.', style: null })).rejects.toThrow('billing')
    expect(existsSync(join(path, 'narration-cache'))).toBe(false)
  }, 15_000)
})
