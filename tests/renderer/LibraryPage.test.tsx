// @vitest-environment jsdom

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LibraryPage } from '../../src/renderer/src/pages/LibraryPage'
import { BookPage } from '../../src/renderer/src/pages/BookPage'
import { book, installApi } from './mockApi'

void React

describe('LibraryPage actions', () => {
  afterEach(() => {
    window.location.hash = ''
  })

  it('resolves an existing chapter before opening a book from its Edit action', async () => {
    const api = installApi()
    const user = userEvent.setup()
    render(<LibraryPage defaultSort="recently-opened" onAddBook={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: `Edit ${book.title}` }))

    await waitFor(() => expect(api.books.get).toHaveBeenCalledWith(book.id))
    expect(window.location.hash).toBe(`#/edit/${book.id}/${book.chapters[0].id}`)
  })

  it('imports reviewed Markdown directly into a new book', async () => {
    const api = installApi()
    const user = userEvent.setup()
    render(<LibraryPage defaultSort="recently-opened" notify={vi.fn()} onAddBook={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: 'Import text' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Import story text' }))
    await user.type(
      dialog.getByLabelText('Story or conversation text'),
      '# A Direct Tale\n\n## Opening\n\nThe first imported passage.'
    )
    await user.click(dialog.getByRole('button', { name: 'Import 1 chapter' }))

    await waitFor(() =>
      expect(api.books.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'A Direct Tale',
          initialChapterTitle: 'Opening',
          initialChapterContent: 'The first imported passage.'
        })
      )
    )
  })

  it('creates tags and collections from the organizer manager', async () => {
    const api = installApi()
    const user = userEvent.setup()
    render(<LibraryPage defaultSort="recently-opened" notify={vi.fn()} onAddBook={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: 'Organize' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Manage your library' }))
    await user.type(dialog.getByLabelText('New tag name'), 'Comfort read')
    await user.click(dialog.getByRole('button', { name: 'Add tag' }))
    await user.type(dialog.getByLabelText('New collection name'), 'Winter shelf')
    await user.click(dialog.getByRole('button', { name: 'Add collection' }))

    expect(api.tags.create).toHaveBeenCalledWith({ name: 'Comfort read', color: 'gold' })
    expect(api.collections.create).toHaveBeenCalledWith({ name: 'Winter shelf' })
  })

  it('opens Read from beginning at location zero even when the first chapter was last read', async () => {
    installApi()
    const user = userEvent.setup()
    render(<BookPage bookId={book.id} notify={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: 'Read from beginning' }))

    expect(window.location.hash).toBe(`#/read/${book.id}/${book.chapters[0].id}?at=0`)
  })
})
