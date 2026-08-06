// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { applyStoryPaste, storyTextFromClipboard } from '../../src/renderer/src/lib/storyPaste'

function clipboard(plainText: string, html = ''): Pick<DataTransfer, 'getData'> {
  return {
    getData: (type) => (type === 'text/plain' ? plainText : type === 'text/html' ? html : '')
  }
}

describe('story paste formatting', () => {
  it('recovers semantic paragraphs and inline emphasis from matching clipboard HTML', () => {
    expect(
      storyTextFromClipboard(
        clipboard(
          'The room went still.\n“Are you certain?” Mara asked.\n“Completely,” Ivo said.',
          '<p>The room went <strong>still</strong>.</p><p>“Are you certain?” Mara asked.</p><p>“Completely,” Ivo said.</p>'
        )
      )
    ).toBe('The room went **still**.\n\n“Are you certain?” Mara asked.\n\n“Completely,” Ivo said.')
  })

  it('keeps existing plain-text paragraph boundaries exactly', () => {
    expect(
      storyTextFromClipboard(
        clipboard('First paragraph.\r\n\r\nSecond paragraph.', '<p>Different text.</p>')
      )
    ).toBe('First paragraph.\n\nSecond paragraph.')
  })

  it('does not trust unrelated or hidden rich clipboard content', () => {
    expect(
      storyTextFromClipboard(
        clipboard('The intended story.', '<p>The intended story.</p><button>Share</button>')
      )
    ).toBe('The intended story.')
  })

  it('keeps preformatted clipboard text inside a clean Markdown fence', () => {
    expect(
      storyTextFromClipboard(
        clipboard(
          'const lantern = true;\nContinue below.',
          '<pre><code>const lantern = true;</code></pre><p>Continue below.</p>'
        )
      )
    ).toBe('```\nconst lantern = true;\n```\n\nContinue below.')
  })

  it('normalizes Unicode line separators and replaces only the selected text', () => {
    const edit = applyStoryPaste(
      'Before OLD after',
      7,
      10,
      clipboard('First\u2029Second\u2028Third')
    )

    expect(edit).toEqual({
      cursor: 26,
      insertedText: 'First\n\nSecond\nThird',
      value: 'Before First\n\nSecond\nThird after'
    })
  })
})
