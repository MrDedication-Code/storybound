import {
  GEMINI_TTS_MODEL,
  GeminiSpeechError,
  geminiLimitMessage,
  listGeminiVoices,
  synthesizeWithGemini,
  type GeminiVoice,
  type NarrationSegment
} from '@storybound/narration'
import { cachedAudio, silenceAudio, trimAudioCache } from './audioCache'
import { createKokoroVoice, kokoroInstalled } from './kokoroVoice'
import type { ListeningVoice } from './listeningSession'
import { loadGeminiKey, loadNarrationSettings, type NarrationSettings } from './narrationSettings'

export class ListeningSetupNeeded extends Error {}

/** The voice chosen in Listening settings, ready to read. */
export async function createListeningVoice(): Promise<{
  voice: ListeningVoice
  settings: NarrationSettings
}> {
  const settings = await loadNarrationSettings()
  if (settings.engine === 'kokoro') {
    if (!(await kokoroInstalled())) throw new ListeningSetupNeeded('Download the free voice first.')
    return { settings, voice: await createKokoroVoice(settings.kokoroVoiceId) }
  }
  return createGoogleVoice()
}

/** Google's voice, with each passage kept on the phone once made so listening again is free. */
export async function createGoogleVoice(): Promise<{
  voice: ListeningVoice
  settings: NarrationSettings
}> {
  const [settings, key] = await Promise.all([loadNarrationSettings(), loadGeminiKey()])
  if (!key) throw new ListeningSetupNeeded('Add your Google API key to listen.')
  if (!settings.geminiConsent) {
    throw new ListeningSetupNeeded('Agree to send chapter text to Google to listen.')
  }
  trimAudioCache()
  return {
    settings,
    voice: {
      speak: (segment: NarrationSegment) =>
        speakWithGoogle(key, {
          text: segment.text,
          style: segment.style ?? settings.geminiStyle,
          voice: settings.geminiVoiceId
        }),
      silence: silenceAudio,
      metered: true,
      whenLimited: async () =>
        (await kokoroInstalled()) ? createKokoroVoice(settings.kokoroVoiceId) : null
    }
  }
}

/** Kept in memory only: after a restart, one refused request finds the limit again. */
let limitedUntil: Date | null = null

async function askGoogle(
  key: string,
  input: { text: string; style: string; voice: string }
): Promise<Uint8Array> {
  // Audio heard before still plays. New audio cannot, so Google is not asked again.
  if (limitedUntil && limitedUntil > new Date()) {
    throw new GeminiSpeechError(geminiLimitMessage(limitedUntil), 429, false, null, limitedUntil)
  }
  try {
    return await synthesizeWithGemini(fetch, key, {
      text: input.text,
      style: input.style || null,
      voice: input.voice
    })
  } catch (error) {
    if (error instanceof GeminiSpeechError && error.limitedUntil) limitedUntil = error.limitedUntil
    throw error
  }
}

export function speakWithGoogle(
  key: string,
  input: { text: string; style: string; voice: string }
): Promise<string> {
  const style = input.style.trim()
  return cachedAudio(['gemini', GEMINI_TTS_MODEL, input.voice, style, input.text], () =>
    askGoogle(key, { ...input, style })
  )
}

/** Checks a key with Google by looking up the default voice, and returns that voice. */
export async function checkGeminiKey(key: string): Promise<GeminiVoice | null> {
  const result = await listGeminiVoices(fetch, key, { search: 'Riko', pageSize: 10 })
  return result.voices.find((voice) => voice.name.toLowerCase() === 'riko') ?? null
}

export function searchGeminiVoices(
  key: string,
  search: string
): Promise<{ voices: GeminiVoice[]; nextPageToken: string | null }> {
  return listGeminiVoices(fetch, key, { search: search.trim() || undefined, pageSize: 30 })
}

export { GeminiSpeechError }
