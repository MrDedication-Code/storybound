import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SharedBook } from '@storybound/contracts'
import { sharedEntityId, textSha256 } from '@storybound/sync/sharedIds'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileBookstore, type BookstoreAccount } from '../src/bookstore/mobileBookstore'
import { createSqlWriteCoordinator } from '../src/data/sqlite/databasePort'
import { migrateDatabase } from '../src/data/sqlite/migrations'
import { createSQLiteRepository } from '../src/data/sqlite/sqliteRepository'
import { SQLiteSyncStore } from '../src/data/sqlite/sqliteSyncStore'
import type { BookstoreOrigin, MobileRepository } from '../src/domain/contracts'
import type { AccountAccess } from '../src/sync/types'
import { NodeSqliteDatabase } from './helpers/nodeSqliteDatabase'

const EXPECTED_BOOK_ID = 'df06dd2d-78a8-55e1-be0d-22b97dba2f69'
const LISTING = '11111111-1111-4111-8111-111111111111'
const SOURCE_BOOK = '22222222-2222-4222-8222-222222222222'
const ONE = '33333333-3333-4333-8333-333333333333'
const TWO = '44444444-4444-4444-8444-444444444444'

function book(chapters: Array<[string, string, string]>, title = 'The Salt Road'): SharedBook {
  return {
    format: 'storybound-shared-book',
    formatVersion: 1,
    book: {
      sourceId: SOURCE_BOOK,
      title,
      subtitle: '',
      seriesName: '',
      seriesPosition: null,
      authorName: 'A. Writer',
      blurb: 'A ledger and a missing cent.',
      status: 'ongoing',
      languageCode: 'en',
      coverStyle: 'moonlit',
      coverPositionX: 50,
      coverPositionY: 50,
      createdAt: '2026-11-01T09:00:00.000Z',
      baseHash: null
    },
    cover: null,
    chapters: chapters.map(([sourceId, chapterTitle, content]) => ({
      sourceId,
      title: chapterTitle,
      content,
      baseHash: null
    })),
    bible: null
  }
}

const origin = (version: number): BookstoreOrigin => ({
  listingId: LISTING,
  version,
  authorName: 'A. Writer'
})

describe('Bookstore books on the phone', () => {
  let directory = ''
  let database: NodeSqliteDatabase
  let repository: MobileRepository
  let syncStore: SQLiteSyncStore

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'storybound-mobile-store-'))
    database = new NodeSqliteDatabase(join(directory, 'library.db'))
    await migrateDatabase(database)
    const writes = createSqlWriteCoordinator()
    repository = createSQLiteRepository(database, () => new Date(), writes)
    syncStore = new SQLiteSyncStore(database, writes)
  })

  afterEach(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('makes the same ids a computer makes, so one book stays one book', async () => {
    // Worked out by the desktop's original code, which used Node's own SHA-256.
    expect(sharedEntityId(LISTING, SOURCE_BOOK)).toBe(EXPECTED_BOOK_ID)
    const received = await repository.receiveBookstoreBook(
      origin(1),
      book([[ONE, 'One', 'First words.']])
    )
    expect(received.bookId).toBe(EXPECTED_BOOK_ID)
  })

  it('adds a locked book that the reader cannot change', async () => {
    const { bookId } = await repository.receiveBookstoreBook(
      origin(1),
      book([
        [ONE, 'One', 'First words here.'],
        [TWO, 'Two', 'Second words.']
      ])
    )
    const detail = await repository.getBook(bookId)
    expect(detail).toMatchObject({
      title: 'The Salt Road',
      shareMode: 'read-only',
      shareSenderName: 'A. Writer',
      coverTone: expect.any(String)
    })
    expect(detail.chapters.map((chapter) => chapter.title)).toEqual(['One', 'Two'])
    await expect(
      repository.updateChapter({ id: detail.chapters[0].id, title: 'Mine', content: 'Changed.' })
    ).rejects.toThrow('read-only')
    expect(await repository.findBookstoreBook(LISTING)).toBe(bookId)
    expect(await repository.listBookstoreBooks()).toEqual([
      {
        bookId,
        listingId: LISTING,
        title: 'The Salt Road',
        authorName: 'A. Writer',
        version: 1,
        deleted: false
      }
    ])
  })

  it('applies an update, keeps the old text in Revisions, and moves a removed chapter to Trash', async () => {
    const { bookId } = await repository.receiveBookstoreBook(
      origin(1),
      book([
        [ONE, 'One', 'First words.'],
        [TWO, 'Two', 'Second words.']
      ])
    )
    const before = await repository.getBook(bookId)
    await repository.saveReadingState({
      bookId,
      chapterId: before.chapters[0].id,
      scrollPosition: 0.4,
      progressPercentage: 20
    })

    await repository.receiveBookstoreBook(
      origin(2),
      book([[ONE, 'One', 'Better first words.']], 'The Salt Road, revised')
    )

    const after = await repository.getBook(bookId)
    expect(after.title).toBe('The Salt Road, revised')
    expect(after.chapters).toHaveLength(1)
    expect((await repository.getChapter(after.chapters[0].id)).content).toBe('Better first words.')
    const revisions = await repository.listChapterRevisions(after.chapters[0].id)
    expect(revisions[0]).toMatchObject({ reason: 'Before update from A. Writer' })
    expect((await repository.listTrashedChapters(bookId)).map((item) => item.title)).toEqual([
      'Two'
    ])
    expect((await repository.getReadingState(bookId)).scrollPosition).toBe(0.4)
  })

  it('reorders chapters without tripping over their positions', async () => {
    const { bookId } = await repository.receiveBookstoreBook(
      origin(1),
      book([
        [ONE, 'One', 'First.'],
        [TWO, 'Two', 'Second.']
      ])
    )
    await repository.receiveBookstoreBook(
      origin(2),
      book([
        [TWO, 'Two', 'Second.'],
        [ONE, 'One', 'First.']
      ])
    )
    const after = await repository.getBook(bookId)
    expect(after.chapters.map((chapter) => chapter.title)).toEqual(['Two', 'One'])
  })

  it('ignores an older version, and brings back a book added again from Trash', async () => {
    const { bookId } = await repository.receiveBookstoreBook(
      origin(2),
      book([[ONE, 'One', 'New.']])
    )
    const stale = await repository.receiveBookstoreBook(origin(1), book([[ONE, 'One', 'Old.']]))
    expect(stale.stale).toBe(true)
    const detail = await repository.getBook(bookId)
    expect((await repository.getChapter(detail.chapters[0].id)).content).toBe('New.')

    await repository.trashBook(bookId)
    expect(await repository.findBookstoreBook(LISTING)).toBeNull()
    await repository.receiveBookstoreBook(origin(2), book([[ONE, 'One', 'New.']]))
    expect(await repository.findBookstoreBook(LISTING)).toBe(bookId)
  })

  it('sends a computer every share detail, so the book stays locked there', async () => {
    const { bookId } = await repository.receiveBookstoreBook(
      origin(3),
      book([[ONE, 'One', 'Words.']])
    )
    const pending = await syncStore.claimPendingChanges(() => globalThis.crypto.randomUUID())
    const record = pending.find((item) => item.entityType === 'book' && item.entityId === bookId)
    expect(record?.value).toMatchObject({
      share_id: LISTING,
      share_mode: 'read-only',
      share_sender_name: 'A. Writer',
      share_sender_address: `bookstore:${LISTING}`,
      share_sequence: 3
    })
  })

  it('never clears the details of a book that reached the phone before it kept them all', async () => {
    const created = await repository.createBook({
      title: 'From an older version',
      subtitle: '',
      authorName: '',
      blurb: '',
      status: 'ongoing',
      seriesName: '',
      seriesPosition: null,
      libraryId: null
    })
    await database.runAsync("UPDATE books SET share_mode = 'read-only' WHERE id = ?", [created.id])
    const pending = await syncStore.claimPendingChanges(() => globalThis.crypto.randomUUID())
    const record = pending.find((item) => item.entityId === created.id)
    expect(record?.value).not.toHaveProperty('share_mode')
    expect(record?.value).not.toHaveProperty('share_id')
  })

  describe('with the server', () => {
    const file = JSON.stringify(book([[ONE, 'One', 'Words from the file.']]))

    function fakeAccount(rpc: (name: string) => unknown): {
      access: AccountAccess
      account: BookstoreAccount & { syncNow: ReturnType<typeof vi.fn> }
    } {
      const access = {
        client: {
          rpc: vi.fn(async (name: string) => ({ data: rpc(name), error: null })),
          storage: {
            from: () => ({
              createSignedUrl: async () => ({
                data: { signedUrl: 'https://example.test/book' },
                error: null
              })
            })
          }
        },
        userId: 'reader',
        email: null
      } as unknown as AccountAccess
      return {
        access,
        account: {
          accountAccess: async () => access,
          isConfigured: () => true,
          syncNow: vi.fn(async () => ({}) as never)
        }
      }
    }

    const profile = {
      joined: true,
      penName: null,
      suspended: false,
      suspensionReason: null,
      isAdmin: false,
      termsVersion: 1
    }
    const added = {
      listingId: LISTING,
      version: 1,
      authorName: 'A. Writer',
      filePath: 'author/book.json',
      sha256: textSha256(file)
    }

    it('adds a book that arrives whole, and refuses a damaged one', async () => {
      const { account } = fakeAccount(() => added)
      const store = new MobileBookstore(repository, account, async () => file)
      const bookId = await store.addBook(LISTING)
      expect((await repository.getBook(bookId)).shareMode).toBe('read-only')

      const damaged = new MobileBookstore(repository, account, async () => `${file} `)
      await expect(damaged.addBook(LISTING)).rejects.toThrow('arrived damaged')
    })

    it('updates a copy and takes back a removed one', async () => {
      const { bookId } = await repository.receiveBookstoreBook(
        origin(1),
        book([[ONE, 'One', 'Old words.']])
      )
      let check: unknown = [{ ...added, status: 'live', version: 2, removalReason: null }]
      const { account } = fakeAccount((name) =>
        name === 'check_storybound_books' ? check : profile
      )
      const store = new MobileBookstore(repository, account, async () => file)

      expect((await store.checkBooks()).updated).toEqual([{ bookId, title: 'The Salt Road' }])
      const chapterId = (await repository.getBook(bookId)).chapters[0].id
      expect((await repository.getChapter(chapterId)).content).toBe('Words from the file.')
      expect(account.syncNow).toHaveBeenCalled()

      check = [{ ...added, status: 'removed', version: 2, removalReason: 'It was copied.' }]
      expect((await store.checkBooks()).removed).toEqual([
        { bookId, title: 'The Salt Road', reason: 'It was copied.' }
      ])
      expect(await repository.findBookstoreBook(LISTING)).toBeNull()
    })

    it('a suspended reader hears about removals, but fetches no updates', async () => {
      await repository.receiveBookstoreBook(origin(1), book([[ONE, 'One', 'Old words.']]))
      const { account } = fakeAccount((name) =>
        name === 'check_storybound_books'
          ? [{ ...added, status: 'live', version: 2, removalReason: null }]
          : { ...profile, suspended: true, suspensionReason: 'Repeated copying.' }
      )
      const fetchText = vi.fn(async () => file)
      const store = new MobileBookstore(repository, account, fetchText)
      expect(await store.checkBooks()).toEqual({ updated: [], removed: [] })
      expect(fetchText).not.toHaveBeenCalled()
    })

    it('says nothing when signed out, and asks nothing of a build with no server', async () => {
      await repository.receiveBookstoreBook(origin(1), book([[ONE, 'One', 'Words.']]))
      const signedOut = new MobileBookstore(repository, {
        accountAccess: async () => null,
        isConfigured: () => true,
        syncNow: async () => ({}) as never
      })
      expect(await signedOut.checkBooks()).toEqual({ updated: [], removed: [] })
      expect(await signedOut.status()).toEqual({ phase: 'signed-out' })
      const noServer = new MobileBookstore(repository, {
        accountAccess: async () => null,
        isConfigured: () => false,
        syncNow: async () => ({}) as never
      })
      expect(await noServer.status()).toEqual({ phase: 'unavailable' })
    })
  })
})
