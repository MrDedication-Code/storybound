import * as SecureStore from 'expo-secure-store'
import { GEMINI_DEFAULT_STYLE, GEMINI_DEFAULT_VOICE } from '@storybound/narration'

/** Listening preferences for this phone; the Google API key is kept separately below. */
export interface NarrationSettings {
  geminiVoiceId: string
  geminiVoiceName: string
  geminiStyle: string
  /** The writer agreed that passages they listen to are sent to Google to make the audio. */
  geminiConsent: boolean
  speed: number
}

export const DEFAULT_NARRATION_SETTINGS: NarrationSettings = {
  geminiVoiceId: GEMINI_DEFAULT_VOICE,
  geminiVoiceName: GEMINI_DEFAULT_VOICE,
  geminiStyle: GEMINI_DEFAULT_STYLE,
  geminiConsent: false,
  speed: 1
}

const SETTINGS_KEY = 'storybound.narration.settings'
const API_KEY = 'storybound.narration.gemini-api-key'
// The key stays on this phone only: never in the library database, backups, or sync.
const KEY_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY
}

export async function loadNarrationSettings(): Promise<NarrationSettings> {
  try {
    const stored = await SecureStore.getItemAsync(SETTINGS_KEY)
    if (!stored) return { ...DEFAULT_NARRATION_SETTINGS }
    const value = JSON.parse(stored) as Partial<NarrationSettings>
    const text = (input: unknown, fallback: string, maximum: number): string =>
      typeof input === 'string' && input.trim() ? input.trim().slice(0, maximum) : fallback
    return {
      geminiVoiceId: text(value.geminiVoiceId, GEMINI_DEFAULT_VOICE, 200),
      geminiVoiceName: text(value.geminiVoiceName, GEMINI_DEFAULT_VOICE, 200),
      geminiStyle:
        typeof value.geminiStyle === 'string'
          ? value.geminiStyle.slice(0, 500)
          : GEMINI_DEFAULT_STYLE,
      geminiConsent: value.geminiConsent === true,
      speed:
        typeof value.speed === 'number' && value.speed >= 0.5 && value.speed <= 2.5
          ? value.speed
          : 1
    }
  } catch {
    return { ...DEFAULT_NARRATION_SETTINGS }
  }
}

export async function saveNarrationSettings(
  changes: Partial<NarrationSettings>
): Promise<NarrationSettings> {
  const next = { ...(await loadNarrationSettings()), ...changes }
  await SecureStore.setItemAsync(SETTINGS_KEY, JSON.stringify(next), KEY_OPTIONS)
  return next
}

export async function loadGeminiKey(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(API_KEY, KEY_OPTIONS)
  } catch {
    return null
  }
}

export async function saveGeminiKey(key: string): Promise<void> {
  await SecureStore.setItemAsync(API_KEY, key, KEY_OPTIONS)
}

export async function removeGeminiKey(): Promise<void> {
  await SecureStore.deleteItemAsync(API_KEY, KEY_OPTIONS)
}
