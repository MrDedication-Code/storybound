import {
  buildNarrationScript,
  GeminiSpeechError,
  segmentAtProgress,
  segmentProgress,
  type NarrationSegment
} from '@storybound/narration'
import type { BookDetail, MobileRepository } from '../domain/contracts'
import { calculateReadingProgress } from '../domain/reading'

/**
 * The phone's audio player as the listening session sees it: a queue of sound files that plays
 * one after another, also when the screen is off.
 */
export interface ListeningBackend {
  add(uri: string): void
  /** Empties the queue; the next file added is number 0 again. */
  clear(): void
  skipTo(index: number): void
  play(): void
  pause(): void
  setRate(rate: number): void
  readonly currentIndex: number
  /** Shows the book on the lock screen, the notification shade, and headphone controls. */
  showControls(details: NowPlaying | null): void
  onTrackChanged(listener: (index: number) => void): void
  /** `finished` is true when the last file in the queue has played to its end. */
  onStatus(listener: (status: { playing: boolean; finished: boolean }) => void): void
}

export interface NowPlaying {
  title: string
  artist: string
  album: string
}

/** Turns a passage into a sound file on the phone and returns its address. */
export interface ListeningVoice {
  speak(segment: NarrationSegment): Promise<string>
  silence(seconds: number): Promise<string>
  /** For a voice with few requests a day: fewer, longer passages, and less made ahead. */
  metered?: boolean
  /** The voice to carry on with once this one's daily allowance runs out, if there is one. */
  whenLimited?(): Promise<ListeningVoice | null>
}

export type ListeningStatus = 'idle' | 'loading' | 'playing' | 'paused'

export interface ListeningSnapshot {
  status: ListeningStatus
  bookId: string | null
  bookTitle: string
  chapterId: string | null
  chapterTitle: string
  /** The passage being read, as offsets in the chapter's text, for the reader to follow. */
  passage: { start: number; end: number } | null
  speed: number
  error: string
}

const IDLE: ListeningSnapshot = {
  status: 'idle',
  bookId: null,
  bookTitle: '',
  chapterId: null,
  chapterTitle: '',
  passage: null,
  speed: 1,
  error: ''
}

/** Passages made ready ahead of the one playing, so there is no gap between them. */
const PREPARE_AHEAD = 4
/** Long passages play for minutes, so two are plenty, and little is wasted if listening stops. */
const METERED_PREPARE_AHEAD = 2
/** Times a passage is asked for again after a network or busy error before listening stops. */
const RETRIES = 4
/** Played while waiting to ask again: the phone's timers stop with the screen off, sound doesn't. */
const WAIT_SECONDS = 2

interface Track {
  chapterId: string
  chapterIndex: number
  chapterTitle: string
  contentLength: number
  /** Null for the short silence played while waiting to try a passage again. */
  segment: NarrationSegment | null
}

interface ChapterScript {
  chapterIndex: number
  chapterId: string
  title: string
  contentLength: number
  segments: NarrationSegment[]
}

/**
 * Reads a book aloud chapter after chapter. It lives outside the screens, so it keeps going
 * when the reader is closed or the phone is locked, and saves each passage as the reading place.
 *
 * Everything moves on from audio events, never timers: Android pauses an app's timers while the
 * screen is off, but its player keeps sending events.
 */
export class ListeningSession {
  private snapshot: ListeningSnapshot = IDLE
  private readonly listeners = new Set<(snapshot: ListeningSnapshot) => void>()
  private generation = 0
  private repository: MobileRepository | null = null
  private voice: ListeningVoice | null = null
  private book: BookDetail | null = null
  private tracks: Track[] = []
  private script: ChapterScript | null = null
  private nextSegment = 0
  private reachedEnd = false
  private producing = false
  private retries = 0
  /** Production stopped after an error, until the listener presses play. */
  private halted = false
  /** The listener wants sound; the queue may have run dry while a passage is being made. */
  private wantsToPlay = false
  /** The queue ran dry: the next file added starts playing straight away. */
  private waiting = false
  /** The player reached the end of its queue. */
  private finishedQueue = false
  private lastShownChapter = ''

  constructor(private readonly backend: ListeningBackend) {
    backend.onTrackChanged((index) => this.trackChanged(index))
    backend.onStatus((status) => this.statusChanged(status))
  }

  get current(): ListeningSnapshot {
    return this.snapshot
  }

  subscribe(listener: (snapshot: ListeningSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Starts reading a book from a chapter and a place in it (0 to 1). */
  async start(input: {
    repository: MobileRepository
    voice: ListeningVoice
    bookId: string
    chapterId: string
    progress: number
    speed: number
  }): Promise<void> {
    const generation = this.reset()
    this.repository = input.repository
    this.voice = input.voice
    const book = await input.repository.getBook(input.bookId)
    if (generation !== this.generation) return
    this.book = book
    const chapterIndex = Math.max(
      0,
      book.chapters.findIndex((chapter) => chapter.id === input.chapterId)
    )
    const script = await this.loadScript(chapterIndex)
    if (generation !== this.generation || !script) return
    this.script = script
    const startAt = input.progress >= 0.98 ? 0 : input.progress
    this.nextSegment =
      startAt > 0 ? segmentAtProgress(script.segments, startAt, script.contentLength) : 0
    this.wantsToPlay = true
    this.waiting = true
    this.backend.setRate(input.speed)
    this.update({
      status: 'loading',
      bookId: book.id,
      bookTitle: book.title,
      chapterId: script.chapterId,
      chapterTitle: script.title,
      passage: null,
      speed: input.speed,
      error: ''
    })
    this.backend.showControls(this.nowPlaying(script.title))
    void this.fill(generation)
  }

  play(): void {
    if (!this.book) return
    this.wantsToPlay = true
    if (this.halted) {
      this.halted = false
      this.retries = 0
      this.update({ error: '' })
    }
    if (this.waiting || this.finishedQueue) {
      // Nothing left in the queue: carry on once the next passage is ready.
      this.waiting = true
      this.update({ status: 'loading' })
      void this.fill(this.generation)
      return
    }
    this.backend.play()
    this.update({ status: 'playing' })
    void this.fill(this.generation)
  }

  pause(): void {
    if (!this.book) return
    this.wantsToPlay = false
    this.backend.pause()
    this.update({ status: 'paused' })
  }

  toggle(): void {
    if (this.snapshot.status === 'playing' || this.snapshot.status === 'loading') this.pause()
    else this.play()
  }

  /** Skips to the next spoken passage that is ready. */
  next(): void {
    const index = this.findSpoken(this.backend.currentIndex, 1)
    if (index !== null) this.jump(index)
  }

  /** Goes back to the previous spoken passage, or to the start of this one. */
  previous(): void {
    const index = this.findSpoken(this.backend.currentIndex, -1)
    this.jump(index ?? this.backend.currentIndex)
  }

  setSpeed(speed: number): void {
    this.backend.setRate(speed)
    this.update({ speed })
  }

  /** Stops reading and saves the place; the lock-screen controls go away. */
  stop(): void {
    void this.saveCurrentPlace()
    this.reset()
    this.update({ ...IDLE, speed: this.snapshot.speed })
  }

  private reset(): number {
    this.generation += 1
    this.backend.pause()
    this.backend.clear()
    this.backend.showControls(null)
    this.tracks = []
    this.script = null
    this.book = null
    this.nextSegment = 0
    this.reachedEnd = false
    this.producing = false
    this.retries = 0
    this.halted = false
    this.wantsToPlay = false
    this.waiting = false
    this.finishedQueue = false
    return this.generation
  }

  private jump(index: number): void {
    if (index < 0 || index >= this.tracks.length) return
    this.waiting = false
    this.finishedQueue = false
    this.backend.skipTo(index)
    if (this.wantsToPlay) this.backend.play()
    // The player reports the change too; telling the reader now keeps the page in step.
    this.trackChanged(index)
  }

  private findSpoken(from: number, step: number): number | null {
    for (let index = from + step; index >= 0 && index < this.tracks.length; index += step) {
      if (this.tracks[index].segment?.kind === 'speech') return index
    }
    return null
  }

  private trackChanged(index: number): void {
    const track = this.tracks[index]
    if (!track) return
    if (track.segment?.kind === 'speech') {
      this.update({
        chapterId: track.chapterId,
        chapterTitle: track.chapterTitle,
        passage: { start: track.segment.start, end: track.segment.end }
      })
      void this.savePlace(track)
    }
    if (track.chapterTitle !== this.lastShownChapter) {
      this.backend.showControls(this.nowPlaying(track.chapterTitle))
    }
    // A wait is played out to its end before the passage is asked for again.
    if (track.segment) void this.fill(this.generation)
  }

  private statusChanged(status: { playing: boolean; finished: boolean }): void {
    if (!this.book) return
    if (status.finished) {
      this.finishedQueue = true
      if (this.reachedEnd && !this.producing && this.unplayed() === 0) {
        // The last chapter has been read to its end.
        const last = this.tracks.at(-1)
        if (last) void this.savePlace(last, 1)
        this.wantsToPlay = false
        this.backend.showControls(null)
        this.update({ status: 'idle', passage: null })
        return
      }
      if (this.wantsToPlay) {
        this.waiting = true
        this.update({ status: this.halted ? 'paused' : 'loading' })
        void this.fill(this.generation)
      }
      return
    }
    if (status.playing) {
      this.finishedQueue = false
      this.wantsToPlay = true
      this.update({ status: 'playing' })
    } else if (!this.waiting && this.snapshot.status === 'playing') {
      // Paused from the lock screen, headphones, or a phone call.
      this.wantsToPlay = false
      this.update({ status: 'paused' })
    }
  }

  /** Files in the queue after the one playing. */
  private unplayed(): number {
    if (this.waiting) return 0
    return Math.max(0, this.tracks.length - 1 - this.backend.currentIndex)
  }

  /** Makes passages ready, in order, until enough are queued ahead of the one playing. */
  private async fill(generation: number): Promise<void> {
    if (this.producing || this.halted || !this.voice) return
    this.producing = true
    try {
      while (
        generation === this.generation &&
        !this.halted &&
        (this.waiting ||
          this.unplayed() < (this.voice.metered ? METERED_PREPARE_AHEAD : PREPARE_AHEAD))
      ) {
        const item = await this.nextItem(generation)
        if (generation !== this.generation) return
        if (!item) break
        let uri: string
        try {
          uri =
            item.segment.kind === 'pause'
              ? await this.voice.silence(item.segment.pause)
              : await this.voice.speak(item.segment)
        } catch (error) {
          if (generation !== this.generation) return
          await this.failed(error, item, generation)
          return
        }
        if (generation !== this.generation) return
        this.retries = 0
        this.nextSegment += 1
        this.queue(item, uri)
      }
    } finally {
      if (generation === this.generation) this.producing = false
    }
  }

  private queue(track: Track, uri: string): void {
    this.tracks.push(track)
    this.backend.add(uri)
    const index = this.tracks.length - 1
    if (this.waiting && this.wantsToPlay) {
      this.waiting = false
      this.finishedQueue = false
      this.backend.skipTo(index)
      this.backend.play()
      this.update({ status: 'playing' })
      this.trackChanged(index)
    }
  }

  private async failed(
    error: unknown,
    item: { segment: NarrationSegment } & Omit<Track, 'segment'>,
    generation: number
  ): Promise<void> {
    if (error instanceof GeminiSpeechError && error.limitedUntil) {
      await this.voiceLimitReached(error, item, generation)
      return
    }
    const retryable = error instanceof GeminiSpeechError ? error.retryable : true
    if (retryable && this.retries < RETRIES) {
      this.retries += 1
      this.producing = false
      if (this.waiting && this.wantsToPlay && this.voice) {
        // Nothing is playing: play a moment of silence, longer each time, and ask again after.
        const uri = await this.voice.silence(WAIT_SECONDS * this.retries).catch(() => null)
        if (generation !== this.generation || !uri) return
        this.queue({ ...item, segment: null }, uri)
      }
      // Otherwise the next passage change asks again.
      return
    }
    this.halted = true
    this.producing = false
    const message =
      error instanceof Error ? error.message : 'This passage could not be turned into speech.'
    this.update({
      error: `${message} Press play to try again.`,
      status: this.waiting || this.unplayed() === 0 ? 'paused' : this.snapshot.status
    })
  }

  /** Hands over to the free voice from the same place, or stops and says why. */
  private async voiceLimitReached(
    error: GeminiSpeechError,
    item: { segment: NarrationSegment } & Omit<Track, 'segment'>,
    generation: number
  ): Promise<void> {
    const replacement = await this.voice?.whenLimited?.().catch(() => null)
    if (generation !== this.generation) return
    this.producing = false
    if (!replacement) {
      this.halted = true
      this.update({
        error: `${error.message} Download the free voice in Listening settings to keep going.`,
        status: this.waiting || this.unplayed() === 0 ? 'paused' : this.snapshot.status
      })
      return
    }
    this.voice = replacement
    const script = await this.loadScript(item.chapterIndex)
    if (generation !== this.generation) return
    if (script) {
      // The free voice divides a chapter differently, so find the same place in its passages.
      this.script = script
      this.nextSegment = segmentAtProgress(
        script.segments,
        segmentProgress(item.segment, item.contentLength),
        script.contentLength
      )
    }
    this.update({ error: `${error.message} The free voice will read until then.` })
    void this.fill(generation)
  }

  private async nextItem(
    generation: number
  ): Promise<({ segment: NarrationSegment } & Omit<Track, 'segment'>) | null> {
    while (generation === this.generation) {
      const script = this.script
      if (!script) return null
      const segment = script.segments[this.nextSegment]
      if (segment) {
        return {
          chapterId: script.chapterId,
          chapterIndex: script.chapterIndex,
          chapterTitle: script.title,
          contentLength: script.contentLength,
          segment
        }
      }
      // This chapter is all queued: move on to the next one.
      const nextScript = await this.loadScript(script.chapterIndex + 1)
      if (generation !== this.generation) return null
      if (!nextScript) {
        this.reachedEnd = true
        return null
      }
      this.script = nextScript
      this.nextSegment = 0
    }
    return null
  }

  private async loadScript(chapterIndex: number): Promise<ChapterScript | null> {
    const summary = this.book?.chapters[chapterIndex]
    if (!summary || !this.repository) return null
    const chapter = await this.repository.getChapter(summary.id)
    return {
      chapterIndex,
      chapterId: chapter.id,
      title: chapter.title,
      contentLength: chapter.content.length,
      segments: buildNarrationScript(
        { title: chapter.title, content: chapter.content },
        { longPassages: this.voice?.metered === true }
      )
    }
  }

  private async savePlace(track: Track, position?: number): Promise<void> {
    const book = this.book
    const repository = this.repository
    if (!book || !repository) return
    const place =
      position ?? (track.segment ? segmentProgress(track.segment, track.contentLength) : 0)
    try {
      await repository.saveReadingState({
        bookId: book.id,
        chapterId: track.chapterId,
        scrollPosition: place,
        progressPercentage: calculateReadingProgress(
          track.chapterIndex,
          book.chapters.length,
          place
        )
      })
    } catch {
      // The place is saved again at the next passage.
    }
  }

  private async saveCurrentPlace(): Promise<void> {
    const track = this.tracks[this.backend.currentIndex]
    if (track?.segment) await this.savePlace(track)
  }

  private nowPlaying(chapterTitle: string): NowPlaying | null {
    if (!this.book) return null
    this.lastShownChapter = chapterTitle
    return {
      title: chapterTitle,
      artist: this.book.authorName || this.book.title,
      album: this.book.title
    }
  }

  private update(changes: Partial<ListeningSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...changes }
    for (const listener of this.listeners) listener(this.snapshot)
  }
}
