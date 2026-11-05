import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  StoryboundStore,
  type PreparedSharedBook,
  type ReceivedShareOrigin
} from '../../src/main/store'
import { applyLocalSyncEntity, listLocalSyncEntities } from '../../src/main/sync/entities'
import type { StoryEntity } from '../../src/shared/types'
import { sharedBookSchema, type SharedBook } from '../../src/shared/sharing'

const directories: string[] = []
const stores: StoryboundStore[] = []
const SHARE = '33333333-3333-4333-8333-333333333333'
const JACK = 'K7QM2XPD9RTAHF4W'

async function openStore(): Promise<StoryboundStore> {
  const directory = mkdtempSync(join(tmpdir(), 'storybound-shared-'))
  directories.push(directory)
  const store = await StoryboundStore.open(directory)
  stores.push(store)
  return store
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close()
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 3 })
  }
})

function origin(
  sequence: number,
  mode: 'read-only' | 'editable' = 'read-only'
): ReceivedShareOrigin {
  return { shareId: SHARE, sequence, mode, senderName: 'Jack', senderAddress: JACK }
}

function prepare(
  store: StoryboundStore,
  bookId: string,
  shareId: string | null = null
): PreparedSharedBook {
  return store.prepareSharedBook({
    bookId,
    shareId,
    includeBible: true,
    encodeCover: () => {
      throw new Error('No cover in these books')
    }
  })
}

async function authoredBook(): Promise<{ author: StoryboundStore; bookId: string; first: string }> {
  const author = await openStore()
  const book = author.createBook({
    title: 'Zero Balance',
    blurb: 'It lost the ability to prove who owned it.',
    initialChapterTitle: 'Chapter 1',
    initialChapterContent: 'One.'
  })
  author.updateBook({ id: book.id, authorName: 'Jack', personalNotes: 'Private to Jack' })
  return { author, bookId: book.id, first: book.chapters[0].id }
}

/** Sends the book as it stands, recording it the way the app does. */
function send(author: StoryboundStore, bookId: string, sequence: number): SharedBook {
  const shareId = sequence > 1 ? SHARE : null
  const prepared = prepare(author, bookId, shareId)
  author.saveShareContact({
    address: 'ADAMADAMADAMADAM',
    name: 'Adam',
    encryptionPublicKey: 'e',
    signingPublicKey: 's'
  })
  author.recordShareSent({
    shareId: SHARE,
    bookId,
    address: 'ADAMADAMADAMADAM',
    mode: 'read-only',
    includeBible: true,
    sequence,
    prepared
  })
  return sharedBookSchema.parse(JSON.parse(JSON.stringify(prepared.body)))
}

describe('sending a book', () => {
  it('leaves out everything personal', async () => {
    const { author, bookId, first } = await authoredBook()
    author.createBookmark({ bookId, chapterId: first, location: 0.5 })

    const text = JSON.stringify(prepare(author, bookId).body)

    expect(text).toContain('Zero Balance')
    expect(text).not.toContain('Private to Jack')
    expect(text).not.toContain('bookmark')
  })

  it('says what has changed since the last time', async () => {
    const { author, bookId, first } = await authoredBook()
    send(author, bookId, 1)
    expect(author.listBookShares(bookId)[0]).toMatchObject({
      newChapters: 0,
      changedChapters: 0,
      removedChapters: 0,
      detailsChanged: false
    })

    author.createChapter({ bookId, title: 'Chapter 2', content: 'Two.' })
    author.updateChapter({ id: first, content: 'One, revised.' })
    author.updateBook({ id: bookId, blurb: 'New blurb' })

    expect(author.listBookShares(bookId)[0]).toMatchObject({
      newChapters: 1,
      changedChapters: 1,
      detailsChanged: true
    })
  })
})

describe('receiving a read-only book', () => {
  it('adds the whole book, marked with who it came from', async () => {
    const { author, bookId } = await authoredBook()
    const reader = await openStore()

    const result = reader.receiveSharedBook(origin(1), send(author, bookId, 1))

    expect(result).toMatchObject({ added: 1, stale: false })
    const book = reader.getBook(result.bookId)
    expect(book).toMatchObject({ title: 'Zero Balance', authorName: 'Jack', personalNotes: '' })
    expect(book.share).toMatchObject({ senderName: 'Jack', mode: 'read-only' })
    expect(reader.getChapter(book.chapters[0].id).content).toBe('One.')
  })

  it('cannot be changed by any route, but still belongs to the reader', async () => {
    const { author, bookId } = await authoredBook()
    const reader = await openStore()
    const { bookId: id } = reader.receiveSharedBook(origin(1), send(author, bookId, 1))
    const chapterId = reader.getBook(id).chapters[0].id
    const locked = 'read-only'

    expect(() => reader.updateChapter({ id: chapterId, content: 'x' })).toThrow(locked)
    expect(() => reader.createChapter({ bookId: id, title: 'x', content: 'x' })).toThrow(locked)
    expect(() => reader.removeChapter(chapterId)).toThrow(locked)
    expect(() => reader.duplicateChapter(chapterId)).toThrow(locked)
    expect(() => reader.updateBook({ id, title: 'x' })).toThrow(locked)
    expect(() => reader.updateBook({ id, blurb: 'x' })).toThrow(locked)
    expect(() => reader.removeCover(id)).toThrow(locked)
    expect(() =>
      reader.createStoryEntity({
        bookId: id,
        entityType: 'character',
        title: 'x',
        summary: '',
        bodyMarkdown: '',
        details: {},
        detailsVersion: 1
      })
    ).toThrow(locked)
    await expect(reader.exportBookToPath(id, join(tmpdir(), 'nope.zip'))).rejects.toThrow(locked)
    expect(() =>
      reader.prepareSharedBook({
        bookId: id,
        shareId: null,
        includeBible: false,
        encodeCover: () => {
          throw new Error('unused')
        }
      })
    ).toThrow(locked)

    expect(reader.updateBook({ id, rating: 5, isFavourite: true }).rating).toBe(5)
    expect(reader.createBookmark({ bookId: id, chapterId, location: 0.2 }).chapterId).toBe(
      chapterId
    )
    reader.trashBook(id)
    expect(reader.listBooks().map((book) => book.id)).not.toContain(id)
  })

  it('takes updates, keeps the reader’s place, and ignores anything older', async () => {
    const { author, bookId, first } = await authoredBook()
    const reader = await openStore()
    const original = send(author, bookId, 1)
    const { bookId: id } = reader.receiveSharedBook(origin(1), original)
    const chapterId = reader.getBook(id).chapters[0].id
    const highlight = reader.createAnnotation({
      bookId: id,
      chapterId,
      kind: 'highlight',
      body: 'Lovely',
      color: 'gold',
      anchor: { fallbackLocation: 0 }
    })
    reader.saveReadingState({
      bookId: id,
      chapterId,
      scrollPosition: 0.5,
      progressPercentage: 50,
      hasFinishedCurrentContent: false
    })

    author.updateChapter({ id: first, content: 'One, longer than it was before.' })
    author.createChapter({ bookId, title: 'Chapter 2', content: 'Two.' })
    author.updateBook({ id: bookId, blurb: 'A better blurb' })
    const update = send(author, bookId, 2)
    const result = reader.receiveSharedBook(origin(2), update)

    expect(result).toMatchObject({ added: 1, revised: 1, removed: 0 })
    const book = reader.getBook(id)
    expect(book.blurb).toBe('A better blurb')
    expect(book.chapters.map((chapter) => chapter.title)).toEqual(['Chapter 1', 'Chapter 2'])
    expect(reader.getChapter(chapterId).content).toBe('One, longer than it was before.')
    expect(reader.listChapterRevisions(chapterId).map((item) => item.reason)).toContain(
      'Before update from Jack'
    )
    expect(reader.getReadingState(id).chapterId).toBe(chapterId)
    expect(reader.listAnnotations(id).map((item) => item.id)).toContain(highlight.id)

    expect(reader.receiveSharedBook(origin(1), original).stale).toBe(true)
    expect(reader.getBook(id).chapters).toHaveLength(2)
  })

  it('moves a chapter the sender removed to Trash, in the sender’s order', async () => {
    const { author, bookId, first } = await authoredBook()
    const second = author.createChapter({ bookId, title: 'Chapter 2', content: 'Two.' })
    const third = author.createChapter({ bookId, title: 'Chapter 3', content: 'Three.' })
    const reader = await openStore()
    const { bookId: id } = reader.receiveSharedBook(origin(1), send(author, bookId, 1))

    author.removeChapter(second.id)
    author.reorderChapters({ bookId, chapterIds: [third.id, first] })
    const result = reader.receiveSharedBook(origin(2), send(author, bookId, 2))

    expect(result.removed).toBe(1)
    expect(reader.getBook(id).chapters.map((chapter) => chapter.title)).toEqual([
      'Chapter 3',
      'Chapter 1'
    ])
    expect(reader.listChapterTrash(id).map((chapter) => chapter.title)).toEqual(['Chapter 2'])
  })

  it('refuses an update from anyone but the original sender', async () => {
    const { author, bookId } = await authoredBook()
    const reader = await openStore()
    const shared = send(author, bookId, 1)
    reader.receiveSharedBook(origin(1), shared)

    expect(() =>
      reader.receiveSharedBook({ ...origin(2), senderAddress: 'SOMEONEELSEENTIR' }, shared)
    ).toThrow('did not come from')
  })

  it('can be sent again after the reader removed it', async () => {
    const { author, bookId } = await authoredBook()
    const reader = await openStore()
    const { bookId: id } = reader.receiveSharedBook(origin(1), send(author, bookId, 1))
    reader.trashBook(id)

    reader.receiveSharedBook(origin(2), send(author, bookId, 2))

    expect(reader.listBooks().map((book) => book.id)).toContain(id)
  })
})

describe('receiving an editable book', () => {
  it('can be edited, and an update never overwrites the reader’s edits', async () => {
    const { author, bookId, first } = await authoredBook()
    const second = author.createChapter({ bookId, title: 'Chapter 2', content: 'Two.' })
    const reader = await openStore()
    const { bookId: id } = reader.receiveSharedBook(origin(1, 'editable'), send(author, bookId, 1))
    const [mine, theirs] = reader.getBook(id).chapters
    reader.updateChapter({ id: mine.id, content: 'My own version.' })
    reader.updateBook({ id, title: 'My Title' })
    const extra = reader.createChapter({ bookId: id, title: 'My chapter', content: 'Mine.' })

    author.updateChapter({ id: first, content: 'Jack’s new version.' })
    author.updateChapter({ id: second.id, content: 'Two, revised.' })
    author.updateBook({ id: bookId, title: 'New Title' })
    const result = reader.receiveSharedBook(origin(2, 'editable'), send(author, bookId, 2))

    expect(result).toMatchObject({ revised: 1, keptYours: 1 })
    expect(reader.getChapter(mine.id).content).toBe('My own version.')
    expect(reader.getChapter(theirs.id).content).toBe('Two, revised.')
    expect(reader.getBook(id).title).toBe('My Title')
    expect(reader.getBook(id).chapters.map((chapter) => chapter.id)).toContain(extra.id)
    const revision = reader
      .listChapterRevisions(mine.id)
      .find((item) => item.reason === 'Update from Jack')
    expect(reader.getChapterRevision(revision!.id).content).toBe('Jack’s new version.')
  })

  it('updates details the reader left alone', async () => {
    const { author, bookId } = await authoredBook()
    const reader = await openStore()
    const { bookId: id } = reader.receiveSharedBook(origin(1, 'editable'), send(author, bookId, 1))

    author.updateBook({ id: bookId, title: 'New Title' })
    reader.receiveSharedBook(origin(2, 'editable'), send(author, bookId, 2))

    expect(reader.getBook(id).title).toBe('New Title')
  })
})

describe('the story bible', () => {
  async function bookWithBible(): Promise<{
    author: StoryboundStore
    bookId: string
    first: string
    entity: StoryEntity
  }> {
    const made = await authoredBook()
    const entity = made.author.createStoryEntity({
      bookId: made.bookId,
      entityType: 'character',
      title: 'Dale',
      summary: 'A careful man',
      bodyMarkdown: 'Fixes things.',
      details: {},
      detailsVersion: 1
    })
    made.author.createStoryEntityChapterLink({
      entityId: entity.id,
      chapterId: made.first,
      note: 'First seen'
    })
    return { ...made, entity }
  }

  it('is left out unless the sender includes it', async () => {
    const { author, bookId } = await bookWithBible()
    const prepared = author.prepareSharedBook({
      bookId,
      shareId: null,
      includeBible: false,
      encodeCover: () => {
        throw new Error('unused')
      }
    })
    expect(prepared.body.bible).toBeNull()
    expect(JSON.stringify(prepared.body)).not.toContain('Dale')
  })

  it('arrives with its links, and stays locked', async () => {
    const { author, bookId } = await bookWithBible()
    const reader = await openStore()
    const { bookId: id } = reader.receiveSharedBook(origin(1), send(author, bookId, 1))

    const [entity] = reader.listStoryEntities({ bookId: id })
    expect(entity).toMatchObject({ title: 'Dale', summary: 'A careful man' })
    expect(reader.listStoryEntityChapterLinks(entity.id)).toHaveLength(1)
    expect(() => reader.updateStoryEntity({ id: entity.id, title: 'x' })).toThrow('read-only')
    expect(() => reader.removeStoryEntity(entity.id)).toThrow('read-only')
  })

  it('mirrors the sender’s on a locked book', async () => {
    const { author, bookId, entity } = await bookWithBible()
    const reader = await openStore()
    const { bookId: id } = reader.receiveSharedBook(origin(1), send(author, bookId, 1))

    author.updateStoryEntity({ id: entity.id, summary: 'A changed man' })
    reader.receiveSharedBook(origin(2), send(author, bookId, 2))
    expect(reader.listStoryEntities({ bookId: id })[0].summary).toBe('A changed man')

    author.removeStoryEntity(entity.id)
    reader.receiveSharedBook(origin(3), send(author, bookId, 3))
    expect(reader.listStoryEntities({ bookId: id })).toHaveLength(0)
  })

  it('only gains new entries on an editable book', async () => {
    const { author, bookId, entity } = await bookWithBible()
    const reader = await openStore()
    const { bookId: id } = reader.receiveSharedBook(origin(1, 'editable'), send(author, bookId, 1))
    const [mine] = reader.listStoryEntities({ bookId: id })
    reader.updateStoryEntity({ id: mine.id, summary: 'My take' })

    author.updateStoryEntity({ id: entity.id, summary: 'A changed man' })
    author.createStoryEntity({
      bookId,
      entityType: 'character',
      title: 'Bev',
      summary: '',
      bodyMarkdown: '',
      details: {},
      detailsVersion: 1
    })
    reader.receiveSharedBook(origin(2, 'editable'), send(author, bookId, 2))

    const entries = reader.listStoryEntities({ bookId: id })
    expect(entries.map((item) => item.title).sort()).toEqual(['Bev', 'Dale'])
    expect(entries.find((item) => item.title === 'Dale')?.summary).toBe('My take')
  })
})

describe('a shared book in sync', () => {
  it('carries its lock to other devices, and an older record cannot remove it', async () => {
    const { author, bookId } = await authoredBook()
    const reader = await openStore()
    const { bookId: id } = reader.receiveSharedBook(origin(1), send(author, bookId, 1))
    const database = reader.syncDatabase()
    const library = reader.getBook(id).libraryId
    const entity = listLocalSyncEntities(database, library).find(
      (item) => item.entityType === 'book' && item.entityId === id
    )
    const record = entity!.value
    expect(record).toMatchObject({ share_mode: 'read-only', share_sender_name: 'Jack' })

    const secondComputer = await openStore()
    applyLocalSyncEntity(secondComputer.syncDatabase(), library, 'book', id, 'upsert', record)
    expect(() => secondComputer.updateBook({ id, title: 'x' })).toThrow('read-only')

    const fromOldPhone = Object.fromEntries(
      Object.entries(record).filter(([key]) => !key.startsWith('share_'))
    )
    applyLocalSyncEntity(database, library, 'book', id, 'upsert', fromOldPhone)
    expect(reader.getBook(id).share?.mode).toBe('read-only')
    expect(() => reader.updateBook({ id, title: 'x' })).toThrow('read-only')
  })
})
