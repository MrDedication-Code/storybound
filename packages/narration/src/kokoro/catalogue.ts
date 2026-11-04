/**
 * Where the free offline voice comes from. Every file is fetched from a fixed revision and
 * checked against its SHA-256 before use, so a changed or damaged download is never run.
 *
 * - Model and voices: Kokoro-82M v1.0 (Apache-2.0, hexgrad), as converted to ONNX by
 *   onnx-community on Hugging Face.
 * - Pronunciation dictionaries: misaki (Apache-2.0, hexgrad), Kokoro's own.
 */
const MODEL_BASE =
  'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231'
const MISAKI_BASE =
  'https://raw.githubusercontent.com/hexgrad/misaki/fba1236595f2d2bf21d414ba6e57d25256afada3/misaki/data'

export interface KokoroFile {
  /** Name it is saved under in the voice folder. */
  name: string
  url: string
  bytes: number
  sha256: string
}

/** The full model, for computers. */
export const KOKORO_MODEL_FULL: KokoroFile = {
  name: 'kokoro-v1.0.onnx',
  url: `${MODEL_BASE}/onnx/model.onnx`,
  bytes: 325_532_232,
  sha256: '8fbea51ea711f2af382e88c833d9e288c6dc82ce5e98421ea61c058ce21a34cb'
}

/** The 8-bit model: a third of the size and quicker, for phones. */
export const KOKORO_MODEL_COMPACT: KokoroFile = {
  name: 'kokoro-v1.0-q8.onnx',
  url: `${MODEL_BASE}/onnx/model_quantized.onnx`,
  bytes: 92_361_116,
  sha256: 'fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478'
}

export const KOKORO_LEXICONS: Record<'us' | 'gb', KokoroFile[]> = {
  us: [
    {
      name: 'misaki-us-gold.json',
      url: `${MISAKI_BASE}/us_gold.json`,
      bytes: 3_000_469,
      sha256: 'dc414872a49a28ae6c141463d502fd945f3b2fde040484fdc47d00cc4612686f'
    },
    {
      name: 'misaki-us-silver.json',
      url: `${MISAKI_BASE}/us_silver.json`,
      bytes: 3_099_517,
      sha256: 'de8f67be911bb6c659187b4a65fd966b6a30e56350e0f790d763210b053ac475'
    }
  ],
  gb: [
    {
      name: 'misaki-gb-gold.json',
      url: `${MISAKI_BASE}/gb_gold.json`,
      bytes: 2_838_552,
      sha256: '29e62f4b60261c88f7f3c2c7811ca3825978948090b72d2b27d565b729282f71'
    },
    {
      name: 'misaki-gb-silver.json',
      url: `${MISAKI_BASE}/gb_silver.json`,
      bytes: 3_663_898,
      sha256: '48131e2d92ccc41655f4543e87e0f938e71463eb5a54be7f0693bb712ebb6bce'
    }
  ]
}

export interface KokoroVoice {
  id: string
  name: string
  accent: 'us' | 'gb'
  description: string
  sha256: string
}

/** The English voices worth listening to a book in, best first within each accent. */
export const KOKORO_VOICES: KokoroVoice[] = [
  {
    id: 'af_heart',
    name: 'Heart',
    accent: 'us',
    description: 'Warm, expressive American woman',
    sha256: 'd583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b'
  },
  {
    id: 'af_bella',
    name: 'Bella',
    accent: 'us',
    description: 'Bright, lively American woman',
    sha256: 'f69d836209b78eb8c66e75e3cda491e26ea838a3674257e9d4e5703cbaf55c8b'
  },
  {
    id: 'af_nicole',
    name: 'Nicole',
    accent: 'us',
    description: 'Soft, close American woman',
    sha256: 'cd2191ab31b914ed7b318416b0e4440fdf392ddad9106a060819aa600a64f59a'
  },
  {
    id: 'af_aoede',
    name: 'Aoede',
    accent: 'us',
    description: 'Smooth American woman',
    sha256: '4a004c33430762e2461eedb2013fad808ef4ab3121f5300f554476caf58d8361'
  },
  {
    id: 'af_kore',
    name: 'Kore',
    accent: 'us',
    description: 'Clear, steady American woman',
    sha256: '9be5221b6a941c04b561959b8ff0b06e809444dcc4ab7e75a7b23606f691819e'
  },
  {
    id: 'af_sarah',
    name: 'Sarah',
    accent: 'us',
    description: 'Friendly American woman',
    sha256: '4409fbc125afabacc615d94db5398d847006a737b0247d6892b7a9a0007a2f0a'
  },
  {
    id: 'am_fenrir',
    name: 'Fenrir',
    accent: 'us',
    description: 'Deep American man',
    sha256: 'c27989f741f7ee34d273a39d8a595cc0837d35f5ced9a29b7cc162614616df43'
  },
  {
    id: 'am_michael',
    name: 'Michael',
    accent: 'us',
    description: 'Calm American man',
    sha256: '1d1f21dd8da39c30705cd4c75d039d265e9bc4a2a93ed09bc9e1b1225eb95ba1'
  },
  {
    id: 'am_puck',
    name: 'Puck',
    accent: 'us',
    description: 'Playful American man',
    sha256: 'fcf73c989033e9233e0b98713eca600c8c74dcc1614b37009d5450ff4a2274a0'
  },
  {
    id: 'bf_emma',
    name: 'Emma',
    accent: 'gb',
    description: 'Poised British woman',
    sha256: '669fe0647f9dd04fcab92f1439a40eeb4c8b4ab1f82e4996fe3d918ce4a63b73'
  },
  {
    id: 'bf_isabella',
    name: 'Isabella',
    accent: 'gb',
    description: 'Gentle British woman',
    sha256: '3754352c4aaa46d17f27654ab7518d65b62ad6163a0f55a5f4330c2da2c4e94f'
  },
  {
    id: 'bm_george',
    name: 'George',
    accent: 'gb',
    description: 'Classic British storyteller',
    sha256: 'c4b235a4c1f2cd3b939fed08b899ce9385638b763f7b73a59616c4fc9bd6c9bc'
  },
  {
    id: 'bm_fable',
    name: 'Fable',
    accent: 'gb',
    description: 'Rich British man',
    sha256: 'f889083196807b4adb15e9204252165f503b8d33d3982e681c52443c49d798f1'
  },
  {
    id: 'bm_lewis',
    name: 'Lewis',
    accent: 'gb',
    description: 'Low British man',
    sha256: 'b8f671cef828c30e66fdf0b0756a76bba58f6bb3398cbbf27058642acbcedb97'
  }
]

export const KOKORO_DEFAULT_VOICE = 'bm_george'
export const KOKORO_VOICE_BYTES = 522_240
export const KOKORO_SAMPLE_RATE = 24_000
/** Numbers in one style row of a voice file; a voice holds one row per passage length. */
export const KOKORO_STYLE_SIZE = 256

export function kokoroVoiceFile(voice: KokoroVoice): KokoroFile {
  return {
    name: `${voice.id}.bin`,
    url: `${MODEL_BASE}/voices/${voice.id}.bin`,
    bytes: KOKORO_VOICE_BYTES,
    sha256: voice.sha256
  }
}

/** Every file the offline voice needs on a device, for its model size. */
export function kokoroFiles(model: KokoroFile): KokoroFile[] {
  return [
    model,
    ...KOKORO_LEXICONS.us,
    ...KOKORO_LEXICONS.gb,
    ...KOKORO_VOICES.map(kokoroVoiceFile)
  ]
}

export function kokoroVoice(id: string): KokoroVoice {
  return KOKORO_VOICES.find((voice) => voice.id === id) ?? KOKORO_VOICES[0]
}

/** The style row for a passage of this many tokens (padding included). */
export function kokoroStyleRow(tokenCount: number): number {
  return Math.min(Math.max(tokenCount - 2, 0), 509)
}
