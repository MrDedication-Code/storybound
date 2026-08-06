// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SearchPage } from '../../src/renderer/src/pages/SearchPage'
import { book, chapter, installApi, ok } from './mockApi'

void React

describe('SearchPage', () => {
  afterEach(() => {
    window.location.hash = ''
  })

  it('resolves a passage location and carries its highlight into the reader route', async () => {
    const api = installApi()
    vi.mocked(api.search.query).mockResolvedValue(
      ok([
        {
          type: 'chapter',
          bookId: book.id,
          bookTitle: book.title,
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          excerpt: 'The obsidian key waited.',
          rank: -1
        }
      ])
    )
    vi.mocked(api.search.locate).mockResolvedValue(
      ok({ chapterId: chapter.id, location: 0.42, matchedTerm: 'obsidian key' })
    )
    const user = userEvent.setup()

    render(<SearchPage term="obsidian key" />)
    await user.click(await screen.findByRole('button', { name: /obsidian key/i }))

    await waitFor(() =>
      expect(api.search.locate).toHaveBeenCalledWith({
        chapterId: chapter.id,
        term: 'obsidian key'
      })
    )
    expect(window.location.hash).toBe(`#/read/${book.id}/${chapter.id}?at=0.42&find=obsidian+key`)
  })
})
