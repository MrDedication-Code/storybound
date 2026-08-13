export interface StoryBlock {
  kind: 'heading' | 'paragraph' | 'divider'
  text: string
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

export function estimateReadingMinutes(wordCount: number, wordsPerMinute = 230): number {
  if (wordCount <= 0) return 0
  return Math.max(1, Math.ceil(wordCount / Math.max(1, wordsPerMinute)))
}

export function parseStoryBlocks(content: string): StoryBlock[] {
  const normalized = content.replace(/\r\n?/g, '\n').trim()
  if (!normalized) return []

  return normalized.split(/\n{2,}/u).map((block) => {
    const value = block.trim()
    if (/^(?:\*\s*){3}$|^(?:-\s*){3}$/u.test(value)) return { kind: 'divider', text: '' }
    const heading = value.match(/^#{1,3}\s+(.+)$/u)
    if (heading) return { kind: 'heading', text: heading[1].trim() }
    return { kind: 'paragraph', text: value }
  })
}

export function formatCompactNumber(value: number): string {
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return `${Number((value / 1_000).toFixed(value < 10_000 ? 1 : 0))}k`
  return `${Number((value / 1_000_000).toFixed(1))}m`
}
