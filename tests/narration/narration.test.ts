import { signUpFoundExistingAccount } from '@storybound/contracts'
import { describe, expect, it } from 'vitest'
import {
  base64ToBytes,
  buildNarrationScript,
  nextGeminiReset,
  type GeminiSpeechError,
  geminiAudioFromResponse,
  geminiSpeechBody,
  GeminiSpeechError,
  isWav,
  listGeminiVoices,
  parseGeminiVoices,
  pcm16ToWav,
  readParagraphDirection,
  listeningStartOffset,
  narrationFrom,
  narrationPlace,
  paragraphAtPosition,
  shownParagraphOffsets,
  stripPerformanceNotes,
  synthesizeWithGemini
} from '@storybound/narration'

const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64')

describe('performance notes', () => {
  it('are hidden from readers, leaving tidy text', () => {
    expect(
      stripPerformanceNotes('[[hushed, urgent]] Run. [[sigh]] Now, she said [[long pause]].')
    ).toBe('Run. Now, she said.')
    expect(stripPerformanceNotes('No notes here.')).toBe('No notes here.')
  })

  it('at the start of a paragraph set how it is read', () => {
    expect(readParagraphDirection('[[hushed]][[urgent]] Run.')).toEqual({
      style: 'hushed, urgent',
      body: 'Run.',
      bodyOffset: 21
    })
    expect(readParagraphDirection('Run. [[sigh]]')).toEqual({
      style: null,
      body: 'Run. [[sigh]]',
      bodyOffset: 0
    })
  })
})

describe('narration script', () => {
  const content = [
    'The lamp went *out* at midnight.',
    '"Who is there?" she asked.',
    '* * *',
    '[[hushed, gravelly, urgent]] Get down. [[gasp]] Now!',
    '[[long pause]]',
    'Morning came.'
  ].join('\n\n')

  it('reads the title, merges short plain paragraphs, and keeps directions and pauses', () => {
    const script = buildNarrationScript({ title: 'Chapter 1: The Lamp', content })
    expect(
      script.map((segment) => [segment.kind, segment.text, segment.style, segment.pause])
    ).toEqual([
      ['speech', 'Chapter 1: The Lamp', null, 0],
      ['pause', '', null, 0.9],
      ['speech', 'The lamp went out at midnight.\n\n"Who is there?" she asked.', null, 0],
      ['pause', '', null, 1.6],
      ['speech', 'Get down. <gasp> Now!', 'hushed, gravelly, urgent', 0],
      ['pause', '', null, 1.4],
      ['speech', 'Morning came.', null, 0]
    ])
    expect(script[4].plainText).toBe('Get down. Now!')
    // Each passage knows where it is in the chapter, for the reading position.
    expect(content.slice(script[4].start, script[4].end)).toBe(
      '[[hushed, gravelly, urgent]] Get down. [[gasp]] Now!'
    )
  })

  describe('long passages, for a voice that counts requests', () => {
    const paragraph = 'She counted the ledgers again and found the same missing cent. '.repeat(6)
    const chapter = {
      title: 'Chapter 2',
      content: Array.from({ length: 40 }, () => paragraph.trim()).join('\n\n')
    }
    const spoken = (options = {}): string[] =>
      buildNarrationScript(chapter, options)
        .filter((segment) => segment.kind === 'speech')
        .map((segment) => segment.text)

    it('needs far fewer passages, and starts with a short one that includes the title', () => {
      const short = spoken()
      const long = spoken({ longPassages: true })
      expect(long.length).toBeLessThan(short.length / 2.5)
      expect(long[0].startsWith('Chapter 2\n\n')).toBe(true)
      expect(long[0].length).toBeLessThan(800)
      expect(Math.max(...long.map((text) => text.length))).toBeLessThanOrEqual(2600)
    })

    it('keeps every word, in order', () => {
      const script = buildNarrationScript(chapter, { longPassages: true })
      const words = script
        .map((segment) => segment.plainText)
        .join(' ')
        .match(/\S+/g)
      expect(words?.slice(2)).toEqual(chapter.content.match(/\S+/g))
    })

    it('keeps directions apart, and pauses inside passages', () => {
      const script = buildNarrationScript(
        {
          title: '',
          content: [
            'First.',
            'Second.',
            '* * *',
            'Third.',
            '[[long pause]]',
            'Fourth.',
            '[[hushed]] Whispered.',
            'Last.'
          ].join('\n\n')
        },
        { longPassages: true }
      )
      expect(script.map((segment) => [segment.text, segment.style])).toEqual([
        ['First.\n\nSecond.\n\n<long pause>\n\nThird.\n\n<long pause>\n\nFourth.', null],
        ['Whispered.', 'hushed'],
        ['Last.', null]
      ])
    })

    it('leaves other voices exactly as they were', () => {
      expect(buildNarrationScript(chapter, { longPassages: false })).toEqual(
        buildNarrationScript(chapter)
      )
    })
  })

  it('splits long paragraphs at sentence ends and resumes from a reading position', () => {
    const sentence = 'She counted the ledgers again and found the same missing cent. '
    const long = sentence.repeat(40).trim()
    const script = buildNarrationScript({ title: '', content: `Opening line.\n\n${long}` })
    const speech = script.filter((segment) => segment.kind === 'speech')
    expect(speech.length).toBeGreaterThan(2)
    for (const segment of speech) expect(segment.text.length).toBeLessThanOrEqual(1200)
    expect(speech.slice(1).every((segment) => segment.text.endsWith('cent.'))).toBe(true)
    const chapter = { title: '', content: `Opening line.\n\n${long}` }
    const last = speech.at(-1)!
    expect(narrationFrom(chapter, {}, 0).index).toBe(0)
    expect(narrationFrom(chapter, {}, last.start).index).toBe(last.index)
  })
})

describe('choosing where listening starts', () => {
  const paragraph = (name: string): string => `${name} ${'walked along the salt road. '.repeat(14)}`
  const content = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten']
    .map(paragraph)
    .join('\n\n')
  const chapter = { title: 'The Road', content }
  const startOf = (name: string): number => content.indexOf(`${name} walked`)

  it('starts at the chosen paragraph, not the top of the long passage it falls in', () => {
    const plain = buildNarrationScript(chapter, { longPassages: true })
    const inside = plain.find((item) => item.index > 0 && item.text.includes('Four walked'))!
    expect(inside.text.startsWith('Four')).toBe(false)

    const { segments, index } = narrationFrom(chapter, { longPassages: true }, startOf('Four'))
    expect(segments[index].text.startsWith('Four')).toBe(true)
    expect(segments[index].start).toBe(startOf('Four'))
  })

  it('leaves every later passage as it was, so audio already made is used again', () => {
    const plain = buildNarrationScript(chapter, { longPassages: true })
    const { segments, index } = narrationFrom(chapter, { longPassages: true }, startOf('Four'))
    const later = (from: typeof plain, at: number): string[] =>
      from.filter((item) => item.start > at).map((item) => item.text)
    const end = segments[index].end
    expect(later(segments, end)).toEqual(later(plain, end))
    expect(segments.length).toBeLessThanOrEqual(plain.length + 1)
  })

  it('keeps every word in the chapter when a passage is divided', () => {
    const { segments } = narrationFrom(chapter, { longPassages: true }, startOf('Four'))
    const words = segments.map((item) => item.text).join(' ')
    for (const name of ['One', 'Three', 'Four', 'Ten']) {
      expect(words.split(`${name} walked`).length).toBe(2)
    }
  })

  it('reads the title with the first paragraph', () => {
    for (const offset of [0, 3]) {
      expect(narrationFrom(chapter, {}, offset).index).toBe(0)
      expect(narrationFrom(chapter, { longPassages: true }, offset).index).toBe(0)
    }
  })

  it('goes back to the start of a paragraph chosen partway through it', () => {
    const { segments, index } = narrationFrom(chapter, {}, startOf('Four') + 20)
    expect(segments[index].start).toBe(startOf('Four'))
  })

  it('resumes from a saved place partway through a split paragraph', () => {
    const long = 'She counted the ledgers again. '.repeat(120).trim()
    const split = { title: '', content: `Opening line.\n\n${long}` }
    const second = buildNarrationScript(split).filter((item) => item.kind === 'speech')[2]
    expect(narrationFrom(split, {}, second.start).index).toBe(second.index)
  })

  it('moves past scene breaks and pauses to the next words', () => {
    const text = 'First.\n\n***\n\n[[long pause]]\n\nSecond.'
    const place = narrationPlace(text, text.indexOf('***'))
    expect(place?.preview).toBe('Second.')
    expect(place?.start).toBe(text.indexOf('Second'))
  })

  it('shows a paragraph’s opening words without notes or Markdown', () => {
    const text = '[[hushed]] *Quiet* now. [[sigh]] Listen.'
    expect(narrationPlace(text, 0)?.preview).toBe('Quiet now. Listen.')
    expect(narrationPlace(`${'word '.repeat(40)}`, 0)?.preview.endsWith('…')).toBe(true)
    expect(narrationPlace('', 0)).toBeNull()
  })

  it('starts the chapter again from the very end', () => {
    expect(listeningStartOffset(0.99, 1000)).toBe(0)
    expect(listeningStartOffset(0.5, 1000)).toBe(500)
    expect(paragraphAtPosition(content, 1)).toBe(0)
    expect(paragraphAtPosition(content, startOf('Six') / content.length)).toBe(startOf('Six'))
  })

  it('matches paragraphs on the page to the stored text, around performance notes', () => {
    const text = '[[warm]] First.\n\n[[long pause]]\n\nSecond [[sigh]] line.\n\nThird.'
    expect(shownParagraphOffsets(text).map((item) => item.stored)).toEqual([
      0,
      text.indexOf('Second'),
      text.indexOf('Third')
    ])
  })
})

describe('Google voice', () => {
  it('asks for one passage in the chosen voice and style', () => {
    expect(geminiSpeechBody({ text: 'Hello <sigh>', style: null, voice: 'Riko' })).toEqual({
      model: 'gemini-3.8-flash-tts',
      input: [
        {
          type: 'user_input',
          content: [
            {
              type: 'text',
              text: 'Hello <sigh>',
              annotations: [
                { type: 'speech_metadata', style: 'Rich, velvety, unhurried audiobook narration' }
              ]
            }
          ]
        }
      ],
      response_format: { type: 'audio', mime_type: 'audio/wav', sample_rate: 24000 },
      generation_config: { speech_config: [{ voice: 'Riko' }] }
    })
  })

  it('reads the audio from the documented reply, and wraps raw PCM as WAV', () => {
    const wav = pcm16ToWav(new Uint8Array([1, 0, 2, 0]), 24000)
    const reply = {
      steps: [
        { type: 'user_input', content: [{ type: 'text', text: 'Hello' }] },
        { type: 'model_output', content: [{ type: 'audio', data: toBase64(wav) }] }
      ]
    }
    expect(Buffer.from(geminiAudioFromResponse(reply))).toEqual(Buffer.from(wav))
    const pcm = geminiAudioFromResponse({
      candidates: [
        { content: { parts: [{ inlineData: { data: toBase64(new Uint8Array([9, 0])) } }] } }
      ]
    })
    expect(isWav(pcm)).toBe(true)
    expect(() => geminiAudioFromResponse({ steps: [] })).toThrow(GeminiSpeechError)
  })

  it('decodes base64 the same way Node does', () => {
    for (const bytes of [
      new Uint8Array([]),
      new Uint8Array([255]),
      new Uint8Array([1, 2]),
      new Uint8Array([0, 128, 255, 7, 9])
    ]) {
      expect(Buffer.from(base64ToBytes(toBase64(bytes)))).toEqual(Buffer.from(bytes))
    }
  })

  it('lists library voices and explains refused keys and rate limits', async () => {
    expect(
      parseGeminiVoices({
        voices: [
          {
            id: 'riko-1',
            display_name: 'Riko',
            description: 'Confident and clear.',
            pitch: 'Deep'
          },
          {}
        ],
        next_page_token: 'next'
      })
    ).toEqual({
      voices: [
        {
          id: 'riko-1',
          name: 'Riko',
          description: 'Confident and clear.',
          gender: null,
          accent: null,
          pitch: 'Deep',
          languageCode: null
        }
      ],
      nextPageToken: 'next'
    })

    const calls: string[] = []
    const reply = (status: number, body: unknown) => async (url: string) => {
      calls.push(url)
      return { ok: status < 400, status, json: async () => body, text: async () => '' }
    }
    await listGeminiVoices(reply(200, { voices: [] }), 'key', { search: 'Riko' })
    expect(calls[0]).toBe(
      'https://generativelanguage.googleapis.com/v1beta/voices?page_size=100&search=Riko'
    )
    await expect(
      synthesizeWithGemini(reply(403, { error: { message: 'denied' } }), 'key', {
        text: 'a',
        style: null,
        voice: 'Riko'
      })
    ).rejects.toMatchObject({ retryable: false, message: expect.stringContaining('billing') })
    await expect(
      synthesizeWithGemini(reply(429, {}), 'key', { text: 'a', style: null, voice: 'Riko' })
    ).rejects.toMatchObject({ retryable: true })
  })

  describe('when Google limits requests', () => {
    const limited = (retryAfter: string | null, message = ''): typeof fetch =>
      (async () => ({
        ok: false,
        status: 429,
        headers: { get: () => retryAfter },
        json: async () => ({ error: { message } }),
        text: async () => ''
      })) as unknown as typeof fetch
    const speak = (fetchImpl: typeof fetch): Promise<Uint8Array> =>
      synthesizeWithGemini(fetchImpl, 'key', { text: 'a', style: null, voice: 'Riko' })

    it('recognises the daily limit from a long wait, and does not retry it', async () => {
      const error = await speak(limited('85847')).catch((caught: unknown) => caught)
      expect(error).toMatchObject({ retryable: false })
      const until = (error as GeminiSpeechError).limitedUntil
      expect(until!.getTime()).toBeGreaterThan(Date.now() + 85_000_000)
      expect((error as Error).message).toContain('today’s allowance')
    })

    it('recognises the daily limit from Google’s words', async () => {
      const error = await speak(limited(null, 'Limit of 100 requests per day reached')).catch(
        (caught: unknown) => caught
      )
      expect((error as GeminiSpeechError).limitedUntil).toBeInstanceOf(Date)
    })

    it('treats the per-minute limit as something to wait out', async () => {
      await expect(speak(limited('20'))).rejects.toMatchObject({
        retryable: true,
        retryAfterSeconds: 20,
        limitedUntil: null
      })
    })

    it('works out the next midnight in California', () => {
      // 07:30 UK on 6 November is 23:30 the evening before in Los Angeles.
      expect(nextGeminiReset(new Date('2026-11-06T07:30:00Z')).toISOString()).toBe(
        '2026-11-06T08:00:00.000Z'
      )
    })
  })
})

describe('signing up with an email that already has an account', () => {
  it('is recognised from the server’s empty identities', () => {
    expect(signUpFoundExistingAccount({ identities: [] })).toBe(true)
    expect(signUpFoundExistingAccount({ identities: [{ id: 'one' }] })).toBe(false)
    expect(signUpFoundExistingAccount({})).toBe(false)
    expect(signUpFoundExistingAccount(null)).toBe(false)
  })
})
