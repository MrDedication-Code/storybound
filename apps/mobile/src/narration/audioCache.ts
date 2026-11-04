import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto'
import { Directory, File, Paths } from 'expo-file-system'
import { silenceWav } from '@storybound/narration'

/** Spoken passages kept on the phone so listening again costs nothing; trimmed past this size. */
const CACHE_LIMIT_BYTES = 600 * 1024 * 1024

function folder(): Directory {
  const directory = new Directory(Paths.cache, 'narration')
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true })
  return directory
}

export async function cachedAudio(
  identity: unknown[],
  produce: () => Promise<Uint8Array>
): Promise<string> {
  const name = `${await digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify(identity))}.wav`
  const file = new File(folder(), name)
  if (file.exists && (file.size ?? 0) > 44) return file.uri
  const audio = await produce()
  if (!file.exists) file.create({ overwrite: true })
  await file.write(audio)
  return file.uri
}

export async function silenceAudio(seconds: number): Promise<string> {
  const file = new File(folder(), `silence-${Math.round(seconds * 1000)}.wav`)
  if (!file.exists) {
    file.create({ overwrite: true })
    await file.write(silenceWav(seconds))
  }
  return file.uri
}

/** Removes the oldest cached passages once the cache passes its size limit. */
export function trimAudioCache(): void {
  try {
    const files = folder()
      .list()
      .filter((entry): entry is File => entry instanceof File && entry.name.endsWith('.wav'))
      .map((file) => ({ file, size: file.size ?? 0, time: file.modificationTime ?? 0 }))
    let total = files.reduce((sum, entry) => sum + entry.size, 0)
    for (const entry of files.sort((left, right) => left.time - right.time)) {
      if (total <= CACHE_LIMIT_BYTES) break
      entry.file.delete()
      total -= entry.size
    }
  } catch {
    // Trimming is best effort; the operating system can also clear this cache folder.
  }
}
