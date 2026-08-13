import { describe, expect, it } from 'vitest'
import {
  calculateReadingProgress,
  estimateReadingMinutes,
  formatCompactNumber,
  parseStoryBlocks
} from '../src/domain/reading'

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
      { kind: 'heading', text: 'Arrival' },
      { kind: 'paragraph', text: 'First paragraph.' },
      { kind: 'divider', text: '' },
      { kind: 'paragraph', text: 'Last paragraph.' }
    ])
  })

  it('returns plain text instead of interpreting embedded markup', () => {
    expect(parseStoryBlocks('<script>alert(1)</script>')).toEqual([
      { kind: 'paragraph', text: '<script>alert(1)</script>' }
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
