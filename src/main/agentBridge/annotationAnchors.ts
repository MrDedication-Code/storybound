import type { ChapterAnchor } from '../../shared/types'

/**
 * - exact: the stored character offsets still point at the highlighted words.
 * - relocated: the words were found elsewhere in the current text (the chapter was edited).
 * - orphaned: the highlighted words no longer appear in the chapter at all.
 * - chapter-position: a note made without selecting text, pinned to a rough position.
 */
export type AnchorStatus = 'exact' | 'relocated' | 'orphaned' | 'chapter-position'

export interface LocatedAnchor {
  status: AnchorStatus
  /** Offsets into the current chapter text; null when orphaned. */
  start: number | null
  end: number | null
}

type AnchorFields = Pick<
  ChapterAnchor,
  'startOffset' | 'endOffset' | 'fallbackLocation' | 'quote' | 'prefix' | 'suffix'
>

// Highlights are captured from the rendered page, so a quote can lack the Markdown emphasis
// markers that exist in the stored chapter, and its line breaks can differ.
const MARKDOWN_MARKERS = new Set(['*', '_', '`', '~'])

interface NormalizedText {
  text: string
  /** For each character of `text`, its index in the original string. */
  sourceIndex: number[]
}

function normalize(value: string): NormalizedText {
  let text = ''
  const sourceIndex: number[] = []
  let pendingSpace = false
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (MARKDOWN_MARKERS.has(character)) continue
    if (/\s/.test(character)) {
      pendingSpace = text.length > 0
      continue
    }
    if (pendingSpace) {
      text += ' '
      sourceIndex.push(index)
      pendingSpace = false
    }
    text += character
    sourceIndex.push(index)
  }
  return { text, sourceIndex }
}

function occurrences(haystack: string, needle: string): number[] {
  const found: number[] = []
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) {
    found.push(at)
  }
  return found
}

function sharedSuffixLength(left: string, right: string): number {
  let length = 0
  while (
    length < left.length &&
    length < right.length &&
    left[left.length - 1 - length] === right[right.length - 1 - length]
  ) {
    length += 1
  }
  return length
}

function sharedPrefixLength(left: string, right: string): number {
  let length = 0
  while (length < left.length && length < right.length && left[length] === right[length]) {
    length += 1
  }
  return length
}

/** Finds where an annotation sits in the chapter's current text. */
export function locateAnchor(content: string, anchor: AnchorFields): LocatedAnchor {
  const quote = anchor.quote
  if (!quote.trim()) {
    const position = Math.round(anchor.fallbackLocation * content.length)
    return { status: 'chapter-position', start: position, end: position }
  }
  const { startOffset, endOffset } = anchor
  if (
    startOffset !== null &&
    endOffset !== null &&
    endOffset <= content.length &&
    content.slice(startOffset, endOffset) === quote
  ) {
    return { status: 'exact', start: startOffset, end: endOffset }
  }

  let candidates = occurrences(content, quote).map((start) => ({
    start,
    end: start + quote.length
  }))
  if (candidates.length === 0) {
    const normalizedContent = normalize(content)
    const normalizedQuote = normalize(quote).text
    if (normalizedQuote) {
      candidates = occurrences(normalizedContent.text, normalizedQuote).map((start) => ({
        start: normalizedContent.sourceIndex[start],
        end: normalizedContent.sourceIndex[start + normalizedQuote.length - 1] + 1
      }))
    }
  }
  if (candidates.length === 0) return { status: 'orphaned', start: null, end: null }

  // With several matches, prefer the one whose surroundings best match the text saved around
  // the highlight, then the one nearest where it used to be.
  const expected = startOffset ?? Math.round(anchor.fallbackLocation * content.length)
  const best = candidates
    .map((candidate) => ({
      ...candidate,
      context:
        sharedSuffixLength(anchor.prefix, content.slice(0, candidate.start)) +
        sharedPrefixLength(anchor.suffix, content.slice(candidate.end)),
      distance: Math.abs(candidate.start - expected)
    }))
    .sort((left, right) => right.context - left.context || left.distance - right.distance)[0]
  return { status: 'relocated', start: best.start, end: best.end }
}
