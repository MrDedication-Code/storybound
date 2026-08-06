import type { BookSummary, LibraryFilter } from './types'

export function matchesLibraryFilter(
  book: Pick<BookSummary, 'status' | 'progressPercentage' | 'hasFinishedCurrentContent'>,
  filter: LibraryFilter
): boolean {
  switch (filter) {
    case 'ongoing':
    case 'completed':
      return book.status === filter
    case 'unread':
      return book.progressPercentage <= 0
    case 'in-progress':
      return book.progressPercentage > 0 && !book.hasFinishedCurrentContent
    case 'finished':
      return book.hasFinishedCurrentContent
    case 'all':
      return true
  }
}

export function reorderByIds<T extends { id: string }>(
  items: readonly T[],
  orderedIds: readonly string[]
): T[] {
  if (items.length !== orderedIds.length || new Set(orderedIds).size !== orderedIds.length) {
    throw new Error('The chapter order must include each chapter exactly once')
  }

  const byId = new Map(items.map((item) => [item.id, item]))
  const reordered = orderedIds.map((id) => byId.get(id))
  if (reordered.some((item) => item === undefined)) {
    throw new Error('The chapter order contains an unknown chapter')
  }

  return reordered as T[]
}

export function splitContentAtOffset(
  content: string,
  offset: number
): { before: string; after: string } {
  if (!Number.isInteger(offset) || offset < 0 || offset > content.length) {
    throw new Error('The split location is outside this chapter')
  }

  return {
    before: content.slice(0, offset).trimEnd(),
    after: content.slice(offset).trimStart()
  }
}

export function mergeChapterContent(first: string, second: string): string {
  const left = first.trimEnd()
  const right = second.trimStart()
  if (!left) return right
  if (!right) return left
  return `${left}\n\n${right}`
}
