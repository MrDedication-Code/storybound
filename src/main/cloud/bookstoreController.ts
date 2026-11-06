import { createHash, randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import {
  addedBookSchema,
  BOOKSTORE_ADDRESS_PREFIX,
  bookstoreServerMessage,
  browseStoreSchema,
  checkedBooksSchema,
  myListingSchema,
  reviewItemSchema,
  storeListingSchema,
  storePageSchema,
  storeProfileSchema,
  storeReportSchema,
  type AddedBook,
  type BookstoreCheckResult,
  type BookstoreStatus,
  type BrowseStoreInput,
  type CloseReportInput,
  type MyListing,
  type PublishBookInput,
  type ReadForReviewInput,
  type RemoveListingInput,
  type ReportListingInput,
  type ReviewBook,
  type ReviewDecisionInput,
  type ReviewItem,
  type StoreListing,
  type StorePage,
  type StoreReport
} from '../../shared/bookstore'
import {
  sharedBookSchema,
  type ParcelPreview,
  type ParcelResult,
  type SharedBook
} from '../../shared/sharing'
import { countWords } from '../../shared/text'
import { StoryboundError } from '../errors'
import { sharedEntityId, type StoryboundStore } from '../store'
import { coverThumbnail, encodeCoverForSync } from './coverEncoder'
import type { StoryboundSyncController } from './syncController'

const BUCKET = 'bookstore-books'
/** The bucket's limit. */
const MAX_FILE_BYTES = 30 * 1024 * 1024

export interface BookstoreAccess {
  client: SupabaseClient
  userId: string
  email: string | null
}

interface OpenedBook {
  added: AddedBook
  book: SharedBook
}

export interface BookstoreDependencies {
  encodeCover: typeof encodeCoverForSync
  thumbnail: (cover: { mimeType: string; data: Buffer }) => string
}

/** Turns what the server says into words a person can act on. */
function networkError(message: string, error: { message?: string } | null): StoryboundError {
  const known = bookstoreServerMessage(error?.message ?? '')
  return new StoryboundError(known ? 'CONFLICT' : 'NETWORK_ERROR', known ?? message, error)
}

/** Publishes books to the Bookstore, finds them, and brings them into the library. */
export class StoryboundBookstoreController {
  private readonly opened = new Map<string, OpenedBook>()
  private readonly reviews = new Map<string, ReviewItem>()

  constructor(
    private readonly store: StoryboundStore,
    private readonly sync: Pick<
      StoryboundSyncController,
      'accountAccess' | 'isConfigured' | 'syncNow'
    >,
    private readonly dependencies: BookstoreDependencies = {
      encodeCover: encodeCoverForSync,
      thumbnail: coverThumbnail
    }
  ) {}

  async status(): Promise<BookstoreStatus> {
    if (!this.sync.isConfigured()) return { phase: 'unavailable' }
    const access = await this.sync.accountAccess()
    if (!access) return { phase: 'signed-out' }
    const profile = storeProfileSchema.parse(
      await this.call(
        access,
        'get_storybound_store_profile',
        {},
        'The Bookstore could not be reached.'
      )
    )
    return { phase: 'signed-in', email: access.email, ...profile }
  }

  async join(termsVersion: number): Promise<BookstoreStatus> {
    const access = await this.requireAccess()
    await this.call(
      access,
      'join_storybound_store',
      { p_terms_version: termsVersion },
      'Your answer could not be saved.'
    )
    return this.status()
  }

  async setPenName(penName: string): Promise<BookstoreStatus> {
    const access = await this.requireAccess()
    await this.call(
      access,
      'set_storybound_pen_name',
      { p_pen_name: penName },
      'The pen name could not be saved.'
    )
    return this.status()
  }

  async browse(input: BrowseStoreInput): Promise<StorePage> {
    const access = await this.requireAccess()
    const parsed = browseStoreSchema.parse(input)
    return storePageSchema.parse(
      await this.call(
        access,
        'browse_storybound_store',
        {
          p_query: parsed.query,
          p_genre: parsed.genre,
          p_sort: parsed.sort,
          p_page: parsed.page
        },
        'The Bookstore could not be reached.'
      )
    )
  }

  async listing(listingId: string): Promise<StoreListing> {
    const access = await this.requireAccess()
    const listing = storeListingSchema.parse(
      await this.call(
        access,
        'get_storybound_listing',
        { p_listing_id: listingId },
        'That book could not be opened.'
      )
    )
    return { ...listing, libraryBookId: this.store.findBookstoreBook(listingId) }
  }

  /** Fetches a book, ready to unwrap. Asking for it is what counts as adding it. */
  async openBook(listingId: string): Promise<ParcelPreview> {
    const access = await this.requireAccess()
    const added = addedBookSchema.parse(
      await this.call(
        access,
        'add_storybound_book',
        { p_listing_id: listingId },
        'That book could not be added.'
      )
    )
    const book = await this.download(access, added.filePath, added.sha256)
    this.opened.set(listingId, { added, book })
    const coverDataUrl = book.cover ? `data:${book.cover.mimeType};base64,${book.cover.data}` : null
    return {
      id: listingId,
      kind: 'book',
      senderName: added.authorName,
      senderAddress: `${BOOKSTORE_ADDRESS_PREFIX}${listingId}`,
      title: book.book.title,
      authorName: book.book.authorName,
      mode: 'read-only',
      chapterCount: book.chapters.length,
      newChapterCount: 0,
      sentAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
      bookId: sharedEntityId(listingId, book.book.sourceId),
      subtitle: book.book.subtitle,
      seriesName: book.book.seriesName,
      seriesPosition: book.book.seriesPosition,
      blurb: book.book.blurb,
      coverStyle: book.book.coverStyle,
      coverDataUrl,
      coverPositionX: book.book.coverPositionX,
      coverPositionY: book.book.coverPositionY,
      wordCount: book.chapters.reduce((sum, chapter) => sum + countWords(chapter.content), 0),
      hasBible: false
    }
  }

  collectBook(listingId: string): ParcelResult {
    const opened = this.opened.get(listingId)
    if (!opened) throw new StoryboundError('NOT_FOUND', 'Open the book first.')
    const result = this.apply(listingId, opened.added, opened.book)
    this.opened.delete(listingId)
    void this.sync.syncNow().catch(() => undefined)
    return result
  }

  async publish(input: PublishBookInput): Promise<MyListing[]> {
    const access = await this.requireAccess()
    const prepared = this.store.prepareBookstoreBook(input.bookId, this.dependencies.encodeCover)
    const status = await this.status()
    if (status.phase !== 'signed-in' || !status.penName) {
      throw new StoryboundError('VALIDATION_ERROR', 'Choose a pen name first.')
    }
    const body: SharedBook = {
      ...prepared.body,
      // The name on a published book is always the pen name, never what the app has on file.
      book: { ...prepared.body.book, authorName: status.penName, blurb: input.blurb }
    }
    const file = Buffer.from(JSON.stringify(body), 'utf8')
    if (file.byteLength > MAX_FILE_BYTES) {
      throw new StoryboundError(
        'VALIDATION_ERROR',
        'This book is too large to publish. Try a smaller cover image.'
      )
    }
    const path = `${access.userId}/${randomUUID()}.json`
    const uploaded = await access.client.storage.from(BUCKET).upload(path, file, {
      contentType: 'application/json',
      upsert: false
    })
    if (uploaded.error) throw networkError('The book could not be uploaded.', uploaded.error)
    await this.call(
      access,
      'submit_storybound_version',
      {
        p_listing_id: randomUUID(),
        p_source_book_id: input.bookId,
        p_title: body.book.title,
        p_subtitle: body.book.subtitle,
        p_blurb: input.blurb,
        p_genre: input.genre,
        p_content_warnings: input.contentWarnings,
        p_ai_use: input.aiUse,
        p_language_code: body.book.languageCode || 'en',
        p_chapter_count: body.chapters.length,
        p_word_count: body.chapters.reduce((sum, chapter) => sum + countWords(chapter.content), 0),
        p_cover_style: body.book.coverStyle,
        p_cover_thumb: body.cover
          ? this.dependencies.thumbnail({
              mimeType: body.cover.mimeType,
              data: Buffer.from(body.cover.data, 'base64')
            })
          : null,
        p_file_path: path,
        p_file_sha256: createHash('sha256').update(file).digest('hex'),
        p_file_bytes: file.byteLength
      },
      'The book could not be submitted.'
    )
    return this.myListings()
  }

  async myListings(): Promise<MyListing[]> {
    const access = await this.requireAccess()
    return z
      .array(myListingSchema)
      .parse(
        await this.call(
          access,
          'list_my_storybound_listings',
          {},
          'Your published books could not be loaded.'
        )
      )
  }

  async withdraw(listingId: string): Promise<MyListing[]> {
    const access = await this.requireAccess()
    await this.call(
      access,
      'withdraw_storybound_listing',
      { p_listing_id: listingId },
      'The book could not be withdrawn.'
    )
    return this.myListings()
  }

  async report(input: ReportListingInput): Promise<void> {
    const access = await this.requireAccess()
    await this.call(
      access,
      'report_storybound_listing',
      {
        p_report_id: randomUUID(),
        p_listing_id: input.listingId,
        p_reason: input.reason,
        p_detail: input.detail
      },
      'The report could not be sent.'
    )
  }

  /** Brings the reader's copies up to date, and takes back any removed for breaking the rules. */
  async checkBooks(): Promise<BookstoreCheckResult> {
    const result: BookstoreCheckResult = { updated: [], removed: [] }
    if (!this.store.listBookstoreBooks().length) return result
    const access = await this.sync.accountAccess()
    if (!access) return result
    // Another device may already have fetched an update, and two copies of one would conflict.
    await this.sync.syncNow().catch(() => undefined)
    const books = this.store.listBookstoreBooks()
    const profile = storeProfileSchema.parse(
      await this.call(
        access,
        'get_storybound_store_profile',
        {},
        'The Bookstore could not be reached.'
      )
    )
    if (!profile.joined) return result
    const checked = checkedBooksSchema.parse(
      await this.call(
        access,
        'check_storybound_books',
        { p_listing_ids: books.map((book) => book.listingId) },
        'The Bookstore could not be reached.'
      )
    )
    for (const item of checked) {
      const book = books.find((candidate) => candidate.listingId === item.listingId)
      if (!book) continue
      if (item.status === 'removed') {
        if (book.deleted) continue
        this.store.trashBook(book.bookId)
        result.removed.push({
          bookId: book.bookId,
          title: book.title,
          reason: item.removalReason ?? ''
        })
      } else if (
        item.status === 'live' &&
        !book.deleted &&
        item.version !== null &&
        item.version > book.version &&
        item.filePath &&
        item.sha256
      ) {
        const shared = await this.download(access, item.filePath, item.sha256)
        const applied = this.apply(
          item.listingId,
          {
            listingId: item.listingId,
            version: item.version,
            authorName: item.authorName ?? book.authorName,
            filePath: item.filePath,
            sha256: item.sha256
          },
          shared
        )
        result.updated.push({ bookId: applied.bookId, title: applied.title })
      }
    }
    if (result.updated.length || result.removed.length) {
      void this.sync.syncNow().catch(() => undefined)
    }
    return result
  }

  async reviewQueue(): Promise<ReviewItem[]> {
    const access = await this.requireAccess()
    const queue = z
      .array(reviewItemSchema)
      .parse(
        await this.call(
          access,
          'list_storybound_review_queue',
          {},
          'The review queue could not be loaded.'
        )
      )
    this.reviews.clear()
    for (const item of queue) this.reviews.set(`${item.id}:${item.version}`, item)
    return queue
  }

  async readForReview(input: ReadForReviewInput): Promise<ReviewBook> {
    const access = await this.requireAccess()
    const item = this.reviews.get(`${input.listingId}:${input.version}`)
    if (!item) throw new StoryboundError('NOT_FOUND', 'That version is not waiting.')
    const book = await this.download(access, item.filePath, item.sha256)
    return {
      title: book.book.title,
      authorName: book.book.authorName,
      titleMismatch: book.book.title !== item.title,
      chapters: book.chapters.map((chapter) => ({ title: chapter.title, content: chapter.content }))
    }
  }

  async decide(input: ReviewDecisionInput): Promise<ReviewItem[]> {
    const access = await this.requireAccess()
    await this.call(
      access,
      'review_storybound_version',
      {
        p_listing_id: input.listingId,
        p_version: input.version,
        p_approve: input.approve,
        p_reason: input.reason
      },
      'The decision could not be saved.'
    )
    return this.reviewQueue()
  }

  async remove(input: RemoveListingInput): Promise<void> {
    const access = await this.requireAccess()
    await this.call(
      access,
      'remove_storybound_listing',
      { p_listing_id: input.listingId, p_reason: input.reason },
      'The book could not be removed.'
    )
  }

  async reports(): Promise<StoreReport[]> {
    const access = await this.requireAccess()
    return z
      .array(storeReportSchema)
      .parse(await this.call(access, 'list_storybound_reports', {}, 'Reports could not be loaded.'))
  }

  async closeReport(input: CloseReportInput): Promise<StoreReport[]> {
    const access = await this.requireAccess()
    await this.call(
      access,
      'close_storybound_report',
      { p_report_id: input.reportId, p_outcome: input.outcome },
      'The report could not be closed.'
    )
    return this.reports()
  }

  private apply(listingId: string, added: AddedBook, book: SharedBook): ParcelResult {
    const result = this.store.receiveSharedBook(
      {
        shareId: listingId,
        sequence: added.version,
        mode: 'read-only',
        senderName: added.authorName,
        senderAddress: `${BOOKSTORE_ADDRESS_PREFIX}${listingId}`
      },
      book
    )
    // Adding a book again after putting it in the Trash brings it back.
    if (result.stale) this.store.restoreBook(result.bookId)
    return result
  }

  private async download(
    access: BookstoreAccess,
    path: string,
    expectedHash: string
  ): Promise<SharedBook> {
    const { data, error } = await access.client.storage.from(BUCKET).download(path)
    if (error || !data) throw networkError('The book could not be downloaded.', error)
    const file = Buffer.from(await data.arrayBuffer())
    if (createHash('sha256').update(file).digest('hex') !== expectedHash) {
      throw new StoryboundError('SECURITY_ERROR', 'That book arrived damaged. Please try again.')
    }
    return sharedBookSchema.parse(JSON.parse(file.toString('utf8')))
  }

  private async call(
    access: BookstoreAccess,
    name: string,
    args: Record<string, unknown>,
    failure: string
  ): Promise<unknown> {
    const { data, error } = await access.client.rpc(name, args)
    if (error) throw networkError(failure, error)
    return data
  }

  private async requireAccess(): Promise<BookstoreAccess> {
    const access = await this.sync.accountAccess()
    if (!access) throw new StoryboundError('SECURITY_ERROR', 'Sign in to use the Bookstore.')
    return access
  }
}
