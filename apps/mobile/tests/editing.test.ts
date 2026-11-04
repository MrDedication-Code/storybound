import { describe, expect, it } from 'vitest'
import {
  EditHistory,
  findMatches,
  insertSceneBreak,
  insertText,
  replaceAllMatches,
  smartenTyping,
  suggestSplitTitle,
  toggleEmphasis,
  toggleHeading,
  wrapDialogue,
  type TextEdit
} from '../src/domain/editing'

const edit = (value: string, start: number, end = start): TextEdit => ({
  value,
  selection: { start, end }
})

describe('writing tools', () => {
  it('wraps and unwraps emphasis', () => {
    const bold = toggleEmphasis(edit('a dark night', 2, 6), '**')
    expect(bold).toEqual(edit('a **dark** night', 4, 8))
    expect(toggleEmphasis(bold, '**')).toEqual(edit('a dark night', 2, 6))
    expect(toggleEmphasis(edit('so ', 3), '*')).toEqual(edit('so **', 4))
    // Italic inside bold adds its own markers instead of eating the bold ones.
    expect(toggleEmphasis(edit('**dark**', 2, 6), '*').value).toBe('***dark***')
    expect(toggleEmphasis(edit('x **dark** y', 2, 10), '**')).toEqual(edit('x dark y', 2, 6))
  })

  it('toggles a heading on the current line', () => {
    const heading = toggleHeading(edit('Intro\nThe Storm\nText', 9))
    expect(heading).toEqual(edit('Intro\n## The Storm\nText', 12))
    expect(toggleHeading(heading)).toEqual(edit('Intro\nThe Storm\nText', 9))
  })

  it('adds dialogue quotes, dashes, and scene breaks', () => {
    expect(wrapDialogue(edit('Run now', 0, 7))).toEqual(edit('“Run now”', 1, 8))
    expect(wrapDialogue(edit('', 0))).toEqual(edit('“”', 1))
    expect(insertText(edit('wait then', 4, 5), '—')).toEqual(edit('wait—then', 5))
    expect(insertSceneBreak(edit('End of scene.  \nNext', 15))).toEqual(
      edit('End of scene.\n\n* * *\n\nNext', 22)
    )
    expect(insertSceneBreak(edit('', 0))).toEqual(edit('* * *\n\n', 7))
  })

  it('turns typed punctuation into typeset punctuation', () => {
    expect(smartenTyping('He said ', 'He said "')).toEqual(edit('He said “', 9))
    expect(smartenTyping('“Go', '“Go"')).toEqual(edit('“Go”', 4))
    expect(smartenTyping('don', "don'")).toEqual(edit('don’', 4))
    expect(smartenTyping('(', "('")).toEqual(edit('(‘', 2))
    expect(smartenTyping('wait-', 'wait--')).toEqual(edit('wait—', 5))
    expect(smartenTyping('and..', 'and...')).toEqual(edit('and…', 4))
    // Typing in the middle of text keeps what follows.
    expect(smartenTyping('ab', 'a"b')).toEqual(edit('a”b', 2))
    // Pasted text and suggestions are left alone.
    expect(smartenTyping('a', 'a "quoted"')).toBeNull()
    expect(smartenTyping('a', 'ab')).toBeNull()
  })

  it('finds and replaces text, with or without matching case', () => {
    expect(findMatches('The cat. the end. THE', 'the')).toEqual([
      { start: 0, end: 3 },
      { start: 9, end: 12 },
      { start: 18, end: 21 }
    ])
    expect(findMatches('The cat. the end.', 'the', true)).toEqual([{ start: 9, end: 12 }])
    expect(findMatches('a.b', '.')).toEqual([{ start: 1, end: 2 }])
    expect(replaceAllMatches('Mara and mara', 'mara', 'Lena')).toEqual({
      value: 'Lena and Lena',
      count: 2
    })
    expect(replaceAllMatches('cost $5', '$5', '$6').value).toBe('cost $6')
  })

  it('suggests a title for the second half of a split', () => {
    expect(suggestSplitTitle('\n## The Crossing\nThey walked.', 'Chapter 4')).toBe('The Crossing')
    expect(suggestSplitTitle('They walked.\n## Later', 'Chapter 4')).toBe('Chapter 4')
  })

  it('undoes typing a phrase at a time and each tool as one step', () => {
    const history = new EditHistory(edit('', 0))
    history.record(edit('T', 1), 'typing', 1000)
    history.record(edit('Th', 2), 'typing', 1200)
    history.record(edit('The', 3), 'typing', 1400)
    history.record(edit('The end', 7), 'typing', 5000)
    history.record(edit('**The end**', 9), 'tool', 5100)
    expect(history.undo()).toEqual(edit('The end', 7))
    expect(history.undo()).toEqual(edit('The', 3))
    expect(history.undo()).toEqual(edit('', 0))
    expect(history.canUndo).toBe(false)
    expect(history.redo()).toEqual(edit('The', 3))
    history.record(edit('The cat', 7), 'typing', 9000)
    expect(history.canRedo).toBe(false)
  })
})

describe('performance notes', () => {
  it('puts a note at the cursor with spaces where words would touch', async () => {
    const { insertPerformanceNote } = await import('../src/domain/editing')
    const result = insertPerformanceNote(
      { value: 'She stopped.It hurt.', selection: { start: 12, end: 12 } },
      'sigh'
    )
    expect(result.value).toBe('She stopped. [[sigh]] It hurt.')
    expect(result.selection.start).toBe(22)
  })

  it('starts the paragraph with a direction, replacing the one there', async () => {
    const { directParagraph } = await import('../src/domain/editing')
    const value = 'First.\n\n[[calm]] Second line here.'
    const once = directParagraph({ value, selection: { start: 30, end: 30 } }, 'hushed, urgent')
    expect(once.value).toBe('First.\n\n[[hushed, urgent]] Second line here.')
    const top = directParagraph({ value: 'Alone.', selection: { start: 3, end: 3 } }, 'grave')
    expect(top.value).toBe('[[grave]] Alone.')
  })
})
