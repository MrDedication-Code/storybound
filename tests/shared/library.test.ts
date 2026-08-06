import {
  matchesLibraryFilter,
  mergeChapterContent,
  reorderByIds,
  splitContentAtOffset
} from '../../src/shared/library'
import type { BookSummary, LibraryFilter } from '../../src/shared/types'

function filterableBook(
  overrides: Partial<
    Pick<BookSummary, 'status' | 'progressPercentage' | 'hasFinishedCurrentContent'>
  > = {}
): Pick<BookSummary, 'status' | 'progressPercentage' | 'hasFinishedCurrentContent'> {
  return {
    status: 'ongoing',
    progressPercentage: 0,
    hasFinishedCurrentContent: false,
    ...overrides
  }
}

describe('matchesLibraryFilter', () => {
  it.each<
    [
      LibraryFilter,
      Pick<BookSummary, 'status' | 'progressPercentage' | 'hasFinishedCurrentContent'>,
      boolean
    ]
  >([
    ['all', filterableBook(), true],
    ['ongoing', filterableBook({ status: 'ongoing' }), true],
    ['ongoing', filterableBook({ status: 'completed' }), false],
    ['completed', filterableBook({ status: 'completed' }), true],
    ['unread', filterableBook({ progressPercentage: 0 }), true],
    ['unread', filterableBook({ progressPercentage: 0.01 }), false],
    [
      'in-progress',
      filterableBook({ progressPercentage: 35, hasFinishedCurrentContent: false }),
      true
    ],
    [
      'in-progress',
      filterableBook({ progressPercentage: 100, hasFinishedCurrentContent: true }),
      false
    ],
    ['finished', filterableBook({ progressPercentage: 100, hasFinishedCurrentContent: true }), true]
  ])('evaluates the %s filter independently of writing state', (filter, book, expected) => {
    expect(matchesLibraryFilter(book, filter)).toBe(expected)
  })

  it('does not equate a completed manuscript with finished reading', () => {
    const completedButUnread = filterableBook({
      status: 'completed',
      progressPercentage: 0,
      hasFinishedCurrentContent: false
    })

    expect(matchesLibraryFilter(completedButUnread, 'completed')).toBe(true)
    expect(matchesLibraryFilter(completedButUnread, 'unread')).toBe(true)
    expect(matchesLibraryFilter(completedButUnread, 'finished')).toBe(false)
  })
})

describe('reorderByIds', () => {
  const chapters = [
    { id: 'chapter-a', title: 'First' },
    { id: 'chapter-b', title: 'Second' },
    { id: 'chapter-c', title: 'Third' }
  ]

  it('returns the same chapter objects in the requested order without mutating input', () => {
    const reordered = reorderByIds(chapters, ['chapter-c', 'chapter-a', 'chapter-b'])

    expect(reordered.map((chapter) => chapter.title)).toEqual(['Third', 'First', 'Second'])
    expect(reordered[0]).toBe(chapters[2])
    expect(chapters.map((chapter) => chapter.title)).toEqual(['First', 'Second', 'Third'])
  })

  it.each([
    ['missing id', ['chapter-a', 'chapter-b']],
    ['duplicate id', ['chapter-a', 'chapter-a', 'chapter-c']],
    ['unknown id', ['chapter-a', 'chapter-b', 'chapter-x']]
  ])('rejects an invalid order with a %s', (_label, ids) => {
    expect(() => reorderByIds(chapters, ids)).toThrow()
  })
})

describe('splitContentAtOffset', () => {
  it('splits at the exact offset and trims whitespace only at the new boundary', () => {
    const content = '  Opening paragraph.  \n\n  Closing paragraph.  '
    const offset = content.indexOf('Closing')

    expect(splitContentAtOffset(content, offset)).toEqual({
      before: '  Opening paragraph.',
      after: 'Closing paragraph.  '
    })
  })

  it('supports boundary splits', () => {
    expect(splitContentAtOffset('A chapter', 0)).toEqual({ before: '', after: 'A chapter' })
    expect(splitContentAtOffset('A chapter', 9)).toEqual({ before: 'A chapter', after: '' })
  })

  it.each([-1, 1.5, 10])('rejects invalid offset %s', (offset) => {
    expect(() => splitContentAtOffset('A chapter', offset)).toThrow(
      'The split location is outside this chapter'
    )
  })
})

describe('mergeChapterContent', () => {
  it('joins non-empty chapters with a stable paragraph boundary', () => {
    expect(mergeChapterContent('First scene.\n\n', '\nSecond scene.')).toBe(
      'First scene.\n\nSecond scene.'
    )
  })

  it('does not introduce blank paragraphs when one chapter is empty', () => {
    expect(mergeChapterContent('', '  Second scene.')).toBe('Second scene.')
    expect(mergeChapterContent('First scene.  ', '')).toBe('First scene.')
  })
})
