import type Database from 'better-sqlite3'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { createStoryboundPaths, openStoryboundDatabase } from '../../src/main/database'
import { StoryboundStore } from '../../src/main/store'
import {
  applyLocalSyncEntity,
  DesktopSyncEngine,
  listLocalSyncEntities,
  type EncodedCover,
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

const mediaFolders = new WeakMap<Database.Database, string>()
function mediaFolderOf(database: Database.Database): string {
  return mediaFolders.get(database)!
}

async function databaseWithProfile(deviceId: string): Promise<Database.Database> {
  const directory = mkdtempSync(join(tmpdir(), 'storybound-sync-engine-test-'))
  temporaryDirectories.push(directory)
  const paths = createStoryboundPaths(directory)
  const database = await openStoryboundDatabase(paths)
  mediaFolders.set(database, paths.media)
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

  it('syncs a book cover and its removal without echoing it back', async () => {
    const provider = new MemoryProvider()
    const key = Uint8Array.from({ length: 32 }, (_, index) => index + 3)
    const encodeCover = (path: string): EncodedCover => ({
      mimeType: 'image/jpeg',
      data: readFileSync(path)
    })
    const source = await databaseWithProfile(DEVICE_A)
    const sourceMedia = mediaFolderOf(source)
    source
      .prepare(
        `INSERT INTO books (id, title, blurb, status, created_at, updated_at, total_word_count)
         VALUES ('book-cover', 'Covered', '', 'ongoing', ?, ?, 0)`
      )
      .run(NOW, NOW)
    writeFileSync(join(sourceMedia, 'original.jpg'), Buffer.from('fake-jpeg-bytes'))
    source.prepare(`UPDATE books SET cover_image_path = 'original.jpg', cover_version = 1`).run()

    const sourceEngine = new DesktopSyncEngine(source, provider, PROFILE_ID, DEVICE_A, key, 1, {
      mediaPath: sourceMedia,
      encodeCover
    })
    await sourceEngine.run()
    expect(
      provider.changes.some(
        (change) =>
          change.entityType === 'media-asset' && change.entityId === 'book-cover:book-cover'
      )
    ).toBe(true)

    const target = await databaseWithProfile(DEVICE_B)
    const targetMedia = mediaFolderOf(target)
    const targetEngine = new DesktopSyncEngine(target, provider, PROFILE_ID, DEVICE_B, key, 1, {
      mediaPath: targetMedia,
      encodeCover
    })
    await targetEngine.run()
    const received = target
      .prepare(`SELECT cover_image_path, cover_version FROM books WHERE id = 'book-cover'`)
      .get() as { cover_image_path: string; cover_version: number }
    expect(received.cover_version).toBe(1)
    expect(readFileSync(join(targetMedia, received.cover_image_path)).toString()).toBe(
      'fake-jpeg-bytes'
    )
    expect((await sourceEngine.run()).pushed).toBe(0)
    expect((await targetEngine.run()).pushed).toBe(0)

    source
      .prepare(`UPDATE books SET cover_image_path = NULL, cover_version = cover_version + 1`)
      .run()
    const removal = listLocalSyncEntities(source, LIBRARY_ID).find(
      (entity) => entity.entityType === 'media-asset'
    )
    expect(removal).toMatchObject({ deleted: true, value: { deleted_at: expect.any(String) } })
    await sourceEngine.run()
    await targetEngine.run()
    expect(
      target.prepare(`SELECT cover_image_path FROM books WHERE id = 'book-cover'`).pluck().get()
    ).toBeNull()
    expect(existsSync(join(targetMedia, received.cover_image_path))).toBe(false)
  })

  it('syncs highlights and notes with their place in the chapter, both ways', async () => {
    const provider = new MemoryProvider()
    const key = Uint8Array.from({ length: 32 }, (_, index) => index + 5)
    const source = await databaseWithProfile(DEVICE_A)
    source
      .prepare(
        `INSERT INTO books (id, title, blurb, status, created_at, updated_at, total_word_count)
         VALUES ('book-notes', 'Annotated', '', 'ongoing', ?, ?, 4)`
      )
      .run(NOW, NOW)
    for (const [id, position] of [
      ['chapter-one', 0],
      ['chapter-two', 1]
    ] as const) {
      source
        .prepare(
          `INSERT INTO chapters (
             id, book_id, title, content, position, created_at, updated_at, word_count
           ) VALUES (?, 'book-notes', ?, 'The lamp went out at midnight.', ?, ?, ?, 6)`
        )
        .run(id, id, position, NOW, NOW)
    }
    source
      .prepare(
        `INSERT INTO chapter_anchors (
           id, chapter_id, start_offset, end_offset, fallback_location, quote, prefix, suffix,
           content_hash, resolution_status, created_at, updated_at
         ) VALUES ('anchor-1', 'chapter-one', 4, 18, 0.1, 'lamp went out', 'The ', ' at',
           'hash', 'resolved', ?, ?)`
      )
      .run(NOW, NOW)
    source
      .prepare(
        `INSERT INTO annotations (id, book_id, anchor_id, kind, body, color, created_at, updated_at)
         VALUES ('note-1', 'book-notes', 'anchor-1', 'note', 'Foreshadowing?', 'blue', ?, ?)`
      )
      .run(NOW, NOW)

    const sourceEngine = new DesktopSyncEngine(source, provider, PROFILE_ID, DEVICE_A, key, 1)
    await sourceEngine.run()
    const target = await databaseWithProfile(DEVICE_B)
    const targetEngine = new DesktopSyncEngine(target, provider, PROFILE_ID, DEVICE_B, key, 1)
    await targetEngine.run()

    const readNote = (database: Database.Database): Record<string, unknown> =>
      database
        .prepare(
          `SELECT a.kind, a.body, a.color, a.deleted_at, anchor.chapter_id, anchor.quote,
             anchor.start_offset, a.row_version + anchor.row_version AS version
           FROM annotations a JOIN chapter_anchors anchor ON anchor.id = a.anchor_id
           WHERE a.id = 'note-1'`
        )
        .get() as Record<string, unknown>
    expect(readNote(target)).toMatchObject({
      kind: 'note',
      body: 'Foreshadowing?',
      color: 'blue',
      chapter_id: 'chapter-one',
      quote: 'lamp went out',
      start_offset: 4,
      version: 2
    })
    expect((await sourceEngine.run()).pushed).toBe(0)
    expect((await targetEngine.run()).pushed).toBe(0)

    // Edited on the second device, then moved to another chapter (a merge) on the first.
    target
      .prepare(
        `UPDATE annotations SET body = 'Definitely foreshadowing.', updated_at = ?,
           row_version = row_version + 1 WHERE id = 'note-1'`
      )
      .run('2026-08-06T21:00:00.000Z')
    await targetEngine.run()
    await sourceEngine.run()
    expect(readNote(source)).toMatchObject({ body: 'Definitely foreshadowing.', version: 3 })
    source
      .prepare(
        `UPDATE chapter_anchors SET chapter_id = 'chapter-two', row_version = row_version + 1
         WHERE id = 'anchor-1'`
      )
      .run()
    await sourceEngine.run()
    await targetEngine.run()
    expect(readNote(target)).toMatchObject({ chapter_id: 'chapter-two', version: 4 })
    expect((await sourceEngine.run()).pushed).toBe(0)
    expect((await targetEngine.run()).pushed).toBe(0)

    source
      .prepare(
        `UPDATE annotations SET deleted_at = ?, row_version = row_version + 1 WHERE id = 'note-1'`
      )
      .run('2026-08-06T22:00:00.000Z')
    source
      .prepare(
        `UPDATE chapter_anchors SET deleted_at = ?, row_version = row_version + 1
         WHERE id = 'anchor-1'`
      )
      .run('2026-08-06T22:00:00.000Z')
    await sourceEngine.run()
    await targetEngine.run()
    expect(readNote(target)).toMatchObject({ deleted_at: '2026-08-06T22:00:00.000Z' })
    expect((await sourceEngine.run()).pushed).toBe(0)
    expect((await targetEngine.run()).pushed).toBe(0)
  })

  it('syncs bookmarks, including ones saved before anchors existed', async () => {
    const provider = new MemoryProvider()
    const key = Uint8Array.from({ length: 32 }, (_, index) => index + 9)
    const source = await databaseWithProfile(DEVICE_A)
    source
      .prepare(
        `INSERT INTO books (id, title, blurb, status, created_at, updated_at, total_word_count)
         VALUES ('book-marks', 'Marked', '', 'ongoing', ?, ?, 1)`
      )
      .run(NOW, NOW)
    source
      .prepare(
        `INSERT INTO chapters (
           id, book_id, title, content, position, created_at, updated_at, word_count
         ) VALUES ('marked-one', 'book-marks', 'One', 'Prose', 0, ?, ?, 1)`
      )
      .run(NOW, NOW)
    source
      .prepare(
        `INSERT INTO chapter_anchors (id, chapter_id, fallback_location, created_at, updated_at)
         VALUES ('mark-anchor', 'marked-one', 0.4, ?, ?)`
      )
      .run(NOW, NOW)
    source
      .prepare(
        `INSERT INTO bookmarks (
           id, book_id, chapter_id, location, note, anchor_id, label, color, created_at,
           updated_at
         ) VALUES
           ('mark-1', 'book-marks', 'marked-one', 0.4, 'Reread', 'mark-anchor', 'The storm',
             'green', ?, ?),
           ('mark-old', 'book-marks', 'marked-one', 0.9, '', NULL, '', 'gold', ?, NULL)`
      )
      .run(NOW, NOW, NOW)

    const sourceEngine = new DesktopSyncEngine(source, provider, PROFILE_ID, DEVICE_A, key, 1)
    await sourceEngine.run()
    const target = await databaseWithProfile(DEVICE_B)
    const targetEngine = new DesktopSyncEngine(target, provider, PROFILE_ID, DEVICE_B, key, 1)
    await targetEngine.run()

    const readMarks = (database: Database.Database): Array<Record<string, unknown>> =>
      database
        .prepare(
          `SELECT bm.id, bm.location, bm.label, bm.note, bm.color, bm.deleted_at,
             anchor.fallback_location
           FROM bookmarks bm JOIN chapter_anchors anchor ON anchor.id = bm.anchor_id
           ORDER BY bm.id`
        )
        .all() as Array<Record<string, unknown>>
    expect(readMarks(target)).toEqual([
      {
        id: 'mark-1',
        location: 0.4,
        label: 'The storm',
        note: 'Reread',
        color: 'green',
        deleted_at: null,
        fallback_location: 0.4
      },
      {
        id: 'mark-old',
        location: 0.9,
        label: '',
        note: '',
        color: 'gold',
        deleted_at: null,
        fallback_location: 0.9
      }
    ])
    expect((await sourceEngine.run()).pushed).toBe(0)
    expect((await targetEngine.run()).pushed).toBe(0)

    target
      .prepare(
        `UPDATE bookmarks SET deleted_at = ?, updated_at = ?, row_version = row_version + 1
         WHERE id = 'mark-1'`
      )
      .run('2026-08-06T21:00:00.000Z', '2026-08-06T21:00:00.000Z')
    target
      .prepare(
        `UPDATE chapter_anchors SET deleted_at = ?, row_version = row_version + 1
         WHERE id = 'mark-anchor'`
      )
      .run('2026-08-06T21:00:00.000Z')
    await targetEngine.run()
    await sourceEngine.run()
    expect(
      source.prepare(`SELECT deleted_at FROM bookmarks WHERE id = 'mark-1'`).pluck().get()
    ).toBe('2026-08-06T21:00:00.000Z')
    expect((await sourceEngine.run()).pushed).toBe(0)
    expect((await targetEngine.run()).pushed).toBe(0)
  })

  it('applies a chapter reorder and keeps text replaced by another device as a revision', async () => {
    const provider = new MemoryProvider()
    const key = Uint8Array.from({ length: 32 }, (_, index) => index + 13)
    const source = await databaseWithProfile(DEVICE_A)
    source
      .prepare(
        `INSERT INTO books (id, title, blurb, status, created_at, updated_at, total_word_count)
         VALUES ('book-order', 'Ordered', '', 'ongoing', ?, ?, 3)`
      )
      .run(NOW, NOW)
    for (const [index, id] of ['first', 'second', 'third'].entries()) {
      source
        .prepare(
          `INSERT INTO chapters (
             id, book_id, title, content, position, created_at, updated_at, word_count
           ) VALUES (?, 'book-order', ?, ?, ?, ?, ?, 1)`
        )
        .run(id, id, `Text of ${id}`, index, NOW, NOW)
    }
    const sourceEngine = new DesktopSyncEngine(source, provider, PROFILE_ID, DEVICE_A, key, 1)
    await sourceEngine.run()
    const target = await databaseWithProfile(DEVICE_B)
    const targetEngine = new DesktopSyncEngine(target, provider, PROFILE_ID, DEVICE_B, key, 1)
    await targetEngine.run()

    // Reversed the way the desktop and phone reorder: shift every position out of the way,
    // then number the new order.
    source.prepare(`UPDATE chapters SET position = position + 10`).run()
    for (const [position, id] of ['third', 'second', 'first'].entries()) {
      source
        .prepare(`UPDATE chapters SET position = ?, row_version = row_version + 1 WHERE id = ?`)
        .run(position, id)
    }
    source
      .prepare(
        `UPDATE chapters SET content = 'Rewritten.', row_version = row_version + 1
         WHERE id = 'second'`
      )
      .run()
    await sourceEngine.run()
    await targetEngine.run()

    expect(
      target
        .prepare(`SELECT id FROM chapters WHERE book_id = 'book-order' ORDER BY position`)
        .pluck()
        .all()
    ).toEqual(['third', 'second', 'first'])
    const revision = target
      .prepare(`SELECT title, reason, content_blob FROM chapter_revisions WHERE chapter_id = ?`)
      .get('second') as { title: string; reason: string; content_blob: Buffer }
    expect(revision).toMatchObject({
      title: 'second',
      reason: 'Before an edit from another device'
    })
    expect(gunzipSync(revision.content_blob).toString()).toBe('Text of second')
    expect((await targetEngine.run()).pushed).toBe(0)
  })

  it('accepts a book and chapter written by the phone', async () => {
    const target = await databaseWithProfile(DEVICE_B)
    // The shape the phone's sync store sends for a book it created.
    applyLocalSyncEntity(target, LIBRARY_ID, 'book', 'phone-book', 'upsert', {
      id: 'phone-book',
      title: 'Written on the train',
      blurb: '',
      status: 'ongoing',
      created_at: NOW,
      updated_at: NOW,
      last_opened_at: null,
      completed_at: null,
      total_word_count: 4,
      is_archived: 0,
      deleted_at: null,
      row_version: 1,
      subtitle: '',
      author_name: 'Jack',
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
      library_id: LIBRARY_ID
    })
    applyLocalSyncEntity(target, LIBRARY_ID, 'chapter', 'phone-chapter', 'upsert', {
      id: 'phone-chapter',
      book_id: 'phone-book',
      title: 'Chapter 1',
      content: 'Four words right here.',
      position: 0,
      created_at: NOW,
      updated_at: NOW,
      word_count: 4,
      deleted_at: null,
      trashed_from_position: null,
      row_version: 1
    })
    expect(
      target
        .prepare(
          `SELECT b.title, bl.library_id, c.title AS chapter FROM books b
           JOIN book_libraries bl ON bl.book_id = b.id JOIN chapters c ON c.book_id = b.id
           WHERE b.id = 'phone-book'`
        )
        .get()
    ).toEqual({ title: 'Written on the train', library_id: LIBRARY_ID, chapter: 'Chapter 1' })
  })

  it('skips record types this version does not understand instead of failing', async () => {
    const provider = new MemoryProvider()
    const key = Uint8Array.from({ length: 32 }, (_, index) => index + 11)
    const source = await databaseWithProfile(DEVICE_A)
    source
      .prepare(
        `INSERT INTO books (id, title, blurb, status, created_at, updated_at, total_word_count)
         VALUES ('book-known', 'Known', '', 'ongoing', ?, ?, 0)`
      )
      .run(NOW, NOW)
    await new DesktopSyncEngine(source, provider, PROFILE_ID, DEVICE_A, key, 1).run()
    provider.changes.unshift({
      ...provider.changes[0],
      mutationId: '99999999-9999-4999-8999-999999999999',
      entityType: 'story-entity',
      entityId: 'from-a-newer-version'
    })
    provider.changes.forEach((change, index) => (change.remoteRevision = String(index + 1)))

    const target = await databaseWithProfile(DEVICE_B)
    await expect(
      new DesktopSyncEngine(target, provider, PROFILE_ID, DEVICE_B, key, 1).run()
    ).resolves.toMatchObject({ pushed: 0 })
    expect(target.prepare(`SELECT title FROM books WHERE id = 'book-known'`).pluck().get()).toBe(
      'Known'
    )
  })

  it('sends a book moved to Trash, and restored from it, to other devices', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'storybound-sync-trash-'))
    temporaryDirectories.push(directory)
    const store = await StoryboundStore.open(directory)
    const book = store.createBook({ title: 'Trash Me' })
    const versionOf = (): number =>
      store
        .syncDatabase()
        .prepare('SELECT row_version FROM books WHERE id = ?')
        .pluck()
        .get(book.id) as number
    const before = versionOf()
    store.trashBook(book.id)
    expect(versionOf()).toBe(before + 1)
    const trashed = listLocalSyncEntities(store.syncDatabase(), LIBRARY_ID).find(
      (entity) => entity.entityId === book.id
    )!
    expect(trashed.deleted).toBe(true)
    store.restoreBook(book.id)
    expect(versionOf()).toBe(before + 2)
    store.close()
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
