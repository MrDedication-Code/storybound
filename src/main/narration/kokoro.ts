import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  float32ToPcm16,
  KokoroPhonemizer,
  kokoroFiles,
  kokoroStyleRow,
  kokoroVoice,
  pcm16ToWav,
  KOKORO_LEXICONS,
  KOKORO_MODEL_FULL,
  KOKORO_SAMPLE_RATE,
  KOKORO_STYLE_SIZE,
  type KokoroFile,
  type KokoroLexicon
} from '@storybound/narration'
import type { InferenceSession, Tensor } from 'onnxruntime-node'

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
  private session: Promise<InferenceSession> | null = null
  private runtime: Promise<typeof import('onnxruntime-node')> | null = null
  private readonly phonemizers = new Map<'us' | 'gb', Promise<KokoroPhonemizer>>()
  private readonly styles = new Map<string, Promise<Float32Array>>()
  private installing: Promise<void> | null = null
  private progress: KokoroProgress | null = null
  /** Passages are spoken one at a time, so preparing ahead never competes with playback. */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly folder: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly model: KokoroFile = KOKORO_MODEL_FULL,
    private readonly files: KokoroFile[] = kokoroFiles(model)
  ) {}

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
    this.session = null
    this.phonemizers.clear()
    this.styles.clear()
    await rm(this.folder, { recursive: true, force: true })
  }

  /** One passage spoken in a voice, as WAV bytes. */
  synthesize(text: string, voiceId: string): Promise<Uint8Array> {
    const job = this.queue.then(() => this.speak(text, voiceId))
    this.queue = job.catch(() => undefined)
    return job
  }

  private async speak(text: string, voiceId: string): Promise<Uint8Array> {
    if (!(await this.isInstalled())) {
      throw new Error('Download the free voice in Settings → Listening first.')
    }
    const voice = kokoroVoice(voiceId)
    const [ort, session, phonemizer, styles] = await Promise.all([
      this.loadRuntime(),
      this.loadSession(),
      this.loadPhonemizer(voice.accent),
      this.loadStyles(voice.id)
    ])
    const pieces: Float32Array[] = []
    for (const ids of phonemizer.tokenize(phonemizer.phonemize(text))) {
      const row = kokoroStyleRow(ids.length)
      const feeds: Record<string, Tensor> = {
        [session.inputNames[0]]: new ort.Tensor(
          'int64',
          BigInt64Array.from(ids.map((id) => BigInt(id))),
          [1, ids.length]
        ),
        [session.inputNames[1]]: new ort.Tensor(
          'float32',
          styles.slice(row * KOKORO_STYLE_SIZE, (row + 1) * KOKORO_STYLE_SIZE),
          [1, KOKORO_STYLE_SIZE]
        ),
        [session.inputNames[2]]: new ort.Tensor('float32', Float32Array.from([1]), [1])
      }
      const output = await session.run(feeds)
      pieces.push(output[session.outputNames[0]].data as Float32Array)
    }
    const total = pieces.reduce((sum, piece) => sum + piece.length, 0)
    const samples = new Float32Array(total)
    let offset = 0
    for (const piece of pieces) {
      samples.set(piece, offset)
      offset += piece.length
    }
    return pcm16ToWav(float32ToPcm16(samples), KOKORO_SAMPLE_RATE)
  }

  private loadRuntime(): Promise<typeof import('onnxruntime-node')> {
    this.runtime ??= import('onnxruntime-node')
    return this.runtime
  }

  private loadSession(): Promise<InferenceSession> {
    this.session ??= this.loadRuntime().then((ort) =>
      ort.InferenceSession.create(join(this.folder, this.model.name), {
        executionProviders: ['cpu'],
        intraOpNumThreads: 4,
        graphOptimizationLevel: 'all'
      })
    )
    this.session.catch(() => {
      this.session = null
    })
    return this.session
  }

  private loadPhonemizer(accent: 'us' | 'gb'): Promise<KokoroPhonemizer> {
    let pending = this.phonemizers.get(accent)
    if (!pending) {
      pending = Promise.all(
        KOKORO_LEXICONS[accent].map(
          async (file) =>
            JSON.parse(await readFile(join(this.folder, file.name), 'utf8')) as KokoroLexicon
        )
      ).then((lexicons) => new KokoroPhonemizer(lexicons, { british: accent === 'gb' }))
      pending.catch(() => this.phonemizers.delete(accent))
      this.phonemizers.set(accent, pending)
    }
    return pending
  }

  private loadStyles(voiceId: string): Promise<Float32Array> {
    let pending = this.styles.get(voiceId)
    if (!pending) {
      pending = readFile(join(this.folder, `${voiceId}.bin`)).then(
        (bytes) => new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
      )
      pending.catch(() => this.styles.delete(voiceId))
      this.styles.set(voiceId, pending)
    }
    return pending
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
