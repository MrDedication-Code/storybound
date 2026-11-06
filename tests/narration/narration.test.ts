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
  segmentAtProgress,
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
    const total = long.length + 15
    expect(segmentAtProgress(script, 0, total)).toBe(0)
    expect(segmentAtProgress(script, 0.99, total)).toBe(speech.at(-1)?.index)
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
