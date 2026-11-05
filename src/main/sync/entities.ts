import type Database from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import type { SyncEntityType } from '@storybound/contracts'
import { managedCoverPath, safeRemoveManagedCover } from '../coverFiles'
import { StoryboundError } from '../errors'

export const DESKTOP_SYNC_ENTITY_TYPES = [
  'library',
  'book',
  'chapter',
  'reading-state',
  'media-asset',
  'annotation',
  'bookmark'
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
 * Who a shared book came from, and whether it is locked. They are optional in a book record so
 * that a record from an older version, which knows nothing of them, leaves them as they are.
 */
const BOOK_SHARE_COLUMNS = [
  'share_id',
  'share_sender_name',
  'share_sender_address',
  'share_mode',
  'share_sequence'
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

/**
 * A highlight, note, or bookmark travels as one record with its anchor (where it sits in the
 * chapter) folded in. Its version is its own row's plus the anchor's, so moving the anchor
 * (chapter split or merge) also syncs; receivers store the anchor at version 1 to keep the sum.
 */
const ANNOTATION_KINDS = new Set(['highlight', 'note'])
const ANCHOR_STATUSES = new Set(['resolved', 'approximate', 'unresolved'])
const MAX_ANNOTATION_TEXT = 100_000

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
 * Every library, book, chapter, reading position, cover, highlight, and bookmark on this device. The vault holds the whole
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
      `SELECT ${selectColumns([...BOOK_COLUMNS, ...BOOK_SHARE_COLUMNS], 'b')},
         bl.library_id AS ${BOOK_LIBRARY_KEY}
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

  const annotations = database
    .prepare(
      `SELECT a.id, a.book_id, anchor.chapter_id, a.anchor_id, a.kind, a.body, a.color,
         a.created_at, MAX(a.updated_at, anchor.updated_at) AS updated_at,
         COALESCE(a.deleted_at, anchor.deleted_at) AS deleted_at,
         anchor.start_offset, anchor.end_offset, anchor.fallback_location, anchor.quote,
         anchor.prefix, anchor.suffix, anchor.content_hash, anchor.resolution_status,
         a.row_version + anchor.row_version AS row_version
       FROM annotations a
       JOIN chapter_anchors anchor ON anchor.id = a.anchor_id
       JOIN book_libraries bl ON bl.book_id = a.book_id`
    )
    .all() as Array<Record<string, unknown>>

  // Bookmarks from before anchors existed may lack one; it then counts as version 1 and is
  // created on the receiving side under the bookmark's own id.
  const bookmarks = database
    .prepare(
      `SELECT bm.id, bm.book_id, bm.chapter_id, COALESCE(bm.anchor_id, bm.id) AS anchor_id,
         bm.location, bm.note, bm.label, bm.color, bm.created_at,
         MAX(COALESCE(bm.updated_at, bm.created_at), COALESCE(anchor.updated_at, '')) AS updated_at,
         COALESCE(bm.deleted_at, anchor.deleted_at) AS deleted_at,
         anchor.start_offset, anchor.end_offset,
         COALESCE(anchor.fallback_location, bm.location) AS fallback_location,
         COALESCE(anchor.quote, '') AS quote, COALESCE(anchor.prefix, '') AS prefix,
         COALESCE(anchor.suffix, '') AS suffix, COALESCE(anchor.content_hash, '') AS content_hash,
         COALESCE(anchor.resolution_status, 'approximate') AS resolution_status,
         bm.row_version + COALESCE(anchor.row_version, 1) AS row_version
       FROM bookmarks bm
       LEFT JOIN chapter_anchors anchor ON anchor.id = bm.anchor_id
       JOIN book_libraries bl ON bl.book_id = bm.book_id`
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
    ...annotations.map((value) => localEntity(scopeLibraryId, 'annotation', 'id', value)),
    ...bookmarks.map((value) => localEntity(scopeLibraryId, 'bookmark', 'id', value)),
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

function optionalText(row: Record<string, unknown>, key: string, maximum: number): string {
  const value = row[key] ?? ''
  if (typeof value !== 'string' || value.length > maximum) {
    throw new StoryboundError('VALIDATION_ERROR', `The synced ${key} is invalid.`)
  }
  return value
}

function optionalOffset(row: Record<string, unknown>, key: string): number | null {
  const value = row[key]
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new StoryboundError('VALIDATION_ERROR', `The synced ${key} is invalid.`)
  }
  return value
}

type AnchoredTable = 'annotations' | 'bookmarks'

/** A deleted highlight or bookmark keeps the sender's version split as anchor 1 plus the rest. */
function deleteAnchored(
  database: Database.Database,
  table: AnchoredTable,
  id: string,
  value: Record<string, unknown>
): number {
  const rowVersion = typeof value.rowVersion === 'number' ? value.rowVersion : 2
  const deletedAt = typeof value.deletedAt === 'string' ? value.deletedAt : new Date().toISOString()
  const ownVersion = Math.max(1, rowVersion - 1)
  const existing = database.prepare(`SELECT anchor_id FROM ${table} WHERE id = ?`).get(id) as
    { anchor_id: string | null } | undefined
  if (!existing) return ownVersion + 1
  database
    .prepare(
      `UPDATE chapter_anchors SET deleted_at = COALESCE(deleted_at, ?), row_version = 1
       WHERE id = ?`
    )
    .run(deletedAt, existing.anchor_id)
  database
    .prepare(
      `UPDATE ${table} SET deleted_at = COALESCE(deleted_at, ?), row_version = ? WHERE id = ?`
    )
    .run(deletedAt, ownVersion, id)
  return ownVersion + 1
}

interface SyncedAnchored {
  rowVersion: number
  bookId: string
  chapterId: string
  anchorId: string
  color: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

/**
 * Validates the fields a highlight and a bookmark share and writes the anchor. Returns null when
 * the chapter has not arrived: the anchor has nowhere to live, so the record is left out rather
 * than failing the whole download.
 */
function upsertSyncedAnchor(
  database: Database.Database,
  table: AnchoredTable,
  id: string,
  value: Record<string, unknown>
): SyncedAnchored | null {
  if (requireString(value, 'id') !== id) {
    throw new StoryboundError('VALIDATION_ERROR', 'The synced record identifier does not match.')
  }
  const rowVersion = requirePositiveVersion(value)
  const bookId = requireString(value, 'book_id')
  const chapterId = requireString(value, 'chapter_id')
  const color = requireString(value, 'color')
  const createdAt = requireString(value, 'created_at')
  const updatedAt = requireString(value, 'updated_at')
  const deletedAt = typeof value.deleted_at === 'string' ? value.deleted_at : null
  const startOffset = optionalOffset(value, 'start_offset')
  const endOffset = optionalOffset(value, 'end_offset')
  const fallback = value.fallback_location
  const status =
    typeof value.resolution_status === 'string' && ANCHOR_STATUSES.has(value.resolution_status)
      ? value.resolution_status
      : 'approximate'
  if (
    rowVersion < 2 ||
    color.length > 40 ||
    (startOffset === null) !== (endOffset === null) ||
    (startOffset !== null && endOffset !== null && startOffset > endOffset) ||
    typeof fallback !== 'number' ||
    !(fallback >= 0 && fallback <= 1)
  ) {
    throw new StoryboundError('VALIDATION_ERROR', 'The synced reading mark is invalid.')
  }
  const quote = optionalText(value, 'quote', MAX_ANNOTATION_TEXT)
  const prefix = optionalText(value, 'prefix', 2_000)
  const suffix = optionalText(value, 'suffix', 2_000)
  const contentHash = optionalText(value, 'content_hash', 128)

  const chapter = database.prepare('SELECT book_id FROM chapters WHERE id = ?').get(chapterId) as
    { book_id: string } | undefined
  if (!chapter || chapter.book_id !== bookId) return null

  const existing = database.prepare(`SELECT anchor_id FROM ${table} WHERE id = ?`).get(id) as
    { anchor_id: string | null } | undefined
  const anchorId = existing?.anchor_id ?? requireString(value, 'anchor_id')
  database
    .prepare(
      `INSERT INTO chapter_anchors (
         id, chapter_id, start_offset, end_offset, fallback_location, quote, prefix, suffix,
         content_hash, resolution_status, created_at, updated_at, deleted_at, row_version
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(id) DO UPDATE SET
         chapter_id = excluded.chapter_id, start_offset = excluded.start_offset,
         end_offset = excluded.end_offset, fallback_location = excluded.fallback_location,
         quote = excluded.quote, prefix = excluded.prefix, suffix = excluded.suffix,
         content_hash = excluded.content_hash, resolution_status = excluded.resolution_status,
         updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, row_version = 1`
    )
    .run(
      anchorId,
      chapterId,
      startOffset,
      endOffset,
      fallback,
      quote,
      prefix,
      suffix,
      contentHash,
      status,
      createdAt,
      updatedAt,
      deletedAt
    )
  return { rowVersion, bookId, chapterId, anchorId, color, createdAt, updatedAt, deletedAt }
}

function applyAnnotation(
  database: Database.Database,
  annotationId: string,
  operation: 'upsert' | 'delete',
  value: Record<string, unknown>
): number {
  if (operation === 'delete') return deleteAnchored(database, 'annotations', annotationId, value)
  const kind = requireString(value, 'kind')
  if (!ANNOTATION_KINDS.has(kind)) {
    throw new StoryboundError('VALIDATION_ERROR', 'The synced annotation is invalid.')
  }
  const body = optionalText(value, 'body', MAX_ANNOTATION_TEXT)
  const synced = upsertSyncedAnchor(database, 'annotations', annotationId, value)
  if (!synced) return requirePositiveVersion(value)
  database
    .prepare(
      `INSERT INTO annotations (
         id, book_id, anchor_id, kind, body, color, created_at, updated_at, deleted_at,
         row_version
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         anchor_id = excluded.anchor_id, kind = excluded.kind, body = excluded.body,
         color = excluded.color, updated_at = excluded.updated_at,
         deleted_at = excluded.deleted_at, row_version = excluded.row_version`
    )
    .run(
      annotationId,
      synced.bookId,
      synced.anchorId,
      kind,
      body,
      synced.color,
      synced.createdAt,
      synced.updatedAt,
      synced.deletedAt,
      synced.rowVersion - 1
    )
  return synced.rowVersion
}

function applyBookmark(
  database: Database.Database,
  bookmarkId: string,
  operation: 'upsert' | 'delete',
  value: Record<string, unknown>
): number {
  if (operation === 'delete') return deleteAnchored(database, 'bookmarks', bookmarkId, value)
  const location = value.location
  if (typeof location !== 'number' || !(location >= 0 && location <= 1)) {
    throw new StoryboundError('VALIDATION_ERROR', 'The synced bookmark is invalid.')
  }
  const note = optionalText(value, 'note', 10_000)
  const label = optionalText(value, 'label', 240)
  const synced = upsertSyncedAnchor(database, 'bookmarks', bookmarkId, value)
  if (!synced) return requirePositiveVersion(value)
  database
    .prepare(
      `INSERT INTO bookmarks (
         id, book_id, chapter_id, location, note, anchor_id, label, color, created_at,
         updated_at, deleted_at, row_version
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         chapter_id = excluded.chapter_id, location = excluded.location, note = excluded.note,
         anchor_id = excluded.anchor_id, label = excluded.label, color = excluded.color,
         updated_at = excluded.updated_at, deleted_at = excluded.deleted_at,
         row_version = excluded.row_version`
    )
    .run(
      bookmarkId,
      synced.bookId,
      synced.chapterId,
      location,
      note,
      synced.anchorId,
      label,
      synced.color,
      synced.createdAt,
      synced.updatedAt,
      synced.deletedAt,
      synced.rowVersion - 1
    )
  return synced.rowVersion
}

/**
 * Chapter positions are unique within a book, but a reorder arrives one chapter at a time, so an
 * incoming chapter can land on a position another chapter still holds. That chapter moves to a
 * spare position at the end until its own update arrives.
 */
function makeRoomForChapter(
  database: Database.Database,
  chapterId: string,
  row: Record<string, unknown>
): void {
  database
    .prepare(
      `UPDATE chapters
       SET position = (SELECT MAX(position) + 1 FROM chapters WHERE book_id = ?)
       WHERE book_id = ? AND position = ? AND id <> ?`
    )
    .run(row.book_id, row.book_id, row.position, chapterId)
}

/** Keeps the text being replaced by another device's edit in the chapter's revision history. */
function keepRevisionBeforeSync(
  database: Database.Database,
  chapterId: string,
  row: Record<string, unknown>
): void {
  const current = database
    .prepare('SELECT title, content, word_count FROM chapters WHERE id = ?')
    .get(chapterId) as { title: string; content: string; word_count: number } | undefined
  if (!current || (current.title === row.title && current.content === row.content)) return
  const contentHash = createHash('sha256')
    .update(current.title)
    .update('\u0000')
    .update(current.content)
    .digest('hex')
  const known = database
    .prepare('SELECT 1 FROM chapter_revisions WHERE chapter_id = ? AND content_hash = ?')
    .get(chapterId, contentHash)
  if (known) return
  const revisionNumber = Number(
    database
      .prepare(
        'SELECT COALESCE(MAX(revision_number), 0) + 1 FROM chapter_revisions WHERE chapter_id = ?'
      )
      .pluck()
      .get(chapterId)
  )
  database
    .prepare(
      `INSERT INTO chapter_revisions (
         id, chapter_id, revision_number, title, content_blob, content_hash, word_count, reason,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Before an edit from another device', ?)`
    )
    .run(
      randomUUID(),
      chapterId,
      revisionNumber,
      current.title,
      gzipSync(Buffer.from(current.content, 'utf8')),
      contentHash,
      current.word_count,
      new Date().toISOString()
    )
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

function applyBookShare(
  database: Database.Database,
  bookId: string,
  value: Record<string, unknown>
): void {
  if (!('share_mode' in value)) return
  const text = (key: string): string | null => {
    const field = value[key]
    if (field === null || field === undefined) return null
    if (typeof field !== 'string' || field.length > 240) {
      throw new StoryboundError('VALIDATION_ERROR', `The synced ${key} is invalid.`)
    }
    return field
  }
  const mode = text('share_mode')
  const sequence = value.share_sequence ?? 0
  if (
    (mode !== null && mode !== 'read-only' && mode !== 'editable') ||
    typeof sequence !== 'number' ||
    !Number.isInteger(sequence) ||
    sequence < 0
  ) {
    throw new StoryboundError('VALIDATION_ERROR', 'The synced share details are invalid.')
  }
  database
    .prepare(
      `UPDATE books SET share_id = ?, share_sender_name = ?, share_sender_address = ?,
         share_mode = ?, share_sequence = ? WHERE id = ?`
    )
    .run(
      text('share_id'),
      text('share_sender_name'),
      text('share_sender_address'),
      mode,
      sequence,
      bookId
    )
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
  if (entityType === 'annotation') {
    return applyAnnotation(database, entityId, operation, value)
  }
  if (entityType === 'bookmark') {
    return applyBookmark(database, entityId, operation, value)
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
    applyBookShare(database, entityId, value)
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
    keepRevisionBeforeSync(database, entityId, row)
    makeRoomForChapter(database, entityId, row)
    upsert(database, 'chapters', row, CHAPTER_COLUMNS, 'id')
    return requirePositiveVersion(row)
  }

  const row = boundedRecord(value, READING_COLUMNS, 'book_id', entityId)
  upsert(database, 'reading_states', row, READING_COLUMNS, 'book_id')
  return requirePositiveVersion(row)
}
