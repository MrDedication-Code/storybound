import { base64ToBytes } from './base64'
import { isWav, pcm16ToWav } from './wav'

/**
 * Google's Gemini text-to-speech, called directly from each device with the writer's own API
 * key: a request carries one passage, its reading style, and the chosen voice.
 */
export const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta'
export const GEMINI_TTS_MODEL = 'gemini-3.8-flash-tts'
export const GEMINI_DEFAULT_VOICE = 'Riko'
export const GEMINI_DEFAULT_STYLE = 'Rich, velvety, unhurried audiobook narration'
const SAMPLE_RATE = 24000

export interface GeminiSpeechInput {
  text: string
  /** How the passage is read. Null uses the default narration style. */
  style: string | null
  voice: string
  model?: string
}

export interface GeminiVoice {
  id: string
  name: string
  description: string
  gender: string | null
  accent: string | null
  pitch: string | null
  languageCode: string | null
}

export class GeminiSpeechError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    /** True when retrying later may work (rate limits, outages, a dropped connection). */
    readonly retryable: boolean
  ) {
    super(message)
    this.name = 'GeminiSpeechError'
  }
}

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string }
) => Promise<{
  ok: boolean
  status: number
  json(): Promise<unknown>
  text(): Promise<string>
}>

export function geminiSpeechBody(input: GeminiSpeechInput): Record<string, unknown> {
  const style = (input.style ?? GEMINI_DEFAULT_STYLE).trim()
  return {
    model: input.model ?? GEMINI_TTS_MODEL,
    input: [
      {
        type: 'user_input',
        content: [
          {
            type: 'text',
            text: input.text,
            ...(style ? { annotations: [{ type: 'speech_metadata', style }] } : {})
          }
        ]
      }
    ],
    response_format: { type: 'audio', mime_type: 'audio/wav', sample_rate: SAMPLE_RATE },
    generation_config: { speech_config: [{ voice: input.voice }] }
  }
}

function findAudio(value: unknown, depth = 0): string | null {
  if (depth > 8 || !value || typeof value !== 'object') return null
  if (Array.isArray(value)) {
    // The documented reply holds the audio in the last audio item of the model's output.
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const found = findAudio(value[index], depth + 1)
      if (found) return found
    }
    return null
  }
  const record = value as Record<string, unknown>
  if (record.type === 'audio' && typeof record.data === 'string') return record.data
  const inline = record.inlineData ?? record.inline_data
  if (inline && typeof inline === 'object') {
    const data = (inline as Record<string, unknown>).data
    if (typeof data === 'string') return data
  }
  for (const key of ['steps', 'content', 'outputs', 'candidates', 'parts']) {
    const found = findAudio(record[key], depth + 1)
    if (found) return found
  }
  return null
}

/** The WAV audio in a Gemini reply. Raw 16-bit PCM is wrapped so players can open it. */
export function geminiAudioFromResponse(response: unknown): Uint8Array {
  const data = findAudio(response)
  if (!data) throw new GeminiSpeechError('Google returned no audio for this passage.', null, true)
  const bytes = base64ToBytes(data)
  return isWav(bytes) ? bytes : pcm16ToWav(bytes, SAMPLE_RATE)
}

export function parseGeminiVoices(response: unknown): {
  voices: GeminiVoice[]
  nextPageToken: string | null
} {
  const record = (response ?? {}) as Record<string, unknown>
  const list = Array.isArray(record.voices) ? record.voices : []
  const text = (item: Record<string, unknown>, ...keys: string[]): string | null => {
    for (const key of keys) {
      const value = item[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
    return null
  }
  const voices = list.flatMap((entry): GeminiVoice[] => {
    if (!entry || typeof entry !== 'object') return []
    const item = entry as Record<string, unknown>
    const id = text(item, 'id', 'name', 'voice')
    if (!id) return []
    return [
      {
        id,
        name: text(item, 'display_name', 'displayName') ?? id,
        description: text(item, 'description') ?? '',
        gender: text(item, 'gender'),
        accent: text(item, 'accent'),
        pitch: text(item, 'pitch'),
        languageCode: text(item, 'language_code', 'languageCode')
      }
    ]
  })
  const next = text(record, 'next_page_token', 'nextPageToken')
  return { voices, nextPageToken: next }
}

async function failure(response: Awaited<ReturnType<FetchLike>>): Promise<GeminiSpeechError> {
  let detail = ''
  try {
    const body = (await response.json()) as { error?: { message?: string } }
    detail = body.error?.message ?? ''
  } catch {
    // A reply without a JSON error body still has its status code.
  }
  const status = response.status
  if (status === 400 && /api key/i.test(detail)) {
    return new GeminiSpeechError('Google did not accept this API key.', status, false)
  }
  if (status === 401 || status === 403) {
    return new GeminiSpeechError(
      'Google refused this API key. Check that it is correct and that billing is set up.',
      status,
      false
    )
  }
  if (status === 429) {
    return new GeminiSpeechError(
      'Google is limiting requests just now. Trying again shortly.',
      status,
      true
    )
  }
  if (status >= 500) {
    return new GeminiSpeechError('Google’s voice service is unavailable just now.', status, true)
  }
  return new GeminiSpeechError(detail || `Google returned an error (${status}).`, status, false)
}

export async function synthesizeWithGemini(
  fetchImpl: FetchLike,
  apiKey: string,
  input: GeminiSpeechInput
): Promise<Uint8Array> {
  let response: Awaited<ReturnType<FetchLike>>
  try {
    response = await fetchImpl(`${GEMINI_API}/interactions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(geminiSpeechBody(input))
    })
  } catch {
    throw new GeminiSpeechError(
      'Could not reach Google. Check the internet connection.',
      null,
      true
    )
  }
  if (!response.ok) throw await failure(response)
  return geminiAudioFromResponse(await response.json())
}

export async function listGeminiVoices(
  fetchImpl: FetchLike,
  apiKey: string,
  options: { search?: string; pageToken?: string; pageSize?: number } = {}
): Promise<{ voices: GeminiVoice[]; nextPageToken: string | null }> {
  const query = new URLSearchParams({ page_size: String(options.pageSize ?? 100) })
  if (options.search) query.set('search', options.search)
  if (options.pageToken) query.set('page_token', options.pageToken)
  let response: Awaited<ReturnType<FetchLike>>
  try {
    response = await fetchImpl(`${GEMINI_API}/voices?${query.toString()}`, {
      method: 'GET',
      headers: { 'x-goog-api-key': apiKey }
    })
  } catch {
    throw new GeminiSpeechError(
      'Could not reach Google. Check the internet connection.',
      null,
      true
    )
  }
  if (!response.ok) throw await failure(response)
  return parseGeminiVoices(await response.json())
}
