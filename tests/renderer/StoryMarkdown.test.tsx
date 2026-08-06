// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StoryMarkdown } from '../../src/renderer/src/components/StoryMarkdown'

void React

class MockHighlight {
  readonly ranges: Range[]

  constructor(...ranges: Range[]) {
    this.ranges = ranges
  }
}

describe('StoryMarkdown highlights', () => {
  const registry = new Map<string, MockHighlight>()
  const deleteHighlight = vi.fn((name: string) => registry.delete(name))
  const setHighlight = vi.fn((name: string, highlight: MockHighlight) => {
    registry.set(name, highlight)
  })
  const scrollIntoView = vi.fn()

  beforeEach(() => {
    registry.clear()
    deleteHighlight.mockClear()
    setHighlight.mockClear()
    scrollIntoView.mockClear()
    Object.defineProperty(globalThis, 'CSS', {
      configurable: true,
      value: { highlights: { delete: deleteHighlight, set: setHighlight } }
    })
    Object.defineProperty(window, 'Highlight', {
      configurable: true,
      value: MockHighlight
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView
    })
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('groups annotation quotes into safe color registries', () => {
    const { unmount } = render(
      <StoryMarkdown
        highlights={[
          { id: 'one', quote: 'marked phrase', color: 'blue' },
          { id: 'two', quote: 'again', color: 'blue' },
          { id: 'three', quote: 'fallback', color: 'url(evil)' },
          { id: 'empty', quote: '   ', color: 'pink' }
        ]}
      >
        {'A **marked** phrase appears again, with a fallback.'}
      </StoryMarkdown>
    )

    expect(registry.get('storybound-annotation-blue')?.ranges).toHaveLength(2)
    expect(registry.get('storybound-annotation-gold')?.ranges).toHaveLength(1)
    expect(registry.has('storybound-annotation-pink')).toBe(false)
    expect([...registry.keys()]).toEqual([
      'storybound-annotation-blue',
      'storybound-annotation-gold'
    ])

    unmount()
    expect(deleteHighlight).toHaveBeenCalledWith('storybound-annotation-blue')
    expect(deleteHighlight).toHaveBeenCalledWith('storybound-annotation-gold')
  })

  it('keeps search highlighting and scrolls the first match into view', () => {
    const { unmount } = render(
      <StoryMarkdown highlight="needle">A needle and another needle.</StoryMarkdown>
    )

    expect(registry.get('storybound-search-hit')?.ranges).toHaveLength(2)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' })

    unmount()
    expect(deleteHighlight).toHaveBeenCalledWith('storybound-search-hit')
  })

  it('renders without highlights when the browser API is unavailable', () => {
    Object.defineProperty(globalThis, 'CSS', { configurable: true, value: undefined })
    Object.defineProperty(window, 'Highlight', { configurable: true, value: undefined })

    expect(() =>
      render(
        <StoryMarkdown highlight="text" highlights={[{ id: 'one', quote: 'text', color: 'green' }]}>
          Some text
        </StoryMarkdown>
      )
    ).not.toThrow()
    expect(setHighlight).not.toHaveBeenCalled()
  })

  it('keeps authored dialogue lines visible while retaining true paragraph boundaries', () => {
    const { container } = render(
      <StoryMarkdown>
        {
          'The room went still.\n“Are you certain?” Mara asked.\n“Completely,” Ivo said.\n\nThe lamp flickered.'
        }
      </StoryMarkdown>
    )

    expect(container.querySelectorAll('.story-markdown p')).toHaveLength(2)
    expect(container.querySelectorAll('.story-markdown br')).toHaveLength(2)
    expect(container.querySelectorAll('.story-markdown p')[0]).toHaveTextContent(
      'The room went still. “Are you certain?” Mara asked. “Completely,” Ivo said.'
    )
    expect(container.querySelectorAll('.story-markdown p')[1]).toHaveTextContent(
      'The lamp flickered.'
    )
  })
})
