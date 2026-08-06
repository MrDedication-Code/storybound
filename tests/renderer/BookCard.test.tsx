// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { BookCard } from '../../src/renderer/src/components/BookCard'
import { book } from './mockApi'

void React

describe('BookCard', () => {
  it('shows a text status and accessible primary actions', () => {
    render(
      <BookCard
        book={{ ...book, status: 'completed' }}
        onEdit={vi.fn()}
        onOpen={vi.fn()}
        onRead={vi.fn()}
      />
    )

    expect(screen.getByText('Completed')).toBeVisible()
    expect(screen.getByRole('button', { name: `Open ${book.title} details` })).toBeVisible()
    expect(screen.getByRole('button', { name: `Read ${book.title}` })).toBeVisible()
    expect(screen.getByRole('progressbar', { name: '25% read' })).toHaveAttribute(
      'aria-valuenow',
      '25'
    )
  })

  it('uses the saved focal point for a custom cover', () => {
    const { container } = render(
      <BookCard
        book={{
          ...book,
          coverImageUrl: 'storybound-media://covers/cover.webp',
          coverPositionX: 18,
          coverPositionY: 82
        }}
        onEdit={vi.fn()}
        onOpen={vi.fn()}
        onRead={vi.fn()}
      />
    )

    expect(container.querySelector('.book-cover img')).toHaveStyle({ objectPosition: '18% 82%' })
  })
})
