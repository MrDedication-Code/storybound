// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AddBookModal } from '../../src/renderer/src/components/AddBookModal'
import type { PrepareCloseDetail } from '../../src/renderer/src/lib/events'
import { installApi } from './mockApi'

void React

describe('AddBookModal', () => {
  it('validates the title and creates a book from the compact form', async () => {
    const api = installApi()
    const onCreated = vi.fn()
    const user = userEvent.setup()
    render(<AddBookModal onClose={vi.fn()} onCreated={onCreated} />)

    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!)
    expect(screen.getByText('Give your book a title before creating it.')).toBeVisible()
    expect(api.books.create).not.toHaveBeenCalled()

    await user.type(screen.getByRole('textbox', { name: /book title/i }), 'A Quiet Orbit')
    await user.type(
      screen.getByRole('textbox', { name: /blurb/i }),
      'A story between distant stars.'
    )
    await user.click(screen.getByRole('button', { name: 'Create book' }))

    await waitFor(() =>
      expect(api.books.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'A Quiet Orbit' })
      )
    )
    expect(onCreated).toHaveBeenCalledTimes(1)
  })

  it('commits a created book once when optional cover selection fails', async () => {
    const api = installApi()
    vi.mocked(api.books.chooseCover).mockResolvedValue({
      ok: false,
      error: 'The selected image is too large.'
    })
    const onCreated = vi.fn()
    const user = userEvent.setup()
    render(<AddBookModal onClose={vi.fn()} onCreated={onCreated} />)

    await user.type(screen.getByRole('textbox', { name: /book title/i }), 'A Covered Path')
    await user.click(screen.getByRole('checkbox', { name: /choose a cover/i }))
    await user.click(screen.getByRole('button', { name: 'Create book' }))

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1))
    expect(api.books.create).toHaveBeenCalledTimes(1)
    expect(onCreated).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'book-1' }),
      expect.stringContaining('book was created')
    )
  })

  it('blocks close preparation with visible guidance for a nonempty unsaved form', async () => {
    installApi()
    const user = userEvent.setup()
    render(<AddBookModal onClose={vi.fn()} onCreated={vi.fn()} />)
    await user.type(screen.getByRole('textbox', { name: /book title/i }), 'Not created yet')

    const tasks: Promise<boolean>[] = []
    let results: boolean[] = []
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent<PrepareCloseDetail>('storybound:prepare-close', { detail: { tasks } })
      )
      results = await Promise.all(tasks)
    })

    expect(results).toEqual([false])
    expect(
      screen.getByText('Finish creating this book or close this form before quitting Storybound.')
    ).toBeVisible()
  })

  it('keeps a dirty form intact when backdrop dismissal is cancelled', async () => {
    installApi()
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<AddBookModal onClose={onClose} onCreated={vi.fn()} />)

    const title = screen.getByRole('textbox', { name: /book title/i })
    await user.type(title, 'Still being drafted')
    const createDialog = screen.getByRole('dialog', { name: 'Create a new book' })
    fireEvent.mouseDown(createDialog)

    const confirmation = screen.getByRole('dialog', { name: 'Discard this new book?' })
    expect(onClose).not.toHaveBeenCalled()
    expect(
      within(confirmation).getByText(
        'The title, blurb, and chapter text entered here will be lost.'
      )
    ).toBeVisible()

    await user.click(within(confirmation).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'Discard this new book?' })).not.toBeInTheDocument()
    expect(title).toHaveValue('Still being drafted')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('requests confirmation before Escape discards a dirty form', async () => {
    installApi()
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<AddBookModal onClose={onClose} onCreated={vi.fn()} />)

    await user.type(screen.getByRole('textbox', { name: /chapter text/i }), 'An opening line.')
    await user.keyboard('{Escape}')

    const confirmation = screen.getByRole('dialog', { name: 'Discard this new book?' })
    expect(onClose).not.toHaveBeenCalled()
    await user.click(within(confirmation).getByRole('button', { name: 'Discard draft' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('requests confirmation before the Cancel button discards a dirty form', async () => {
    installApi()
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<AddBookModal onClose={onClose} onCreated={vi.fn()} />)

    await user.selectOptions(screen.getByRole('combobox', { name: /writing status/i }), 'completed')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByRole('dialog', { name: 'Discard this new book?' })).toBeVisible()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('requests confirmation before the close button discards a dirty form', async () => {
    installApi()
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<AddBookModal onClose={onClose} onCreated={vi.fn()} />)

    await user.click(screen.getByRole('checkbox', { name: /choose a cover/i }))
    const createDialog = screen.getByRole('dialog', { name: 'Create a new book' })
    await user.click(within(createDialog).getByRole('button', { name: 'Close dialog' }))

    expect(screen.getByRole('dialog', { name: 'Discard this new book?' })).toBeVisible()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes a clean form immediately without a discard prompt', async () => {
    installApi()
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<AddBookModal onClose={onClose} onCreated={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog', { name: 'Discard this new book?' })).not.toBeInTheDocument()
  })
})
