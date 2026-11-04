import { describe, expect, it } from 'vitest'
import {
  guessPronunciation,
  KokoroPhonemizer,
  KOKORO_MAX_TOKENS,
  KOKORO_VOCAB,
  kokoroStyleRow
} from '@storybound/narration'
import { numberToWords, spellNumbers } from '../../packages/narration/src/kokoro/numbers'

const lexicon = {
  the: 'ði',
  she: 'ʃi',
  had: 'hæd',
  to: 'tu',
  read: { DEFAULT: 'ɹˈid', VBD: 'ɹˈɛd', VBN: 'ɹˈɛd' },
  live: { DEFAULT: 'lˈIv', VERB: 'lˈɪv' },
  whisper: 'wˈɪspəɹ',
  door: 'dˈɔɹ',
  closed: 'klˈOzd',
  Mister: 'mˈɪstəɹ',
  four: 'fˈɔɹ',
  pounds: 'pˈWndz',
  and: 'ænd',
  fifty: 'fˈɪfti',
  pence: 'pˈɛns',
  wait: 'wˈAt',
  said: 'sˈɛd'
}

describe('Kokoro pronunciation', () => {
  const phonemizer = new KokoroPhonemizer([lexicon])

  it('reads words from the dictionary, choosing by the word before', () => {
    expect(phonemizer.phonemize('She had read the door.')).toBe('ʃi hæd ɹˈɛd ði dˈɔɹ.')
    expect(phonemizer.phonemize('To read.')).toBe('tu ɹˈid.')
    expect(phonemizer.phonemize('to live')).toBe('tu lˈɪv')
  })

  it('adds common endings to words it knows', () => {
    expect(phonemizer.word('whispered')).toBe('wˈɪspəɹd')
    expect(phonemizer.word('whispering')).toBe('wˈɪspəɹɪŋ')
    expect(phonemizer.word('doors')).toBe('dˈɔɹz')
    expect(phonemizer.word('waited')).toBe('wˈAtɪd')
  })

  it('sounds out names it has never seen, stressing them sensibly', () => {
    expect(guessPronunciation('Kaelith')).toBe('kˈAlɪθ')
    expect(guessPronunciation('Thorne')).toBe('θˈɔɹn')
    expect(guessPronunciation('Morwenna')).toBe('mɔɹwˈɛnə')
    // British voices drop the r after a vowel and use their own "oh".
    expect(guessPronunciation('Thorne', true)).toBe('θˈɔːn')
    expect(guessPronunciation('Ashgrove', true)).toContain('Q')
  })

  it('spells out numbers, money and titles, and pairs quotation marks', () => {
    expect(numberToWords(1205)).toBe('one thousand two hundred and five')
    expect(spellNumbers('In 1984, on the 21st, at 3:05')).toBe(
      'In nineteen eighty-four, on the twenty-first, at three oh five'
    )
    expect(phonemizer.phonemize('Mr. Thorne paid £4.50')).toBe(
      'mˈɪstəɹ θˈɔɹn pˈAd fˈɔɹ pˈWndz ænd fˈɪfti pˈɛns'
    )
    expect(phonemizer.phonemize('"Wait," she said -- "wait."')).toBe('“wˈAt,” ʃi sˈɛd — “wˈAt.”')
  })

  it('makes model input in padded pieces no longer than the model takes', () => {
    const [ids] = phonemizer.tokenize('ði dˈɔɹ.')
    expect(ids[0]).toBe(0)
    expect(ids.at(-1)).toBe(0)
    expect(ids[1]).toBe(KOKORO_VOCAB.get('ð'))
    const long = Array.from({ length: 120 }, () => 'ði dˈɔɹ klˈOzd.').join(' ')
    const pieces = phonemizer.tokenize(long)
    expect(pieces.length).toBeGreaterThan(1)
    for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(KOKORO_MAX_TOKENS)
    expect(kokoroStyleRow(2)).toBe(0)
    expect(kokoroStyleRow(5000)).toBe(509)
  })
})
