import { GeminiSpeechError, type NarrationSegment } from '@storybound/narration'
import { describe, expect, it } from 'vitest'
import type {
  BookDetail,
  Chapter,
  MobileRepository,
  SaveReadingStateInput
} from '../src/domain/contracts'
import {
  ListeningSession,
  type ListeningBackend,
  type ListeningVoice,
  type NowPlaying
} from '../src/narration/listeningSession'

const chapters: Chapter[] = [
  {
    id: 'c1',
    bookId: 'b1',
    title: 'The Lamp',
    position: 0,
    wordCount: 9,
    updatedAt: '',
    content:
      '[[warm]] The lamp went out.\n\n[[hushed]] Someone whispered.\n\n[[tense]] A door closed.'
  },
  {
    id: 'c2',
    bookId: 'b1',
    title: 'Morning',
    position: 1,
    wordCount: 3,
    updatedAt: '',
    content: 'The sun rose.'
  }
]

const book: BookDetail = {
  id: 'b1',
  libraryId: 'l1',
  title: 'Night Book',
  subtitle: '',
  authorName: 'A. Writer',
  blurb: '',
  status: 'draft',
  coverTone: 'forest',
  seriesName: '',
  seriesPosition: null,
  chapters: chapters.map((chapter) => ({ ...chapter, content: undefined }))
} as unknown as BookDetail

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- a test fixture
function setup(options: { failures?: unknown[] } = {}) {
  const saved: SaveReadingStateInput[] = []
  const repository = {
    getBook: async () => book,
    getChapter: async (id: string) => chapters.find((chapter) => chapter.id === id)!,
    saveReadingState: async (input: SaveReadingStateInput) => {
      saved.push(input)
      return { ...input, lastReadAt: null }
    }
  } as unknown as MobileRepository

  const queue: string[] = []
  const trackListeners: ((index: number) => void)[] = []
  const statusListeners: ((status: { playing: boolean; finished: boolean }) => void)[] = []
  const controls: (NowPlaying | null)[] = []
  const player = { index: 0, playing: false, rate: 1 }
  const backend: ListeningBackend = {
    add: (uri) => void queue.push(uri),
    clear: () => {
      queue.length = 0
      player.index = 0
    },
    skipTo: (index) => {
      player.index = index
    },
    play: () => {
      player.playing = true
    },
    pause: () => {
      player.playing = false
    },
    setRate: (rate) => {
      player.rate = rate
    },
    get currentIndex() {
      return player.index
    },
    showControls: (details) => void controls.push(details),
    onTrackChanged: (listener) => void trackListeners.push(listener),
    onStatus: (listener) => void statusListeners.push(listener)
  }

  const failures = [...(options.failures ?? [])]
  const spoken: string[] = []
  const voice: ListeningVoice = {
    speak: async (segment: NarrationSegment) => {
      const failure = failures.shift()
      if (failure) throw failure
      spoken.push(segment.plainText)
      return `speech:${segment.plainText}`
    },
    silence: async (seconds) => `silence:${seconds}`
  }

  /** The playing file ends: the player moves on, or reports the queue finished. */
  const finishTrack = (): void => {
    if (player.index < queue.length - 1) {
      player.index += 1
      for (const listener of trackListeners) listener(player.index)
    } else {
      player.playing = false
      for (const listener of statusListeners) listener({ playing: false, finished: true })
    }
  }

  const session = new ListeningSession(backend)
  const start = (progress = 0): Promise<void> =>
    session.start({ repository, voice, bookId: 'b1', chapterId: 'c1', progress, speed: 1.25 })
  return { session, start, queue, saved, spoken, player, controls, finishTrack }
}

const settle = (): Promise<unknown> => new Promise((resolve) => setTimeout(resolve, 0))

describe('listening session', () => {
  it('reads from the saved place, prepares passages ahead, and saves each as the place', async () => {
    const { session, start, queue, saved, player, controls } = setup()
    await start(0.5)
    await settle()
    // Halfway through the chapter is the second paragraph; the title is skipped.
    expect(queue[0]).toBe('speech:Someone whispered.')
    expect(player.playing).toBe(true)
    expect(player.rate).toBe(1.25)
    expect(session.current.status).toBe('playing')
    expect(session.current.passage?.start).toBe(chapters[0].content.indexOf('[[hushed]]'))
    expect(saved.at(-1)).toMatchObject({ bookId: 'b1', chapterId: 'c1' })
    expect(controls.at(-1)).toEqual({ title: 'The Lamp', artist: 'A. Writer', album: 'Night Book' })
    // Passages are queued ahead, carrying on into the next chapter.
    expect(queue).toContain('speech:A door closed.')
    expect(queue).toContain('speech:Morning')
  })

  it('moves into the next chapter and stops at the end of the book', async () => {
    const { session, start, queue, saved, finishTrack, controls } = setup()
    await start(0.9)
    await settle()
    for (let step = 0; step < 12 && session.current.status !== 'idle'; step += 1) {
      finishTrack()
      await settle()
    }
    expect(queue.at(-1)).toBe('speech:The sun rose.')
    expect(session.current.status).toBe('idle')
    expect(saved.at(-1)).toMatchObject({
      chapterId: 'c2',
      scrollPosition: 1,
      progressPercentage: 100
    })
    expect(controls.at(-1)).toBeNull()
  })

  it('waits with a moment of silence and asks again when Google is busy', async () => {
    const busy = new GeminiSpeechError('Google is busy.', 429, true)
    const { session, start, queue, finishTrack, spoken } = setup({ failures: [busy] })
    await start(0)
    await settle()
    expect(queue).toEqual(['silence:2'])
    expect(session.current.status).toBe('playing')
    finishTrack()
    await settle()
    expect(spoken[0]).toBe('The Lamp')
    expect(queue[1]).toBe('speech:The Lamp')
  })

  it('stops with a message when the key is refused, and tries again on play', async () => {
    const refused = new GeminiSpeechError('Google refused the key.', 403, false)
    const { session, start, queue } = setup({ failures: [refused] })
    await start(0)
    await settle()
    expect(queue).toEqual([])
    expect(session.current.status).toBe('paused')
    expect(session.current.error).toContain('Google refused the key.')
    session.play()
    await settle()
    expect(session.current.error).toBe('')
    expect(queue[0]).toBe('speech:The Lamp')
    expect(session.current.status).toBe('playing')
  })

  it('pauses from the lock screen and stops cleanly', async () => {
    const { session, start, player, controls } = setup()
    await start(0)
    await settle()
    session.pause()
    expect(player.playing).toBe(false)
    expect(session.current.status).toBe('paused')
    session.stop()
    expect(session.current.status).toBe('idle')
    expect(session.current.bookId).toBeNull()
    expect(controls.at(-1)).toBeNull()
  })
})
