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

function splitLong(text: string): string[] {
  if (text.length <= MAX_SEGMENT_CHARACTERS) return [text]
  const sentences = text.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)\s*/gu) ?? [text]
  const parts: string[] = []
  let current = ''
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > MAX_SEGMENT_CHARACTERS) {
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
export function buildNarrationScript(chapter: {
  title: string
  content: string
}): NarrationSegment[] {
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

  for (const block of blocksOf(chapter.content)) {
    if (SCENE_BREAK.test(block.raw)) {
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
    const canMerge =
      previous?.kind === 'speech' &&
      previous !== titleSegment &&
      previous.style === null &&
      direction.style === null &&
      previous.text.length + cleaned.length < MERGE_UP_TO_CHARACTERS
    if (canMerge && previous) {
      previous.text = `${previous.text}\n\n${voiceTags(cleaned)}`
      previous.plainText = `${previous.plainText}\n\n${withoutNotes(cleaned).trim()}`
      previous.end = block.end
      continue
    }

    const parts = splitLong(cleaned)
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
