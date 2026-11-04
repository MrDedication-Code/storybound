import {
  KokoroPhonemizer,
  KOKORO_LEXICONS,
  KOKORO_MODEL_COMPACT,
  kokoroFiles,
  kokoroVoice,
  type KokoroLexicon,
  type NarrationSegment
} from '@storybound/narration'
import { Directory, File, Paths } from 'expo-file-system'
import { StoryboundKokoro } from '../../modules/storybound-kokoro'
import { cachedAudioFile, silenceAudio, trimAudioCache } from './audioCache'
import type { ListeningVoice } from './listeningSession'

const MODEL = KOKORO_MODEL_COMPACT
const FILES = kokoroFiles(MODEL)
const MARKER = 'installed.json'

export const KOKORO_DOWNLOAD_BYTES = FILES.reduce((sum, file) => sum + file.bytes, 0)

/** Kept with the app's documents, not its cache, so Android does not clear it to save space. */
function folder(): Directory {
  const directory = new Directory(Paths.document, 'voices', 'kokoro')
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true })
  return directory
}

export function kokoroAvailable(): boolean {
  return StoryboundKokoro !== null
}

export async function kokoroInstalled(): Promise<boolean> {
  try {
    const marker = new File(folder(), MARKER)
    if (!marker.exists) return false
    const done = (JSON.parse(await marker.text()) as { files?: string[] }).files ?? []
    return FILES.every((file) => done.includes(file.sha256))
  } catch {
    return false
  }
}

let installing: Promise<void> | null = null

/**
 * Downloads the free voice (about 120 MB), each file checked against its SHA-256. Files already
 * here from an interrupted download are checked and kept.
 */
export function installKokoro(
  onProgress: (received: number, total: number) => void
): Promise<void> {
  installing ??= download(onProgress).finally(() => {
    installing = null
  })
  return installing
}

async function download(onProgress: (received: number, total: number) => void): Promise<void> {
  const native = StoryboundKokoro
  if (!native) throw new Error('The free voice is not available on this device.')
  const directory = folder()
  let completed = 0
  let current = ''
  const subscription = native.addListener('onDownloadProgress', (event) => {
    if (event.path === current) onProgress(completed + event.received, KOKORO_DOWNLOAD_BYTES)
  })
  try {
    for (const item of FILES) {
      const file = new File(directory, item.name)
      if (!(file.exists && (await native.sha256(file.uri)) === item.sha256)) {
        current = file.uri
        await native.download(item.url, file.uri, item.sha256)
      }
      completed += item.bytes
      onProgress(completed, KOKORO_DOWNLOAD_BYTES)
    }
    const marker = new File(directory, MARKER)
    if (!marker.exists) marker.create({ overwrite: true })
    marker.write(JSON.stringify({ files: FILES.map((file) => file.sha256) }))
  } finally {
    subscription.remove()
  }
}

export function removeKokoro(): void {
  StoryboundKokoro?.unload()
  phonemizers.clear()
  const directory = new Directory(Paths.document, 'voices', 'kokoro')
  if (directory.exists) directory.delete()
}

const phonemizers = new Map<'us' | 'gb', Promise<KokoroPhonemizer>>()

function phonemizerFor(accent: 'us' | 'gb'): Promise<KokoroPhonemizer> {
  let pending = phonemizers.get(accent)
  if (!pending) {
    pending = Promise.all(
      KOKORO_LEXICONS[accent].map(
        async (item) => JSON.parse(await new File(folder(), item.name).text()) as KokoroLexicon
      )
    ).then((lexicons) => new KokoroPhonemizer(lexicons, { british: accent === 'gb' }))
    pending.catch(() => phonemizers.delete(accent))
    phonemizers.set(accent, pending)
  }
  return pending
}

/** A passage spoken by a free voice, kept in the narration cache like Google's. */
export async function speakWithKokoro(text: string, voiceId: string): Promise<string> {
  const native = StoryboundKokoro
  if (!native) throw new Error('The free voice is not available on this device.')
  const voice = kokoroVoice(voiceId)
  const phonemizer = await phonemizerFor(voice.accent)
  const directory = folder()
  return cachedAudioFile(['kokoro', MODEL.sha256, voice.id, text], async (file) => {
    const pieces = phonemizer.tokenize(phonemizer.phonemize(text))
    if (!pieces.length) throw new Error('This passage has nothing to read.')
    await native.synthesize(
      new File(directory, MODEL.name).uri,
      new File(directory, `${voice.id}.bin`).uri,
      pieces,
      file.uri
    )
  })
}

export async function createKokoroVoice(voiceId: string): Promise<ListeningVoice> {
  if (!(await kokoroInstalled())) throw new Error('Download the free voice first.')
  trimAudioCache()
  return {
    // The free voice reads the words; performance notes are for Google's voice.
    speak: (segment: NarrationSegment) => speakWithKokoro(segment.plainText, voiceId),
    silence: silenceAudio
  }
}
