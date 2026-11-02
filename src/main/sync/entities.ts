import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SyncEntityType } from '@storybound/contracts'
import { managedCoverPath, safeRemoveManagedCover } from '../coverFiles'
import { StoryboundError } from '../errors'

export const DESKTOP_SYNC_ENTITY_TYPES = [
  'library',
  'book',
  'chapter',
  'reading-state',
  'media-asset'
] as const satisfies readonly SyncEntityType[]

export function isDesktopSyncEntityType(value: string): value is DesktopSyncEntityType {
  return (DESKTOP_SYNC_ENTITY_TYPES as readonly string[]).includes(value)
}

/** Book covers sync as `media-asset` records keyed by this prefix plus the book id. */
export const BOOK_COVER_PREFIX = 'book-cover:'
const COVER_MIME_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp'
} as const
const MAX_SYNCED_COVER_BYTES = 15 * 1024 * 1024

export interface EncodedCover {
  mimeType: keyof typeof COVER_MIME_TYPES
  data: Buffer
}

/** How this device reads and writes cover images; absent where covers cannot be handled. */
export interface SyncMediaOptions {
  mediaPath: string
  /** Shrinks a cover image file for sync. */
  encodeCover(path: string): EncodedCover
}

export type DesktopSyncEntityType = (typeof DESKTOP_SYNC_ENTITY_TYPES)[number]

export interface LocalSyncEntity {
  libraryId: string
  entityType: DesktopSyncEntityType
  entityId: string
  rowVersion: number
  changedAt: string
  deleted: boolean
  value: Record<string, unknown>
  /** Builds the payload only when the record is actually sent (covers are expensive). */
  load?: (media: SyncMediaOptions) => Record<string, unknown>
}

const LIBRARY_COLUMNS = [
  'id',
  'name',
  'description',
  'created_at',
  'updated_at',
  'deleted_at',
  'row_version'
] as const

const BOOK_COLUMNS = [
  'id',
  'title',
  'blurb',
  'status',
  'created_at',
  'updated_at',
  'last_opened_at',
  'completed_at',
  'total_word_count',
  'is_archived',
  'deleted_at',
  'row_version',
  'subtitle',
  'author_name',
  'language_code',
  'source_label',
  'source_url',
  'personal_notes',
  'rating',
  'favourited_at',
  'pinned_at',
  'series_name',
  'series_position',
  'cover_style',
  'cover_position_x',
  'cover_position_y'
] as const

/**
 * Book payloads name their library. Books do not store it themselves (book_libraries does), so a
 * future "move to library" must also bump the book's row_version for the move to sync.
 * Payloads from older versions lack it and fall back to the profile's library.
 */
const BOOK_LIBRARY_KEY = 'library_id'

const CHAPTER_COLUMNS = [
  'id',
  'book_id',
  'title',
  'content',
  'position',
  'created_at',
  'updated_at',
  'word_count',
  'deleted_at',
  'trashed_from_position',
  'row_version'
] as const

const READING_COLUMNS = [
  'book_id',
  'chapter_id',
  'scroll_position',
  'progress_percentage',
  'last_read_at',
  'has_finished_current_content',
  'updated_at',
  'row_version',
  'device_id'
] as const

function selectColumns(columns: readonly string[], prefix?: string): string {
  return columns.map((column) => (prefix ? `${prefix}.${column}` : column)).join(', ')
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new StoryboundError('VALIDATION_ERROR', 'The decrypted sync record is invalid.')
  }
  return value as Record<string, unknown>
}

function requireString(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new StoryboundError('VALIDATION_ERROR', `The synced ${key} is invalid.`)
  }
  return value
}

function requirePositiveVersion(row: Record<string, unknown>): number {
  const value = row.row_version
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new StoryboundError('VALIDATION_ERROR', 'The synced row version is invalid.')
  }
  return value
}

function boundedRecord(
  value: unknown,
  columns: readonly string[],
  expectedIdKey: string,
  expectedId: string
): Record<string, unknown> {
  const input = asRecord(value)
  if (requireString(input, expectedIdKey) !== expectedId) {
    throw new StoryboundError('VALIDATION_ERROR', 'The synced record identifier does not match.')
  }
  requirePositiveVersion(input)
  return Object.fromEntries(columns.map((column) => [column, input[column] ?? null]))
}

function upsert(
  database: Database.Database,
  table: string,
  row: Record<string, unknown>,
  columns: readonly string[],
  conflictColumn: string,
  preserveOnUpdate: readonly string[] = []
): void {
  const preserve = new Set(preserveOnUpdate)
  const updateColumns = columns.filter(
    (column) => column !== conflictColumn && !preserve.has(column)
  )
  database
    .prepare(
      `INSERT INTO ${table} (${columns.join(', ')})
       VALUES (${columns.map(() => '?').join(', ')})
       ON CONFLICT(${conflictColumn}) DO UPDATE SET
       ${updateColumns.map((column) => `${column} = excluded.${column}`).join(', ')}`
    )
    .run(...columns.map((column) => row[column]))
}

/**
 * Every library, book, chapter, and reading position on this device. The vault holds the whole
 * library collection; `scopeLibraryId` is only the profile's bookkeeping key for outbox and
 * entity-state rows, not a filter. Each book carries `library_id` so receivers file it correctly.
 */
export function listLocalSyncEntities(
  database: Database.Database,
  scopeLibraryId: string
): LocalSyncEntity[] {
  const libraries = database
    .prepare(`SELECT ${selectColumns(LIBRARY_COLUMNS)} FROM libraries`)
    .all() as Array<Record<string, unknown>>
  const books = database
    .prepare(
      `SELECT ${selectColumns(BOOK_COLUMNS, 'b')}, bl.library_id AS ${BOOK_LIBRARY_KEY}
       FROM books b
       JOIN book_libraries bl ON bl.book_id = b.id`
    )
    .all() as Array<Record<string, unknown>>
  const chapters = database
    .prepare(
      `SELECT ${selectColumns(CHAPTER_COLUMNS, 'c')}
       FROM chapters c
       JOIN book_libraries bl ON bl.book_id = c.book_id`
    )
    .all() as Array<Record<string, unknown>>
  const reading = database
    .prepare(
      `SELECT ${selectColumns(READING_COLUMNS, 'r')}
       FROM reading_states r
       JOIN book_libraries bl ON bl.book_id = r.book_id`
    )
    .all() as Array<Record<string, unknown>>

  const covers = database
    .prepare(
      `SELECT id, cover_image_path, cover_version, updated_at FROM books WHERE cover_version > 0`
    )
    .all() as Array<{
    id: string
    cover_image_path: string | null
    cover_version: number
    updated_at: string
  }>

  return [
    ...libraries.map((value) => localEntity(scopeLibraryId, 'library', 'id', value)),
    ...books.map((value) => localEntity(scopeLibraryId, 'book', 'id', value)),
    ...chapters.map((value) => localEntity(scopeLibraryId, 'chapter', 'id', value)),
    ...reading.map((value) => localEntity(scopeLibraryId, 'reading-state', 'book_id', value)),
    ...covers.map((cover): LocalSyncEntity => ({
      libraryId: scopeLibraryId,
      entityType: 'media-asset',
      entityId: `${BOOK_COVER_PREFIX}${cover.id}`,
      rowVersion: cover.cover_version,
      changedAt: cover.updated_at,
      deleted: cover.cover_image_path === null,
      // A removed cover is sent as a deletion dated when the book last changed.
      value: {
        book_id: cover.id,
        row_version: cover.cover_version,
        deleted_at: cover.cover_image_path === null ? cover.updated_at : null
      },
      load: (media) => {
        const path = cover.cover_image_path
          ? managedCoverPath(media.mediaPath, cover.cover_image_path)
          : null
        if (!path) throw new StoryboundError('FILE_ERROR', 'The cover image file is missing.')
        const encoded = media.encodeCover(path)
        return {
          book_id: cover.id,
          mime_type: encoded.mimeType,
          data: encoded.data.toString('base64'),
          row_version: cover.cover_version
        }
      }
    }))
  ]
}

function applyCover(
  database: Database.Database,
  bookId: string,
  operation: 'upsert' | 'delete',
  value: Record<string, unknown>,
  media: SyncMediaOptions
): number {
  const rowVersion =
    operation === 'delete'
      ? typeof value.rowVersion === 'number'
        ? value.rowVersion
        : 1
      : requirePositiveVersion(value)
  const current = database
    .prepare('SELECT cover_image_path FROM books WHERE id = ?')
    .get(bookId) as { cover_image_path: string | null } | undefined
  if (!current) return rowVersion

  let filename: string | null = null
  if (operation === 'upsert') {
    if (requireString(value, 'book_id') !== bookId) {
      throw new StoryboundError('VALIDATION_ERROR', 'The synced cover does not match its book.')
    }
    const extension = COVER_MIME_TYPES[value.mime_type as keyof typeof COVER_MIME_TYPES]
    const data = Buffer.from(requireString(value, 'data'), 'base64')
    if (!extension || data.length === 0 || data.length > MAX_SYNCED_COVER_BYTES) {
      throw new StoryboundError('VALIDATION_ERROR', 'The synced cover image is invalid.')
    }
    filename = `${randomUUID()}${extension}`
    writeFileSync(join(media.mediaPath, filename), data, { flag: 'wx' })
  }
  // cover_version follows the sender so this device does not send the same cover back.
  database
    .prepare('UPDATE books SET cover_image_path = ?, cover_version = ? WHERE id = ?')
    .run(filename, rowVersion, bookId)
  if (current.cover_image_path) safeRemoveManagedCover(media.mediaPath, current.cover_image_path)
  return rowVersion
}

function localEntity(
  libraryId: string,
  entityType: DesktopSyncEntityType,
  idKey: string,
  value: Record<string, unknown>
): LocalSyncEntity {
  const entityId = requireString(value, idKey)
  const rowVersion = requirePositiveVersion(value)
  const changedAtValue = value.updated_at ?? value.last_read_at ?? value.created_at
  const changedAt = typeof changedAtValue === 'string' ? changedAtValue : new Date(0).toISOString()
  return {
    libraryId,
    entityType,
    entityId,
    rowVersion,
    changedAt,
    deleted: typeof value.deleted_at === 'string',
    value
  }
}

export function applyLocalSyncEntity(
  database: Database.Database,
  libraryId: string,
  entityType: string,
  entityId: string,
  operation: 'upsert' | 'delete',
  decryptedValue: unknown,
  media: SyncMediaOptions | null = null
): number {
  if (!isDesktopSyncEntityType(entityType)) {
    throw new StoryboundError('VALIDATION_ERROR', `Unsupported synced entity: ${entityType}`)
  }

  const value = asRecord(decryptedValue)
  if (entityType === 'media-asset') {
    if (!entityId.startsWith(BOOK_COVER_PREFIX) || !media) {
      throw new StoryboundError('VALIDATION_ERROR', `Unsupported synced media: ${entityId}`)
    }
    return applyCover(database, entityId.slice(BOOK_COVER_PREFIX.length), operation, value, media)
  }
  if (operation === 'delete') {
    const deletedAt =
      typeof value.deletedAt === 'string' ? value.deletedAt : new Date().toISOString()
    if (entityType === 'reading-state') {
      database.prepare('DELETE FROM reading_states WHERE book_id = ?').run(entityId)
      return 1
    }
    const table = { library: 'libraries', book: 'books', chapter: 'chapters' }[
      entityType as 'library' | 'book' | 'chapter'
    ]
    database.prepare(`UPDATE ${table} SET deleted_at = ? WHERE id = ?`).run(deletedAt, entityId)
    return typeof value.rowVersion === 'number' ? value.rowVersion : 1
  }

  if (entityType === 'library') {
    const row = boundedRecord(value, LIBRARY_COLUMNS, 'id', entityId)
    upsert(database, 'libraries', row, LIBRARY_COLUMNS, 'id')
    return requirePositiveVersion(row)
  }
  if (entityType === 'book') {
    const row = boundedRecord(value, BOOK_COLUMNS, 'id', entityId)
    const named = value[BOOK_LIBRARY_KEY]
    const targetLibraryId = typeof named === 'string' && named.length > 0 ? named : libraryId
    // The library record normally arrives first; if not, hold the book in a placeholder that the
    // library's own record overwrites when it lands.
    database
      .prepare(
        `INSERT OR IGNORE INTO libraries (id, name, description, created_at, updated_at)
         VALUES (?, 'Synced library', '', ?, ?)`
      )
      .run(targetLibraryId, new Date(0).toISOString(), new Date(0).toISOString())
    upsert(database, 'books', row, BOOK_COLUMNS, 'id')
    const now = requireString(row, 'updated_at')
    database
      .prepare(
        `INSERT INTO book_libraries (
           id, book_id, library_id, created_at, updated_at, deleted_at, row_version
         ) VALUES (?, ?, ?, ?, ?, NULL, 1)
         ON CONFLICT(book_id) DO UPDATE SET
           library_id = excluded.library_id, updated_at = excluded.updated_at, deleted_at = NULL`
      )
      .run(entityId, entityId, targetLibraryId, requireString(row, 'created_at'), now)
    return requirePositiveVersion(row)
  }
  if (entityType === 'chapter') {
    const row = boundedRecord(value, CHAPTER_COLUMNS, 'id', entityId)
    upsert(database, 'chapters', row, CHAPTER_COLUMNS, 'id')
    return requirePositiveVersion(row)
  }

  const row = boundedRecord(value, READING_COLUMNS, 'book_id', entityId)
  upsert(database, 'reading_states', row, READING_COLUMNS, 'book_id')
  return requirePositiveVersion(row)
}
