// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  DirectImportModal,
  type DirectImportSubmission
} from '../../src/renderer/src/components/DirectImportModal'

void React

const markdown = `# The Lantern Sea

## Chapter 1: Shore

The tide came in quietly.

## Chapter 2: Below

Mara followed the lanterns.`

describe('DirectImportModal', () => {
  it('detects Markdown live and submits only selected chapters with source metadata', async () => {
    const onConfirm = vi.fn<(submission: DirectImportSubmission) => void>()
    const user = userEvent.setup()
    render(<DirectImportModal onClose={vi.fn()} onConfirm={onConfirm} />)

    await user.type(screen.getByRole('textbox', { name: /story or conversation text/i }), markdown)

    expect(screen.getByRole('textbox', { name: /book title/i })).toHaveValue('The Lantern Sea')
    expect(screen.getByText('2 chapters detected')).toBeVisible()
    expect(screen.getByText('Detected as markdown.')).toBeVisible()

    await user.click(screen.getByRole('checkbox', { name: /chapter 2: below/i }))
    await user.clear(screen.getByRole('textbox', { name: /book title/i }))
    await user.type(screen.getByRole('textbox', { name: /book title/i }), 'Lanterns Below')
    await user.click(screen.getByRole('button', { name: 'Import 1 chapter' }))

    expect(onConfirm).toHaveBeenCalledWith({
      title: 'Lanterns Below',
      chapters: [{ title: 'Chapter 1: Shore', content: 'The tide came in quietly.' }],
      source: expect.objectContaining({
        format: 'markdown',
        originalCharacterCount: markdown.length,
        processedCharacterCount: markdown.length,
        sourceLineCount: 9,
        truncated: false,
        warnings: []
      })
    })
  })

  it('extracts assistant story text from a chat transcript and exposes parser warnings', async () => {
    const user = userEvent.setup()
    render(<DirectImportModal onClose={vi.fn()} onConfirm={vi.fn()} />)

    await user.selectOptions(screen.getByRole('combobox', { name: /source type/i }), 'chat')
    await user.type(
      screen.getByRole('textbox', { name: /story or conversation text/i }),
      'User: Write a scene.\nAssistant: Chapter 1\n\nRain silvered the road.'
    )

    expect(screen.getByText('Chapter 1')).toBeVisible()
    expect(screen.getByText('Rain silvered the road.')).toBeVisible()
    expect(screen.getByRole('status', { name: 'Import warnings' })).toHaveTextContent(
      'user-authored conversation block was excluded'
    )
  })

  it('preserves a plain-text source in the submitted chapter', async () => {
    const onConfirm = vi.fn<(submission: DirectImportSubmission) => void>()
    const user = userEvent.setup()
    render(<DirectImportModal onClose={vi.fn()} onConfirm={onConfirm} />)

    const plainText = 'A Small Story\n\nFirst line.\nSecond line.'
    await user.selectOptions(screen.getByRole('combobox', { name: /source type/i }), 'txt')
    fireEvent.change(screen.getByRole('textbox', { name: /story or conversation text/i }), {
      target: { value: plainText }
    })
    await user.click(screen.getByRole('button', { name: 'Import 1 chapter' }))

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'A Small Story',
        chapters: [{ title: 'Chapter 1', content: plainText }],
        source: expect.objectContaining({ format: 'txt' })
      })
    )
  })

  it('supports clearing and reselecting all detected chapters', async () => {
    const user = userEvent.setup()
    render(<DirectImportModal initialContent={markdown} onClose={vi.fn()} onConfirm={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(screen.getByRole('button', { name: /import 0 chapters/i })).toBeDisabled()
    expect(screen.getAllByRole('checkbox')).toSatisfy((items: HTMLElement[]) =>
      items.every((item) => !(item as HTMLInputElement).checked)
    )

    await user.click(screen.getByRole('button', { name: 'Select all' }))
    expect(screen.getByRole('button', { name: 'Import 2 chapters' })).toBeEnabled()
  })

  it('uses the shared modal focus trap and confirms before discarding pasted text', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<DirectImportModal onClose={onClose} onConfirm={vi.fn()} />)

    const source = screen.getByRole('textbox', { name: /story or conversation text/i })
    expect(screen.getByRole('combobox', { name: /source type/i })).toHaveFocus()
    await user.type(source, 'A title\n\nSome text.')
    await user.keyboard('{Escape}')

    const confirmation = screen.getByRole('dialog', { name: 'Discard this import?' })
    expect(onClose).not.toHaveBeenCalled()
    await user.click(within(confirmation).getByRole('button', { name: 'Discard import' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
