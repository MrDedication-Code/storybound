import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  float32ToPcm16,
  KokoroPhonemizer,
  kokoroStyleRow,
  kokoroVoice,
  pcm16ToWav,
  KOKORO_LEXICONS,
  KOKORO_SAMPLE_RATE,
  KOKORO_STYLE_SIZE,
  type KokoroLexicon
} from '@storybound/narration'
import type { InferenceSession, Tensor } from 'onnxruntime-node'

/**
 * Speaks text with Kokoro from the files in a voice folder. It runs in the free voice's own
 * background process (see kokoroWorker), because the model holds the thread it runs on and uses
 * close to a gigabyte of memory while it does.
 */
export class KokoroInference {
  private session: Promise<InferenceSession> | null = null
  private runtime: Promise<typeof import('onnxruntime-node')> | null = null
  private readonly phonemizers = new Map<'us' | 'gb', Promise<KokoroPhonemizer>>()
  private readonly styles = new Map<string, Promise<Float32Array>>()

  constructor(
    private readonly folder: string,
    private readonly modelName: string
  ) {}

  async speak(text: string, voiceId: string): Promise<Uint8Array> {
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
    if (!pieces.length) throw new Error('This passage has nothing to read.')
    const samples = new Float32Array(pieces.reduce((sum, piece) => sum + piece.length, 0))
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
      ort.InferenceSession.create(join(this.folder, this.modelName), {
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
}
