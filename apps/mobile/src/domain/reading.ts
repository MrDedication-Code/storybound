import { locateAnchor, type AnchorStatus } from '@storybound/sync'
import type { Annotation } from './contracts'

export interface StoryBlock {
  kind: 'heading' | 'paragraph' | 'divider'
  text: string
  /** Where `text` starts and ends in the chapter's stored content, so highlights can map onto it. */
  start: number
  end: number
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

export function calculateReadingProgress(
  chapterIndex: number,
  chapterCount: number,
  positionWithinChapter: number
): number {
  if (chapterCount <= 0) return 0
  const safeIndex = clamp(chapterIndex, 0, chapterCount - 1)
  const safePosition = clamp(positionWithinChapter, 0, 1)
  return Number((((safeIndex + safePosition) / chapterCount) * 100).toFixed(2))
}

/** Words as the desktop counts them, so both apps show the same totals. */
export function countWords(content: string): number {
  return content.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu)?.length ?? 0
}

export function estimateReadingMinutes(wordCount: number, wordsPerMinute = 230): number {
  if (wordCount <= 0) return 0
  return Math.max(1, Math.ceil(wordCount / Math.max(1, wordsPerMinute)))
}

export function parseStoryBlocks(content: string): StoryBlock[] {
  const blocks: StoryBlock[] = []
  const addBlock = (from: number, to: number): void => {
    const raw = content.slice(from, to)
    const value = raw.trim()
    if (!value) return
    const start = from + raw.length - raw.trimStart().length
    const end = start + value.length
    if (/^(?:\*\s*){3}$|^(?:-\s*){3}$/u.test(value)) {
      blocks.push({ kind: 'divider', text: '', start, end })
      return
    }
    const heading = value.match(/^(#{1,3}\s+)(.+)$/u)
    if (heading) {
      const text = heading[2].trim()
      const textStart = start + heading[1].length
      blocks.push({ kind: 'heading', text, start: textStart, end: textStart + text.length })
      return
    }
    blocks.push({ kind: 'paragraph', text: value, start, end })
  }

  // Blocks are separated by blank lines; offsets are kept in the original text.
  let cursor = 0
  for (const separator of content.matchAll(/(?:\r\n?|\n)(?:[ \t]*(?:\r\n?|\n))+/gu)) {
    addBlock(cursor, separator.index)
    cursor = separator.index + separator[0].length
  }
  addBlock(cursor, content.length)
  return blocks
}

export interface TextRange {
  start: number
  end: number
}

/** Splits a paragraph into sentences, as offsets into the chapter's stored content. */
export function splitSentences(block: StoryBlock): TextRange[] {
  const sentences: TextRange[] = []
  for (const match of block.text.matchAll(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)/gu)) {
    const leading = match[0].length - match[0].trimStart().length
    const text = match[0].trim()
    if (!text) continue
    const start = block.start + match.index + leading
    sentences.push({ start, end: start + text.length })
  }
  return sentences.length ? sentences : [{ start: block.start, end: block.end }]
}

/**
 * The words of a highlight as the desktop shows them: it finds highlights in the rendered page,
 * where Markdown emphasis markers are not part of the text.
 */
export function quoteText(value: string): string {
  return value
    .replace(/[*`~]/gu, '')
    .replace(/(^|[^\p{L}\p{N}])_+|_+(?=[^\p{L}\p{N}]|$)/gu, '$1')
    .trim()
}

export interface PlacedAnnotation {
  annotation: Annotation
  status: AnchorStatus
  /** Offsets into the chapter's current text; null when the words are no longer there. */
  start: number | null
  end: number | null
}

/** Finds each highlight in the chapter's current text, the same way the desktop does. */
export function placeAnnotations(content: string, annotations: Annotation[]): PlacedAnnotation[] {
  return annotations.map((annotation) => {
    const located = locateAnchor(content, annotation)
    return { annotation, ...located }
  })
}

export interface TextSegment {
  text: string
  start: number
  end: number
  /** The topmost highlight covering this piece of text, if any. */
  annotation: Annotation | null
  /** True on the last piece of a highlight that carries a note. */
  endsNote: boolean
}

/** Cuts a block's text into plain and highlighted pieces. */
export function segmentBlock(block: StoryBlock, placed: PlacedAnnotation[]): TextSegment[] {
  const ranges = placed.filter(
    (item): item is PlacedAnnotation & { start: number; end: number } =>
      item.start !== null &&
      item.end !== null &&
      item.end > item.start &&
      item.start < block.end &&
      item.end > block.start
  )
  const cuts = new Set([block.start, block.end])
  for (const range of ranges) {
    cuts.add(Math.max(block.start, range.start))
    cuts.add(Math.min(block.end, range.end))
  }
  const points = [...cuts].sort((left, right) => left - right)
  // A heading's text omits its leading markers, so it is read from the block, not the content.
  const textAt = (from: number, to: number): string =>
    block.text.slice(from - block.start, to - block.start)
  const segments: TextSegment[] = []
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]
    const end = points[index + 1]
    if (end <= start) continue
    const covering = ranges.filter((range) => range.start <= start && range.end >= end)
    const top = covering.at(-1) ?? null
    segments.push({
      text: textAt(start, end),
      start,
      end,
      annotation: top?.annotation ?? null,
      endsNote: Boolean(top && top.end === end && top.annotation.body.trim())
    })
  }
  return segments
}

export function formatCompactNumber(value: number): string {
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return `${Number((value / 1_000).toFixed(value < 10_000 ? 1 : 0))}k`
  return `${Number((value / 1_000_000).toFixed(1))}m`
}
