// @vitest-environment jsdom

import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ReaderPage } from '../../src/renderer/src/pages/ReaderPage'
import type { PrepareCloseDetail } from '../../src/renderer/src/lib/events'
import { book, chapter, installApi, settings } from './mockApi'

void React

describe('ReaderPage', () => {
  it('shows the requested restart position instead of stale completed progress', async () => {
    const api = installApi()
    vi.mocked(api.reading.get).mockResolvedValue({
      ok: true,
      data: {
        bookId: book.id,
        chapterId: chapter.id,
        scrollPosition: 1,
        progressPercentage: 100,
        lastReadAt: null,
        hasFinishedCurrentContent: true
      }
    })
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)

    render(
      <ReaderPage
        bookId={book.id}
        chapterId={chapter.id}
        initialLocation={0}
        notify={vi.fn()}
        settings={settings}
        updateSettings={vi.fn(async () => undefined)}
      />
    )

    expect(
      await screen.findByRole('progressbar', { name: 'Book reading progress' })
    ).toHaveAttribute('aria-valuenow', '0')
    requestFrame.mockRestore()
  })

  it('opens reading controls and persists a font-size change through the supplied updater', async () => {
    const api = installApi()
    const updateSettings = vi.fn(async () => undefined)
    const user = userEvent.setup()
    render(
      <ReaderPage
        bookId={book.id}
        chapterId={book.chapters[0].id}
        notify={vi.fn()}
        settings={settings}
        updateSettings={updateSettings}
      />
    )

    await screen.findByRole('heading', { name: book.chapters[0].title })
    await waitFor(() =>
      expect(api.reading.save).toHaveBeenCalledWith(
        expect.objectContaining({
          chapterId: book.chapters[0].id,
          progressPercentage: 100,
          hasFinishedCurrentContent: true
        })
      )
    )
    const bookmarksToggle = screen.getByRole('button', { name: 'Bookmarks' })
    await user.click(bookmarksToggle)
    const bookmarkPanel = screen.getByRole('complementary', { name: 'Bookmarks' })
    expect(bookmarkPanel).toHaveFocus()
    const addBookmark = within(bookmarkPanel).getByRole('button', {
      name: 'Add bookmark here'
    })
    await user.click(addBookmark)
    const note = screen.getByRole('textbox', { name: /note/i })
    await user.type(note, 'Return to this quiet line.')
    expect(note).toHaveValue('Return to this quiet line.')
    expect(note).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(bookmarkPanel).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Reading settings' }))
    await user.click(screen.getByRole('button', { name: 'Increase reader font size' }))

    expect(updateSettings).toHaveBeenCalledWith({ readerFontSize: settings.readerFontSize + 1 })
    expect(screen.getByTestId('reader-scroll')).toBeVisible()
    expect(screen.getByRole('progressbar', { name: 'Book reading progress' })).toHaveAttribute(
      'aria-valuenow'
    )
  })

  it('exposes a non-modal reader panel with disclosure focus and APG keyboard tabs', async () => {
    const api = installApi()
    vi.mocked(api.books.get).mockResolvedValue({
      ok: true,
      data: {
        ...book,
        chapterCount: 2,
        chapters: [chapter, { ...chapter, id: 'chapter-2', position: 1, title: 'Chapter 2' }]
      }
    })
    const user = userEvent.setup()
    render(
      <ReaderPage
        bookId={book.id}
        chapterId={chapter.id}
        notify={vi.fn()}
        settings={settings}
        updateSettings={vi.fn(async () => undefined)}
      />
    )

    await screen.findByRole('heading', { name: chapter.title })
    const reader = screen.getByRole('main')
    const readingSurface = screen.getByTestId('reader-scroll')
    const bookmarksToggle = screen.getByRole('button', { name: 'Bookmarks' })
    const contentsToggle = screen.getByRole('button', { name: 'Table of contents' })
    const annotationsToggle = screen.getByRole('button', { name: 'Highlights and notes' })
    const settingsToggle = screen.getByRole('button', { name: 'Reading settings' })

    expect(bookmarksToggle).toHaveAttribute('aria-expanded', 'false')
    expect(contentsToggle).toHaveAttribute('aria-expanded', 'false')
    expect(annotationsToggle).toHaveAttribute('aria-expanded', 'false')
    expect(settingsToggle).toHaveAttribute('aria-expanded', 'false')

    await user.click(bookmarksToggle)

    const panel = screen.getByRole('complementary', { name: 'Bookmarks' })
    expect(panel).toHaveFocus()
    expect(bookmarksToggle).toHaveAttribute('aria-controls', panel.id)
    expect(bookmarksToggle).toHaveAttribute('aria-expanded', 'true')
    expect(contentsToggle).toHaveAttribute('aria-controls', panel.id)
    expect(annotationsToggle).toHaveAttribute('aria-controls', panel.id)
    expect(settingsToggle).toHaveAttribute('aria-controls', panel.id)
    expect(reader).toContainElement(readingSurface)
    expect(readingSurface).not.toHaveAttribute('aria-hidden')
    expect(readingSurface).not.toHaveAttribute('inert')

    const contentsTab = screen.getByRole('tab', { name: 'Contents' })
    const bookmarksTab = screen.getByRole('tab', { name: 'Bookmarks' })
    const notesTab = screen.getByRole('tab', { name: 'Notes' })
    const appearanceTab = screen.getByRole('tab', { name: 'Appearance' })
    expect(bookmarksTab).toHaveAttribute('aria-selected', 'true')
    expect(bookmarksTab).toHaveAttribute('tabindex', '0')
    expect(contentsTab).toHaveAttribute('tabindex', '-1')
    expect(notesTab).toHaveAttribute('tabindex', '-1')
    expect(appearanceTab).toHaveAttribute('tabindex', '-1')

    let tabpanel = screen.getByRole('tabpanel', { name: 'Bookmarks' })
    expect(bookmarksTab).toHaveAttribute('aria-controls', tabpanel.id)
    await user.click(bookmarksTab)
    await user.keyboard('{ArrowRight}')
    expect(notesTab).toHaveFocus()
    expect(notesTab).toHaveAttribute('aria-selected', 'true')
    expect(annotationsToggle).toHaveAttribute('aria-expanded', 'true')

    await user.keyboard('{ArrowRight}')
    expect(appearanceTab).toHaveFocus()
    expect(appearanceTab).toHaveAttribute('aria-selected', 'true')
    expect(appearanceTab).toHaveAttribute('tabindex', '0')
    tabpanel = screen.getByRole('tabpanel', { name: 'Appearance' })
    expect(appearanceTab).toHaveAttribute('aria-controls', tabpanel.id)
    expect(settingsToggle).toHaveAttribute('aria-expanded', 'true')

    await user.keyboard('{ArrowRight}')
    expect(contentsTab).toHaveFocus()
    expect(contentsTab).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowLeft}')
    expect(appearanceTab).toHaveFocus()
    await user.keyboard('{Home}')
    expect(contentsTab).toHaveFocus()
    await user.keyboard('{End}')
    expect(appearanceTab).toHaveFocus()

    await user.click(within(panel).getByRole('button', { name: 'Close reader panel' }))
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    expect(bookmarksToggle).toHaveFocus()
    expect(bookmarksToggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('creates a reading note at the current position', async () => {
    const api = installApi()
    const notify = vi.fn()
    const user = userEvent.setup()
    render(
      <ReaderPage
        bookId={book.id}
        chapterId={chapter.id}
        notify={notify}
        settings={settings}
        updateSettings={vi.fn(async () => undefined)}
      />
    )

    await screen.findByRole('heading', { name: chapter.title })
    await user.click(screen.getByRole('button', { name: 'Highlights and notes' }))
    await user.click(screen.getByRole('button', { name: 'Add note here' }))
    const dialog = screen.getByRole('dialog', { name: 'Add reading note' })
    await user.type(within(dialog).getByRole('textbox', { name: /note/i }), 'Remember this turn.')
    await user.click(within(dialog).getByRole('button', { name: 'Save note' }))

    expect(api.annotations.create).toHaveBeenCalledWith(
      expect.objectContaining({
        bookId: book.id,
        chapterId: chapter.id,
        kind: 'note',
        body: 'Remember this turn.',
        anchor: expect.objectContaining({ fallbackLocation: expect.any(Number) })
      })
    )
    expect(notify).toHaveBeenCalledWith('Note saved.')
  })

  it('uses the local speech engine for read-aloud controls', async () => {
    installApi()
    const speak = vi.fn()
    const pause = vi.fn()
    const resume = vi.fn()
    const cancel = vi.fn()
    class Utterance {
      rate = 1
      onend: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor(readonly text: string) {}
    }
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { speak, pause, resume, cancel }
    })
    Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: Utterance
    })
    const user = userEvent.setup()
    const { unmount } = render(
      <ReaderPage
        bookId={book.id}
        chapterId={chapter.id}
        notify={vi.fn()}
        settings={settings}
        updateSettings={vi.fn(async () => undefined)}
      />
    )

    await screen.findByRole('heading', { name: chapter.title })
    await user.click(screen.getByRole('button', { name: 'Read aloud' }))
    await user.click(screen.getByRole('button', { name: 'Read chapter' }))
    expect(speak).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining(chapter.content) })
    )

    await user.click(screen.getByRole('button', { name: 'Pause' }))
    expect(pause).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Resume' }))
    expect(resume).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Stop reading aloud' }))
    expect(cancel).toHaveBeenCalled()
    unmount()
  })

  it('renders story links inert and blocks closing when reading progress cannot be saved', async () => {
    const api = installApi()
    vi.mocked(api.chapters.get).mockResolvedValue({
      ok: true,
      data: { ...chapter, content: 'Return to [Library](#/library).' }
    })
    render(
      <ReaderPage
        bookId={book.id}
        chapterId={chapter.id}
        notify={vi.fn()}
        settings={settings}
        updateSettings={vi.fn(async () => undefined)}
      />
    )

    const inertLink = await screen.findByTitle(
      'Links in story text are displayed without navigation.'
    )
    expect(screen.queryByRole('link', { name: 'Library' })).not.toBeInTheDocument()
    expect(inertLink).toHaveTextContent('Library')
    expect(inertLink).toHaveClass('story-link')
    await waitFor(() => expect(api.reading.save).toHaveBeenCalled())
    vi.mocked(api.reading.save).mockResolvedValue({ ok: false, error: 'Disk unavailable.' })

    const tasks: Promise<boolean>[] = []
    let results: boolean[] = []
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent<PrepareCloseDetail>('storybound:prepare-close', { detail: { tasks } })
      )
      results = await Promise.all(tasks)
    })

    expect(results).toEqual([false])
    expect(screen.getByText(/Reading position could not be saved/)).toBeVisible()
  })

  it('forwards a search term to the story and highlights its exact match', async () => {
    const api = installApi()
    vi.mocked(api.chapters.get).mockResolvedValue({
      ok: true,
      data: { ...chapter, content: 'The lantern burned beside the window.' }
    })
    const setHighlight = vi.fn()
    const deleteHighlight = vi.fn()
    Object.defineProperty(CSS, 'highlights', {
      configurable: true,
      value: { set: setHighlight, delete: deleteHighlight }
    })
    Object.defineProperty(window, 'Highlight', {
      configurable: true,
      value: class Highlight {}
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn()
    })
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })

    const { unmount } = render(
      <ReaderPage
        bookId={book.id}
        chapterId={chapter.id}
        notify={vi.fn()}
        searchTerm="lantern"
        settings={settings}
        updateSettings={vi.fn(async () => undefined)}
      />
    )

    await screen.findByText(/lantern burned/)
    await waitFor(() =>
      expect(setHighlight).toHaveBeenCalledWith('storybound-search-hit', expect.anything())
    )
    unmount()
    expect(deleteHighlight).toHaveBeenCalledWith('storybound-search-hit')
  })
})
