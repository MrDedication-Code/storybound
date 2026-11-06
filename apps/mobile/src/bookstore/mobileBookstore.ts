import {
  addedBookSchema,
  bookstoreServerMessage,
  browseStoreSchema,
  checkedBooksSchema,
  sharedBookSchema,
  storeListingSchema,
  storePageSchema,
  storeProfileSchema,
  type BookstoreCheckResult,
  type BookstoreStatus,
  type BrowseStoreInput,
  type ReportListingInput,
  type SharedBook,
  type StoreListing,
  type StorePage
} from '@storybound/contracts'
import { textSha256 } from '@storybound/sync/sharedIds'
import type { MobileRepository } from '../domain/contracts'
import type { AccountAccess, MobileSyncController } from '../sync/types'

const BUCKET = 'bookstore-books'
/** A signed link only has to last while the book downloads. */
const LINK_SECONDS = 120

export type BookstoreAccount = Pick<
  MobileSyncController,
  'accountAccess' | 'isConfigured' | 'syncNow'
>

/** Finds Bookstore books and brings them into the phone's library. Publishing is on a computer. */
export class MobileBookstore {
  constructor(
    private readonly repository: MobileRepository,
    private readonly account: BookstoreAccount,
    private readonly fetchText: (url: string) => Promise<string> = async (url) => {
      const response = await fetch(url)
      if (!response.ok) throw new Error('The book could not be downloaded.')
      return response.text()
    }
  ) {}

  async status(): Promise<BookstoreStatus> {
    if (!this.account.isConfigured()) return { phase: 'unavailable' }
    const access = await this.account.accountAccess()
    if (!access) return { phase: 'signed-out' }
    const profile = storeProfileSchema.parse(
      await this.call(access, 'get_storybound_store_profile', {}, 'The Bookstore is out of reach.')
    )
    return { phase: 'signed-in', email: access.email, ...profile }
  }

  async join(termsVersion: number): Promise<BookstoreStatus> {
    await this.call(
      await this.requireAccess(),
      'join_storybound_store',
      { p_terms_version: termsVersion },
      'Your answer could not be saved.'
    )
    return this.status()
  }

  async browse(input: BrowseStoreInput): Promise<StorePage> {
    const parsed = browseStoreSchema.parse(input)
    return storePageSchema.parse(
      await this.call(
        await this.requireAccess(),
        'browse_storybound_store',
        {
          p_query: parsed.query,
          p_genre: parsed.genre,
          p_sort: parsed.sort,
          p_page: parsed.page
        },
        'The Bookstore is out of reach.'
      )
    )
  }

  async listing(listingId: string): Promise<StoreListing> {
    const listing = storeListingSchema.parse(
      await this.call(
        await this.requireAccess(),
        'get_storybound_listing',
        { p_listing_id: listingId },
        'That book could not be opened.'
      )
    )
    return { ...listing, libraryBookId: await this.repository.findBookstoreBook(listingId) }
  }

  /** Fetches the book and puts it in the library, returning its id there. */
  async addBook(listingId: string): Promise<string> {
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
    const received = await this.repository.receiveBookstoreBook(
      { listingId, version: added.version, authorName: added.authorName },
      book
    )
    void this.account.syncNow().catch(() => undefined)
    return received.bookId
  }

  async report(input: ReportListingInput): Promise<void> {
    await this.call(
      await this.requireAccess(),
      'report_storybound_listing',
      {
        p_report_id: globalThis.crypto.randomUUID(),
        p_listing_id: input.listingId,
        p_reason: input.reason,
        p_detail: input.detail
      },
      'The report could not be sent.'
    )
  }

  /** Brings copies up to date, and takes back any removed for breaking the rules. */
  async checkBooks(): Promise<BookstoreCheckResult> {
    const result: BookstoreCheckResult = { updated: [], removed: [] }
    if (!(await this.repository.listBookstoreBooks()).length) return result
    const access = await this.account.accountAccess()
    if (!access) return result
    // Another device may already have fetched an update, and two copies of one would conflict.
    await this.account.syncNow().catch(() => undefined)
    const profile = storeProfileSchema.parse(
      await this.call(access, 'get_storybound_store_profile', {}, 'The Bookstore is out of reach.')
    )
    if (!profile.joined) return result
    const books = await this.repository.listBookstoreBooks()
    const checked = checkedBooksSchema.parse(
      await this.call(
        access,
        'check_storybound_books',
        { p_listing_ids: books.map((book) => book.listingId) },
        'The Bookstore is out of reach.'
      )
    )
    for (const item of checked) {
      const book = books.find((candidate) => candidate.listingId === item.listingId)
      if (!book || book.deleted) continue
      if (item.status === 'removed') {
        await this.repository.trashBook(book.bookId)
        result.removed.push({
          bookId: book.bookId,
          title: book.title,
          reason: item.removalReason ?? ''
        })
      } else if (
        item.status === 'live' &&
        item.version !== null &&
        item.version > book.version &&
        item.filePath &&
        item.sha256
      ) {
        const shared = await this.download(access, item.filePath, item.sha256)
        const received = await this.repository.receiveBookstoreBook(
          {
            listingId: item.listingId,
            version: item.version,
            authorName: item.authorName ?? book.authorName
          },
          shared
        )
        result.updated.push({ bookId: received.bookId, title: received.title })
      }
    }
    if (result.updated.length || result.removed.length) {
      void this.account.syncNow().catch(() => undefined)
    }
    return result
  }

  private async download(
    access: AccountAccess,
    path: string,
    expectedHash: string
  ): Promise<SharedBook> {
    const { data, error } = await access.client.storage
      .from(BUCKET)
      .createSignedUrl(path, LINK_SECONDS)
    if (error || !data) throw new Error('The book could not be downloaded.')
    const text = await this.fetchText(data.signedUrl)
    if (textSha256(text) !== expectedHash) {
      throw new Error('That book arrived damaged. Please try again.')
    }
    return sharedBookSchema.parse(JSON.parse(text))
  }

  private async call(
    access: AccountAccess,
    name: string,
    args: Record<string, unknown>,
    failure: string
  ): Promise<unknown> {
    const { data, error } = await access.client.rpc(name, args)
    if (error) throw new Error(bookstoreServerMessage(error.message) ?? failure)
    return data
  }

  private async requireAccess(): Promise<AccountAccess> {
    const access = await this.account.accountAccess()
    if (!access) throw new Error('Sign in to use the Bookstore.')
    return access
  }
}
