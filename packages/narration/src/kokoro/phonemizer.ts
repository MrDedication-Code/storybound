import { britishSounds, guessPronunciation } from './letterToSound'
import { spellNumbers } from './numbers'
import { KOKORO_MAX_TOKENS, KOKORO_PAD, KOKORO_VOCAB } from './vocab'

/**
 * A pronunciation dictionary in misaki's format (Kokoro's own): a word maps to its phonemes, or,
 * for words said differently by part of speech ("read", "live", "close"), to one per tag.
 */
export type KokoroLexicon = Record<string, string | Record<string, string | null>>

type Entry = string | Record<string, string | null>

const ABBREVIATIONS: Record<string, string> = {
  mr: 'Mister',
  mrs: 'Missus',
  ms: 'Miz',
  dr: 'Doctor',
  st: 'Saint',
  prof: 'Professor',
  capt: 'Captain',
  lt: 'Lieutenant',
  sgt: 'Sergeant',
  col: 'Colonel',
  gen: 'General',
  rev: 'Reverend',
  jr: 'Junior',
  sr: 'Senior',
  vs: 'versus',
  etc: 'et cetera'
}

// Words before a verb, a past form, or a noun, to choose between "read" and "read".
const BEFORE_VERB = new Set([
  'to',
  'will',
  'would',
  'can',
  'could',
  'should',
  'must',
  'might',
  'may',
  'shall',
  'i',
  'we',
  'they',
  'you',
  "don't",
  "didn't",
  "won't",
  "can't",
  "couldn't",
  "wouldn't",
  "shouldn't",
  'not',
  'let',
  'please'
])
const BEFORE_PAST = new Set([
  'had',
  'has',
  'have',
  'was',
  'were',
  'been',
  'is',
  'are',
  'be',
  "i've",
  "we've",
  "they've",
  "you've",
  "he'd",
  "she'd",
  "i'd",
  "hadn't",
  "hasn't",
  "haven't"
])
const BEFORE_NOUN = new Set([
  'a',
  'an',
  'the',
  'my',
  'his',
  'her',
  'their',
  'our',
  'your',
  'its',
  'this',
  'that',
  'these',
  'those',
  'every',
  'each',
  'some',
  'no'
])

const STRESS = /[ˈˌ]/gu
const VOICELESS = new Set(['p', 't', 'k', 'f', 'θ'])
const SIBILANTS = new Set(['s', 'z', 'ʃ', 'ʒ', 'ʧ', 'ʤ'])

function lastSound(phonemes: string): string {
  return phonemes.replace(STRESS, '').slice(-1)
}

function plural(stem: string): string {
  const last = lastSound(stem)
  if (SIBILANTS.has(last)) return `${stem}ɪz`
  return `${stem}${VOICELESS.has(last) ? 's' : 'z'}`
}

function past(stem: string): string {
  const last = lastSound(stem)
  if (last === 't' || last === 'd') return `${stem}ɪd`
  return `${stem}${VOICELESS.has(last) || ['s', 'ʃ', 'ʧ'].includes(last) ? 't' : 'd'}`
}

/** Endings tried when a word is not in the dictionary: the stems to look up, and the sound. */
const SUFFIXES: {
  ending: string
  stems: (word: string) => string[]
  add: (stem: string) => string
}[] = [
  { ending: "'s", stems: (w) => [w.slice(0, -2)], add: plural },
  { ending: "s'", stems: (w) => [w.slice(0, -1)], add: (stem) => stem },
  { ending: 'ies', stems: (w) => [`${w.slice(0, -3)}y`], add: plural },
  { ending: 'es', stems: (w) => [w.slice(0, -2), w.slice(0, -1)], add: plural },
  { ending: 's', stems: (w) => [w.slice(0, -1)], add: plural },
  { ending: 'ied', stems: (w) => [`${w.slice(0, -3)}y`], add: past },
  {
    ending: 'ed',
    stems: (w) => [w.slice(0, -2), w.slice(0, -1), w.slice(0, -3)],
    add: past
  },
  {
    ending: 'ing',
    stems: (w) => [w.slice(0, -3), `${w.slice(0, -3)}e`, w.slice(0, -4)],
    add: (stem) => `${stem}ɪŋ`
  },
  { ending: 'ily', stems: (w) => [`${w.slice(0, -3)}y`], add: (stem) => `${stem.slice(0, -1)}ɪli` },
  { ending: 'ly', stems: (w) => [w.slice(0, -2)], add: (stem) => `${stem}li` },
  { ending: 'ness', stems: (w) => [w.slice(0, -4)], add: (stem) => `${stem}nəs` },
  { ending: 'less', stems: (w) => [w.slice(0, -4)], add: (stem) => `${stem}ləs` },
  { ending: 'ful', stems: (w) => [w.slice(0, -3)], add: (stem) => `${stem}fəl` },
  { ending: 'ment', stems: (w) => [w.slice(0, -4)], add: (stem) => `${stem}mənt` },
  { ending: 'est', stems: (w) => [w.slice(0, -3), w.slice(0, -2)], add: (stem) => `${stem}ɪst` },
  { ending: 'er', stems: (w) => [w.slice(0, -2), w.slice(0, -1)], add: (stem) => `${stem}əɹ` }
]

/**
 * Tokens given to the model at once. It takes up to 510, but its memory grows steeply with
 * length (over a gigabyte for a long paragraph), so passages are read a sentence or two at a time.
 */
export const KOKORO_PIECE_TOKENS = 200

/** Splits text into words (letters with inner apostrophes and hyphens) and punctuation. */
const PIECES = /([A-Za-zÀ-ÖØ-öø-ÿĀ-ž]+(?:['-][A-Za-zÀ-ÖØ-öø-ÿĀ-ž]+)*'?)|([;:,.!?—…"“”()])/gu
const OPENING = new Set(['“', '('])
const CLOSING = new Set(['”', ')', ';', ':', ',', '.', '!', '?', '…'])

function normalise(text: string): string {
  let quoteOpen = false
  return (
    spellNumbers(
      text
        .replace(/[‘’ʼ]/gu, "'")
        .replace(/\.{3,}/gu, '…')
        .replace(/\s*(?:--+|–|—)\s*/gu, ' — ')
        .replace(/&/gu, ' and ')
    )
      .replace(/\b([A-Za-z]+)\.(?=\s)/gu, (match, word: string) => {
        const expanded = ABBREVIATIONS[word.toLowerCase()]
        return expanded ? expanded : match
      })
      // Straight double quotes become opening and closing ones, which Kokoro reads differently.
      .replace(/"/gu, () => {
        quoteOpen = !quoteOpen
        return quoteOpen ? '“' : '”'
      })
  )
}

function stripAccents(word: string): string {
  return word.normalize('NFD').replace(/[̀-ͯ]/gu, '')
}

/**
 * Turns English text into Kokoro's phonemes: the dictionary first, then the word with a common
 * ending taken off, then spelling rules for anything new, such as invented names.
 */
export class KokoroPhonemizer {
  private readonly words = new Map<string, Entry>()
  private readonly british: boolean

  /**
   * Dictionaries are given most trusted first; a word keeps its first pronunciation. British
   * voices use the British dictionary and say new words the British way.
   */
  constructor(lexicons: KokoroLexicon[], options: { british?: boolean } = {}) {
    this.british = options.british ?? false
    for (const lexicon of lexicons) {
      for (const [word, entry] of Object.entries(lexicon)) {
        if (!this.words.has(word)) this.words.set(word, entry)
      }
    }
  }

  get size(): number {
    return this.words.size
  }

  /** The phonemes for a passage, words separated by spaces, punctuation kept. */
  phonemize(text: string): string {
    const pieces = [...normalise(text).matchAll(PIECES)]
    let output = ''
    let previousWord = ''
    let afterOpening = true
    for (const piece of pieces) {
      const [, word, mark] = piece
      if (mark) {
        if (OPENING.has(mark)) {
          output += `${output && !afterOpening ? ' ' : ''}${mark}`
          afterOpening = true
        } else if (CLOSING.has(mark)) {
          output += mark
        } else {
          // A dash stands apart.
          output += `${output ? ' ' : ''}${mark}`
          afterOpening = false
        }
        continue
      }
      const phonemes = this.word(word, previousWord)
      previousWord = word.toLowerCase()
      if (!phonemes) continue
      output += `${output && !afterOpening ? ' ' : ''}${phonemes}`
      afterOpening = false
    }
    return output.trim()
  }

  /** Model input: token numbers in pieces short enough for one pass, padded at both ends. */
  tokenize(phonemes: string, maxTokens = KOKORO_PIECE_TOKENS): number[][] {
    const limit = Math.min(maxTokens, KOKORO_MAX_TOKENS) - 2
    const chunks: number[][] = []
    for (const part of splitPhonemes(phonemes, limit)) {
      const ids = [...part].flatMap((symbol) => {
        const id = KOKORO_VOCAB.get(symbol)
        return id === undefined ? [] : [id]
      })
      if (ids.some((id) => id !== KOKORO_VOCAB.get(' ')))
        chunks.push([KOKORO_PAD, ...ids, KOKORO_PAD])
    }
    return chunks
  }

  /** One word's phonemes, or an empty string when it has no letters to say. */
  word(raw: string, previousWord = ''): string {
    const word = raw.replace(/'$/u, '')
    const found = this.lookup(word, previousWord)
    if (found !== null) return found
    if (word.includes('-')) {
      return word
        .split('-')
        .map((part) => this.word(part, previousWord))
        .filter(Boolean)
        .join(' ')
    }
    const lower = word.toLowerCase()
    for (const suffix of SUFFIXES) {
      if (!lower.endsWith(suffix.ending) || lower.length < suffix.ending.length + 2) continue
      for (const stem of suffix.stems(word)) {
        const stemPhonemes = stem.length >= 2 ? this.lookup(stem, previousWord) : null
        if (stemPhonemes) {
          const added = suffix.add(stemPhonemes)
          // The added ending was written in American sounds.
          return this.british
            ? stemPhonemes + britishSounds(added.slice(stemPhonemes.length))
            : added
        }
      }
    }
    const plain = stripAccents(word)
    if (plain !== word) {
      const unaccented = this.lookup(plain, previousWord)
      if (unaccented !== null) return unaccented
    }
    // Initials and short capitals ("FBI") are spelt out letter by letter.
    if (/^[A-Z]{2,4}$/u.test(word)) {
      return [...word].map((letter) => this.lookup(letter, '') ?? '').join('')
    }
    return guessPronunciation(plain, this.british)
  }

  private lookup(word: string, previousWord: string): string | null {
    const forms = [
      word,
      word.toLowerCase(),
      word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    ]
    for (const form of forms) {
      const entry = this.words.get(form)
      if (entry !== undefined) return choose(entry, previousWord)
    }
    return null
  }
}

function choose(entry: Entry, previousWord: string): string | null {
  if (typeof entry === 'string') return entry
  const tags = BEFORE_PAST.has(previousWord)
    ? ['VBD', 'VBN', 'VERB']
    : BEFORE_VERB.has(previousWord)
      ? ['VERB', 'VBP']
      : BEFORE_NOUN.has(previousWord)
        ? ['NOUN', 'ADJ']
        : []
  for (const tag of [...tags, 'DEFAULT']) {
    const value = entry[tag]
    if (value) return value
  }
  return Object.values(entry).find((value): value is string => Boolean(value)) ?? null
}

/** Splits a long passage at sentence ends, then commas, then spaces, to fit the model. */
function splitPhonemes(phonemes: string, limit: number): string[] {
  if ([...phonemes].length <= limit) return [phonemes]
  for (const pattern of [/(?<=[.!?…])\s+/u, /(?<=[,;:—])\s+/u, /\s+/u]) {
    const parts = phonemes.split(pattern)
    if (parts.length < 2) continue
    const chunks: string[] = []
    let current = ''
    for (const part of parts) {
      const joined = current ? `${current} ${part}` : part
      if ([...joined].length <= limit) {
        current = joined
        continue
      }
      if (current) chunks.push(current)
      current = part
    }
    if (current) chunks.push(current)
    return chunks.flatMap((chunk) =>
      [...chunk].length > limit ? splitPhonemes(chunk, limit) : [chunk]
    )
  }
  // No spaces at all: cut it.
  const symbols = [...phonemes]
  const chunks: string[] = []
  for (let index = 0; index < symbols.length; index += limit) {
    chunks.push(symbols.slice(index, index + limit).join(''))
  }
  return chunks
}
