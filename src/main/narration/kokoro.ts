import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { kokoroFiles, KOKORO_MODEL_FULL, type KokoroFile } from '@storybound/narration'

const INSTALLED_MARKER = 'installed.json'

export interface KokoroProgress {
  received: number
  total: number
}

/**
 * Kokoro, the free voice that runs on this computer. Its files are downloaded once, checked
 * against fixed SHA-256 hashes, and kept in the app's data folder; after that nothing leaves the
 * computer.
 */
export class KokoroEngine {
  private installing: Promise<void> | null = null
  private progress: KokoroProgress | null = null
  /** Passages are spoken one at a time, so preparing ahead never competes with playback. */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly folder: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly model: KokoroFile = KOKORO_MODEL_FULL,
    private readonly files: KokoroFile[] = kokoroFiles(model),
    /** Speaks a passage from the installed files; in the app, a background process does it. */
    private readonly speak: (text: string, voiceId: string) => Promise<Uint8Array> = () =>
      Promise.reject(new Error('The free voice is not available here.'))
  ) {}

  get modelName(): string {
    return this.model.name
  }

  get downloadBytes(): number {
    return this.files.reduce((sum, file) => sum + file.bytes, 0)
  }

  get installProgress(): KokoroProgress | null {
    return this.progress
  }

  async isInstalled(): Promise<boolean> {
    try {
      const marker = JSON.parse(await readFile(join(this.folder, INSTALLED_MARKER), 'utf8')) as {
        files?: string[]
      }
      const expected = this.files.map((file) => file.sha256)
      return expected.every((hash) => marker.files?.includes(hash))
    } catch {
      return false
    }
  }

  /** Downloads anything missing; a second call while downloading waits for the first. */
  install(): Promise<void> {
    this.installing ??= this.download().finally(() => {
      this.installing = null
      this.progress = null
    })
    return this.installing
  }

  async remove(): Promise<void> {
    await this.installing?.catch(() => undefined)
    await rm(this.folder, { recursive: true, force: true })
  }

  /** One passage spoken in a voice, as WAV bytes. */
  synthesize(text: string, voiceId: string): Promise<Uint8Array> {
    const job = this.queue.then(() => this.run(text, voiceId))
    this.queue = job.catch(() => undefined)
    return job
  }

  private async run(text: string, voiceId: string): Promise<Uint8Array> {
    if (!(await this.isInstalled())) {
      throw new Error('Download the free voice in Settings → Listening first.')
    }
    return this.speak(text, voiceId)
  }

  private async download(): Promise<void> {
    await mkdir(this.folder, { recursive: true })
    const files = this.files
    const total = files.reduce((sum, file) => sum + file.bytes, 0)
    let received = 0
    this.progress = { received, total }
    for (const file of files) {
      const target = join(this.folder, file.name)
      if (await this.matches(target, file)) {
        received += file.bytes
        this.progress = { received, total }
        continue
      }
      const partial = `${target}.part`
      const response = await this.fetchImpl(file.url)
      if (!response.ok || !response.body) {
        throw new Error(`The free voice could not be downloaded (${response.status}).`)
      }
      const hash = createHash('sha256')
      const counted = Readable.fromWeb(response.body as never)
      counted.on('data', (chunk: Buffer) => {
        hash.update(chunk)
        received += chunk.length
        this.progress = { received, total }
      })
      await pipeline(counted, createWriteStream(partial))
      if (hash.digest('hex') !== file.sha256) {
        await rm(partial, { force: true })
        throw new Error('A downloaded voice file was damaged. Try again.')
      }
      await rename(partial, target)
    }
    await writeFile(
      join(this.folder, INSTALLED_MARKER),
      JSON.stringify({ files: files.map((file) => file.sha256) })
    )
  }

  private async matches(path: string, file: KokoroFile): Promise<boolean> {
    try {
      if ((await stat(path)).size !== file.bytes) return false
      const hash = createHash('sha256')
        .update(await readFile(path))
        .digest('hex')
      return hash === file.sha256
    } catch {
      return false
    }
  }
}
