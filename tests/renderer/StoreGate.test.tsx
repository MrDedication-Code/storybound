// @vitest-environment jsdom
import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PublishPicker } from '../../src/renderer/src/components/bookstore/PublishPicker'
import { StoreGate } from '../../src/renderer/src/components/bookstore/StoreGate'
import { parseRoute, routes } from '../../src/renderer/src/lib/routing'
import { installApi } from './mockApi'

void React

const ok = <T,>(data: T): { ok: true; data: T } => ({ ok: true, data })
const member = {
  phase: 'signed-in' as const,
  email: 'reader@example.test',
  joined: true,
  penName: null,
  suspended: false,
  suspensionReason: null,
  isAdmin: false,
  termsVersion: 1
}

describe('the door to the Bookstore', () => {
  it('says so when this build has no server', async () => {
    installApi()
    render(<StoreGate>{() => 'Inside'}</StoreGate>)
    expect(await screen.findByText(/not available in this version/)).toBeInTheDocument()
  })

  it('asks a signed-out person to sign in, without mentioning sync setup', async () => {
    const api = installApi()
    vi.mocked(api.bookstore.status).mockResolvedValue(ok({ phase: 'signed-out' }))
    const user = userEvent.setup()
    render(<StoreGate>{() => 'Inside'}</StoreGate>)
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Create an account' }))
    expect(screen.getByText(/Sync is separate/)).toBeInTheDocument()
  })

  it('needs both promises before anyone comes in', async () => {
    const api = installApi()
    vi.mocked(api.bookstore.status).mockResolvedValue(ok({ ...member, joined: false }))
    vi.mocked(api.bookstore.join).mockResolvedValue(ok(member))
    const user = userEvent.setup()
    render(<StoreGate>{() => 'Inside'}</StoreGate>)
    const enter = await screen.findByRole('button', { name: 'Enter the Bookstore' })
    expect(enter).toBeDisabled()
    await user.click(screen.getByLabelText('I am 18 or over'))
    expect(enter).toBeDisabled()
    await user.click(screen.getByLabelText('I agree to the Bookstore rules'))
    await user.click(enter)
    expect(api.bookstore.join).toHaveBeenCalledWith(1)
    expect(await screen.findByText('Inside')).toBeInTheDocument()
  })

  it('keeps a suspended account out', async () => {
    const api = installApi()
    vi.mocked(api.bookstore.status).mockResolvedValue(
      ok({ ...member, suspended: true, suspensionReason: 'Repeated copying.' })
    )
    render(<StoreGate>{() => 'Inside'}</StoreGate>)
    expect(await screen.findByText(/can no longer use the Bookstore/)).toHaveTextContent(
      'Repeated copying.'
    )
    expect(screen.queryByText('Inside')).not.toBeInTheDocument()
  })

  it('has its own pages', () => {
    expect(parseRoute(`#${routes.bookstore()}`)).toEqual({ name: 'bookstore' })
    expect(parseRoute(`#${routes.bookstoreReview()}`)).toEqual({ name: 'bookstore-review' })
    expect(parseRoute(`#${routes.bookstoreBook('abc')}`)).toEqual({
      name: 'bookstore-book',
      listingId: 'abc'
    })
  })
})

describe('finding the way to publish', () => {
  const book = { id: 'b1', title: 'My Own Book', blurb: null, share: null }
  const received = { id: 'b2', title: 'From Someone', blurb: null, share: { mode: 'read-only' } }

  it('offers your own books and opens publishing for the one you choose', async () => {
    installApi({
      books: { list: vi.fn(async () => ok([book, received])) },
      bookstore: { myListings: vi.fn(async () => ok([])) }
    })
    render(<PublishPicker penName={null} onClose={vi.fn()} onPublished={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'My Own Book' }))
    expect(screen.queryByRole('button', { name: 'From Someone' })).not.toBeInTheDocument()
    expect(await screen.findByText('Publish “My Own Book”')).toBeInTheDocument()
  })

  it('leaves out a book the Bookstore removed', async () => {
    installApi({
      books: { list: vi.fn(async () => ok([book])) },
      bookstore: {
        myListings: vi.fn(async () => ok([{ sourceBookId: 'b1', status: 'removed' }]))
      }
    })
    render(<PublishPicker penName={null} onClose={vi.fn()} onPublished={vi.fn()} />)
    expect(await screen.findByText(/no books of your own/)).toBeInTheDocument()
  })
})
