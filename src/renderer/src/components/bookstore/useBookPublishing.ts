import { useCallback, useEffect, useState } from 'react'
import type { BookstoreStatus, MyListing } from '@shared/bookstore'
import { readableError, storyboundApi, unwrap } from '../../lib/api'

export interface BookPublishingState {
  status: BookstoreStatus | null
  listing: MyListing | null
  /** Signed in and through the Bookstore's rules, so able to publish. */
  member: boolean
  open: boolean
  error: string
  setOpen: (open: boolean) => void
  published: (listings: MyListing[]) => void
  withdraw: (listing: MyListing) => Promise<string | null>
  refresh: () => Promise<void>
}

/** How a book stands in the Bookstore, shared by the top of its page and its Bookstore section. */
export function useBookPublishing(bookId: string, enabled: boolean): BookPublishingState {
  const [status, setStatus] = useState<BookstoreStatus | null>(null)
  const [listings, setListings] = useState<MyListing[]>([])
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async (): Promise<void> => {
    const current = await storyboundApi().bookstore.status()
    if (!current.ok) return
    setStatus(current.data)
    if (current.data.phase === 'signed-in' && current.data.joined) {
      const mine = await storyboundApi().bookstore.myListings()
      if (mine.ok) setListings(mine.data)
    }
  }, [])

  useEffect(() => {
    if (enabled) void Promise.resolve().then(refresh)
  }, [enabled, refresh])

  const withdraw = async (listing: MyListing): Promise<string | null> => {
    setError('')
    try {
      setListings(unwrap(await storyboundApi().bookstore.withdraw(listing.id)))
      return 'Withdrawn. People who already have it keep their copy.'
    } catch (caught) {
      setError(readableError(caught))
      return null
    }
  }

  return {
    status,
    listing: listings.find((item) => item.sourceBookId === bookId) ?? null,
    member: status?.phase === 'signed-in' && status.joined,
    open,
    error,
    setOpen,
    published: (next) => {
      setListings(next)
      setOpen(false)
      void refresh()
    },
    withdraw,
    refresh
  }
}
