import {
  calculateReadingProgress,
  clamp,
  countWords,
  createExcerpt,
  detectChapterSplits,
  normalizeSearch
} from '../../src/shared/text'

describe('countWords', () => {
  it('counts words without treating punctuation or whitespace as words', () => {
    expect(countWords('  Once, upon\n\na time…  ')).toBe(4)
    expect(countWords('')).toBe(0)
  })

  it('supports unicode words, contractions, hyphenation, and numbers', () => {
    expect(countWords("L'été isn't over—twenty-one times in 2026.")).toBe(7)
    expect(countWords('你好 世界')).toBe(2)
  })
})

describe('normalizeSearch', () => {
  it('normalizes case, surrounding whitespace, and diacritics', () => {
    expect(normalizeSearch('  ÉPILOGUE  ')).toBe('epilogue')
    expect(normalizeSearch('Cafe\u0301')).toBe('cafe')
  })
})

describe('clamp', () => {
  it.each([
    [-1, 0],
    [0.4, 0.4],
    [2, 1]
  ])('clamps %s to %s in the inclusive range', (value, expected) => {
    expect(clamp(value, 0, 1)).toBe(expected)
  })
})

describe('calculateReadingProgress', () => {
  it('combines chapter position and within-chapter position', () => {
    expect(calculateReadingProgress(0, 4, 0)).toBe(0)
    expect(calculateReadingProgress(1, 4, 0.5)).toBe(37.5)
    expect(calculateReadingProgress(3, 4, 1)).toBe(100)
  })

  it('returns zero for an empty book and clamps out-of-range positions', () => {
    expect(calculateReadingProgress(0, 0, 0.5)).toBe(0)
    expect(calculateReadingProgress(-10, 2, -1)).toBe(0)
    expect(calculateReadingProgress(20, 2, 4)).toBe(100)
  })

  it('rounds to two decimal places', () => {
    expect(calculateReadingProgress(0, 3, 1)).toBe(33.33)
  })
})

describe('detectChapterSplits', () => {
  it('finds supported headings after the first chapter without modifying content', () => {
    const content = [
      'Chapter One',
      '',
      'Opening text.',
      '',
      'CHAPTER 2: The Crossing',
      '',
      'Second chapter.',
      '',
      '## Epilogue',
      '',
      'The end.'
    ].join('\n')

    expect(detectChapterSplits(content)).toEqual([
      {
        offset: content.indexOf('CHAPTER 2'),
        title: 'CHAPTER 2: The Crossing',
        line: 5
      },
      {
        offset: content.indexOf('## Epilogue'),
        title: 'Epilogue',
        line: 9
      }
    ])
    expect(content).toContain('Second chapter.')
  })

  it('recognizes standalone prologue and interlude headings but not prose mentions', () => {
    const content = ['Opening', 'A prologue appears in this sentence.', 'Interlude', 'Quiet.'].join(
      '\n'
    )

    expect(detectChapterSplits(content)).toEqual([
      {
        offset: content.indexOf('Interlude'),
        title: 'Interlude',
        line: 3
      }
    ])
  })

  it('does not propose a split at offset zero', () => {
    expect(detectChapterSplits('Prologue\n\nOpening paragraph.')).toEqual([])
  })
})

describe('createExcerpt', () => {
  it('centres an excerpt around a case-insensitive, diacritic-insensitive match', () => {
    const content = `Before ${'x'.repeat(40)} CAFÉ lantern ${'y'.repeat(40)} after`
    const excerpt = createExcerpt(content, 'cafe', 12)

    expect(excerpt).toContain('CAFÉ')
    expect(excerpt.startsWith('…')).toBe(true)
    expect(excerpt.endsWith('…')).toBe(true)
  })

  it('returns a trimmed leading excerpt when the term is absent', () => {
    expect(createExcerpt('  A short opening followed by more words.', 'missing', 9)).toBe(
      'A short opening'
    )
  })
})
