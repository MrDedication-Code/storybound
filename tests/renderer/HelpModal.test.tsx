// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { HelpModal } from '../../src/renderer/src/components/HelpModal'
import { WRITING_GUIDE } from '../../src/shared/writingGuide'

void React

describe('HelpModal', () => {
  it('summarizes the primary workflow and can begin book creation', async () => {
    const onClose = vi.fn()
    const onCreateBook = vi.fn()
    const user = userEvent.setup()
    render(<HelpModal onClose={onClose} onCreateBook={onCreateBook} />)

    expect(screen.getByRole('heading', { name: 'Getting started' })).toBeVisible()
    expect(screen.getByText('Search library')).toBeVisible()
    expect(screen.getByText('Ctrl/⌘ K')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Create a book' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(onCreateBook).toHaveBeenCalledOnce()
  })

  it('copies the Claude prompt through the app', async () => {
    const copy = vi.fn().mockResolvedValue({ ok: true, data: { message: 'Copied the prompt.' } })
    vi.stubGlobal('api', { agentBridge: { copy } })
    const user = userEvent.setup()
    render(<HelpModal onClose={vi.fn()} onCreateBook={vi.fn()} />)

    await user.click(screen.getByRole('tab', { name: 'Write with Claude' }))
    await user.click(screen.getByRole('button', { name: 'Copy the prompt' }))

    expect(copy).toHaveBeenCalledWith('writing-guide')
    expect(await screen.findByText('Copied the prompt.')).toBeVisible()
    vi.unstubAllGlobals()
  })

  it('walks through sync and the Google voice step by step', async () => {
    const user = userEvent.setup()
    render(<HelpModal onClose={vi.fn()} onCreateBook={vi.fn()} />)

    await user.click(screen.getByRole('tab', { name: 'Sync' }))
    expect(screen.getByText('Create new encrypted vault')).toBeVisible()
    expect(screen.getAllByText('Link to my computer').length).toBeGreaterThan(0)

    await user.click(screen.getByRole('tab', { name: 'Listening' }))
    expect(screen.getByRole('link', { name: 'aistudio.google.com/apikey' })).toBeVisible()
    expect(screen.getByText('Set up billing')).toBeVisible()
  })
})

describe('the writing guide', () => {
  it('covers the interview, the bible and performance notes', () => {
    for (const topic of [
      'Author-like style',
      'BIBLE.md',
      'LOCKED DECISIONS',
      'get_annotations',
      '[[hushed, urgent]]',
      'Never use double square brackets for anything else'
    ]) {
      expect(WRITING_GUIDE).toContain(topic)
    }
  })
})
