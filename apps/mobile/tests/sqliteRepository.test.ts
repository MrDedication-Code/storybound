import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DATABASE_VERSION, migrateDatabase } from '../src/data/sqlite/migrations'
import { createSQLiteRepository } from '../src/data/sqlite/sqliteRepository'
import { NodeSqliteDatabase } from './helpers/nodeSqliteDatabase'

describe('SQLite mobile repository', () => {
  let directory = ''
  let databasePath = ''
  let database: NodeSqliteDatabase | null = null

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'storybound-mobile-'))
    databasePath = join(directory, 'library.db')
    database = new NodeSqliteDatabase(databasePath)
  })

  afterEach(() => {
    database?.close()
    database = null
    rmSync(directory, { force: true, recursive: true })
  })

  it('migrates a blank database and seeds the first-run library once', async () => {
    await migrateDatabase(database!)

    const version = await database!.getFirstAsync<{ user_version: number }>('PRAGMA user_version')
    const repository = createSQLiteRepository(database!)
    const books = await repository.listBooks()

    expect(version?.user_version).toBe(DATABASE_VERSION)
    expect(books.map((book) => book.title)).toEqual(['The Lantern House', 'The Glass Orchard'])
    await expect(repository.getSyncStatus()).resolves.toMatchObject({ pendingLocalRecords: 0 })

    await migrateDatabase(database!)
    await expect(repository.listBooks()).resolves.toHaveLength(2)
  })

  it('refuses to open a database created by a newer app version', async () => {
    await database!.execAsync(`PRAGMA user_version = ${DATABASE_VERSION + 1}`)

    await expect(migrateDatabase(database!)).rejects.toThrow('newer Storybound version')
  })

  it('persists edits and reading progress across repository and database reopen', async () => {
    await migrateDatabase(database!)
    const timestamp = new Date('2026-08-06T12:34:56.000Z')
    const repository = createSQLiteRepository(database!, () => timestamp)

    await repository.updateChapter({
      id: 'orchard-1',
      title: 'The Open Orchard',
      content: 'One two three four.'
    })
    await repository.saveReadingState({
      bookId: 'glass-orchard',
      chapterId: 'orchard-1',
      scrollPosition: 0.42,
      progressPercentage: 42
    })
    await expect(repository.getSyncStatus()).resolves.toMatchObject({ pendingLocalRecords: 2 })

    database!.close()
    database = new NodeSqliteDatabase(databasePath)
    await migrateDatabase(database)
    const reopened = createSQLiteRepository(database)

    await expect(reopened.getChapter('orchard-1')).resolves.toMatchObject({
      title: 'The Open Orchard',
      content: 'One two three four.',
      wordCount: 4,
      updatedAt: timestamp.toISOString()
    })
    await expect(reopened.getReadingState('glass-orchard')).resolves.toMatchObject({
      chapterId: 'orchard-1',
      scrollPosition: 0.42,
      progressPercentage: 42,
      lastReadAt: timestamp.toISOString()
    })
    await expect(reopened.getSyncStatus()).resolves.toMatchObject({ pendingLocalRecords: 2 })
  })

  it('rolls back a chapter edit when its change-ledger write fails', async () => {
    await migrateDatabase(database!)
    await database!.execAsync(`
      CREATE TRIGGER reject_chapter_change
      BEFORE INSERT ON change_records
      WHEN NEW.entity_type = 'chapter'
      BEGIN
        SELECT RAISE(ABORT, 'change ledger unavailable');
      END;
    `)
    const repository = createSQLiteRepository(database!)
    const before = await repository.getChapter('lantern-1')

    await expect(
      repository.updateChapter({ id: 'lantern-1', title: 'Should Roll Back', content: 'Changed.' })
    ).rejects.toThrow('change ledger unavailable')

    await expect(repository.getChapter('lantern-1')).resolves.toEqual(before)
  })

  it('rejects reading state that crosses book boundaries without writing changes', async () => {
    await migrateDatabase(database!)
    const repository = createSQLiteRepository(database!)

    await expect(
      repository.saveReadingState({
        bookId: 'glass-orchard',
        chapterId: 'lantern-1',
        scrollPosition: 0.5,
        progressPercentage: 50
      })
    ).rejects.toThrow('does not belong')

    await expect(repository.getReadingState('glass-orchard')).resolves.toMatchObject({
      chapterId: null,
      progressPercentage: 0
    })
    await expect(repository.getSyncStatus()).resolves.toMatchObject({ pendingLocalRecords: 0 })
  })
})
