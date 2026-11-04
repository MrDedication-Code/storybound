import {
  buildNarrationScript,
  segmentAtProgress,
  segmentProgress,
  type NarrationSegment
} from '@storybound/narration'

export type NarratorState = 'idle' | 'loading' | 'playing' | 'paused'

export interface NarratorEvents {
  onState(state: NarratorState): void
  /** A passage started; `progress` is how far through the chapter it begins, from 0 to 1. */
  onPassage(segment: NarrationSegment, progress: number): void
  /** The last passage finished; the reader moves on to the next chapter. */
  onChapterEnd(): void
  onError(message: string): void
}

/** How a passage becomes sound: Google's voice returns audio, the system voice speaks itself. */
export type NarratorVoice =
  { kind: 'audio'; synthesize(segment: NarrationSegment): Promise<Uint8Array> } | { kind: 'system' }

/** Passages prepared ahead of the one playing, so there is no gap between them. */
const PREPARE_AHEAD = 3

/**
 * Reads a chapter passage by passage. Kept outside React so playback carries on while the reader
 * re-renders, and so the next chapter can pick up where this one ends.
 */
export class Narrator {
  private segments: NarrationSegment[] = []
  private contentLength = 0
  private index = 0
  private state: NarratorState = 'idle'
  private rate = 1
  private generation = 0
  private readonly audio = new Audio()
  private readonly prepared = new Map<number, Promise<string>>()
  private pauseTimer: number | null = null

  constructor(
    private voice: NarratorVoice,
    private readonly events: NarratorEvents
  ) {
    this.audio.preservesPitch = true
    this.audio.addEventListener('ended', () => this.advance())
    this.audio.addEventListener('error', () => {
      if (this.state === 'playing') this.fail('This passage could not be played.')
    })
  }

  get current(): NarrationSegment | null {
    return this.segments[this.index] ?? null
  }

  setVoice(voice: NarratorVoice): void {
    const wasPlaying = this.state === 'playing' || this.state === 'loading'
    this.halt()
    this.voice = voice
    this.forgetPrepared()
    if (wasPlaying) void this.playCurrent()
  }

  /** Loads a chapter and starts from the passage at a reading position (0 to 1). */
  load(chapter: { title: string; content: string }, progress = 0): void {
    this.halt()
    this.forgetPrepared()
    this.segments = buildNarrationScript(chapter)
    this.contentLength = chapter.content.length
    this.index = progress > 0 ? segmentAtProgress(this.segments, progress, this.contentLength) : 0
    this.setState('idle')
  }

  play(): void {
    if (this.state === 'paused') {
      this.setState('playing')
      if (this.voice.kind === 'system') window.speechSynthesis.resume()
      else if (this.audio.src && !this.audio.ended)
        void this.audio.play().catch(() => this.playCurrent())
      else void this.playCurrent()
      return
    }
    if (this.state === 'idle') void this.playCurrent()
  }

  pause(): void {
    if (this.state !== 'playing' && this.state !== 'loading') return
    if (this.voice.kind === 'system') window.speechSynthesis.pause()
    else this.audio.pause()
    this.clearPauseTimer()
    this.setState('paused')
  }

  stop(): void {
    this.halt()
    this.setState('idle')
  }

  next(): void {
    this.jump(this.nextSpoken(this.index, 1))
  }

  previous(): void {
    this.jump(this.nextSpoken(this.index, -1))
  }

  setRate(rate: number): void {
    this.rate = rate
    this.audio.playbackRate = rate
  }

  dispose(): void {
    this.halt()
    this.forgetPrepared()
    this.audio.removeAttribute('src')
  }

  private nextSpoken(from: number, step: number): number {
    let index = from + step
    while (this.segments[index]?.kind === 'pause') index += step
    return Math.max(0, Math.min(this.segments.length - 1, index))
  }

  private jump(index: number): void {
    const resume = this.state === 'playing' || this.state === 'loading'
    this.halt()
    this.index = index
    const segment = this.current
    if (segment) this.events.onPassage(segment, segmentProgress(segment, this.contentLength))
    if (resume) void this.playCurrent()
    else this.setState(this.state === 'idle' ? 'idle' : 'paused')
  }

  private async playCurrent(): Promise<void> {
    const segment = this.current
    if (!segment) {
      this.setState('idle')
      this.events.onChapterEnd()
      return
    }
    const generation = ++this.generation
    this.events.onPassage(segment, segmentProgress(segment, this.contentLength))
    this.trimPrepared()

    if (segment.kind === 'pause') {
      this.setState('playing')
      this.pauseTimer = window.setTimeout(() => this.advance(), (segment.pause * 1000) / this.rate)
      return
    }

    if (this.voice.kind === 'system') {
      this.setState('playing')
      const utterance = new SpeechSynthesisUtterance(segment.plainText)
      utterance.rate = this.rate
      utterance.onend = () => {
        if (generation === this.generation) this.advance()
      }
      utterance.onerror = (event) => {
        if (
          generation === this.generation &&
          event.error !== 'interrupted' &&
          event.error !== 'canceled'
        ) {
          this.fail('The system voice stopped unexpectedly.')
        }
      }
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(utterance)
      return
    }

    this.setState('loading')
    try {
      const url = await this.prepare(this.index)
      for (let ahead = 1; ahead <= PREPARE_AHEAD; ahead += 1) {
        void this.prepare(this.index + ahead).catch(() => undefined)
      }
      if (generation !== this.generation) return
      this.audio.src = url
      this.audio.playbackRate = this.rate
      await this.audio.play()
      if (generation === this.generation) this.setState('playing')
    } catch (error) {
      if (generation === this.generation) {
        this.fail(error instanceof Error ? error.message : 'This passage could not be read.')
      }
    }
  }

  private prepare(index: number): Promise<string> {
    const voice = this.voice
    const segment = this.segments[index]
    if (!segment || segment.kind === 'pause' || voice.kind !== 'audio') return Promise.resolve('')
    let pending = this.prepared.get(index)
    if (!pending) {
      pending = voice
        .synthesize(segment)
        .then((bytes) =>
          URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'audio/wav' }))
        )
      // A failed passage is asked for again next time rather than remembered as failed.
      pending.catch(() => this.prepared.delete(index))
      this.prepared.set(index, pending)
    }
    return pending
  }

  private advance(): void {
    this.clearPauseTimer()
    if (this.index >= this.segments.length - 1) {
      this.index = this.segments.length
      this.setState('idle')
      this.events.onChapterEnd()
      return
    }
    this.index += 1
    void this.playCurrent()
  }

  private halt(): void {
    this.generation += 1
    this.clearPauseTimer()
    this.audio.pause()
    if (this.voice.kind === 'system') window.speechSynthesis?.cancel()
  }

  private trimPrepared(): void {
    for (const [index, pending] of this.prepared) {
      if (index < this.index || index > this.index + PREPARE_AHEAD) {
        this.prepared.delete(index)
        void pending.then((url) => url && URL.revokeObjectURL(url)).catch(() => undefined)
      }
    }
  }

  private forgetPrepared(): void {
    for (const pending of this.prepared.values()) {
      void pending.then((url) => url && URL.revokeObjectURL(url)).catch(() => undefined)
    }
    this.prepared.clear()
  }

  private clearPauseTimer(): void {
    if (this.pauseTimer !== null) window.clearTimeout(this.pauseTimer)
    this.pauseTimer = null
  }

  private fail(message: string): void {
    this.halt()
    this.setState('paused')
    this.events.onError(message)
  }

  private setState(state: NarratorState): void {
    this.state = state
    this.events.onState(state)
  }
}
