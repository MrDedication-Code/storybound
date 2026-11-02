import { describe, expect, it } from 'vitest'
import {
  calculateReadingProgress,
  estimateReadingMinutes,
  formatCompactNumber,
  parseStoryBlocks,
  placeAnnotations,
  quoteText,
  segmentBlock,
  splitSentences
} from '../src/domain/reading'
import type { Annotation } from '../src/domain/contracts'

describe('calculateReadingProgress', () => {
  it('combines chapter and in-chapter progress', () => {
    expect(calculateReadingProgress(1, 4, 0.5)).toBe(37.5)
  })

  it('clamps invalid positions and handles empty books', () => {
    expect(calculateReadingProgress(-3, 2, -1)).toBe(0)
    expect(calculateReadingProgress(12, 2, 2)).toBe(100)
    expect(calculateReadingProgress(0, 0, 0.5)).toBe(0)
  })
})

describe('parseStoryBlocks', () => {
  it('preserves prose order while recognizing headings and dividers', () => {
    expect(parseStoryBlocks('## Arrival\n\nFirst paragraph.\n\n* * *\n\nLast paragraph.')).toEqual([
      { kind: 'heading', text: 'Arrival', start: 3, end: 10 },
      { kind: 'paragraph', text: 'First paragraph.', start: 12, end: 28 },
      { kind: 'divider', text: '', start: 30, end: 35 },
      { kind: 'paragraph', text: 'Last paragraph.', start: 37, end: 52 }
    ])
  })

  it('returns plain text instead of interpreting embedded markup', () => {
    expect(parseStoryBlocks('<script>alert(1)</script>')).toEqual([
      { kind: 'paragraph', text: '<script>alert(1)</script>', start: 0, end: 25 }
    ])
  })
})

describe('reading labels', () => {
  it('estimates whole reading minutes', () => {
    expect(estimateReadingMinutes(0)).toBe(0)
    expect(estimateReadingMinutes(231)).toBe(2)
  })

  it('formats compact word counts', () => {
    expect(formatCompactNumber(999)).toBe('999')
    expect(formatCompactNumber(1_250)).toBe('1.3k')
    expect(formatCompactNumber(25_400)).toBe('25k')
  })
})

function annotation(overrides: Partial<Annotation>): Annotation {
  return {
    id: 'a',
    bookId: 'book',
    chapterId: 'chapter',
    chapterTitle: 'One',
    kind: 'highlight',
    body: '',
    color: 'gold',
    startOffset: null,
    endOffset: null,
    fallbackLocation: 0,
    quote: '',
    prefix: '',
    suffix: '',
    createdAt: '2026-11-02T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z',
    ...overrides
  }
}

describe('highlights in the reader', () => {
  const content = 'Intro line.\n\nThe lamp went out. Someone *laughed*! Then silence.'

  it('splits a paragraph into sentences at their place in the chapter', () => {
    const paragraph = parseStoryBlocks(content)[1]
    expect(splitSentences(paragraph).map((range) => content.slice(range.start, range.end))).toEqual(
      ['The lamp went out.', 'Someone *laughed*!', 'Then silence.']
    )
  })

  it('saves quotes the way the desktop page shows them', () => {
    expect(quoteText('Someone *laughed*! `code` and ~~gone~~ _so_ snake_case')).toBe(
      'Someone laughed! code and gone so snake_case'
    )
  })

  it('finds a highlight after edits and cuts the paragraph around it', () => {
    const edited = `A new opening.\n\n${content}`
    const placed = placeAnnotations(edited, [
      annotation({
        id: 'note',
        body: 'Who?',
        quote: 'Someone laughed!',
        startOffset: 33,
        endOffset: 51
      }),
      annotation({ id: 'gone', quote: 'words that were deleted' })
    ])
    expect(placed.map((item) => item.status)).toEqual(['relocated', 'orphaned'])
    const paragraph = parseStoryBlocks(edited)[2]
    expect(
      segmentBlock(paragraph, placed).map((segment) => [
        segment.text,
        segment.annotation?.id ?? null,
        segment.endsNote
      ])
    ).toEqual([
      ['The lamp went out. ', null, false],
      ['Someone *laughed*!', 'note', true],
      [' Then silence.', null, false]
    ])
  })
})
