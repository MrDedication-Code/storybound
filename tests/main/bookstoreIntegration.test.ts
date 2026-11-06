import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, describe, expect, it } from 'vitest'
import {
  StoryboundBookstoreController,
  type BookstoreAccess
} from '../../src/main/cloud/bookstoreController'
import { StoryboundStore } from '../../src/main/store'
import type { PublishBookInput } from '../../src/shared/bookstore'

/**
 * Real accounts and real libraries against a local Supabase. Run with
 * STORYBOUND_TEST_SUPABASE_URL, STORYBOUND_TEST_SUPABASE_KEY and STORYBOUND_TEST_DB_CONTAINER set;
 * it is skipped otherwise. No sync vault is set up: the Bookstore only needs an account.
 */
const url = process.env.STORYBOUND_TEST_SUPABASE_URL
const key = process.env.STORYBOUND_TEST_SUPABASE_KEY
const container = process.env.STORYBOUND_TEST_DB_CONTAINER

interface Person {
  client: SupabaseClient
  userId: string
  store: StoryboundStore
  bookstore: StoryboundBookstoreController
}

const cleanups: Array<() => void> = []

async function person(name: string): Promise<Person> {
  const client = createClient(url!, key!, { auth: { persistSession: false } })
  const signedUp = await client.auth.signUp({
    email: `${name}-${randomUUID()}@example.test`,
    password: `Storybound-${randomUUID()}!`
  })
  if (signedUp.error || !signedUp.data.session) throw signedUp.error ?? new Error('No session')
  const userId = signedUp.data.session.user.id
  const directory = mkdtempSync(join(tmpdir(), `storybound-store-${name}-`))
  const store = await StoryboundStore.open(directory)
  cleanups.push(() => {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  })
  const access: BookstoreAccess = { client, userId, email: null }
  const bookstore = new StoryboundBookstoreController(
    store,
    {
      accountAccess: async () => access,
      isConfigured: () => true,
      syncNow: async () => ({}) as never
    },
    {
      encodeCover: () => {
        throw new Error('No cover in this test')
      },
      thumbnail: () => ''
    }
  )
  await bookstore.join(1)
  return { client, userId, store, bookstore }
}

/** Admins are only ever added directly on the database. */
function makeAdmin(userId: string): void {
  execFileSync('docker', [
    'exec',
    container!,
    'psql',
    '-U',
    'postgres',
    '-c',
    `insert into public.storybound_admins (owner_id) values ('${userId}')`
  ])
}

afterAll(() => {
  for (const cleanup of cleanups) cleanup()
})

describe.skipIf(!url || !key || !container)('the Bookstore, end to end', () => {
  it('publishes, reviews, adds, updates, withdraws and removes a book', async () => {
    const admin = await person('admin')
    const author = await person('author')
    const reader = await person('reader')
    makeAdmin(admin.userId)

    const book = author.store.createBook({
      title: 'The Salt Road',
      initialChapterTitle: 'Chapter 1',
      initialChapterContent: 'The ledger stayed closed on the table.'
    })
    const details: PublishBookInput = {
      bookId: book.id,
      blurb: 'A ledger, a salt road, and a missing cent.',
      genre: 'fantasy',
      contentWarnings: ['violence'],
      aiUse: 'assisted',
      rightsConfirmed: true
    }

    await expect(author.bookstore.publish(details)).rejects.toThrow('Choose a pen name first')
    await author.bookstore.setPenName(`A. Writer ${randomUUID().slice(0, 8)}`)
    const [submitted] = await author.bookstore.publish(details)
    expect(submitted).toMatchObject({ status: 'pending', latestStatus: 'pending' })

    // Nobody but the author and the reviewer can reach it yet.
    expect((await reader.bookstore.browse({ query: 'Salt Road' })).items).toHaveLength(0)
    await expect(reader.bookstore.openBook(submitted.id)).rejects.toThrow('not in the Bookstore')
    await expect(reader.bookstore.reviewQueue()).rejects.toThrow('Not allowed')

    const queue = await admin.bookstore.reviewQueue()
    const waiting = queue.find((item) => item.id === submitted.id)!
    const text = await admin.bookstore.readForReview({ listingId: waiting.id, version: 1 })
    expect(text.chapters[0].content).toContain('The ledger stayed closed')
    expect(text.titleMismatch).toBe(false)
    await admin.bookstore.decide({
      listingId: waiting.id,
      version: 1,
      approve: true,
      reason: ''
    })

    // The reader finds it, adds it, and it arrives locked under the pen name.
    const found = (await reader.bookstore.browse({ query: 'Salt Road' })).items
    expect(found.map((item) => item.id)).toContain(submitted.id)
    const preview = await reader.bookstore.openBook(submitted.id)
    expect(preview.authorName).toContain('A. Writer')
    const added = reader.bookstore.collectBook(submitted.id)
    const copy = reader.store.getBook(added.bookId)
    expect(copy.share?.mode).toBe('read-only')
    expect(copy.authorName).toContain('A. Writer')
    expect(() =>
      reader.store.updateChapter({
        id: copy.chapters[0].id,
        title: 'Mine now',
        content: 'Changed.'
      })
    ).toThrow()

    // An update waits for review, then reaches the reader by itself.
    author.store.createChapter({
      bookId: book.id,
      title: 'Chapter 2',
      content: 'A second chapter.'
    })
    await author.bookstore.publish(details)
    expect((await reader.bookstore.checkBooks()).updated).toHaveLength(0)
    await admin.bookstore.reviewQueue()
    await admin.bookstore.decide({
      listingId: submitted.id,
      version: 2,
      approve: true,
      reason: ''
    })
    expect((await reader.bookstore.checkBooks()).updated).toHaveLength(1)
    expect(reader.store.getBook(added.bookId).chapters).toHaveLength(2)

    // A report reaches the reviewer, and removal takes the reader's copy to Trash.
    await reader.bookstore.report({ listingId: submitted.id, reason: 'copyright', detail: 'Mine.' })
    expect((await admin.bookstore.reports()).map((item) => item.listingId)).toContain(submitted.id)
    await admin.bookstore.remove({ listingId: submitted.id, reason: 'It was copied.' })
    expect((await reader.bookstore.checkBooks()).removed).toEqual([
      { bookId: added.bookId, title: 'The Salt Road', reason: 'It was copied.' }
    ])
    expect(reader.store.findBookstoreBook(submitted.id)).toBeNull()
    await expect(author.bookstore.publish(details)).rejects.toThrow('removed from the Bookstore')
  }, 60_000)

  it('suspends an author, removes their books, and lets the reviewer lift it', async () => {
    const admin = await person('reviewer')
    const author = await person('banned')
    const reader = await person('fan')
    makeAdmin(admin.userId)
    await author.bookstore.setPenName(`Banned ${randomUUID().slice(0, 8)}`)
    const book = author.store.createBook({
      title: 'Copied Book',
      initialChapterTitle: 'One',
      initialChapterContent: 'Words taken from elsewhere.'
    })
    const [listing] = await author.bookstore.publish({
      bookId: book.id,
      blurb: 'A book that should not be here at all.',
      genre: 'other',
      contentWarnings: [],
      aiUse: 'none',
      rightsConfirmed: true
    })
    await admin.bookstore.reviewQueue()
    await admin.bookstore.decide({ listingId: listing.id, version: 1, approve: true, reason: '' })
    await reader.bookstore.openBook(listing.id)
    const { bookId } = reader.bookstore.collectBook(listing.id)

    await expect(
      reader.bookstore.suspend({ listingId: listing.id, reason: 'No.', removeBooks: true })
    ).rejects.toThrow('Not allowed')
    await admin.bookstore.suspend({
      listingId: listing.id,
      reason: 'Repeated copying.',
      removeBooks: true
    })

    expect(await author.bookstore.status()).toMatchObject({
      suspended: true,
      suspensionReason: 'Repeated copying.'
    })
    await expect(author.bookstore.browse({})).rejects.toThrow('can no longer use the Bookstore')
    expect(author.store.getBook(book.id).title).toBe('Copied Book')
    expect((await reader.bookstore.checkBooks()).removed).toEqual([
      { bookId, title: 'Copied Book', reason: 'Repeated copying.' }
    ])

    const [blocked] = await admin.bookstore.suspended()
    expect(blocked.reason).toBe('Repeated copying.')
    await admin.bookstore.unsuspend(blocked.ownerId)
    expect(await author.bookstore.status()).toMatchObject({ suspended: false })
    await expect(
      author.bookstore.publish({
        bookId: book.id,
        blurb: 'A book that should not be here at all.',
        genre: 'other',
        contentWarnings: [],
        aiUse: 'none',
        rightsConfirmed: true
      })
    ).rejects.toThrow('removed from the Bookstore')
  }, 60_000)

  it('refuses to publish a book that came from someone else', async () => {
    const reader = await person('copier')
    const book = reader.store.createBook({ title: 'Mine' })
    reader.store.receiveSharedBook(
      {
        shareId: randomUUID(),
        sequence: 1,
        mode: 'editable',
        senderName: 'Someone',
        senderAddress: 'K7QM2XPD9RTAHF4W'
      },
      reader.store.prepareSharedBook({
        bookId: book.id,
        shareId: null,
        includeBible: false,
        encodeCover: () => {
          throw new Error('No cover')
        }
      }).body
    )
    const received = reader.store.listBooks({}).find((item) => item.id !== book.id)
    expect(() =>
      reader.store.prepareBookstoreBook(received!.id, () => {
        throw new Error('No cover')
      })
    ).toThrow('Only books you wrote')
  })
})
