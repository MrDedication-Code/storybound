import {
  PERFORMANCE_NOTE,
  pauseSeconds,
  readParagraphDirection,
  stripPerformanceNotes
} from './notes'

/** One passage of a chapter, read in one go. */
export interface NarrationSegment {
  index: number
  kind: 'speech' | 'pause'
  /** What is spoken, with Markdown removed and notes written as `<sigh>` voice tags. */
  text: string
  /** The same words with every note removed, for voices that cannot perform them. */
  plainText: string
  /** How the passage is read, from a leading performance note; null for the default. */
  style: string | null
  /** Seconds of silence, for scene breaks and pause notes. */
  pause: number
  /** Where the passage starts and ends in the chapter's stored text. */
  start: number
  end: number
}

/** Passages longer than this are split at sentence ends so each request stays quick. */
const MAX_SEGMENT_CHARACTERS = 1200
/** Short neighbouring paragraphs without directions are read together, so dialogue flows. */
const MERGE_UP_TO_CHARACTERS = 700
/**
 * Google counts every passage as a request and allows few a day, however long each one is, so its
 * passages are as long as it reads well. The first stays short so listening starts quickly.
 */
const LONG_PASSAGE_CHARACTERS = 2600
/** How much of a paragraph is shown to say where listening will start. */
const PREVIEW_CHARACTERS = 64
const SCENE_BREAK = /^(?:\*\s*){3,}$|^(?:-\s*){3,}$|^(?:_\s*){3,}$/u

function cleanMarkdown(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*`~]+/g, '')
    .replace(/(^|[^\p{L}\p{N}])_+|_+(?=[^\p{L}\p{N}]|$)/gu, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
}

function voiceTags(text: string): string {
  return text.replace(PERFORMANCE_NOTE, (_match, note: string) => `<${note.trim().toLowerCase()}>`)
}

function withoutNotes(text: string): string {
  return text.replace(PERFORMANCE_NOTE, ' ').replace(/[ \t]{2,}/g, ' ')
}

function splitLong(text: string, maximum: number): string[] {
  if (text.length <= maximum) return [text]
  const sentences = text.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)\s*/gu) ?? [text]
  const parts: string[] = []
  let current = ''
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > maximum) {
      parts.push(current.trim())
      current = ''
    }
    current += sentence
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

interface Block {
  start: number
  end: number
  raw: string
}

function blocksOf(content: string): Block[] {
  const blocks: Block[] = []
  let cursor = 0
  const add = (from: number, to: number): void => {
    const raw = content.slice(from, to)
    if (!raw.trim()) return
    const lead = raw.length - raw.trimStart().length
    blocks.push({ start: from + lead, end: from + lead + raw.trim().length, raw: raw.trim() })
  }
  for (const separator of content.matchAll(/(?:\r\n?|\n)(?:[ \t]*(?:\r\n?|\n))+/gu)) {
    add(cursor, separator.index)
    cursor = separator.index + separator[0].length
  }
  add(cursor, content.length)
  return blocks
}

export interface NarrationOptions {
  longPassages?: boolean
}

const NO_BREAKS: ReadonlySet<number> = new Set()

/**
 * Turns a chapter into the passages a voice reads, in order, starting with its title. Each
 * passage keeps its place in the chapter so listening can follow and save the reading position.
 */
export function buildNarrationScript(
  chapter: {
    title: string
    content: string
  },
  options: NarrationOptions = {}
): NarrationSegment[] {
  return buildScript(chapter, options, NO_BREAKS)
}

/** `breaks` are places in the text where a new passage must begin. */
function buildScript(
  chapter: { title: string; content: string },
  options: NarrationOptions,
  breaks: ReadonlySet<number>
): NarrationSegment[] {
  const long = options.longPassages === true
  const maximum = long ? LONG_PASSAGE_CHARACTERS : MAX_SEGMENT_CHARACTERS
  const segments: Omit<NarrationSegment, 'index'>[] = []
  const title = cleanMarkdown(chapter.title)
  let titleSegment: Omit<NarrationSegment, 'index'> | null = null
  if (title) {
    titleSegment = {
      kind: 'speech',
      text: title,
      plainText: title,
      style: null,
      pause: 0,
      start: 0,
      end: 0
    }
    segments.push(titleSegment)
    // With long passages the title is read as part of the first one, which saves a request.
    if (!long) {
      segments.push({
        kind: 'pause',
        text: '',
        plainText: '',
        style: null,
        pause: 0.9,
        start: 0,
        end: 0
      })
    }
  }

  /** Whether a passage has room for more, keeping the very first one short. */
  const roomFor = (
    previous: Omit<NarrationSegment, 'index'> | undefined,
    block: Block,
    length: number
  ): previous is Omit<NarrationSegment, 'index'> => {
    if (previous?.kind !== 'speech' || previous.style !== null || breaks.has(block.start)) {
      return false
    }
    if (!long)
      return previous !== titleSegment && previous.text.length + length < MERGE_UP_TO_CHARACTERS
    const first = segments.filter((segment) => segment.kind === 'speech').length === 1
    return previous.text.length + length < (first ? MERGE_UP_TO_CHARACTERS : maximum)
  }

  for (const block of blocksOf(chapter.content)) {
    if (SCENE_BREAK.test(block.raw)) {
      // Google performs a pause inside a passage, so a scene break need not end one.
      const before = segments.at(-1)
      if (long && roomFor(before, block, 0)) {
        before.text = `${before.text}\n\n<long pause>`
        before.plainText = `${before.plainText}\n\n`
        before.end = block.end
        continue
      }
      segments.push({
        kind: 'pause',
        text: '',
        plainText: '',
        style: null,
        pause: 1.6,
        start: block.start,
        end: block.end
      })
      continue
    }
    // A paragraph that is only a pause note ("[[long pause]]") is a silence, not a style.
    const onlyNote = block.raw.match(/^\[\[([^[\]\n]{1,120})\]\]$/)
    const pause = onlyNote ? pauseSeconds(onlyNote[1]) : null
    if (pause !== null) {
      const before = segments.at(-1)
      if (long && roomFor(before, block, 0)) {
        before.text = `${before.text}\n\n<${onlyNote?.[1].trim().toLowerCase()}>`
        before.end = block.end
        continue
      }
      segments.push({
        kind: 'pause',
        text: '',
        plainText: '',
        style: null,
        pause,
        start: block.start,
        end: block.end
      })
      continue
    }
    const direction = readParagraphDirection(block.raw)
    const cleaned = cleanMarkdown(direction.body)
    if (!withoutNotes(cleaned).trim()) continue

    const previous = segments.at(-1)
    if (direction.style === null && roomFor(previous, block, cleaned.length)) {
      previous.text = `${previous.text}\n\n${voiceTags(cleaned)}`
      previous.plainText = `${previous.plainText}\n\n${withoutNotes(cleaned).trim()}`
      previous.end = block.end
      continue
    }

    const parts = splitLong(cleaned, maximum)
    const span = block.end - block.start
    parts.forEach((part, partIndex) => {
      // A split paragraph's parts share its place, spread evenly, which is close enough to
      // resume from.
      const start = block.start + Math.round((span * partIndex) / parts.length)
      const end = block.start + Math.round((span * (partIndex + 1)) / parts.length)
      segments.push({
        kind: 'speech',
        text: voiceTags(part),
        plainText: withoutNotes(part).trim(),
        style: direction.style,
        pause: 0,
        start,
        end
      })
    })
  }
  return segments.map((segment, index) => ({ ...segment, index }))
}

/** How far through the chapter a passage is, from 0 to 1, for the reading position. */
export function segmentProgress(segment: NarrationSegment, contentLength: number): number {
  if (contentLength <= 0) return 0
  return Math.min(1, Math.max(0, segment.start / contentLength))
}

/** The words of a block as a listener hears them, or nothing if it is a break or a pause. */
function spokenWords(block: Block): string {
  if (SCENE_BREAK.test(block.raw)) return ''
  return withoutNotes(cleanMarkdown(readParagraphDirection(block.raw).body)).trim()
}

export interface NarrationPlace {
  /** The paragraph, as offsets in the chapter's stored text. */
  start: number
  end: number
  /** Its opening words, to show the listener where this is. */
  preview: string
}

/** The paragraph a voice would read at a place in the chapter, or the next one with words in it. */
export function narrationPlace(content: string, offset: number): NarrationPlace | null {
  const spoken = blocksOf(content).filter((block) => spokenWords(block))
  const block = spoken.find((item) => item.end > offset) ?? spoken.at(-1)
  if (!block) return null
  const words = spokenWords(block).replace(/\s+/g, ' ')
  return {
    start: block.start,
    end: block.end,
    preview:
      words.length > PREVIEW_CHARACTERS ? `${words.slice(0, PREVIEW_CHARACTERS).trimEnd()}…` : words
  }
}

/** Where listening starts from a reading position. At the very end, the chapter starts again. */
export function listeningStartOffset(progress: number, contentLength: number): number {
  return progress >= 0.98 ? 0 : Math.max(0, progress) * contentLength
}

/** The start of the paragraph listening begins from at a reading position (0 to 1). */
export function paragraphAtPosition(content: string, position: number): number {
  return narrationPlace(content, listeningStartOffset(position, content.length))?.start ?? 0
}

/**
 * The passages of a chapter and which one to start with, so reading begins at the paragraph at
 * `offset`, not at the top of the passage it falls in. Only that passage is divided: the ones
 * after it stay the same, so audio already made for them is used again.
 */
export function narrationFrom(
  chapter: { title: string; content: string },
  options: NarrationOptions,
  offset: number
): { segments: NarrationSegment[]; index: number } {
  const plain = buildScript(chapter, options, NO_BREAKS)
  const place = offset > 0 ? narrationPlace(chapter.content, offset) : null
  // The chapter's first paragraph is read with its title.
  if (!place || place.start === narrationPlace(chapter.content, 0)?.start) {
    return { segments: plain, index: 0 }
  }
  const spoken = plain.filter((segment) => segment.kind === 'speech')
  // A place saved while listening is the start of a passage, even partway through a paragraph.
  const saved = spoken.find((segment) => Math.abs(segment.start - offset) < 1)
  if (saved) return { segments: plain, index: saved.index }
  const containing = spoken.filter((segment) => segment.start <= place.start).at(-1)
  if (!containing || containing.start === place.start) {
    return { segments: plain, index: containing?.index ?? 0 }
  }
  const after = plain[containing.index + 1]
  const breaks = new Set(after ? [place.start, after.start] : [place.start])
  const segments = buildScript(chapter, options, breaks)
  const index = segments.findIndex(
    (segment) => segment.kind === 'speech' && segment.start === place.start
  )
  return { segments, index: Math.max(0, index) }
}

/**
 * Where each paragraph a reader sees starts in the text they see, with notes removed, and in the
 * chapter's stored text. Empty if the two cannot be matched up.
 */
export function shownParagraphOffsets(content: string): { shown: number; stored: number }[] {
  const shown = blocksOf(stripPerformanceNotes(content))
  const stored = blocksOf(content).filter((block) => stripPerformanceNotes(block.raw).trim())
  if (shown.length !== stored.length) return []
  return shown.map((block, index) => ({ shown: block.start, stored: stored[index].start }))
}
