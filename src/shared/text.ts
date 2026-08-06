import type { SplitCandidate } from './types'

const WORD_PATTERN = /[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu

export function countWords(value: string): number {
  return value.match(WORD_PATTERN)?.length ?? 0
}

export function normalizeSearch(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase()
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
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

export function detectChapterSplits(content: string): SplitCandidate[] {
  const heading =
    /^(?:#{1,3}\s*)?(?:(?:chapter\s+(?:\d+|[a-z]+)(?:\s*[:.–—-]\s*.+)?)|prologue|epilogue|interlude)(?:\s*)$/gimu
  const candidates: SplitCandidate[] = []
  let match: RegExpExecArray | null

  while ((match = heading.exec(content)) !== null) {
    if (match.index === 0) continue
    const title = match[0].replace(/^#{1,3}\s*/, '').trim()
    const line = content.slice(0, match.index).split('\n').length
    candidates.push({ offset: match.index, title, line })
  }

  return candidates
}

export function createExcerpt(content: string, term: string, radius = 90): string {
  const normalizedContent = normalizeSearch(content)
  const normalizedTerm = normalizeSearch(term)
  const found = normalizedContent.indexOf(normalizedTerm)
  if (found < 0) return content.slice(0, radius * 2).trim()
  const start = Math.max(0, found - radius)
  const end = Math.min(content.length, found + term.length + radius)
  return `${start > 0 ? '…' : ''}${content.slice(start, end).trim()}${end < content.length ? '…' : ''}`
}
