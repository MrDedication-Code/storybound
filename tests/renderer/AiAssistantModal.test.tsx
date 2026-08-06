// @vitest-environment jsdom

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AiAssistantModal } from '../../src/renderer/src/components/AiAssistantModal'
import { book, installApi } from './mockApi'

void React

describe('AiAssistantModal', () => {
  it('requires one-time consent, sends a privacy-bounded request, and applies only after review', async () => {
    const api = installApi()
    const onApply = vi.fn()
    const user = userEvent.setup()
    render(
      <AiAssistantModal
        book={book}
        chapterText="The  lantern waited."
        onApply={onApply}
        onClose={vi.fn()}
      />
    )

    const dialog = screen.getByRole('dialog', { name: 'AI writing assistant' })
    await user.type(within(dialog).getByLabelText('OpenAI API key'), 'test-secret-key')
    await user.click(within(dialog).getByRole('button', { name: 'Send one request' }))
    expect(within(dialog).getByText(/Confirm that you want/)).toBeVisible()
    expect(api.data.aiAssist).not.toHaveBeenCalled()

    await user.click(within(dialog).getByLabelText('Consent to send this text to OpenAI'))
    await user.click(within(dialog).getByRole('button', { name: 'Send one request' }))
    expect(api.data.aiAssist).toHaveBeenCalledWith({
      apiKey: 'test-secret-key',
      task: 'chapter-cleanup',
      text: 'The  lantern waited.',
      context: expect.stringContaining(book.title)
    })

    const suggestion = await within(dialog).findByLabelText('AI suggestion')
    expect(suggestion).toHaveValue('A polished suggestion.')
    await user.clear(suggestion)
    await user.type(suggestion, 'The lantern waited.')
    expect(suggestion).toHaveValue('The lantern waited.')
    const applyButton = within(dialog).getByRole('button', { name: 'Replace chapter text' })
    expect(applyButton).toBeEnabled()
    await user.click(applyButton)
    await waitFor(() =>
      expect(onApply).toHaveBeenCalledWith('chapter-cleanup', 'The lantern waited.')
    )
  })
})
