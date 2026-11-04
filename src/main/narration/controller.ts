import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { mkdir, readdir, readFile, stat, unlink, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import {
  GEMINI_DEFAULT_STYLE,
  GEMINI_DEFAULT_VOICE,
  GEMINI_TTS_MODEL,
  GeminiSpeechError,
  listGeminiVoices,
  synthesizeWithGemini,
  type GeminiVoice
} from '@storybound/narration'
import type {
  NarrationSettingsInput,
  NarrationStatus,
  NarrationSynthesisInput,
  NarrationVoiceList
} from '../../shared/types'
import { StoryboundError } from '../errors'
import { SecureCredentialStorage, type CredentialProtector } from '../cloud/secureCredentials'

const SETTINGS_FILE = 'narration.json'
const CREDENTIALS_FILE = 'narration-credentials.bin'
const GEMINI_KEY = 'gemini-api-key'
const CACHE_FOLDER = 'narration-cache'
/** Cached audio is trimmed, oldest listened-to first, once it passes this size. */
const CACHE_LIMIT_BYTES = 1.5 * 1024 * 1024 * 1024
const RETRY_DELAYS_MS = [2000, 6000]

// Kept beside the database rather than in it: listening preferences are per computer, and the
// API key never enters backups, packages, or sync.
const settingsSchema = z.object({
  version: z.literal(1),
  engine: z.enum(['system', 'gemini', 'kokoro']),
  speed: z.number().min(0.5).max(2.5),
  geminiVoiceId: z.string().min(1).max(200),
  geminiVoiceName: z.string().min(1).max(200),
  geminiStyle: z.string().max(500),
  geminiConsentedAt: z.string().nullable()
})

type NarrationSettings = z.infer<typeof settingsSchema>

const DEFAULT_SETTINGS: NarrationSettings = {
  version: 1,
  engine: 'system',
  speed: 1,
  geminiVoiceId: GEMINI_DEFAULT_VOICE,
  geminiVoiceName: GEMINI_DEFAULT_VOICE,
  geminiStyle: GEMINI_DEFAULT_STYLE,
  geminiConsentedAt: null
}

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

/**
 * Listening on this computer: which voice reads, the writer's Google API key (kept in the
 * operating system's protected storage), and a cache of spoken passages so a chapter heard
 * twice is only paid for once.
 */
export class NarrationController {
  private settings: NarrationSettings
  private readonly credentials: SecureCredentialStorage
  private readonly cachePath: string

  constructor(
    private readonly dataPath: string,
    protector: CredentialProtector,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.credentials = new SecureCredentialStorage(join(dataPath, CREDENTIALS_FILE), protector)
    this.cachePath = join(dataPath, CACHE_FOLDER)
    this.settings = this.readSettings()
  }

  async status(): Promise<NarrationStatus> {
    const key = await this.geminiKey()
    return {
      engine: this.settings.engine,
      speed: this.settings.speed,
      gemini: {
        hasKey: Boolean(key),
        consented: this.settings.geminiConsentedAt !== null,
        voiceId: this.settings.geminiVoiceId,
        voiceName: this.settings.geminiVoiceName,
        style: this.settings.geminiStyle,
        model: GEMINI_TTS_MODEL
      }
    }
  }

  async update(input: NarrationSettingsInput): Promise<NarrationStatus> {
    const next: NarrationSettings = { ...this.settings }
    if (input.engine !== undefined) next.engine = input.engine
    if (input.speed !== undefined) next.speed = input.speed
    if (input.geminiVoiceId !== undefined) next.geminiVoiceId = input.geminiVoiceId
    if (input.geminiVoiceName !== undefined) next.geminiVoiceName = input.geminiVoiceName
    if (input.geminiStyle !== undefined) next.geminiStyle = input.geminiStyle.trim()
    if (input.geminiConsent === true && !next.geminiConsentedAt) {
      next.geminiConsentedAt = new Date().toISOString()
    }
    if (input.geminiConsent === false) next.geminiConsentedAt = null
    if (next.engine === 'gemini' && !next.geminiConsentedAt) {
      throw new StoryboundError(
        'VALIDATION_ERROR',
        'Agree to sending chapter text to Google before choosing the Google voice.'
      )
    }
    this.settings = next
    this.writeSettings()
    return this.status()
  }

  /** Checks the key with Google (listing voices costs nothing), then stores it. */
  async setGeminiKey(apiKey: string): Promise<NarrationStatus> {
    const key = apiKey.trim()
    let riko: GeminiVoice | undefined
    try {
      const { voices } = await listGeminiVoices(this.fetchImpl, key, {
        search: GEMINI_DEFAULT_VOICE
      })
      riko = voices.find((voice) => voice.name.toLowerCase() === GEMINI_DEFAULT_VOICE.toLowerCase())
    } catch (error) {
      throw this.toStoryboundError(error)
    }
    await this.credentials.setItem(GEMINI_KEY, key)
    // The library lists voices by ID; Riko's is looked up so the default voice is exact.
    if (riko && this.settings.geminiVoiceName === GEMINI_DEFAULT_VOICE) {
      this.settings = { ...this.settings, geminiVoiceId: riko.id, geminiVoiceName: riko.name }
      this.writeSettings()
    }
    return this.status()
  }

  async clearGeminiKey(): Promise<NarrationStatus> {
    await this.credentials.removeItem(GEMINI_KEY)
    if (this.settings.engine === 'gemini') {
      this.settings = { ...this.settings, engine: 'system' }
      this.writeSettings()
    }
    return this.status()
  }

  async listVoices(input: { search?: string; pageToken?: string }): Promise<NarrationVoiceList> {
    const key = await this.requireGeminiKey()
    try {
      return await listGeminiVoices(this.fetchImpl, key, { ...input, pageSize: 60 })
    } catch (error) {
      throw this.toStoryboundError(error)
    }
  }

  /** Spoken audio for one passage, as WAV bytes, from the cache when it has been heard before. */
  async synthesize(input: NarrationSynthesisInput): Promise<Uint8Array> {
    if (!this.settings.geminiConsentedAt) {
      throw new StoryboundError(
        'VALIDATION_ERROR',
        'Agree to sending chapter text to Google before using the Google voice.'
      )
    }
    const key = await this.requireGeminiKey()
    const voice = input.voiceId ?? this.settings.geminiVoiceId
    const style = input.style ?? (this.settings.geminiStyle || null)
    const cacheFile = join(
      this.cachePath,
      `${createHash('sha256')
        .update(JSON.stringify(['gemini', GEMINI_TTS_MODEL, voice, style, input.text]))
        .digest('hex')}.wav`
    )
    try {
      const cached = await readFile(cacheFile)
      const now = new Date()
      await utimes(cacheFile, now, now).catch(() => undefined)
      return new Uint8Array(cached)
    } catch {
      // Not heard before.
    }

    let audio: Uint8Array | null = null
    for (let attempt = 0; audio === null; attempt += 1) {
      try {
        audio = await synthesizeWithGemini(this.fetchImpl, key, { text: input.text, style, voice })
      } catch (error) {
        const retry = error instanceof GeminiSpeechError && error.retryable
        if (!retry || attempt >= RETRY_DELAYS_MS.length) throw this.toStoryboundError(error)
        await wait(RETRY_DELAYS_MS[attempt])
      }
    }
    await mkdir(this.cachePath, { recursive: true })
    await writeFile(cacheFile, audio)
    void this.trimCache().catch(() => undefined)
    return audio
  }

  private async trimCache(): Promise<void> {
    const names = await readdir(this.cachePath)
    const files = await Promise.all(
      names
        .filter((name) => name.endsWith('.wav'))
        .map(async (name) => {
          const path = join(this.cachePath, name)
          const info = await stat(path)
          return { path, size: info.size, used: info.mtimeMs }
        })
    )
    let total = files.reduce((sum, file) => sum + file.size, 0)
    for (const file of files.sort((left, right) => left.used - right.used)) {
      if (total <= CACHE_LIMIT_BYTES) break
      await unlink(file.path).catch(() => undefined)
      total -= file.size
    }
  }

  private async geminiKey(): Promise<string | null> {
    try {
      return await this.credentials.getItem(GEMINI_KEY)
    } catch {
      return null
    }
  }

  private async requireGeminiKey(): Promise<string> {
    const key = await this.geminiKey()
    if (!key) {
      throw new StoryboundError(
        'VALIDATION_ERROR',
        'Add your Google API key in Settings → Listening first.'
      )
    }
    return key
  }

  private toStoryboundError(error: unknown): StoryboundError {
    if (error instanceof StoryboundError) return error
    if (error instanceof GeminiSpeechError) {
      return new StoryboundError(
        error.retryable ? 'NETWORK_ERROR' : 'VALIDATION_ERROR',
        error.message,
        error
      )
    }
    return new StoryboundError('NETWORK_ERROR', 'The Google voice could not be reached.', error)
  }

  private readSettings(): NarrationSettings {
    try {
      const parsed = settingsSchema.safeParse(
        JSON.parse(readFileSync(join(this.dataPath, SETTINGS_FILE), 'utf8'))
      )
      return parsed.success ? parsed.data : { ...DEFAULT_SETTINGS }
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }

  private writeSettings(): void {
    mkdirSync(this.dataPath, { recursive: true })
    const target = join(this.dataPath, SETTINGS_FILE)
    const temporary = `${target}.tmp`
    writeFileSync(temporary, JSON.stringify(this.settings, null, 2), { mode: 0o600 })
    renameSync(temporary, target)
  }
}
