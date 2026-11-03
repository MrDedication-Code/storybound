import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSqlWriteCoordinator } from '../src/data/sqlite/databasePort'
import { migrateDatabase } from '../src/data/sqlite/migrations'
import { createSQLiteRepository } from '../src/data/sqlite/sqliteRepository'
import { SQLiteSyncStore, type DecryptedRemoteChange } from '../src/data/sqlite/sqliteSyncStore'
import type { BookDetailsInput, MobileRepository } from '../src/domain/contracts'
import { NodeSqliteDatabase } from './helpers/nodeSqliteDatabase'

const details: BookDetailsInput = {
  title: 'Written on the Train',
  subtitle: '',
  authorName: 'Jack',
  blurb: 'A story begun between stations.',
  status: 'ongoing',
  seriesName: '',
  seriesPosition: null
}

describe('editing on the phone', () => {
  let directory = ''
  let database: NodeSqliteDatabase
  let repository: MobileRepository
  let clock = 0
  let nextId = 0

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'storybound-mobile-editing-'))
    database = new NodeSqliteDatabase(join(directory, 'library.db'))
    await migrateDatabase(database)
    clock = Date.parse('2026-11-03T09:00:00Z')
    nextId = 0
    repository = createSQLiteRepository(
      database,
      // Each call is a minute later, so version history has a clear order.
      () => new Date((clock += 60_000)),
      createSqlWriteCoordinator(),
      () => `id-${String((nextId += 1)).padStart(3, '0')}`
    )
  })

  afterEach(() => {
    database.close()
    rmSync(directory, { force: true, recursive: true })
  })

  const order = async (bookId: string): Promise<string[]> =>
    (await repository.getBook(bookId)).chapters.map((chapter) => chapter.title)

  const pending = (): Promise<Array<{ entity_type: string; entity_id: string }>> =>
    database.getAllAsync(
      'SELECT entity_type, entity_id FROM change_records ORDER BY entity_type, entity_id'
    )

  it('creates a book with a first chapter and edits its details', async () => {
    const book = await repository.createBook({ ...details, libraryId: 'default-library' })
    expect(book).toMatchObject({ title: 'Written on the Train', authorName: 'Jack' })
    expect(book.chapters.map((chapter) => chapter.title)).toEqual(['Chapter 1'])
    expect(await pending()).toEqual([
      { entity_type: 'book', entity_id: book.id },
      { entity_type: 'chapter', entity_id: book.chapters[0].id }
    ])

    const edited = await repository.updateBookDetails(book.id, {
      ...details,
      title: '  Night Train  ',
      status: 'completed',
      seriesName: 'Rails',
      seriesPosition: 2
    })
    expect(edited).toMatchObject({
      title: 'Night Train',
      status: 'completed',
      seriesName: 'Rails',
      seriesPosition: 2
    })
    await expect(
      repository.updateBookDetails(book.id, { ...details, title: '   ' })
    ).rejects.toThrow('needs a title')

    await repository.trashBook(book.id)
    expect(await repository.listBooks()).toEqual([])
    expect(await repository.listTrashedBooks()).toEqual([
      expect.objectContaining({ id: book.id, title: 'Night Train' })
    ])
    await repository.restoreBook(book.id)
    expect((await repository.listBooks()).map((item) => item.id)).toEqual([book.id])
  })

  it('adds, duplicates, reorders, trashes, and restores chapters', async () => {
    const book = await repository.createBook({ ...details, libraryId: 'default-library' })
    const two = await repository.createChapter(book.id)
    const three = await repository.createChapter(book.id, 'The Tunnel')
    expect(await order(book.id)).toEqual(['Chapter 1', 'Chapter 2', 'The Tunnel'])

    await repository.duplicateChapter(two.id)
    expect(await order(book.id)).toEqual([
      'Chapter 1',
      'Chapter 2',
      'Chapter 2 (copy)',
      'The Tunnel'
    ])

    const ids = (await repository.getBook(book.id)).chapters.map((chapter) => chapter.id)
    await repository.reorderChapters(book.id, [ids[3], ids[0], ids[1], ids[2]])
    expect(await order(book.id)).toEqual([
      'The Tunnel',
      'Chapter 1',
      'Chapter 2',
      'Chapter 2 (copy)'
    ])
    await expect(repository.reorderChapters(book.id, [ids[0]])).rejects.toThrow('changed')

    await repository.trashChapter(two.id)
    expect(await order(book.id)).toEqual(['The Tunnel', 'Chapter 1', 'Chapter 2 (copy)'])
    expect(await repository.listTrashedChapters(book.id)).toEqual([
      expect.objectContaining({ id: two.id, title: 'Chapter 2' })
    ])
    await repository.restoreChapter(two.id)
    expect(await order(book.id)).toEqual([
      'The Tunnel',
      'Chapter 1',
      'Chapter 2',
      'Chapter 2 (copy)'
    ])
    expect((await repository.getChapter(three.id)).position).toBe(0)
  })

  it('splits and merges chapters and keeps versions to restore', async () => {
    const book = await repository.createBook({ ...details, libraryId: 'default-library' })
    const first = book.chapters[0]
    await repository.updateChapter({
      id: first.id,
      title: 'Chapter 1',
      content: 'The platform emptied.\n\nThen the lights went out.'
    })
    const split = await repository.splitChapter({
      id: first.id,
      offset: 'The platform emptied.\n\n'.length,
      newTitle: 'Dark'
    })
    expect(split.content).toBe('Then the lights went out.')
    expect((await repository.getChapter(first.id)).content).toBe('The platform emptied.')
    expect(await order(book.id)).toEqual(['Chapter 1', 'Dark'])
    await expect(
      repository.splitChapter({ id: first.id, offset: 0, newTitle: 'Nothing' })
    ).rejects.toThrow('cursor')

    const merged = await repository.mergeWithNextChapter(first.id)
    expect(merged.content).toBe('The platform emptied.\n\nThen the lights went out.')
    expect(await order(book.id)).toEqual(['Chapter 1'])
    expect((await repository.listTrashedChapters(book.id)).map((item) => item.title)).toEqual([
      'Dark'
    ])

    const versions = await repository.listChapterRevisions(first.id)
    expect(versions.map((version) => version.reason)).toEqual([
      'Before merging',
      'Before splitting',
      'While writing'
    ])
    const restored = await repository.restoreChapterRevision(versions[1].id)
    expect(restored.content).toBe('The platform emptied.\n\nThen the lights went out.')
    const beforeSplit = versions.find((version) => version.reason === 'Before splitting')
    expect(beforeSplit?.content).toBe('The platform emptied.\n\nThen the lights went out.')
    expect((await repository.listChapterRevisions(first.id))[0].reason).toBe(
      'Before restoring a version'
    )
  })

  it('receives a reorder from another device and keeps the text it replaces', async () => {
    const book = await repository.createBook({ ...details, libraryId: 'default-library' })
    const second = await repository.createChapter(book.id)
    await database.runAsync('DELETE FROM change_records')
    const syncStore = new SQLiteSyncStore(database, createSqlWriteCoordinator())
    await syncStore.activateProfile(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222'
    )
    const chapter = (
      id: string,
      title: string,
      content: string,
      position: number,
      revision: string
    ): DecryptedRemoteChange => ({
      mutationId: `${revision.padStart(8, '0')}-5555-4555-8555-555555555555`,
      deviceId: '33333333-3333-4333-8333-333333333333',
      entityType: 'chapter',
      entityId: id,
      operation: 'upsert',
      remoteRevision: revision,
      changedAt: '2026-11-03T10:00:00Z',
      payload: {
        ciphertext: 'Y2lwaGVydGV4dA==',
        nonce: 'bm9uY2U=',
        encoding: 'aes-256-gcm-v1',
        keyVersion: 1,
        schemaVersion: 1,
        hash: 'aGFzaA=='
      },
      value: {
        id,
        book_id: book.id,
        title,
        content,
        position,
        created_at: '2026-11-03T09:00:00Z',
        updated_at: '2026-11-03T10:00:00Z',
        word_count: 1,
        deleted_at: null,
        trashed_from_position: null,
        row_version: 5
      }
    })
    // The first chapter lands on position 1 while the second still holds it.
    await syncStore.applyPullPage(null, '2', '22222222-2222-4222-8222-222222222222', [
      chapter(book.chapters[0].id, 'Chapter 1', 'Rewritten elsewhere.', 1, '1'),
      chapter(second.id, 'Chapter 2', '', 0, '2')
    ])
    expect(await order(book.id)).toEqual(['Chapter 2', 'Chapter 1'])
    const [version] = await repository.listChapterRevisions(book.chapters[0].id)
    expect(version).toMatchObject({ reason: 'Before an edit from another device', content: '' })
  })
})
