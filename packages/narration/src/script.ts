import { PERFORMANCE_NOTE, pauseSeconds, readParagraphDirection } from './notes'

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

/**
 * Turns a chapter into the passages a voice reads, in order, starting with its title. Each
 * passage keeps its place in the chapter so listening can follow and save the reading position.
 */
export function buildNarrationScript(
  chapter: {
    title: string
    content: string
  },
  options: { longPassages?: boolean } = {}
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
    length: number
  ): previous is Omit<NarrationSegment, 'index'> => {
    if (previous?.kind !== 'speech' || previous.style !== null) return false
    if (!long)
      return previous !== titleSegment && previous.text.length + length < MERGE_UP_TO_CHARACTERS
    const first = segments.filter((segment) => segment.kind === 'speech').length === 1
    return previous.text.length + length < (first ? MERGE_UP_TO_CHARACTERS : maximum)
  }

  for (const block of blocksOf(chapter.content)) {
    if (SCENE_BREAK.test(block.raw)) {
      // Google performs a pause inside a passage, so a scene break need not end one.
      const before = segments.at(-1)
      if (long && roomFor(before, 0)) {
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
      if (long && roomFor(before, 0)) {
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
    if (direction.style === null && roomFor(previous, cleaned.length)) {
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

/** The passage to start from when resuming at a reading position. */
export function segmentAtProgress(
  segments: NarrationSegment[],
  progress: number,
  contentLength: number
): number {
  const offset = progress * contentLength
  let found = 0
  for (const segment of segments) {
    if (segment.kind === 'speech' && segment.start <= offset) found = segment.index
  }
  return found
}
