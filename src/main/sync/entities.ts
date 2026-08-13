import type Database from 'better-sqlite3'
import type { SyncEntityType } from '@storybound/contracts'
import { StoryboundError } from '../errors'

export const DESKTOP_SYNC_ENTITY_TYPES = [
  'library',
  'book',
  'chapter',
  'reading-state'
] as const satisfies readonly SyncEntityType[]

export type DesktopSyncEntityType = (typeof DESKTOP_SYNC_ENTITY_TYPES)[number]

export interface LocalSyncEntity {
  libraryId: string
  entityType: DesktopSyncEntityType
  entityId: string
  rowVersion: number
  changedAt: string
  deleted: boolean
  value: Record<string, unknown>
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

export function listLocalSyncEntities(
  database: Database.Database,
  libraryId: string
): LocalSyncEntity[] {
  const libraries = database
    .prepare(`SELECT ${selectColumns(LIBRARY_COLUMNS)} FROM libraries WHERE id = ?`)
    .all(libraryId) as Array<Record<string, unknown>>
  const books = database
    .prepare(
      `SELECT ${selectColumns(BOOK_COLUMNS, 'b')}
       FROM books b
       JOIN book_libraries bl ON bl.book_id = b.id
       WHERE bl.library_id = ?`
    )
    .all(libraryId) as Array<Record<string, unknown>>
  const chapters = database
    .prepare(
      `SELECT ${selectColumns(CHAPTER_COLUMNS, 'c')}
       FROM chapters c
       JOIN book_libraries bl ON bl.book_id = c.book_id
       WHERE bl.library_id = ?`
    )
    .all(libraryId) as Array<Record<string, unknown>>
  const reading = database
    .prepare(
      `SELECT ${selectColumns(READING_COLUMNS, 'r')}
       FROM reading_states r
       JOIN book_libraries bl ON bl.book_id = r.book_id
       WHERE bl.library_id = ?`
    )
    .all(libraryId) as Array<Record<string, unknown>>

  return [
    ...libraries.map((value) => localEntity(libraryId, 'library', 'id', value)),
    ...books.map((value) => localEntity(libraryId, 'book', 'id', value)),
    ...chapters.map((value) => localEntity(libraryId, 'chapter', 'id', value)),
    ...reading.map((value) => localEntity(libraryId, 'reading-state', 'book_id', value))
  ]
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
  decryptedValue: unknown
): number {
  if (!DESKTOP_SYNC_ENTITY_TYPES.includes(entityType as DesktopSyncEntityType)) {
    throw new StoryboundError('VALIDATION_ERROR', `Unsupported synced entity: ${entityType}`)
  }

  const value = asRecord(decryptedValue)
  if (operation === 'delete') {
    const deletedAt =
      typeof value.deletedAt === 'string' ? value.deletedAt : new Date().toISOString()
    if (entityType === 'reading-state') {
      database.prepare('DELETE FROM reading_states WHERE book_id = ?').run(entityId)
      return 1
    }
    const table = { library: 'libraries', book: 'books', chapter: 'chapters' }[entityType]
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
      .run(entityId, entityId, libraryId, requireString(row, 'created_at'), now)
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
