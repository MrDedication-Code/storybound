import type { ShareMode, SharedBook } from '@storybound/contracts'

export { sharedBookSchema } from '@storybound/contracts'
export type { ShareMode, SharedBook } from '@storybound/contracts'

/** Who a book came from, for a book that arrived as a parcel. */
export interface BookShareOrigin {
  shareId: string
  senderName: string
  senderAddress: string
  mode: ShareMode
}

export interface SharingStatus {
  /** False until sync is on and unlocked on this device. */
  available: boolean
  address: string | null
  senderName: string
}

export interface ShareContact {
  address: string
  name: string
}

/** One person a book has been sent to, and how far behind they are. */
export interface BookShare {
  id: string
  bookId: string
  contact: ShareContact
  mode: ShareMode
  includeBible: boolean
  sequence: number
  lastSentAt: string
  newChapters: number
  changedChapters: number
  removedChapters: number
  detailsChanged: boolean
}

export interface ShareBookInput {
  bookId: string
  address: string
  name: string
  senderName: string
  mode: ShareMode
  includeBible: boolean
}

export interface UpdateShareInput {
  shareId: string
  mode?: ShareMode
  includeBible?: boolean
}

/** A parcel waiting to be opened. */
export interface ParcelSummary {
  id: string
  kind: 'book' | 'update'
  senderName: string
  senderAddress: string
  mode: ShareMode
  title: string
  authorName: string
  chapterCount: number
  newChapterCount: number
  sentAt: string
  expiresAt: string
}

/** Everything the unwrapping needs to show the book before it is collected. */
export interface ParcelPreview extends ParcelSummary {
  /** The id this book has, or will have, in this library. */
  bookId: string
  subtitle: string
  seriesName: string
  seriesPosition: number | null
  blurb: string
  coverStyle: SharedBook['book']['coverStyle']
  coverDataUrl: string | null
  coverPositionX: number
  coverPositionY: number
  wordCount: number
  hasBible: boolean
}

export interface ParcelResult {
  bookId: string
  title: string
  added: number
  revised: number
  keptYours: number
  removed: number
  stale: boolean
}
