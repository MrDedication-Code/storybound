// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiResult, Chapter } from '../../src/shared/types'
import { EditorPage } from '../../src/renderer/src/pages/EditorPage'
import type { PrepareCloseDetail } from '../../src/renderer/src/lib/events'
import { book, chapter, installApi, ok } from './mockApi'

void React

describe('EditorPage', () => {
  afterEach(() => {
    vi.useRealTimers()
    window.location.hash = ''
  })

  it('autosaves a brand-new chapter by creating it after typing pauses', async () => {
    const api = installApi()
    vi.mocked(api.books.get).mockResolvedValue(ok({ ...book, chapterCount: 0, chapters: [] }))
    render(<EditorPage bookId={book.id} notify={vi.fn()} />)

    expect(await screen.findByRole('textbox', { name: 'Chapter text' })).toBeVisible()
    vi.useFakeTimers()
    fireEvent.change(screen.getByRole('textbox', { name: 'Chapter text' }), {
      target: { value: 'A newly pasted beginning.' }
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100)
    })

    expect(api.chapters.create).toHaveBeenCalledWith(
      expect.objectContaining({ bookId: book.id, content: 'A newly pasted beginning.' })
    )
    expect(screen.getByRole('status')).toHaveTextContent('Saved')
  })

  it('requires confirmation before moving a chapter to recoverable trash', async () => {
    const api = installApi()
    const user = userEvent.setup()
    render(<EditorPage bookId={book.id} chapterId={book.chapters[0].id} notify={vi.fn()} />)

    await screen.findByRole('textbox', { name: 'Chapter text' })
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(
      screen.getByRole('dialog', {
        name: `Move “${book.chapters[0].title}” to chapter trash?`
      })
    ).toBeVisible()
    expect(api.chapters.remove).not.toHaveBeenCalled()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(api.chapters.remove).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Move to chapter trash' }))
    await waitFor(() => expect(api.chapters.remove).toHaveBeenCalledWith(book.chapters[0].id))
  })

  it('keeps editing available in split view and supports replace, focus mode, and versions', async () => {
    const api = installApi()
    vi.mocked(api.chapters.listRevisions).mockResolvedValue(
      ok([
        {
          id: 'revision-1',
          chapterId: chapter.id,
          revisionNumber: 1,
          title: chapter.title,
          wordCount: 7,
          reason: 'Before edit',
          createdAt: chapter.updatedAt
        }
      ])
    )
    vi.mocked(api.chapters.getRevision).mockResolvedValue(
      ok({
        id: 'revision-1',
        chapterId: chapter.id,
        revisionNumber: 1,
        title: chapter.title,
        content: 'An earlier lantern passage.',
        wordCount: 4,
        reason: 'Before edit',
        createdAt: chapter.updatedAt
      })
    )
    const user = userEvent.setup()
    const { container } = render(
      <EditorPage bookId={book.id} chapterId={chapter.id} notify={vi.fn()} />
    )

    const editor = await screen.findByRole('textbox', { name: 'Chapter text' })
    await user.click(screen.getByRole('button', { name: 'Split' }))
    expect(editor).toBeVisible()
    expect(container.querySelector('.markdown-preview')).toHaveTextContent('lantern burned through')
    expect(screen.getByRole('button', { name: 'Resize editor and preview panes' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Find in chapter' }))
    await user.type(screen.getByPlaceholderText('Find in this chapter…'), 'lantern')
    await user.click(screen.getByRole('button', { name: 'Replace' }))
    await user.type(screen.getByPlaceholderText('Replace with…'), 'beacon')
    await user.click(screen.getByRole('button', { name: 'All' }))
    expect((editor as HTMLTextAreaElement).value).toContain('beacon')

    await user.click(screen.getByRole('button', { name: 'Enter focus mode' }))
    expect(container.querySelector('.editor')).toHaveClass('editor--focus')
    expect(screen.getByRole('button', { name: 'Exit focus mode' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Chapter versions' }))
    await user.click(await screen.findByRole('button', { name: /Version 1/ }))
    expect(await screen.findByText('An earlier lantern passage.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Restore selected version' }))
    await waitFor(() =>
      expect(api.chapters.restoreRevision).toHaveBeenCalledWith({
        chapterId: chapter.id,
        revisionId: 'revision-1'
      })
    )
  })

  it('recovers matching rich-text paragraphs when a chapter is pasted', async () => {
    installApi()
    render(<EditorPage bookId={book.id} chapterId={chapter.id} notify={vi.fn()} />)

    const editor = await screen.findByRole('textbox', { name: 'Chapter text' })
    fireEvent.change(editor, { target: { value: '' } })
    fireEvent.paste(editor, {
      clipboardData: {
        getData: (type: string) =>
          type === 'text/plain'
            ? 'The room went still.\n“Speak,” Mara said.'
            : type === 'text/html'
              ? '<p>The room went still.</p><p>“Speak,” Mara said.</p>'
              : ''
      }
    })

    expect(editor).toHaveValue('The room went still.\n\n“Speak,” Mara said.')
  })

  it('blocks close when both the chapter save and recovery draft fail', async () => {
    const api = installApi()
    vi.mocked(api.chapters.update).mockResolvedValue({ ok: false, error: 'Chapter disk full.' })
    vi.mocked(api.recovery.save).mockResolvedValue({ ok: false, error: 'Draft disk full.' })
    render(<EditorPage bookId={book.id} chapterId={chapter.id} notify={vi.fn()} />)

    const editor = await screen.findByRole('textbox', { name: 'Chapter text' })
    fireEvent.change(editor, { target: { value: 'Precious unsaved words.' } })
    const tasks: Promise<boolean>[] = []
    let results: boolean[] = []
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent<PrepareCloseDetail>('storybound:prepare-close', { detail: { tasks } })
      )
      results = await Promise.all(tasks)
    })

    expect(results).toEqual([false])
    expect(api.chapters.update).toHaveBeenCalledTimes(1)
    expect(api.recovery.save).toHaveBeenCalledTimes(2)
    expect(screen.getByText(/Recovery draft also failed/)).toBeVisible()
  })

  it('waits for and persists edits made during an in-flight save before navigating', async () => {
    const api = installApi()
    const secondChapter = { ...chapter, id: 'chapter-2', title: 'Chapter 2', position: 1 }
    vi.mocked(api.books.get).mockResolvedValue(
      ok({ ...book, chapterCount: 2, chapters: [chapter, secondChapter] })
    )
    let resolveFirst!: (value: ApiResult<Chapter>) => void
    const firstUpdate = new Promise<ApiResult<Chapter>>((resolve) => {
      resolveFirst = resolve
    })
    vi.mocked(api.chapters.update)
      .mockReturnValueOnce(firstUpdate)
      .mockImplementation(async (input) => ok({ ...chapter, ...input }))
    window.location.hash = `#/edit/${book.id}/${chapter.id}`
    render(<EditorPage bookId={book.id} chapterId={chapter.id} notify={vi.fn()} />)

    const editor = await screen.findByRole('textbox', { name: 'Chapter text' })
    fireEvent.change(editor, { target: { value: 'Draft A' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.chapters.update).toHaveBeenCalledTimes(1))
    fireEvent.change(editor, { target: { value: 'Draft B is newer' } })
    fireEvent.click(screen.getByRole('button', { name: 'Book details' }))

    await act(async () => resolveFirst(ok({ ...chapter, content: 'Draft A' })))
    await waitFor(() =>
      expect(api.chapters.update).toHaveBeenLastCalledWith(
        expect.objectContaining({ content: 'Draft B is newer' })
      )
    )
    await waitFor(() => expect(window.location.hash).toBe(`#/book/${book.id}`))
  })
})
