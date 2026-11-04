// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { StoryMarkdown } from '../../src/renderer/src/components/StoryMarkdown'
import { countWords } from '../../src/shared/text'

const text = '[[hushed, urgent]] Run, she said. [[sigh]] Then nothing.'

describe('performance notes on screen', () => {
  it('hides them from readers and counts', () => {
    const { container } = render(createElement(StoryMarkdown, null, text))
    expect(container.textContent).toBe('Run, she said. Then nothing.')
    expect(countWords(text)).toBe(5)
  })

  it('shows them as chips in the editor preview', () => {
    render(createElement(StoryMarkdown, { showNotes: true }, text))
    expect(screen.getByText('hushed, urgent').className).toBe('performance-note')
    expect(screen.getByText('sigh').className).toBe('performance-note')
  })
})
