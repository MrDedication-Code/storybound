import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSqlWriteCoordinator } from '../src/data/sqlite/databasePort'
import { migrateDatabase } from '../src/data/sqlite/migrations'
import { createSQLiteRepository } from '../src/data/sqlite/sqliteRepository'
import { SQLiteSyncStore, type DecryptedRemoteChange } from '../src/data/sqlite/sqliteSyncStore'
import { NodeSqliteDatabase } from './helpers/nodeSqliteDatabase'
import { insertSampleLibrary } from './helpers/sampleLibrary'

const vaultId = '11111111-1111-4111-8111-111111111111'
const deviceId = '22222222-2222-4222-8222-222222222222'
const remoteDeviceId = '33333333-3333-4333-8333-333333333333'
const encryptedPayload = {
  ciphertext: 'Y2lwaGVydGV4dA==',
  nonce: 'bm9uY2U=',
  encoding: 'aes-256-gcm-v1' as const,
  keyVersion: 1,
  schemaVersion: 1,
  hash: 'aGFzaA=='
}

describe('SQLite encrypted sync store', () => {
  let directory = ''
  let database: NodeSqliteDatabase | null = null
  let syncStore: SQLiteSyncStore
  let nextMutation = 0

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'storybound-mobile-sync-'))
    database = new NodeSqliteDatabase(join(directory, 'library.db'))
    await migrateDatabase(database)
    await insertSampleLibrary(database)
    const writes = createSqlWriteCoordinator()
    syncStore = new SQLiteSyncStore(database, writes, () => new Date('2026-08-06T12:00:00Z'))
    nextMutation = 0
  })

  afterEach(() => {
    database?.close()
    database = null
    rmSync(directory, { force: true, recursive: true })
  })

  const createMutationId = (): string => {
    nextMutation += 1
    return `00000000-0000-4000-8000-${String(nextMutation).padStart(12, '0')}`
  }

  it('queues all core entities in dependency order and keeps claimed IDs stable', async () => {
    await syncStore.activateProfile(vaultId, deviceId)
    await syncStore.queueAllLocalEntities()

    const first = await syncStore.claimPendingChanges(createMutationId)
    const second = await syncStore.claimPendingChanges(createMutationId)
    expect(first.length).toBeGreaterThan(4)
    expect(first[0].entityType).toBe('library')
    expect(first.map((change) => change.mutationId)).toEqual(
      second.map((change) => change.mutationId)
    )
    expect(new Set(first.map((change) => change.entityType))).toEqual(
      new Set(['library', 'book', 'chapter', 'reading-state'])
    )
  })

  it('coalesces a newer local edit without losing the accepted base revision', async () => {
    const writes = createSqlWriteCoordinator()
    const repository = createSQLiteRepository(
      database!,
      () => new Date('2026-08-06T12:05:00Z'),
      writes
    )
    syncStore = new SQLiteSyncStore(database!, writes, () => new Date('2026-08-06T12:06:00Z'))
    await syncStore.activateProfile(vaultId, deviceId)
    await syncStore.queueAllLocalEntities()
    const sent = await syncStore.claimPendingChanges(createMutationId)
    const original = sent.find(
      (change) => change.entityType === 'chapter' && change.entityId === 'lantern-1'
    )
    expect(original).toBeDefined()

    await repository.updateChapter({
      id: 'lantern-1',
      title: 'A newer local title',
      content: 'Still editing while the encrypted request is in flight.'
    })
    await syncStore.acknowledgePush(
      [
        {
          mutationId: original!.mutationId,
          status: 'accepted',
          remoteRevision: '9223372036854775806',
          duplicate: false
        }
      ],
      [original!]
    )

    const row = await database!.getFirstAsync<{
      mutation_id: string | null
      base_remote_revision: string | null
      row_version: number
    }>(
      `SELECT mutation_id, base_remote_revision, row_version FROM change_records
       WHERE entity_type = 'chapter' AND entity_id = 'lantern-1'`
    )
    expect(row).toEqual({
      mutation_id: null,
      base_remote_revision: '9223372036854775806',
      row_version: 2
    })
  })

  it('applies a remote library before books in the same pull page and advances the cursor', async () => {
    await syncStore.activateProfile(vaultId, deviceId)
    const remoteLibraryId = 'remote-library'
    const bookChange: DecryptedRemoteChange = {
      mutationId: '44444444-4444-4444-8444-444444444444',
      deviceId: remoteDeviceId,
      entityType: 'book',
      entityId: 'remote-book',
      operation: 'upsert',
      remoteRevision: '2',
      changedAt: '2026-08-06T11:00:01Z',
      payload: encryptedPayload,
      value: {
        id: 'remote-book',
        title: 'Across Devices',
        blurb: '',
        status: 'ongoing',
        created_at: '2026-08-06T11:00:00Z',
        updated_at: '2026-08-06T11:00:01Z',
        last_opened_at: null,
        completed_at: null,
        total_word_count: 0,
        is_archived: 0,
        deleted_at: null,
        row_version: 1,
        subtitle: '',
        author_name: '',
        language_code: '',
        source_label: '',
        source_url: '',
        personal_notes: '',
        rating: null,
        favourited_at: null,
        pinned_at: null,
        series_name: '',
        series_position: null,
        cover_style: 'classic',
        cover_position_x: 50,
        cover_position_y: 50
      }
    }
    const libraryChange: DecryptedRemoteChange = {
      mutationId: '55555555-5555-4555-8555-555555555555',
      deviceId: remoteDeviceId,
      entityType: 'library',
      entityId: remoteLibraryId,
      operation: 'upsert',
      remoteRevision: '1',
      changedAt: '2026-08-06T11:00:00Z',
      payload: encryptedPayload,
      value: {
        id: remoteLibraryId,
        name: 'Remote Library',
        description: '',
        created_at: '2026-08-06T11:00:00Z',
        updated_at: '2026-08-06T11:00:00Z',
        deleted_at: null,
        row_version: 1
      }
    }

    await expect(
      syncStore.applyPullPage(null, '9223372036854775807', deviceId, [bookChange, libraryChange])
    ).resolves.toBe(2)

    await expect(syncStore.profile()).resolves.toMatchObject({
      localLibraryId: remoteLibraryId,
      lastPullCursor: '9223372036854775807'
    })
    await expect(
      database!.getFirstAsync<{ library_id: string }>(
        `SELECT library_id FROM books WHERE id = 'remote-book'`
      )
    ).resolves.toEqual({ library_id: remoteLibraryId })
  })

  it('files each synced book into the library it names, across several libraries', async () => {
    await syncStore.activateProfile(vaultId, deviceId)
    let revision = 0
    const change = (
      entityType: DecryptedRemoteChange['entityType'],
      entityId: string,
      value: Record<string, unknown>
    ): DecryptedRemoteChange => {
      revision += 1
      return {
        mutationId: `${String(revision).padStart(8, '0')}-7777-4777-8777-777777777777`,
        deviceId: remoteDeviceId,
        entityType,
        entityId,
        operation: 'upsert',
        remoteRevision: String(revision),
        changedAt: '2026-08-06T11:00:00Z',
        payload: encryptedPayload,
        value
      }
    }
    const library = (id: string, name: string): Record<string, unknown> => ({
      id,
      name,
      description: '',
      created_at: '2026-08-06T11:00:00Z',
      updated_at: '2026-08-06T11:00:00Z',
      deleted_at: null,
      row_version: 1
    })
    const book = (id: string, libraryId: string): Record<string, unknown> => ({
      id,
      title: id,
      blurb: '',
      status: 'ongoing',
      created_at: '2026-08-06T11:00:00Z',
      updated_at: '2026-08-06T11:00:00Z',
      last_opened_at: null,
      completed_at: null,
      total_word_count: 0,
      is_archived: 0,
      deleted_at: null,
      row_version: 1,
      subtitle: '',
      author_name: '',
      language_code: '',
      source_label: '',
      source_url: '',
      personal_notes: '',
      rating: null,
      favourited_at: null,
      pinned_at: null,
      series_name: '',
      series_position: null,
      cover_style: 'classic',
      cover_position_x: 50,
      cover_position_y: 50,
      library_id: libraryId
    })

    await syncStore.applyPullPage(null, '5', deviceId, [
      change('library', 'library-one', library('library-one', 'Fantasy')),
      change('library', 'library-two', library('library-two', 'Horror/Thriller')),
      change('book', 'book-one', book('book-one', 'library-one')),
      change('book', 'book-two', book('book-two', 'library-two')),
      change('book', 'book-early', book('book-early', 'library-later'))
    ])
    const libraryOf = async (bookId: string): Promise<string | undefined> =>
      (
        await database!.getFirstAsync<{ library_id: string }>(
          'SELECT library_id FROM books WHERE id = ?',
          [bookId]
        )
      )?.library_id
    await expect(libraryOf('book-one')).resolves.toBe('library-one')
    await expect(libraryOf('book-two')).resolves.toBe('library-two')
    await expect(libraryOf('book-early')).resolves.toBe('library-later')

    await syncStore.applyPullPage('5', '6', deviceId, [
      change('library', 'library-later', library('library-later', 'Arrived Later'))
    ])
    await expect(
      database!.getFirstAsync<{ name: string }>(
        `SELECT name FROM libraries WHERE id = 'library-later'`
      )
    ).resolves.toEqual({ name: 'Arrived Later' })
  })

  it('sends every library, and each book with its library, when this phone sets up sync', async () => {
    await database!.runAsync(
      `INSERT INTO libraries (id, name, created_at, updated_at)
       VALUES ('library-two', 'Second', '2026-08-06T11:00:00Z', '2026-08-06T11:00:00Z')`
    )
    await database!.runAsync(
      `UPDATE books SET library_id = 'library-two' WHERE id = 'glass-orchard'`
    )
    await syncStore.activateProfile(vaultId, deviceId)
    await syncStore.queueAllLocalEntities()

    const pending = await syncStore.claimPendingChanges(createMutationId)
    expect(
      pending
        .filter((item) => item.entityType === 'library')
        .map((item) => item.entityId)
        .sort()
    ).toEqual(['default-library', 'library-two'])
    const books = Object.fromEntries(
      pending
        .filter((item) => item.entityType === 'book')
        .map((item) => [item.entityId, (item.value as { library_id: string }).library_id])
    )
    expect(books).toEqual({ 'glass-orchard': 'library-two', 'lantern-house': 'default-library' })
  })

  it('stores a synced cover, shows it as the book cover, and removes it again', async () => {
    await syncStore.activateProfile(vaultId, deviceId)
    const repository = createSQLiteRepository(database!)
    const cover = (
      operation: 'upsert' | 'delete',
      revision: string,
      value: Record<string, unknown>
    ): DecryptedRemoteChange => ({
      mutationId: `${revision.padStart(8, '0')}-8888-4888-8888-888888888888`,
      deviceId: remoteDeviceId,
      entityType: 'media-asset',
      entityId: 'book-cover:glass-orchard',
      operation,
      remoteRevision: revision,
      changedAt: '2026-08-06T12:00:00Z',
      payload: encryptedPayload,
      value
    })

    await syncStore.applyPullPage(null, '1', deviceId, [
      cover('upsert', '1', {
        book_id: 'glass-orchard',
        mime_type: 'image/jpeg',
        data: 'AQID',
        row_version: 1
      })
    ])
    const covered = (await repository.listBooks()).find((book) => book.id === 'glass-orchard')
    expect(covered?.coverUri).toBe('data:image/jpeg;base64,AQID')
    expect((await repository.getBook('glass-orchard')).coverUri).toBe('data:image/jpeg;base64,AQID')
    expect(
      (await repository.listBooks()).find((book) => book.id === 'lantern-house')?.coverUri
    ).toBe(null)

    await expect(
      syncStore.applyPullPage('1', '2', deviceId, [
        cover('upsert', '2', {
          book_id: 'glass-orchard',
          mime_type: 'text/html',
          data: 'PHNjcmlwdD4=',
          row_version: 2
        })
      ])
    ).rejects.toThrow('cover image is invalid')

    await syncStore.applyPullPage('1', '3', deviceId, [
      cover('delete', '3', { deletedAt: null, rowVersion: 2 })
    ])
    expect((await repository.getBook('glass-orchard')).coverUri).toBeNull()
  })

  it('records a pull conflict and excludes that entity from future push claims', async () => {
    const writes = createSqlWriteCoordinator()
    const repository = createSQLiteRepository(
      database!,
      () => new Date('2026-08-06T12:05:00Z'),
      writes
    )
    syncStore = new SQLiteSyncStore(database!, writes)
    await syncStore.activateProfile(vaultId, deviceId)
    await repository.updateChapter({ id: 'lantern-1', title: 'Local', content: 'Local edit.' })

    const remote: DecryptedRemoteChange = {
      mutationId: '66666666-6666-4666-8666-666666666666',
      deviceId: remoteDeviceId,
      entityType: 'chapter',
      entityId: 'lantern-1',
      operation: 'upsert',
      remoteRevision: '9',
      changedAt: '2026-08-06T12:06:00Z',
      payload: encryptedPayload,
      value: {
        id: 'lantern-1',
        book_id: 'lantern-house',
        title: 'Remote',
        content: 'Remote edit.',
        position: 0,
        created_at: '2026-08-01T12:00:00Z',
        updated_at: '2026-08-06T12:06:00Z',
        word_count: 2,
        deleted_at: null,
        trashed_from_position: null,
        row_version: 2
      }
    }
    await syncStore.applyPullPage(null, '9', deviceId, [remote])

    const status = await syncStore.localStatus({
      configured: true,
      phase: 'idle',
      accountEmail: 'reader@example.com',
      vaultId,
      deviceId,
      lastSyncAt: null,
      lastError: null
    })
    expect(status).toMatchObject({ pendingChanges: 1, openConflicts: 1 })
    await expect(syncStore.claimPendingChanges(createMutationId)).resolves.toEqual([])
    await expect(repository.getChapter('lantern-1')).resolves.toMatchObject({ title: 'Local' })
  })
})
