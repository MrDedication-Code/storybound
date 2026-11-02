import type Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createStoryboundPaths, openStoryboundDatabase } from '../../src/main/database'
import {
  applyLocalSyncEntity,
  DesktopSyncEngine,
  listLocalSyncEntities,
  type PullSyncRequest,
  type PullSyncResponse,
  type PushSyncRequest,
  type PushSyncResponse,
  type RemoteSyncChange,
  type SyncProvider
} from '../../src/main/sync'

const LIBRARY_ID = '00000000-0000-4000-8000-000000000001'
const VAULT_ID = '10000000-0000-4000-8000-000000000001'
const DEVICE_A = '20000000-0000-4000-8000-000000000001'
const DEVICE_B = '20000000-0000-4000-8000-000000000002'
const PROFILE_ID = '30000000-0000-4000-8000-000000000001'
const NOW = '2026-08-06T20:00:00.000Z'

const temporaryDirectories: string[] = []
const databases: Database.Database[] = []

class MemoryProvider implements SyncProvider {
  readonly changes: RemoteSyncChange[] = []
  private readonly heads = new Map<string, RemoteSyncChange>()

  async push(request: PushSyncRequest): Promise<PushSyncResponse> {
    const results: PushSyncResponse['results'][number][] = []
    for (const mutation of request.mutations) {
      const duplicate = this.changes.find((change) => change.mutationId === mutation.mutationId)
      if (duplicate) {
        results.push({
          mutationId: mutation.mutationId,
          status: 'accepted',
          remoteRevision: duplicate.remoteRevision
        })
        continue
      }
      const key = `${mutation.entityType}:${mutation.entityId}`
      const head = this.heads.get(key)
      if ((head?.remoteRevision ?? null) !== mutation.baseRemoteRevision) {
        if (!head) throw new Error('Mock provider received an impossible missing-head conflict.')
        results.push({
          mutationId: mutation.mutationId,
          status: 'conflict',
          remoteRevision: head.remoteRevision,
          remoteMutationId: head.mutationId,
          remoteDeviceId: head.deviceId,
          remoteOperation: head.operation,
          remotePayload: head.payload
        })
        continue
      }
      const change: RemoteSyncChange = {
        mutationId: mutation.mutationId,
        deviceId: request.deviceId,
        entityType: mutation.entityType,
        entityId: mutation.entityId,
        operation: mutation.operation,
        remoteRevision: String(this.changes.length + 1),
        changedAt: mutation.changedAt,
        payload: mutation.payload
      }
      this.changes.push(change)
      this.heads.set(key, change)
      results.push({
        mutationId: mutation.mutationId,
        status: 'accepted',
        remoteRevision: change.remoteRevision
      })
    }
    return { results }
  }

  async pull(request: PullSyncRequest): Promise<PullSyncResponse> {
    const cursor = Number(request.cursor ?? 0)
    const changes = this.changes.slice(cursor, cursor + request.limit)
    const nextCursor = changes.at(-1)?.remoteRevision ?? String(cursor)
    return {
      changes,
      nextCursor,
      hasMore: Number(nextCursor) < this.changes.length
    }
  }
}

async function databaseWithProfile(deviceId: string): Promise<Database.Database> {
  const directory = mkdtempSync(join(tmpdir(), 'storybound-sync-engine-test-'))
  temporaryDirectories.push(directory)
  const database = await openStoryboundDatabase(createStoryboundPaths(directory))
  databases.push(database)
  database
    .prepare('INSERT INTO devices (id, display_name, created_at, last_seen_at) VALUES (?, ?, ?, ?)')
    .run(deviceId, `Device ${deviceId.at(-1)}`, NOW, NOW)
  database
    .prepare(
      `INSERT INTO sync_profiles (
         id, library_id, provider, remote_library_id, enabled, created_at, updated_at
       ) VALUES (?, ?, 'supabase', ?, 1, ?, ?)`
    )
    .run(PROFILE_ID, LIBRARY_ID, VAULT_ID, NOW, NOW)
  return database
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('DesktopSyncEngine', () => {
  it('syncs every library and files each book into its own library', async () => {
    const provider = new MemoryProvider()
    const key = Uint8Array.from({ length: 32 }, (_, index) => index + 7)
    const source = await databaseWithProfile(DEVICE_A)
    source
      .prepare(
        `INSERT INTO libraries (id, name, description, created_at, updated_at)
         VALUES ('library-horror', 'Horror/Thriller', '', ?, ?)`
      )
      .run(NOW, NOW)
    for (const [bookId, title] of [
      ['book-default', 'In The Synced Library'],
      ['book-horror', 'Zero Balance']
    ]) {
      source
        .prepare(
          `INSERT INTO books (id, title, blurb, status, created_at, updated_at, total_word_count)
           VALUES (?, ?, '', 'ongoing', ?, ?, 1)`
        )
        .run(bookId, title, NOW, NOW)
      source
        .prepare(
          `INSERT INTO chapters (
             id, book_id, title, content, position, created_at, updated_at, word_count
           ) VALUES (?, ?, 'One', 'Prose', 0, ?, ?, 1)`
        )
        .run(`${bookId}-chapter`, bookId, NOW, NOW)
    }
    source
      .prepare(`UPDATE book_libraries SET library_id = 'library-horror' WHERE book_id = ?`)
      .run('book-horror')

    const sourceEngine = new DesktopSyncEngine(source, provider, PROFILE_ID, DEVICE_A, key, 1)
    await sourceEngine.run()
    const target = await databaseWithProfile(DEVICE_B)
    const targetEngine = new DesktopSyncEngine(target, provider, PROFILE_ID, DEVICE_B, key, 1)
    await targetEngine.run()

    expect(
      target.prepare(`SELECT name FROM libraries WHERE id = 'library-horror'`).pluck().get()
    ).toBe('Horror/Thriller')
    const placement = Object.fromEntries(
      (
        target
          .prepare('SELECT book_id, library_id FROM book_libraries ORDER BY book_id')
          .all() as Array<{ book_id: string; library_id: string }>
      ).map((row) => [row.book_id, row.library_id])
    )
    expect(placement).toEqual({ 'book-default': LIBRARY_ID, 'book-horror': 'library-horror' })
    expect(
      target.prepare(`SELECT content FROM chapters WHERE id = 'book-horror-chapter'`).pluck().get()
    ).toBe('Prose')

    // A settled collection does not bounce changes back and forth.
    expect((await sourceEngine.run()).pushed).toBe(0)
    expect((await targetEngine.run()).pushed).toBe(0)
  })

  it('files older book payloads into the profile library and waits for unknown libraries', async () => {
    const database = await databaseWithProfile(DEVICE_B)
    const source = await databaseWithProfile(DEVICE_A)
    source
      .prepare(
        `INSERT INTO books (id, title, blurb, status, created_at, updated_at, total_word_count)
         VALUES ('template', 'Template', '', 'ongoing', ?, ?, 0)`
      )
      .run(NOW, NOW)
    const template = listLocalSyncEntities(source, LIBRARY_ID).find(
      (entity) => entity.entityType === 'book'
    )!.value
    const book = (id: string, extra: Record<string, unknown> = {}): Record<string, unknown> => {
      const value: Record<string, unknown> = { ...template, id, title: id, ...extra }
      if (!('library_id' in extra)) delete value.library_id
      return value
    }
    applyLocalSyncEntity(database, LIBRARY_ID, 'book', 'old-book', 'upsert', book('old-book'))
    applyLocalSyncEntity(
      database,
      LIBRARY_ID,
      'book',
      'early-book',
      'upsert',
      book('early-book', { library_id: 'library-later' })
    )
    const libraryOf = (bookId: string): unknown =>
      database
        .prepare('SELECT library_id FROM book_libraries WHERE book_id = ?')
        .pluck()
        .get(bookId)
    expect(libraryOf('old-book')).toBe(LIBRARY_ID)
    expect(libraryOf('early-book')).toBe('library-later')

    applyLocalSyncEntity(database, LIBRARY_ID, 'library', 'library-later', 'upsert', {
      id: 'library-later',
      name: 'Arrived Later',
      description: '',
      created_at: NOW,
      updated_at: NOW,
      deleted_at: null,
      row_version: 2
    })
    expect(
      database.prepare(`SELECT name FROM libraries WHERE id = 'library-later'`).pluck().get()
    ).toBe('Arrived Later')
  })

  it('encrypts a local book and chapter, then reconstructs them on a second offline database', async () => {
    const provider = new MemoryProvider()
    const key = Uint8Array.from({ length: 32 }, (_, index) => index + 1)
    const source = await databaseWithProfile(DEVICE_A)
    source
      .prepare(
        `INSERT INTO books (
           id, title, blurb, status, created_at, updated_at, total_word_count
         ) VALUES ('book-a', 'A Hidden Title', '', 'ongoing', ?, ?, 2)`
      )
      .run(NOW, NOW)
    source
      .prepare(
        `INSERT INTO chapters (
           id, book_id, title, content, position, created_at, updated_at, word_count
         ) VALUES ('chapter-a', 'book-a', 'First', 'Secret prose', 0, ?, ?, 2)`
      )
      .run(NOW, NOW)

    const sourceEngine = new DesktopSyncEngine(source, provider, PROFILE_ID, DEVICE_A, key, 1)
    const uploaded = await sourceEngine.run()
    expect(uploaded.pushed).toBe(3)
    expect(Buffer.from(provider.changes[2].payload.ciphertext).toString('utf8')).not.toContain(
      'Secret prose'
    )

    const target = await databaseWithProfile(DEVICE_B)
    const targetEngine = new DesktopSyncEngine(target, provider, PROFILE_ID, DEVICE_B, key, 1)
    const downloaded = await targetEngine.run()

    expect(downloaded.pulled).toBe(3)
    expect(downloaded.pushed).toBe(0)
    expect(target.prepare("SELECT title FROM books WHERE id = 'book-a'").pluck().get()).toBe(
      'A Hidden Title'
    )
    expect(
      target.prepare("SELECT content FROM chapters WHERE id = 'chapter-a'").pluck().get()
    ).toBe('Secret prose')
  })

  it('preserves both encrypted branches and can resolve a concurrent chapter edit', async () => {
    const provider = new MemoryProvider()
    const key = Uint8Array.from({ length: 32 }, (_, index) => 32 - index)
    const source = await databaseWithProfile(DEVICE_A)
    source
      .prepare(
        `INSERT INTO books (
           id, title, blurb, status, created_at, updated_at, total_word_count
         ) VALUES ('book-a', 'Shared', '', 'ongoing', ?, ?, 2)`
      )
      .run(NOW, NOW)
    source
      .prepare(
        `INSERT INTO chapters (
           id, book_id, title, content, position, created_at, updated_at, word_count
         ) VALUES ('chapter-a', 'book-a', 'First', 'Original', 0, ?, ?, 1)`
      )
      .run(NOW, NOW)
    const sourceEngine = new DesktopSyncEngine(source, provider, PROFILE_ID, DEVICE_A, key, 1)
    await sourceEngine.run()

    const target = await databaseWithProfile(DEVICE_B)
    const targetEngine = new DesktopSyncEngine(target, provider, PROFILE_ID, DEVICE_B, key, 1)
    await targetEngine.run()

    source
      .prepare(
        `UPDATE chapters SET content = 'From Mac', row_version = row_version + 1,
           updated_at = '2026-08-06T20:01:00.000Z' WHERE id = 'chapter-a'`
      )
      .run()
    target
      .prepare(
        `UPDATE chapters SET content = 'From phone', row_version = row_version + 1,
           updated_at = '2026-08-06T20:02:00.000Z' WHERE id = 'chapter-a'`
      )
      .run()
    await sourceEngine.run()
    await targetEngine.run()

    expect(
      target.prepare("SELECT content FROM chapters WHERE id = 'chapter-a'").pluck().get()
    ).toBe('From phone')
    const conflictId = target
      .prepare("SELECT id FROM sync_conflicts WHERE status = 'open'")
      .pluck()
      .get() as string
    expect(conflictId).toBeTruthy()

    await targetEngine.resolveConflict(conflictId, 'use-remote')

    expect(
      target.prepare("SELECT content FROM chapters WHERE id = 'chapter-a'").pluck().get()
    ).toBe('From Mac')
    expect(
      target.prepare("SELECT COUNT(*) FROM sync_conflicts WHERE status = 'open'").pluck().get()
    ).toBe(0)

    source
      .prepare(
        `UPDATE chapters SET content = 'Mac again', row_version = row_version + 1,
           updated_at = '2026-08-06T20:03:00.000Z' WHERE id = 'chapter-a'`
      )
      .run()
    target
      .prepare(
        `UPDATE chapters SET content = 'Phone wins', row_version = row_version + 1,
           updated_at = '2026-08-06T20:04:00.000Z' WHERE id = 'chapter-a'`
      )
      .run()
    await sourceEngine.run()
    await targetEngine.run()
    const secondConflictId = target
      .prepare("SELECT id FROM sync_conflicts WHERE status = 'open'")
      .pluck()
      .get() as string

    await targetEngine.resolveConflict(secondConflictId, 'keep-local')
    await sourceEngine.run()

    expect(
      source.prepare("SELECT content FROM chapters WHERE id = 'chapter-a'").pluck().get()
    ).toBe('Phone wins')
  })
})
