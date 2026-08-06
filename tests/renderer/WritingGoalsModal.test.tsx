// @vitest-environment jsdom

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { WritingGoalsModal } from '../../src/renderer/src/components/WritingGoalsModal'
import { book, installApi, writingGoal } from './mockApi'

void React

describe('WritingGoalsModal', () => {
  it('shows a 30-day summary, accessible daily changes, and active goal progress', async () => {
    const api = installApi()
    vi.mocked(api.writing.stats).mockImplementation(async (query) => ({
      ok: true,
      data: {
        from: query.from,
        to: query.to,
        totalWordsAdded: 820,
        totalWordsRemoved: 120,
        netWords: 700,
        days: [
          {
            date: '2026-08-04',
            wordsAdded: 320,
            wordsRemoved: 120,
            netWords: 200,
            wordCountAfter: 1_200
          },
          {
            date: '2026-08-05',
            wordsAdded: 500,
            wordsRemoved: 0,
            netWords: 500,
            wordCountAfter: 1_700
          }
        ],
        books: [],
        activeGoals: [
          {
            goal: writingGoal,
            periodStart: query.from,
            periodEnd: query.to,
            achievedValue: 250,
            remainingValue: 250,
            progressPercentage: 50
          }
        ]
      }
    }))

    render(<WritingGoalsModal book={book} notify={vi.fn()} onClose={vi.fn()} />)

    expect(await screen.findByRole('heading', { name: 'Last 30 days' })).toBeVisible()
    expect(screen.getByText('+820')).toBeVisible()
    expect(screen.getByText('700')).toBeVisible()
    const chart = screen.getByRole('figure', {
      name: 'Daily net word change for the last 30 days'
    })
    expect(within(chart).getByText(/Aug 5: 500 words added net/i)).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: /daily goal progress/i })).toHaveAttribute(
      'aria-valuenow',
      '50'
    )
    expect(api.writing.stats).toHaveBeenCalledWith(
      expect.objectContaining({ from: expect.any(String), to: expect.any(String) })
    )
  })

  it('creates a whole-library project goal with the selected metric and dates', async () => {
    const api = installApi()
    const notify = vi.fn()
    const user = userEvent.setup()
    render(<WritingGoalsModal book={book} notify={notify} onClose={vi.fn()} />)
    await screen.findByRole('heading', { name: 'Create a goal' })

    await user.click(screen.getByRole('button', { name: /whole library/i }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Measure' }), 'chapters')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Cadence' }), 'project')
    await user.clear(screen.getByRole('spinbutton', { name: 'Target' }))
    await user.type(screen.getByRole('spinbutton', { name: 'Target' }), '12')
    await user.clear(screen.getByLabelText('Start date'))
    await user.type(screen.getByLabelText('Start date'), '2026-08-05')
    await user.type(screen.getByLabelText(/End date/), '2026-12-31')
    await user.click(screen.getByRole('button', { name: 'Create goal' }))

    await waitFor(() =>
      expect(api.writing.goals.create).toHaveBeenCalledWith(
        expect.objectContaining({
          libraryId: book.libraryId,
          bookId: null,
          metric: 'chapters',
          period: 'project',
          targetValue: 12,
          startOn: '2026-08-05',
          endOn: '2026-12-31',
          isActive: true
        })
      )
    )
    expect(notify).toHaveBeenCalledWith('Project writing goal created.')
  })

  it('uses row versions when pausing and deleting a goal', async () => {
    const api = installApi()
    const user = userEvent.setup()
    render(<WritingGoalsModal book={book} notify={vi.fn()} onClose={vi.fn()} />)
    await screen.findByText('500 words · daily')

    await user.click(screen.getByRole('button', { name: 'Pause' }))
    await waitFor(() =>
      expect(api.writing.goals.update).toHaveBeenCalledWith({
        id: writingGoal.id,
        expectedRowVersion: writingGoal.rowVersion,
        isActive: false
      })
    )

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const confirmation = screen.getByRole('dialog', { name: 'Delete this writing goal?' })
    await user.click(within(confirmation).getByRole('button', { name: 'Delete goal' }))
    await waitFor(() =>
      expect(api.writing.goals.remove).toHaveBeenCalledWith({
        id: writingGoal.id,
        expectedRowVersion: writingGoal.rowVersion
      })
    )
  })

  it('offers a retry when loading fails and explains an empty goal history', async () => {
    const api = installApi()
    vi.mocked(api.writing.goals.list).mockResolvedValueOnce({
      ok: false,
      error: 'Writing goals are temporarily unavailable.'
    })
    const user = userEvent.setup()
    render(<WritingGoalsModal book={book} notify={vi.fn()} onClose={vi.fn()} />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Writing goals are temporarily unavailable.'
    )
    vi.mocked(api.writing.goals.list).mockResolvedValue({ ok: true, data: [] })
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('No goals yet')).toBeVisible()
  })
})
