import {
  GEMINI_TTS_MODEL,
  GeminiSpeechError,
  listGeminiVoices,
  synthesizeWithGemini,
  type GeminiVoice,
  type NarrationSegment
} from '@storybound/narration'
import { cachedAudio, silenceAudio, trimAudioCache } from './audioCache'
import type { ListeningVoice } from './listeningSession'
import { loadGeminiKey, loadNarrationSettings, type NarrationSettings } from './narrationSettings'

export class ListeningSetupNeeded extends Error {}

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
      silence: silenceAudio
    }
  }
}

export function speakWithGoogle(
  key: string,
  input: { text: string; style: string; voice: string }
): Promise<string> {
  const style = input.style.trim()
  return cachedAudio(['gemini', GEMINI_TTS_MODEL, input.voice, style, input.text], () =>
    synthesizeWithGemini(fetch, key, { text: input.text, style: style || null, voice: input.voice })
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
