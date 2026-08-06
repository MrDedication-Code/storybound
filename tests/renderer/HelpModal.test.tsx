// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { HelpModal } from '../../src/renderer/src/components/HelpModal'

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
})
