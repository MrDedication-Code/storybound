import AdmZip from 'adm-zip'
import Database from 'better-sqlite3'
import {
  copyFileSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { z } from 'zod'
import {
  bookPackageManifestSchema,
  createBookPackageManifest,
  createLibraryBackupManifest,
  libraryBackupManifestSchema
} from '../shared/portable'
import { mergeChapterContent, reorderByIds, splitContentAtOffset } from '../shared/library'
import { countWords, createExcerpt, detectChapterSplits, normalizeSearch } from '../shared/text'
import type {
  AnchorInput,
  Annotation,
  ApplicationSettings,
  BackupPlan,
  BackupRun,
  BackupScheduleInput,
  BookDetail,
  Bookmark,
  BookSummary,
  Collection,
  Chapter,
  ChapterRevision,
  ChapterSummary,
  ChapterTrashItem,
  CreateAnnotationInput,
  CreateBookInput,
  CreateBookmarkInput,
  CreateChapterInput,
  CreateCollectionInput,
  CreateLibraryInput,
  CreateSavedFilterInput,
  CreateStoryEntityChapterLinkInput,
  CreateStoryEntityInput,
  CreateStoryEntityRelationInput,
  CreateTagInput,
  CreateWritingGoalInput,
  IntegrityResult,
  LibraryQuery,
  Library,
  LocateSearchHitInput,
  MergeChapterInput,
  OperationResult,
  ReadingState,
  RecoveryDraft,
  ReorderChaptersInput,
  RestoreChapterRevisionInput,
  SaveReadingStateInput,
  SaveRecoveryDraftInput,
  SavedFilter,
  SearchResult,
  SearchHit,
  SplitCandidate,
  SplitChapterInput,
  SetBookRelationsInput,
  StoryEntity,
  StoryEntityChapterLink,
  StoryEntityQuery,
  StoryEntityRelation,
  StoryEntityRelationQuery,
  StoryEntityType,
  Tag,
  UpdateBookInput,
  UpdateAnnotationInput,
  UpdateBackupPlanInput,
  UpdateBookmarkInput,
  UpdateChapterInput,
  UpdateCollectionInput,
  UpdateLibraryInput,
  UpdateSavedFilterInput,
  UpdateStoryEntityChapterLinkInput,
  UpdateStoryEntityInput,
  UpdateStoryEntityRelationInput,
  UpdateTagInput,
  UpdateWritingGoalInput,
  VersionedIdInput,
  WritingBookStats,
  WritingDayStats,
  WritingGoal,
  WritingGoalProgress,
  WritingStats,
  WritingStatsQuery
} from '../shared/types'
import {
  anchorInputSchema,
  backupScheduleSchema,
  createAnnotationSchema,
  createBookSchema,
  createBookmarkSchema,
  createChapterSchema,
  createCollectionSchema,
  createLibrarySchema,
  createSavedFilterSchema,
  createStoryEntityChapterLinkSchema,
  createStoryEntityRelationSchema,
  createStoryEntitySchema,
  createTagSchema,
  createWritingGoalSchema,
  idSchema,
  libraryQuerySchema,
  locateSearchHitSchema,
  mergeChapterSchema,
  reorderChaptersSchema,
  restoreChapterRevisionSchema,
  saveReadingStateSchema,
  saveRecoveryDraftSchema,
  searchTermSchema,
  setBookRelationsSchema,
  settingsUpdateSchema,
  splitCandidateSchema,
  splitChapterSchema,
  storyEntityDetailsSchema,
  storyEntityQuerySchema,
  storyEntityRelationQuerySchema,
  updateAnnotationSchema,
  updateBackupPlanSchema,
  updateBookSchema,
  updateBookmarkSchema,
  updateChapterSchema,
  updateCollectionSchema,
  updateLibrarySchema,
  updateSavedFilterSchema,
  updateStoryEntityChapterLinkSchema,
  updateStoryEntityRelationSchema,
  updateStoryEntitySchema,
  updateTagSchema,
  updateWritingGoalSchema,
  versionedIdSchema,
  writingStatsQuerySchema
} from '../shared/validation'
import {
  LATEST_SCHEMA_VERSION,
  configureDatabase,
  createStoryboundPaths,
  migrateDatabase,
  migrations,
  openStoryboundDatabase,
  type StoryboundPaths
} from './database'
import { StoryboundError } from './errors'

const MAX_COVER_BYTES = 15 * 1024 * 1024
const MAX_IMPORT_BYTES = 512 * 1024 * 1024
const MAX_EXPORT_BYTES = 500 * 1024 * 1024
const COVER_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const RESTORE_REQUIRED_COLUMNS = {
  books: [
    'id',
    'title',
    'blurb',
    'status',
    'cover_image_path',
    'created_at',
    'updated_at',
    'last_opened_at',
    'completed_at',
    'total_word_count',
    'is_archived',
    'deleted_at'
  ],
  chapters: [
    'id',
    'book_id',
    'title',
    'content',
    'position',
    'created_at',
    'updated_at',
    'word_count'
  ],
  reading_states: [
    'book_id',
    'chapter_id',
    'scroll_position',
    'progress_percentage',
    'last_read_at',
    'has_finished_current_content'
  ],
  bookmarks: ['id', 'book_id', 'chapter_id', 'location', 'note', 'created_at'],
  application_settings: [
    'id',
    'app_theme',
    'reduced_motion',
    'has_seen_getting_started',
    'reader_theme',
    'reader_font',
    'reader_font_size',
    'line_height',
    'column_width',
    'paragraph_spacing',
    'paragraph_indentation',
    'text_alignment',
    'default_library_sort'
  ],
  recovery_drafts: ['chapter_id', 'title', 'content', 'saved_at'],
  book_search: ['book_id', 'title', 'blurb'],
  chapter_search: ['chapter_id', 'book_id', 'title', 'content']
} as const
const RESTORE_REQUIRED_TRIGGERS = new Set([
  'books_search_insert',
  'books_search_update',
  'books_search_delete',
  'chapters_search_insert',
  'chapters_search_update',
  'chapters_search_delete'
])

interface BookRow {
  id: string
  library_id: string
  title: string
  subtitle: string
  series_name: string
  series_position: number | null
  author_name: string
  blurb: string
  status: 'ongoing' | 'completed'
  language_code: string
  source_label: string
  source_url: string
  personal_notes: string
  rating: number | null
  favourited_at: string | null
  pinned_at: string | null
  cover_image_path: string | null
  cover_style: BookSummary['coverStyle']
  cover_position_x: number
  cover_position_y: number
  created_at: string
  updated_at: string
  last_opened_at: string | null
  completed_at: string | null
  total_word_count: number
  is_archived: number
  deleted_at: string | null
  chapter_count: number
  progress_percentage: number
  has_finished_current_content: number
}

interface ChapterRow {
  id: string
  book_id: string
  title: string
  content: string
  position: number
  created_at: string
  updated_at: string
  word_count: number
  deleted_at: string | null
  trashed_from_position: number | null
}

interface ChapterRevisionRow {
  id: string
  chapter_id: string
  revision_number: number
  title: string
  content_blob: Buffer
  content_hash: string
  word_count: number
  reason: string
  created_at: string
}

interface ReadingRow {
  book_id: string
  chapter_id: string | null
  scroll_position: number
  progress_percentage: number
  last_read_at: string | null
  has_finished_current_content: number
}

interface BookmarkRow {
  id: string
  book_id: string
  chapter_id: string
  chapter_title: string
  location: number
  note: string
  label: string
  color: string
  created_at: string
  updated_at: string
  row_version: number
  anchor_id: string
  anchor_chapter_id: string
  anchor_start_offset: number | null
  anchor_end_offset: number | null
  anchor_fallback_location: number
  anchor_quote: string
  anchor_prefix: string
  anchor_suffix: string
  anchor_content_hash: string
  anchor_resolution_status: Annotation['anchor']['resolutionStatus']
  anchor_created_at: string
  anchor_updated_at: string
  anchor_row_version: number
}

interface ChapterAnchorRow {
  id: string
  chapter_id: string
  start_offset: number | null
  end_offset: number | null
  fallback_location: number
  quote: string
  prefix: string
  suffix: string
  content_hash: string
  resolution_status: Annotation['anchor']['resolutionStatus']
  created_at: string
  updated_at: string
  row_version: number
}

interface AnnotationRow {
  id: string
  book_id: string
  chapter_id: string
  chapter_title: string
  kind: Annotation['kind']
  body: string
  color: string
  created_at: string
  updated_at: string
  row_version: number
  anchor_id: string
  anchor_chapter_id: string
  anchor_start_offset: number | null
  anchor_end_offset: number | null
  anchor_fallback_location: number
  anchor_quote: string
  anchor_prefix: string
  anchor_suffix: string
  anchor_content_hash: string
  anchor_resolution_status: Annotation['anchor']['resolutionStatus']
  anchor_created_at: string
  anchor_updated_at: string
  anchor_row_version: number
}

interface WritingGoalRow {
  id: string
  library_id: string
  book_id: string | null
  book_title: string | null
  metric: WritingGoal['metric']
  period: WritingGoal['period']
  target_value: number
  start_on: string
  end_on: string | null
  timezone: string
  is_active: number
  created_at: string
  updated_at: string
  row_version: number
}

interface BackupPlanRow {
  id: string
  destination_path: string
  cadence: BackupPlan['cadence']
  retention_count: number
  enabled: number
  next_run_at: string | null
  created_at: string
  updated_at: string
}

interface BackupRunRow {
  id: string
  plan_id: string
  started_at: string
  completed_at: string | null
  status: BackupRun['status']
  output_path: string | null
  byte_size: number | null
  verified_at: string | null
  error_message: string | null
}

interface SettingsRow {
  app_theme: ApplicationSettings['appTheme']
  reduced_motion: number
  has_seen_getting_started: number
  reader_theme: ApplicationSettings['readerTheme']
  reader_font: ApplicationSettings['readerFont']
  reader_font_size: number
  line_height: number
  column_width: number
  paragraph_spacing: number
  paragraph_indentation: number
  text_alignment: ApplicationSettings['textAlignment']
  default_library_sort: ApplicationSettings['defaultLibrarySort']
}

interface RecoveryRow {
  chapter_id: string
  title: string
  content: string
  saved_at: string
}

interface LibraryRow {
  id: string
  name: string
  description: string
  created_at: string
  updated_at: string
  is_active: number
  book_count: number
}

interface TagRow {
  id: string
  library_id: string
  name: string
  color: string
  created_at: string
  updated_at: string
  book_count: number
}

interface CollectionRow {
  id: string
  library_id: string
  name: string
  description: string
  color: string
  icon: string
  position: number
  created_at: string
  updated_at: string
  book_count: number
}

interface SavedFilterRow {
  id: string
  library_id: string
  name: string
  definition_json: string
  position: number
  created_at: string
  updated_at: string
}

interface StoryEntityRow {
  id: string
  book_id: string
  entity_type: StoryEntity['entityType']
  title: string
  summary: string
  body_markdown: string
  details_version: number
  details_json: string
  position: number
  created_at: string
  updated_at: string
  deleted_at: string | null
  row_version: number
}

interface StoryEntityChapterLinkRow {
  id: string
  book_id: string
  entity_id: string
  chapter_id: string
  chapter_title: string
  note: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  row_version: number
}

interface StoryEntityRelationRow {
  id: string
  book_id: string
  from_entity_id: string
  to_entity_id: string
  relationship_type: string
  label: string
  notes: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  row_version: number
}

interface SchemaObjectRow {
  type: string
  name: string
  table_name: string
  sql: string | null
}

const BOOK_SELECT = `
  SELECT b.*,
    bl.library_id,
    COUNT(c.id) AS chapter_count,
    COALESCE(rs.progress_percentage, 0) AS progress_percentage,
    COALESCE(rs.has_finished_current_content, 0) AS has_finished_current_content
  FROM books b
  JOIN book_libraries bl ON bl.book_id = b.id AND bl.deleted_at IS NULL
  LEFT JOIN chapters c ON c.book_id = b.id AND c.deleted_at IS NULL
  LEFT JOIN reading_states rs ON rs.book_id = b.id
`

const ANCHOR_SELECT = `
  anchor.id AS anchor_id,
  anchor.chapter_id AS anchor_chapter_id,
  anchor.start_offset AS anchor_start_offset,
  anchor.end_offset AS anchor_end_offset,
  anchor.fallback_location AS anchor_fallback_location,
  anchor.quote AS anchor_quote,
  anchor.prefix AS anchor_prefix,
  anchor.suffix AS anchor_suffix,
  anchor.content_hash AS anchor_content_hash,
  anchor.resolution_status AS anchor_resolution_status,
  anchor.created_at AS anchor_created_at,
  anchor.updated_at AS anchor_updated_at,
  anchor.row_version AS anchor_row_version
`

const WORD_TOKEN_PATTERN = /[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu

function now(): string {
  return new Date().toISOString()
}

function systemTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

function localDay(timestamp: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(timestamp)
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function wordDelta(before: string, after: string): { added: number; removed: number } {
  const previous = new Map<string, number>()
  for (const token of before.match(WORD_TOKEN_PATTERN) ?? []) {
    const normalized = token.toLocaleLowerCase()
    previous.set(normalized, (previous.get(normalized) ?? 0) + 1)
  }
  let added = 0
  for (const token of after.match(WORD_TOKEN_PATTERN) ?? []) {
    const normalized = token.toLocaleLowerCase()
    const available = previous.get(normalized) ?? 0
    if (available > 0) previous.set(normalized, available - 1)
    else added += 1
  }
  let removed = 0
  for (const remaining of previous.values()) removed += remaining
  return { added, removed }
}

function addUtcDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function goalPeriodRange(goal: WritingGoal, today: string): { start: string; end: string } {
  const reference =
    today < goal.startOn ? goal.startOn : (goal.endOn ?? today) < today ? goal.endOn! : today
  let start = reference
  let end = reference
  if (goal.period === 'weekly') {
    const date = new Date(`${reference}T00:00:00.000Z`)
    const dayFromMonday = (date.getUTCDay() + 6) % 7
    start = addUtcDays(reference, -dayFromMonday)
    end = addUtcDays(start, 6)
  } else if (goal.period === 'monthly') {
    start = `${reference.slice(0, 7)}-01`
    const date = new Date(`${start}T00:00:00.000Z`)
    date.setUTCMonth(date.getUTCMonth() + 1)
    end = addUtcDays(date.toISOString().slice(0, 10), -1)
  } else if (goal.period === 'project') {
    start = goal.startOn
    end = goal.endOn ?? today
  }
  if (start < goal.startOn) start = goal.startOn
  if (goal.endOn && end > goal.endOn) end = goal.endOn
  return { start, end }
}

function nextBackupRun(cadence: BackupPlan['cadence'], from = new Date()): string {
  const next = new Date(from)
  if (cadence === 'daily') next.setUTCDate(next.getUTCDate() + 1)
  else if (cadence === 'weekly') next.setUTCDate(next.getUTCDate() + 7)
  else next.setUTCMonth(next.getUTCMonth() + 1)
  return next.toISOString()
}

function boolean(value: number): boolean {
  return value === 1
}

function normalizeSchemaSql(sql: string | null): string {
  return (sql ?? '').replace(/\s+/g, ' ').trim().toLocaleLowerCase()
}

function schemaSignature(database: Database.Database): string {
  const objects = database
    .prepare(
      `SELECT type, name, tbl_name AS table_name, sql
       FROM sqlite_master
       WHERE name NOT LIKE 'sqlite_%'
       ORDER BY type, name, tbl_name`
    )
    .all() as SchemaObjectRow[]
  return JSON.stringify(
    objects.map((object) => [
      object.type,
      object.name,
      object.table_name,
      normalizeSchemaSql(object.sql)
    ])
  )
}

let expectedSchemaSignature: string | undefined

function currentSchemaSignature(): string {
  if (expectedSchemaSignature) return expectedSchemaSignature
  const reference = new Database(':memory:')
  try {
    for (const migration of migrations) reference.exec(migration.sql)
    expectedSchemaSignature = schemaSignature(reference)
    return expectedSchemaSignature
  } finally {
    reference.close()
  }
}

function safeRemove(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true })
  } catch {
    // Cleanup failures are non-fatal; the primary operation has already completed.
  }
}

function managedCoverPath(mediaDirectory: string, filename: string): string | null {
  if (
    !filename ||
    filename.includes('/') ||
    filename.includes('\\') ||
    filename.includes('\u0000') ||
    basename(filename) !== filename ||
    !COVER_EXTENSIONS.has(extname(filename).toLocaleLowerCase())
  ) {
    return null
  }
  const root = resolve(mediaDirectory)
  const candidate = resolve(root, filename)
  return dirname(candidate) === root ? candidate : null
}

function safeRemoveManagedCover(mediaDirectory: string, filename: string): void {
  const path = managedCoverPath(mediaDirectory, filename)
  if (!path) return
  try {
    rmSync(path, { force: true })
  } catch {
    // A missing or non-file cover falls back to the generated placeholder.
  }
}

function toFtsQuery(term: string): string {
  const tokens = term.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu) ?? []
  return tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(' AND ')
}

function markdownFilename(title: string, position: number): string {
  const safeTitle = title
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80)
  return `${String(position + 1).padStart(3, '0')}-${safeTitle || 'chapter'}.md`
}

function validateArchive(zip: AdmZip): void {
  let totalSize = 0
  for (const entry of zip.getEntries()) {
    const name = entry.entryName.replaceAll('\\', '/')
    if (name.startsWith('/') || name.split('/').includes('..')) {
      throw new StoryboundError(
        'IMPORT_ERROR',
        'The selected archive contains an unsafe file path.'
      )
    }
    totalSize += entry.header.size
    if (totalSize > MAX_IMPORT_BYTES) {
      throw new StoryboundError(
        'IMPORT_ERROR',
        'The selected archive is too large to import safely.'
      )
    }
  }
}

function assertPortableExportSize(zip: AdmZip, label: 'book package' | 'library backup'): void {
  const totalSize = zip
    .getEntries()
    .reduce((total, entry) => total + (entry.isDirectory ? 0 : entry.header.size), 0)
  if (totalSize > MAX_EXPORT_BYTES) {
    throw new StoryboundError(
      'FILE_ERROR',
      `This ${label} would exceed Storybound's 500 MB portable export limit and could not be restored safely. Reduce large cover images or story content, then try again.`
    )
  }
}

function coverExtension(buffer: Buffer, filename: string): string {
  const extension = extname(filename).toLocaleLowerCase()
  if (!COVER_EXTENSIONS.has(extension)) {
    throw new StoryboundError('FILE_ERROR', 'Choose a PNG, JPG, JPEG, or WebP cover image.')
  }

  const isPng =
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const isJpeg =
    buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  const isWebp =
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'

  if (
    (extension === '.png' && !isPng) ||
    ((extension === '.jpg' || extension === '.jpeg') && !isJpeg) ||
    (extension === '.webp' && !isWebp)
  ) {
    throw new StoryboundError('FILE_ERROR', 'That file does not appear to be a valid cover image.')
  }
  return extension === '.jpeg' ? '.jpg' : extension
}

function readCoverHeader(path: string): Buffer {
  const descriptor = openSync(path, 'r')
  try {
    const header = Buffer.alloc(12)
    const bytesRead = readSync(descriptor, header, 0, header.length, 0)
    return header.subarray(0, bytesRead)
  } finally {
    closeSync(descriptor)
  }
}

function parseJsonEntry(zip: AdmZip, name: string): unknown {
  const entry = zip.getEntry(name)
  if (!entry || entry.isDirectory) {
    throw new StoryboundError('IMPORT_ERROR', `The archive is missing ${name}.`)
  }
  try {
    return JSON.parse(entry.getData().toString('utf8'))
  } catch (error) {
    throw new StoryboundError('IMPORT_ERROR', `${name} is not valid JSON.`, error)
  }
}

export class StoryboundStore {
  private database: Database.Database
  readonly paths: StoryboundPaths

  private constructor(database: Database.Database, paths: StoryboundPaths) {
    this.database = database
    this.paths = paths
  }

  static async open(userDataPath: string): Promise<StoryboundStore> {
    const paths = createStoryboundPaths(userDataPath)
    const database = await openStoryboundDatabase(paths)
    return new StoryboundStore(database, paths)
  }

  close(): void {
    if (!this.database.open) return
    try {
      this.database.pragma('wal_checkpoint(TRUNCATE)')
    } finally {
      this.database.close()
    }
  }

  checkpoint(): void {
    if (this.database.open) this.database.pragma('wal_checkpoint(PASSIVE)')
  }

  listBooks(query: LibraryQuery = {}): BookSummary[] {
    const parsed = libraryQuerySchema.parse(query) ?? {}
    const clauses: string[] = ['bl.library_id = ?']
    const parameters: unknown[] = [parsed.libraryId ?? this.activeLibraryId()]

    if (!parsed.includeArchived) clauses.push('b.deleted_at IS NULL')
    if (parsed.favouriteOnly) clauses.push('b.favourited_at IS NOT NULL')
    if (parsed.pinnedOnly) clauses.push('b.pinned_at IS NOT NULL')
    if (parsed.collectionId) {
      clauses.push(`EXISTS (
        SELECT 1 FROM collection_books cb
        WHERE cb.book_id = b.id AND cb.collection_id = ? AND cb.deleted_at IS NULL
      )`)
      parameters.push(parsed.collectionId)
    }
    if (parsed.seriesName) {
      clauses.push('b.series_name = ? COLLATE NOCASE')
      parameters.push(parsed.seriesName)
    }
    if (parsed.tagIds?.length) {
      for (const tagId of parsed.tagIds) {
        clauses.push(`EXISTS (
          SELECT 1 FROM book_tags bt
          WHERE bt.book_id = b.id AND bt.tag_id = ? AND bt.deleted_at IS NULL
        )`)
        parameters.push(tagId)
      }
    }

    switch (parsed.filter ?? 'all') {
      case 'ongoing':
      case 'completed':
        clauses.push('b.status = ?')
        parameters.push(parsed.filter)
        break
      case 'unread':
        clauses.push('COALESCE(rs.progress_percentage, 0) <= 0')
        break
      case 'in-progress':
        clauses.push(
          'COALESCE(rs.progress_percentage, 0) > 0 AND COALESCE(rs.has_finished_current_content, 0) = 0'
        )
        break
      case 'finished':
        clauses.push('COALESCE(rs.has_finished_current_content, 0) = 1')
        break
      case 'all':
        break
    }

    if (parsed.search?.trim()) {
      const fts = toFtsQuery(parsed.search)
      if (!fts) return []
      clauses.push(`(
        b.id IN (SELECT book_id FROM book_search WHERE book_search MATCH ?)
        OR b.id IN (SELECT book_id FROM chapter_search WHERE chapter_search MATCH ?)
        OR b.series_name LIKE ? ESCAPE '\\'
      )`)
      const escapedSearch = parsed.search.replace(/[\\%_]/g, '\\$&')
      parameters.push(fts, fts, `%${escapedSearch}%`)
    }

    const sort = parsed.sort ?? 'recently-opened'
    const orderBy: Record<NonNullable<LibraryQuery['sort']>, string> = {
      'recently-opened': '(b.last_opened_at IS NULL), b.last_opened_at DESC, b.updated_at DESC',
      'recently-updated': 'b.updated_at DESC',
      title: 'b.title COLLATE NOCASE ASC',
      progress: 'progress_percentage DESC, b.title COLLATE NOCASE ASC',
      created: 'b.created_at DESC'
    }

    let sql = `${BOOK_SELECT}
      ${clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''}
      GROUP BY b.id
      ORDER BY ${orderBy[sort]}`

    if (parsed.limit !== undefined) {
      sql += ' LIMIT ?'
      parameters.push(parsed.limit)
      if (parsed.offset !== undefined) {
        sql += ' OFFSET ?'
        parameters.push(parsed.offset)
      }
    } else if (parsed.offset !== undefined) {
      sql += ' LIMIT -1 OFFSET ?'
      parameters.push(parsed.offset)
    }

    return (this.database.prepare(sql).all(...parameters) as BookRow[]).map((row) =>
      this.mapBook(row)
    )
  }

  getBook(id: string): BookDetail {
    const bookId = idSchema.parse(id)
    const row = this.database.prepare(`${BOOK_SELECT} WHERE b.id = ? GROUP BY b.id`).get(bookId) as
      BookRow | undefined
    if (!row) throw new StoryboundError('NOT_FOUND', 'That book could not be found.')
    return {
      ...this.mapBook(row),
      chapters: this.listChapterSummaries(bookId),
      tagIds: this.bookRelationIds('book_tags', 'tag_id', bookId),
      collectionIds: this.bookRelationIds('collection_books', 'collection_id', bookId)
    }
  }

  createBook(input: CreateBookInput): BookDetail {
    const parsed = createBookSchema.parse(input)
    const libraryId = parsed.libraryId ?? this.activeLibraryId()
    this.requireLibrary(libraryId)
    const bookId = randomUUID()
    const timestamp = now()
    const create = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO books (
            id, title, blurb, status, created_at, updated_at, completed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          bookId,
          parsed.title,
          parsed.blurb,
          parsed.status,
          timestamp,
          timestamp,
          parsed.status === 'completed' ? timestamp : null
        )
      this.database
        .prepare(
          `UPDATE book_libraries SET library_id = ?, updated_at = ?, row_version = row_version + 1
           WHERE book_id = ?`
        )
        .run(libraryId, timestamp, bookId)

      if (parsed.initialChapterTitle?.trim() || parsed.initialChapterContent) {
        const chapterId = randomUUID()
        const chapterTitle = parsed.initialChapterTitle?.trim() || 'Chapter 1'
        const content = parsed.initialChapterContent ?? ''
        this.database
          .prepare(
            `INSERT INTO chapters (
              id, book_id, title, content, position, created_at, updated_at, word_count
            ) VALUES (?, ?, ?, ?, 0, ?, ?, ?)`
          )
          .run(chapterId, bookId, chapterTitle, content, timestamp, timestamp, countWords(content))
        this.refreshBook(bookId, timestamp)
      }
    })
    create()
    return this.getBook(bookId)
  }

  updateBook(input: UpdateBookInput): BookDetail {
    const parsed = updateBookSchema.parse(input)
    this.requireBook(parsed.id)
    const assignments: string[] = []
    const values: unknown[] = []
    if (parsed.title !== undefined) {
      assignments.push('title = ?')
      values.push(parsed.title)
    }
    if (parsed.blurb !== undefined) {
      assignments.push('blurb = ?')
      values.push(parsed.blurb)
    }
    if (parsed.status !== undefined) {
      assignments.push('status = ?', 'completed_at = ?')
      values.push(parsed.status, parsed.status === 'completed' ? now() : null)
    }
    const metadataColumns = {
      subtitle: 'subtitle',
      seriesName: 'series_name',
      seriesPosition: 'series_position',
      authorName: 'author_name',
      languageCode: 'language_code',
      sourceLabel: 'source_label',
      sourceUrl: 'source_url',
      personalNotes: 'personal_notes',
      rating: 'rating',
      coverStyle: 'cover_style',
      coverPositionX: 'cover_position_x',
      coverPositionY: 'cover_position_y'
    } as const
    for (const [field, column] of Object.entries(metadataColumns) as Array<
      [keyof typeof metadataColumns, (typeof metadataColumns)[keyof typeof metadataColumns]]
    >) {
      if (parsed[field] !== undefined) {
        assignments.push(`${column} = ?`)
        values.push(parsed[field])
      }
    }
    if (parsed.isFavourite !== undefined) {
      assignments.push('favourited_at = ?')
      values.push(parsed.isFavourite ? now() : null)
    }
    if (parsed.isPinned !== undefined) {
      assignments.push('pinned_at = ?')
      values.push(parsed.isPinned ? now() : null)
    }
    assignments.push('updated_at = ?', 'row_version = row_version + 1')
    values.push(now(), parsed.id)
    this.database.prepare(`UPDATE books SET ${assignments.join(', ')} WHERE id = ?`).run(...values)
    return this.getBook(parsed.id)
  }

  trashBook(id: string): void {
    const bookId = idSchema.parse(id)
    this.requireBook(bookId)
    const timestamp = now()
    this.database
      .prepare('UPDATE books SET is_archived = 1, deleted_at = ?, updated_at = ? WHERE id = ?')
      .run(timestamp, timestamp, bookId)
  }

  restoreBook(id: string): void {
    const bookId = idSchema.parse(id)
    this.requireBook(bookId)
    this.database
      .prepare('UPDATE books SET is_archived = 0, deleted_at = NULL, updated_at = ? WHERE id = ?')
      .run(now(), bookId)
  }

  removeBookPermanently(id: string): void {
    const bookId = idSchema.parse(id)
    const row = this.requireBook(bookId)
    if (!row.deleted_at) {
      throw new StoryboundError(
        'CONFLICT',
        'Move this book to Trash before deleting it permanently.'
      )
    }
    this.database.transaction(() => {
      this.database.prepare('DELETE FROM books WHERE id = ?').run(bookId)
    })()
    if (row.cover_image_path) safeRemoveManagedCover(this.paths.media, row.cover_image_path)
  }

  setCoverFromFile(id: string, sourcePath: string): BookDetail {
    const bookId = idSchema.parse(id)
    const book = this.requireBook(bookId)
    let source: Buffer
    try {
      const stats = statSync(sourcePath)
      if (!stats.isFile() || stats.size > MAX_COVER_BYTES) {
        throw new StoryboundError('FILE_ERROR', 'Cover images must be smaller than 15 MB.')
      }
      source = readFileSync(sourcePath)
    } catch (error) {
      if (error instanceof StoryboundError) throw error
      throw new StoryboundError('FILE_ERROR', 'Storybound could not read that cover image.', error)
    }
    const extension = coverExtension(source, sourcePath)
    const filename = `${randomUUID()}${extension}`
    const temporary = join(this.paths.media, `.${filename}.tmp`)
    const destination = join(this.paths.media, filename)
    try {
      writeFileSync(temporary, source, { flag: 'wx' })
      renameSync(temporary, destination)
      this.database
        .prepare('UPDATE books SET cover_image_path = ?, updated_at = ? WHERE id = ?')
        .run(filename, now(), bookId)
    } catch (error) {
      safeRemove(temporary)
      safeRemove(destination)
      throw new StoryboundError('FILE_ERROR', 'Storybound could not copy that cover image.', error)
    }
    if (book.cover_image_path) safeRemoveManagedCover(this.paths.media, book.cover_image_path)
    return this.getBook(bookId)
  }

  removeCover(id: string): BookDetail {
    const bookId = idSchema.parse(id)
    const book = this.requireBook(bookId)
    this.database
      .prepare('UPDATE books SET cover_image_path = NULL, updated_at = ? WHERE id = ?')
      .run(now(), bookId)
    if (book.cover_image_path) safeRemoveManagedCover(this.paths.media, book.cover_image_path)
    return this.getBook(bookId)
  }

  listLibraries(): Library[] {
    const rows = this.database
      .prepare(
        `SELECT l.*,
          CASE WHEN a.active_library_id = l.id THEN 1 ELSE 0 END AS is_active,
          COUNT(bl.book_id) AS book_count
         FROM libraries l
         JOIN app_state a ON a.id = 1
         LEFT JOIN book_libraries bl
           ON bl.library_id = l.id AND bl.deleted_at IS NULL
         WHERE l.deleted_at IS NULL
         GROUP BY l.id
         ORDER BY is_active DESC, l.name COLLATE NOCASE`
      )
      .all() as LibraryRow[]
    return rows.map((row) => this.mapLibrary(row))
  }

  createLibrary(input: CreateLibraryInput): Library {
    const parsed = createLibrarySchema.parse(input)
    const id = randomUUID()
    const timestamp = now()
    this.database
      .prepare(
        `INSERT INTO libraries (id, name, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, parsed.name, parsed.description, timestamp, timestamp)
    return this.listLibraries().find((library) => library.id === id)!
  }

  updateLibrary(input: UpdateLibraryInput): Library {
    const parsed = updateLibrarySchema.parse(input)
    this.requireLibrary(parsed.id)
    const assignments: string[] = []
    const values: unknown[] = []
    if (parsed.name !== undefined) {
      assignments.push('name = ?')
      values.push(parsed.name)
    }
    if (parsed.description !== undefined) {
      assignments.push('description = ?')
      values.push(parsed.description)
    }
    assignments.push('updated_at = ?', 'row_version = row_version + 1')
    values.push(now(), parsed.id)
    this.database
      .prepare(`UPDATE libraries SET ${assignments.join(', ')} WHERE id = ?`)
      .run(...values)
    return this.listLibraries().find((library) => library.id === parsed.id)!
  }

  setActiveLibrary(id: string): Library {
    const libraryId = idSchema.parse(id)
    this.requireLibrary(libraryId)
    this.database
      .prepare('UPDATE app_state SET active_library_id = ?, updated_at = ? WHERE id = 1')
      .run(libraryId, now())
    return this.listLibraries().find((library) => library.id === libraryId)!
  }

  removeLibrary(id: string): void {
    const libraryId = idSchema.parse(id)
    this.requireLibrary(libraryId)
    if (libraryId === this.activeLibraryId()) {
      throw new StoryboundError('CONFLICT', 'Switch to another library before removing this one.')
    }
    const bookCount = Number(
      this.database
        .prepare('SELECT COUNT(*) FROM book_libraries WHERE library_id = ? AND deleted_at IS NULL')
        .pluck()
        .get(libraryId)
    )
    if (bookCount > 0) {
      throw new StoryboundError(
        'CONFLICT',
        'Move or delete this library’s books before removing it.'
      )
    }
    const timestamp = now()
    this.database.transaction(() => {
      this.database
        .prepare(
          'UPDATE libraries SET deleted_at = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ?'
        )
        .run(timestamp, timestamp, libraryId)
      this.database
        .prepare('UPDATE tags SET deleted_at = ? WHERE library_id = ?')
        .run(timestamp, libraryId)
      this.database
        .prepare('UPDATE collections SET deleted_at = ? WHERE library_id = ?')
        .run(timestamp, libraryId)
      this.database
        .prepare('UPDATE saved_filters SET deleted_at = ? WHERE library_id = ?')
        .run(timestamp, libraryId)
    })()
  }

  listTags(libraryId?: string): Tag[] {
    const scopedLibraryId = libraryId ? idSchema.parse(libraryId) : this.activeLibraryId()
    this.requireLibrary(scopedLibraryId)
    const rows = this.database
      .prepare(
        `SELECT t.*, COUNT(bt.book_id) AS book_count
         FROM tags t
         LEFT JOIN book_tags bt ON bt.tag_id = t.id AND bt.deleted_at IS NULL
         WHERE t.library_id = ? AND t.deleted_at IS NULL
         GROUP BY t.id ORDER BY t.name COLLATE NOCASE`
      )
      .all(scopedLibraryId) as TagRow[]
    return rows.map((row) => this.mapTag(row))
  }

  createTag(input: CreateTagInput): Tag {
    const parsed = createTagSchema.parse(input)
    const libraryId = parsed.libraryId ?? this.activeLibraryId()
    this.requireLibrary(libraryId)
    const normalizedName = this.normalizeOrganizationName(parsed.name)
    const existing = this.database
      .prepare(
        'SELECT id FROM tags WHERE library_id = ? AND normalized_name = ? AND deleted_at IS NULL'
      )
      .pluck()
      .get(libraryId, normalizedName)
    if (existing) throw new StoryboundError('CONFLICT', 'A tag with that name already exists.')
    const id = randomUUID()
    const timestamp = now()
    this.database
      .prepare(
        `INSERT INTO tags (
          id, library_id, name, normalized_name, color, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, libraryId, parsed.name, normalizedName, parsed.color, timestamp, timestamp)
    return this.listTags(libraryId).find((tag) => tag.id === id)!
  }

  updateTag(input: UpdateTagInput): Tag {
    const parsed = updateTagSchema.parse(input)
    const row = this.requireTag(parsed.id)
    const assignments: string[] = []
    const values: unknown[] = []
    if (parsed.name !== undefined) {
      const normalized = this.normalizeOrganizationName(parsed.name)
      const duplicate = this.database
        .prepare(
          `SELECT id FROM tags
           WHERE library_id = ? AND normalized_name = ? AND deleted_at IS NULL AND id <> ?`
        )
        .pluck()
        .get(row.library_id, normalized, parsed.id)
      if (duplicate) throw new StoryboundError('CONFLICT', 'A tag with that name already exists.')
      assignments.push('name = ?', 'normalized_name = ?')
      values.push(parsed.name, normalized)
    }
    if (parsed.color !== undefined) {
      assignments.push('color = ?')
      values.push(parsed.color)
    }
    assignments.push('updated_at = ?', 'row_version = row_version + 1')
    values.push(now(), parsed.id)
    this.database.prepare(`UPDATE tags SET ${assignments.join(', ')} WHERE id = ?`).run(...values)
    return this.listTags(row.library_id).find((tag) => tag.id === parsed.id)!
  }

  removeTag(id: string): void {
    const tag = this.requireTag(idSchema.parse(id))
    const timestamp = now()
    this.database.transaction(() => {
      this.database
        .prepare(
          'UPDATE tags SET deleted_at = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ?'
        )
        .run(timestamp, timestamp, tag.id)
      this.database
        .prepare(
          'UPDATE book_tags SET deleted_at = ?, updated_at = ?, row_version = row_version + 1 WHERE tag_id = ? AND deleted_at IS NULL'
        )
        .run(timestamp, timestamp, tag.id)
    })()
  }

  setBookTags(input: SetBookRelationsInput): Tag[] {
    const parsed = setBookRelationsSchema.parse(input)
    const book = this.requireBook(parsed.bookId)
    const ids = [...new Set(parsed.ids)]
    for (const id of ids) {
      if (this.requireTag(id).library_id !== book.library_id) {
        throw new StoryboundError(
          'VALIDATION_ERROR',
          'Tags must belong to the same library as the book.'
        )
      }
    }
    this.replaceBookRelations('book_tags', 'tag_id', parsed.bookId, ids)
    return this.listTags(book.library_id).filter((tag) => ids.includes(tag.id))
  }

  listCollections(libraryId?: string): Collection[] {
    const scopedLibraryId = libraryId ? idSchema.parse(libraryId) : this.activeLibraryId()
    this.requireLibrary(scopedLibraryId)
    const rows = this.database
      .prepare(
        `SELECT c.*, COUNT(cb.book_id) AS book_count
         FROM collections c
         LEFT JOIN collection_books cb ON cb.collection_id = c.id AND cb.deleted_at IS NULL
         WHERE c.library_id = ? AND c.deleted_at IS NULL
         GROUP BY c.id ORDER BY c.position, c.name COLLATE NOCASE`
      )
      .all(scopedLibraryId) as CollectionRow[]
    return rows.map((row) => this.mapCollection(row))
  }

  createCollection(input: CreateCollectionInput): Collection {
    const parsed = createCollectionSchema.parse(input)
    const libraryId = parsed.libraryId ?? this.activeLibraryId()
    this.requireLibrary(libraryId)
    const id = randomUUID()
    const timestamp = now()
    const position = Number(
      this.database
        .prepare('SELECT COALESCE(MAX(position), -1) + 1 FROM collections WHERE library_id = ?')
        .pluck()
        .get(libraryId)
    )
    this.database
      .prepare(
        `INSERT INTO collections (
          id, library_id, name, description, color, icon, position, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        libraryId,
        parsed.name,
        parsed.description,
        parsed.color,
        parsed.icon,
        position,
        timestamp,
        timestamp
      )
    return this.listCollections(libraryId).find((collection) => collection.id === id)!
  }

  updateCollection(input: UpdateCollectionInput): Collection {
    const parsed = updateCollectionSchema.parse(input)
    const row = this.requireCollection(parsed.id)
    const assignments: string[] = []
    const values: unknown[] = []
    for (const field of ['name', 'description', 'color', 'icon'] as const) {
      if (parsed[field] !== undefined) {
        assignments.push(`${field} = ?`)
        values.push(parsed[field])
      }
    }
    assignments.push('updated_at = ?', 'row_version = row_version + 1')
    values.push(now(), parsed.id)
    this.database
      .prepare(`UPDATE collections SET ${assignments.join(', ')} WHERE id = ?`)
      .run(...values)
    return this.listCollections(row.library_id).find((collection) => collection.id === parsed.id)!
  }

  removeCollection(id: string): void {
    const collection = this.requireCollection(idSchema.parse(id))
    const timestamp = now()
    this.database.transaction(() => {
      this.database
        .prepare(
          'UPDATE collections SET deleted_at = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ?'
        )
        .run(timestamp, timestamp, collection.id)
      this.database
        .prepare(
          'UPDATE collection_books SET deleted_at = ?, updated_at = ?, row_version = row_version + 1 WHERE collection_id = ? AND deleted_at IS NULL'
        )
        .run(timestamp, timestamp, collection.id)
    })()
  }

  setBookCollections(input: SetBookRelationsInput): Collection[] {
    const parsed = setBookRelationsSchema.parse(input)
    const book = this.requireBook(parsed.bookId)
    const ids = [...new Set(parsed.ids)]
    for (const id of ids) {
      if (this.requireCollection(id).library_id !== book.library_id) {
        throw new StoryboundError(
          'VALIDATION_ERROR',
          'Collections must belong to the same library as the book.'
        )
      }
    }
    this.replaceBookRelations('collection_books', 'collection_id', parsed.bookId, ids)
    return this.listCollections(book.library_id).filter((collection) => ids.includes(collection.id))
  }

  listSavedFilters(libraryId?: string): SavedFilter[] {
    const scopedLibraryId = libraryId ? idSchema.parse(libraryId) : this.activeLibraryId()
    this.requireLibrary(scopedLibraryId)
    const rows = this.database
      .prepare(
        `SELECT * FROM saved_filters
         WHERE library_id = ? AND deleted_at IS NULL
         ORDER BY position, name COLLATE NOCASE`
      )
      .all(scopedLibraryId) as SavedFilterRow[]
    return rows.map((row) => this.mapSavedFilter(row))
  }

  createSavedFilter(input: CreateSavedFilterInput): SavedFilter {
    const parsed = createSavedFilterSchema.parse(input)
    const libraryId = parsed.libraryId ?? this.activeLibraryId()
    this.requireLibrary(libraryId)
    const id = randomUUID()
    const timestamp = now()
    const position = Number(
      this.database
        .prepare('SELECT COALESCE(MAX(position), -1) + 1 FROM saved_filters WHERE library_id = ?')
        .pluck()
        .get(libraryId)
    )
    this.database
      .prepare(
        `INSERT INTO saved_filters (
          id, library_id, name, definition_json, position, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, libraryId, parsed.name, JSON.stringify(parsed.query), position, timestamp, timestamp)
    return this.listSavedFilters(libraryId).find((filter) => filter.id === id)!
  }

  updateSavedFilter(input: UpdateSavedFilterInput): SavedFilter {
    const parsed = updateSavedFilterSchema.parse(input)
    const row = this.requireSavedFilter(parsed.id)
    const assignments: string[] = []
    const values: unknown[] = []
    if (parsed.name !== undefined) {
      assignments.push('name = ?')
      values.push(parsed.name)
    }
    if (parsed.query !== undefined) {
      assignments.push('definition_json = ?')
      values.push(JSON.stringify(parsed.query))
    }
    assignments.push('updated_at = ?', 'row_version = row_version + 1')
    values.push(now(), parsed.id)
    this.database
      .prepare(`UPDATE saved_filters SET ${assignments.join(', ')} WHERE id = ?`)
      .run(...values)
    return this.listSavedFilters(row.library_id).find((filter) => filter.id === parsed.id)!
  }

  removeSavedFilter(id: string): void {
    const filter = this.requireSavedFilter(idSchema.parse(id))
    this.database
      .prepare(
        'UPDATE saved_filters SET deleted_at = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ?'
      )
      .run(now(), now(), filter.id)
  }

  listStoryEntities(query: StoryEntityQuery): StoryEntity[] {
    const parsed = storyEntityQuerySchema.parse(query)
    this.requireActiveStoryBook(parsed.bookId)
    const clauses = [
      'entity.book_id = ?',
      'entity.deleted_at IS NULL',
      'book.deleted_at IS NULL',
      'book_library.library_id = ?',
      'book_library.deleted_at IS NULL'
    ]
    const parameters: unknown[] = [parsed.bookId, this.activeLibraryId()]
    if (parsed.entityType) {
      clauses.push('entity.entity_type = ?')
      parameters.push(parsed.entityType)
    }
    if (parsed.search) {
      const fts = toFtsQuery(parsed.search)
      if (!fts) return []
      clauses.push(`entity.id IN (
        SELECT entity_id FROM story_entity_search WHERE story_entity_search MATCH ?
      )`)
      parameters.push(fts)
    }
    let sql = `SELECT entity.*
      FROM story_entities entity
      JOIN books book ON book.id = entity.book_id
      JOIN book_libraries book_library ON book_library.book_id = book.id
      WHERE ${clauses.join(' AND ')}
      ORDER BY
        CASE
          WHEN entity.entity_type = 'event'
            AND json_type(entity.details_json, '$.order') IN ('integer', 'real')
          THEN json_extract(entity.details_json, '$.order')
          ELSE entity.position
        END,
        entity.position,
        entity.title COLLATE NOCASE`
    if (parsed.limit !== undefined) {
      sql += ' LIMIT ?'
      parameters.push(parsed.limit)
      if (parsed.offset !== undefined) {
        sql += ' OFFSET ?'
        parameters.push(parsed.offset)
      }
    } else if (parsed.offset !== undefined) {
      sql += ' LIMIT -1 OFFSET ?'
      parameters.push(parsed.offset)
    }
    return (this.database.prepare(sql).all(...parameters) as StoryEntityRow[]).map((row) =>
      this.mapStoryEntity(row)
    )
  }

  getStoryEntity(id: string): StoryEntity {
    return this.mapStoryEntity(this.requireActiveStoryEntity(idSchema.parse(id)))
  }

  createStoryEntity(input: CreateStoryEntityInput): StoryEntity {
    const parsed = createStoryEntitySchema.parse(input)
    this.requireActiveStoryBook(parsed.bookId)
    const id = randomUUID()
    const timestamp = now()
    const position =
      parsed.position ??
      Number(
        this.database
          .prepare(
            `SELECT COALESCE(MAX(position), -1) + 1
             FROM story_entities WHERE book_id = ? AND deleted_at IS NULL`
          )
          .pluck()
          .get(parsed.bookId)
      )
    this.database
      .prepare(
        `INSERT INTO story_entities (
          id, book_id, entity_type, title, summary, body_markdown, details_version,
          details_json, position, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        parsed.bookId,
        parsed.entityType,
        parsed.title,
        parsed.summary,
        parsed.bodyMarkdown,
        parsed.detailsVersion,
        JSON.stringify(parsed.details),
        position,
        timestamp,
        timestamp
      )
    return this.getStoryEntity(id)
  }

  updateStoryEntity(input: UpdateStoryEntityInput): StoryEntity {
    const parsed = updateStoryEntitySchema.parse(input)
    this.requireActiveStoryEntity(parsed.id)
    const assignments: string[] = []
    const values: unknown[] = []
    const columns = {
      entityType: 'entity_type',
      title: 'title',
      summary: 'summary',
      bodyMarkdown: 'body_markdown',
      detailsVersion: 'details_version',
      position: 'position'
    } as const
    for (const [field, column] of Object.entries(columns) as Array<
      [keyof typeof columns, (typeof columns)[keyof typeof columns]]
    >) {
      if (parsed[field] !== undefined) {
        assignments.push(`${column} = ?`)
        values.push(parsed[field])
      }
    }
    if (parsed.details !== undefined) {
      assignments.push('details_json = ?')
      values.push(JSON.stringify(parsed.details))
    }
    assignments.push('updated_at = ?', 'row_version = row_version + 1')
    values.push(now(), parsed.id)
    this.database
      .prepare(`UPDATE story_entities SET ${assignments.join(', ')} WHERE id = ?`)
      .run(...values)
    return this.getStoryEntity(parsed.id)
  }

  removeStoryEntity(id: string): void {
    const entity = this.requireActiveStoryEntity(idSchema.parse(id))
    const timestamp = now()
    this.database.transaction(() => {
      this.database
        .prepare(
          `UPDATE story_entities
           SET deleted_at = ?, updated_at = ?, row_version = row_version + 1
           WHERE id = ?`
        )
        .run(timestamp, timestamp, entity.id)
      this.database
        .prepare(
          `UPDATE story_entity_chapters
           SET deleted_at = ?, updated_at = ?, row_version = row_version + 1
           WHERE entity_id = ? AND deleted_at IS NULL`
        )
        .run(timestamp, timestamp, entity.id)
      this.database
        .prepare(
          `UPDATE story_entity_relations
           SET deleted_at = ?, updated_at = ?, row_version = row_version + 1
           WHERE (from_entity_id = ? OR to_entity_id = ?) AND deleted_at IS NULL`
        )
        .run(timestamp, timestamp, entity.id, entity.id)
    })()
  }

  listStoryEntityChapterLinks(entityId: string): StoryEntityChapterLink[] {
    const entity = this.requireActiveStoryEntity(idSchema.parse(entityId))
    const rows = this.database
      .prepare(
        `SELECT link.*, entity.book_id, chapter.title AS chapter_title
         FROM story_entity_chapters link
         JOIN story_entities entity ON entity.id = link.entity_id
         JOIN chapters chapter ON chapter.id = link.chapter_id
         WHERE link.entity_id = ? AND link.deleted_at IS NULL
           AND entity.deleted_at IS NULL AND chapter.deleted_at IS NULL
         ORDER BY chapter.position, link.created_at`
      )
      .all(entity.id) as StoryEntityChapterLinkRow[]
    return rows.map((row) => this.mapStoryEntityChapterLink(row))
  }

  createStoryEntityChapterLink(input: CreateStoryEntityChapterLinkInput): StoryEntityChapterLink {
    const parsed = createStoryEntityChapterLinkSchema.parse(input)
    const entity = this.requireActiveStoryEntity(parsed.entityId)
    const chapter = this.requireChapter(parsed.chapterId)
    if (chapter.book_id !== entity.book_id) {
      throw new StoryboundError(
        'VALIDATION_ERROR',
        'Story-bible entities can only link to chapters in the same book.'
      )
    }
    const existing = this.database
      .prepare(
        `SELECT id FROM story_entity_chapters
         WHERE entity_id = ? AND chapter_id = ? AND deleted_at IS NULL`
      )
      .pluck()
      .get(entity.id, chapter.id)
    if (existing) {
      throw new StoryboundError('CONFLICT', 'That entity is already linked to this chapter.')
    }
    const id = randomUUID()
    const timestamp = now()
    this.database
      .prepare(
        `INSERT INTO story_entity_chapters (
          id, entity_id, chapter_id, note, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, entity.id, chapter.id, parsed.note, timestamp, timestamp)
    return this.getActiveStoryEntityChapterLink(id)
  }

  updateStoryEntityChapterLink(input: UpdateStoryEntityChapterLinkInput): StoryEntityChapterLink {
    const parsed = updateStoryEntityChapterLinkSchema.parse(input)
    const existing = this.getActiveStoryEntityChapterLink(parsed.id)
    const assignments: string[] = []
    const values: unknown[] = []
    if (parsed.chapterId !== undefined) {
      const chapter = this.requireChapter(parsed.chapterId)
      if (chapter.book_id !== existing.bookId) {
        throw new StoryboundError(
          'VALIDATION_ERROR',
          'Story-bible entities can only link to chapters in the same book.'
        )
      }
      const duplicate = this.database
        .prepare(
          `SELECT id FROM story_entity_chapters
           WHERE entity_id = ? AND chapter_id = ? AND deleted_at IS NULL AND id <> ?`
        )
        .pluck()
        .get(existing.entityId, chapter.id, parsed.id)
      if (duplicate) {
        throw new StoryboundError('CONFLICT', 'That entity is already linked to this chapter.')
      }
      assignments.push('chapter_id = ?')
      values.push(chapter.id)
    }
    if (parsed.note !== undefined) {
      assignments.push('note = ?')
      values.push(parsed.note)
    }
    assignments.push('updated_at = ?', 'row_version = row_version + 1')
    values.push(now(), parsed.id)
    this.database
      .prepare(`UPDATE story_entity_chapters SET ${assignments.join(', ')} WHERE id = ?`)
      .run(...values)
    return this.getActiveStoryEntityChapterLink(parsed.id)
  }

  removeStoryEntityChapterLink(id: string): void {
    const link = this.getActiveStoryEntityChapterLink(idSchema.parse(id))
    const timestamp = now()
    this.database
      .prepare(
        `UPDATE story_entity_chapters
         SET deleted_at = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ?`
      )
      .run(timestamp, timestamp, link.id)
  }

  listStoryEntityRelations(query: StoryEntityRelationQuery): StoryEntityRelation[] {
    const parsed = storyEntityRelationQuerySchema.parse(query)
    this.requireActiveStoryBook(parsed.bookId)
    if (parsed.entityId) {
      const entity = this.requireActiveStoryEntity(parsed.entityId)
      if (entity.book_id !== parsed.bookId) {
        throw new StoryboundError(
          'VALIDATION_ERROR',
          'That entity does not belong to the requested book.'
        )
      }
    }
    const parameters: unknown[] = [parsed.bookId, this.activeLibraryId()]
    let entityClause = ''
    if (parsed.entityId) {
      entityClause = 'AND (relation.from_entity_id = ? OR relation.to_entity_id = ?)'
      parameters.push(parsed.entityId, parsed.entityId)
    }
    const rows = this.database
      .prepare(
        `SELECT relation.*
         FROM story_entity_relations relation
         JOIN books book ON book.id = relation.book_id
         JOIN book_libraries book_library ON book_library.book_id = book.id
         JOIN story_entities source ON source.id = relation.from_entity_id
         JOIN story_entities target ON target.id = relation.to_entity_id
         WHERE relation.book_id = ? AND book_library.library_id = ?
           AND relation.deleted_at IS NULL AND book.deleted_at IS NULL
           AND book_library.deleted_at IS NULL
           AND source.deleted_at IS NULL AND target.deleted_at IS NULL
           ${entityClause}
         ORDER BY relation.updated_at DESC, relation.created_at DESC`
      )
      .all(...parameters) as StoryEntityRelationRow[]
    return rows.map((row) => this.mapStoryEntityRelation(row))
  }

  createStoryEntityRelation(input: CreateStoryEntityRelationInput): StoryEntityRelation {
    const parsed = createStoryEntityRelationSchema.parse(input)
    const source = this.requireActiveStoryEntity(parsed.fromEntityId)
    const target = this.requireActiveStoryEntity(parsed.toEntityId)
    if (source.book_id !== target.book_id) {
      throw new StoryboundError(
        'VALIDATION_ERROR',
        'Story-bible relationships must connect entities in the same book.'
      )
    }
    const id = randomUUID()
    const timestamp = now()
    this.database
      .prepare(
        `INSERT INTO story_entity_relations (
          id, book_id, from_entity_id, to_entity_id, relationship_type,
          label, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        source.book_id,
        source.id,
        target.id,
        parsed.relationshipType,
        parsed.label,
        parsed.notes,
        timestamp,
        timestamp
      )
    return this.getActiveStoryEntityRelation(id)
  }

  updateStoryEntityRelation(input: UpdateStoryEntityRelationInput): StoryEntityRelation {
    const parsed = updateStoryEntityRelationSchema.parse(input)
    const existing = this.getActiveStoryEntityRelation(parsed.id)
    const sourceId = parsed.fromEntityId ?? existing.fromEntityId
    const targetId = parsed.toEntityId ?? existing.toEntityId
    if (sourceId === targetId) {
      throw new StoryboundError(
        'VALIDATION_ERROR',
        'An entity cannot have a directional relationship to itself.'
      )
    }
    const source = this.requireActiveStoryEntity(sourceId)
    const target = this.requireActiveStoryEntity(targetId)
    if (source.book_id !== existing.bookId || target.book_id !== existing.bookId) {
      throw new StoryboundError(
        'VALIDATION_ERROR',
        'Story-bible relationships must connect entities in the same book.'
      )
    }
    const assignments: string[] = []
    const values: unknown[] = []
    const columns = {
      fromEntityId: 'from_entity_id',
      toEntityId: 'to_entity_id',
      relationshipType: 'relationship_type',
      label: 'label',
      notes: 'notes'
    } as const
    for (const [field, column] of Object.entries(columns) as Array<
      [keyof typeof columns, (typeof columns)[keyof typeof columns]]
    >) {
      if (parsed[field] !== undefined) {
        assignments.push(`${column} = ?`)
        values.push(parsed[field])
      }
    }
    assignments.push('updated_at = ?', 'row_version = row_version + 1')
    values.push(now(), parsed.id)
    this.database
      .prepare(`UPDATE story_entity_relations SET ${assignments.join(', ')} WHERE id = ?`)
      .run(...values)
    return this.getActiveStoryEntityRelation(parsed.id)
  }

  removeStoryEntityRelation(id: string): void {
    const relation = this.getActiveStoryEntityRelation(idSchema.parse(id))
    const timestamp = now()
    this.database
      .prepare(
        `UPDATE story_entity_relations
         SET deleted_at = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ?`
      )
      .run(timestamp, timestamp, relation.id)
  }

  getChapter(id: string): Chapter {
    const chapterId = idSchema.parse(id)
    const row = this.requireChapter(chapterId)
    return this.mapChapter(row, this.isChapterRead(row))
  }

  createChapter(input: CreateChapterInput): Chapter {
    const parsed = createChapterSchema.parse(input)
    this.requireBook(parsed.bookId)
    const chapterId = randomUUID()
    const timestamp = now()
    this.database.transaction(() => {
      const position = Number(
        this.database
          .prepare(
            'SELECT COALESCE(MAX(position), -1) + 1 FROM chapters WHERE book_id = ? AND deleted_at IS NULL'
          )
          .pluck()
          .get(parsed.bookId)
      )
      this.database
        .prepare(
          `INSERT INTO chapters (
            id, book_id, title, content, position, created_at, updated_at, word_count
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          chapterId,
          parsed.bookId,
          parsed.title,
          parsed.content,
          position,
          timestamp,
          timestamp,
          countWords(parsed.content)
        )
      this.refreshBook(parsed.bookId, timestamp)
      this.recalculateReadingProgress(parsed.bookId, chapterId)
    })()
    return this.getChapter(chapterId)
  }

  updateChapter(input: UpdateChapterInput): Chapter {
    const parsed = updateChapterSchema.parse(input)
    const chapter = this.requireChapter(parsed.id)
    const assignments: string[] = []
    const values: unknown[] = []
    if (parsed.title !== undefined) {
      assignments.push('title = ?')
      values.push(parsed.title)
    }
    if (parsed.content !== undefined) {
      assignments.push('content = ?', 'word_count = ?')
      values.push(parsed.content, countWords(parsed.content))
    }
    const timestamp = now()
    assignments.push('updated_at = ?')
    values.push(timestamp, parsed.id)
    this.database.transaction(() => {
      this.saveChapterRevision(chapter, 'Before edit')
      this.database
        .prepare(
          `UPDATE chapters SET ${assignments.join(', ')}, row_version = row_version + 1 WHERE id = ?`
        )
        .run(...values)
      if (parsed.content !== undefined && parsed.content !== chapter.content) {
        const delta = wordDelta(chapter.content, parsed.content)
        if (delta.added > 0 || delta.removed > 0) {
          const libraryId = this.database
            .prepare(
              `SELECT library_id FROM book_libraries
               WHERE book_id = ? AND deleted_at IS NULL`
            )
            .pluck()
            .get(chapter.book_id)
          if (typeof libraryId !== 'string') {
            throw new StoryboundError(
              'DATABASE_ERROR',
              'The chapter library could not be found for writing statistics.'
            )
          }
          const timezone = parsed.writingTimezone ?? systemTimezone()
          this.database
            .prepare(
              `INSERT INTO writing_events (
                id, library_id, book_id, chapter_id, occurred_at, local_day, timezone,
                words_added, words_removed, word_count_after, source, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'editor', ?)`
            )
            .run(
              randomUUID(),
              libraryId,
              chapter.book_id,
              chapter.id,
              timestamp,
              localDay(new Date(timestamp), timezone),
              timezone,
              delta.added,
              delta.removed,
              countWords(parsed.content),
              timestamp
            )
        }
      }
      let readingPositionAdjusted = false
      if (parsed.content !== undefined && parsed.content.length > chapter.content.length) {
        const ratio =
          parsed.content.length === 0 ? 0 : chapter.content.length / parsed.content.length
        const adjusted = this.database
          .prepare(
            `UPDATE reading_states SET scroll_position = scroll_position * ?,
              has_finished_current_content = 0 WHERE chapter_id = ?`
          )
          .run(ratio, chapter.id)
        readingPositionAdjusted = adjusted.changes > 0
      }
      this.refreshBook(chapter.book_id, timestamp)
      if (readingPositionAdjusted) {
        this.recalculateReadingProgress(chapter.book_id, undefined, true)
      }
      this.database.prepare('DELETE FROM recovery_drafts WHERE chapter_id = ?').run(parsed.id)
    })()
    return this.getChapter(parsed.id)
  }

  reorderChapters(input: ReorderChaptersInput): ChapterSummary[] {
    const parsed = reorderChaptersSchema.parse(input)
    this.requireBook(parsed.bookId)
    const chapters = this.chapterRows(parsed.bookId)
    const ordered = reorderByIds(chapters, parsed.chapterIds)
    this.database.transaction(() => {
      this.setChapterOrder(
        parsed.bookId,
        ordered.map((chapter) => chapter.id)
      )
      this.refreshBook(parsed.bookId, now())
      this.recalculateReadingProgress(parsed.bookId)
    })()
    return this.listChapterSummaries(parsed.bookId)
  }

  duplicateChapter(id: string): Chapter {
    const chapterId = idSchema.parse(id)
    const original = this.requireChapter(chapterId)
    const duplicateId = randomUUID()
    const timestamp = now()
    this.database.transaction(() => {
      const chapters = this.chapterRows(original.book_id)
      const temporaryPosition = (chapters.at(-1)?.position ?? -1) + 1
      this.database
        .prepare(
          `INSERT INTO chapters (
            id, book_id, title, content, position, created_at, updated_at, word_count
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          duplicateId,
          original.book_id,
          `${original.title} Copy`,
          original.content,
          temporaryPosition,
          timestamp,
          timestamp,
          original.word_count
        )
      const order = chapters.map((chapter) => chapter.id)
      order.splice(original.position + 1, 0, duplicateId)
      this.setChapterOrder(original.book_id, order)
      this.refreshBook(original.book_id, timestamp)
      this.recalculateReadingProgress(original.book_id, duplicateId)
    })()
    return this.getChapter(duplicateId)
  }

  removeChapter(id: string): void {
    const chapterId = idSchema.parse(id)
    const chapter = this.requireChapter(chapterId)
    const timestamp = now()
    this.database.transaction(() => {
      this.saveChapterRevision(chapter, 'Moved to chapter trash')
      const maximum = Number(
        this.database
          .prepare('SELECT COALESCE(MAX(position), -1) + 1 FROM chapters WHERE book_id = ?')
          .pluck()
          .get(chapter.book_id)
      )
      this.database
        .prepare(
          `UPDATE chapters SET deleted_at = ?, trashed_from_position = position,
            position = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ?`
        )
        .run(timestamp, maximum, timestamp, chapterId)
      const order = this.chapterRows(chapter.book_id).map((row) => row.id)
      this.setChapterOrder(chapter.book_id, order)
      const fallback = this.chapterRows(chapter.book_id)[
        Math.min(chapter.position, order.length - 1)
      ]
      this.database
        .prepare(
          `UPDATE reading_states SET chapter_id = ?, scroll_position = 0,
            has_finished_current_content = 0 WHERE book_id = ? AND chapter_id = ?`
        )
        .run(fallback?.id ?? null, chapter.book_id, chapterId)
      this.refreshBook(chapter.book_id, timestamp)
      this.recalculateReadingProgress(chapter.book_id)
    })()
  }

  listChapterTrash(bookId: string): ChapterTrashItem[] {
    const id = idSchema.parse(bookId)
    this.requireBook(id)
    const rows = this.database
      .prepare(
        `SELECT * FROM chapters
         WHERE book_id = ? AND deleted_at IS NOT NULL
         ORDER BY deleted_at DESC`
      )
      .all(id) as ChapterRow[]
    return rows.map((row) => ({
      ...this.mapChapterSummary(row, false),
      deletedAt: row.deleted_at!,
      originalPosition: row.trashed_from_position ?? row.position
    }))
  }

  restoreChapter(id: string): Chapter {
    const chapterId = idSchema.parse(id)
    const chapter = this.requireAnyChapter(chapterId)
    if (!chapter.deleted_at) return this.getChapter(chapterId)
    const timestamp = now()
    this.database.transaction(() => {
      const activeIds = this.chapterRows(chapter.book_id).map((item) => item.id)
      const position = Math.min(chapter.trashed_from_position ?? activeIds.length, activeIds.length)
      activeIds.splice(position, 0, chapterId)
      this.database
        .prepare(
          `UPDATE chapters SET deleted_at = NULL, trashed_from_position = NULL,
            updated_at = ?, row_version = row_version + 1 WHERE id = ?`
        )
        .run(timestamp, chapterId)
      this.setChapterOrder(chapter.book_id, activeIds)
      this.refreshBook(chapter.book_id, timestamp)
      this.recalculateReadingProgress(chapter.book_id)
    })()
    return this.getChapter(chapterId)
  }

  removeChapterPermanently(id: string): void {
    const chapter = this.requireAnyChapter(idSchema.parse(id))
    if (!chapter.deleted_at) {
      throw new StoryboundError(
        'CONFLICT',
        'Move this chapter to chapter trash before deleting it permanently.'
      )
    }
    this.database.prepare('DELETE FROM chapters WHERE id = ?').run(chapter.id)
  }

  listChapterRevisions(chapterId: string): ChapterRevision[] {
    const id = idSchema.parse(chapterId)
    this.requireAnyChapter(id)
    const rows = this.database
      .prepare(
        `SELECT * FROM chapter_revisions
         WHERE chapter_id = ? ORDER BY revision_number DESC LIMIT 100`
      )
      .all(id) as ChapterRevisionRow[]
    return rows.map((row) => this.mapChapterRevision(row, false))
  }

  getChapterRevision(id: string): ChapterRevision {
    const revisionId = idSchema.parse(id)
    const row = this.database
      .prepare('SELECT * FROM chapter_revisions WHERE id = ?')
      .get(revisionId) as ChapterRevisionRow | undefined
    if (!row) throw new StoryboundError('NOT_FOUND', 'That chapter version could not be found.')
    return this.mapChapterRevision(row, true)
  }

  restoreChapterRevision(input: RestoreChapterRevisionInput): Chapter {
    const parsed = restoreChapterRevisionSchema.parse(input)
    const chapter = this.requireChapter(parsed.chapterId)
    const revision = this.getChapterRevision(parsed.revisionId)
    if (revision.chapterId !== chapter.id || revision.content === undefined) {
      throw new StoryboundError('VALIDATION_ERROR', 'That version does not belong to this chapter.')
    }
    const content = revision.content
    const timestamp = now()
    this.database.transaction(() => {
      this.saveChapterRevision(chapter, 'Before restoring an earlier version')
      this.database
        .prepare(
          `UPDATE chapters SET title = ?, content = ?, word_count = ?, updated_at = ?,
            row_version = row_version + 1 WHERE id = ?`
        )
        .run(revision.title, content, countWords(content), timestamp, chapter.id)
      this.refreshBook(chapter.book_id, timestamp)
    })()
    return this.getChapter(chapter.id)
  }

  splitChapter(input: SplitChapterInput): Chapter {
    const parsed = splitChapterSchema.parse(input)
    const original = this.requireChapter(parsed.chapterId)
    const parts = splitContentAtOffset(original.content, parsed.offset)
    const splitRatio = original.content.length === 0 ? 0 : parsed.offset / original.content.length
    const remainingRatio = Math.max(1 - splitRatio, Number.EPSILON)
    const newId = randomUUID()
    const timestamp = now()
    this.database.transaction(() => {
      this.saveChapterRevision(original, 'Before splitting chapter')
      this.database
        .prepare(
          `UPDATE chapters SET content = ?, word_count = ?, updated_at = ?,
            row_version = row_version + 1 WHERE id = ?`
        )
        .run(parts.before, countWords(parts.before), timestamp, original.id)
      const existing = this.chapterRows(original.book_id)
      const temporaryPosition = (existing.at(-1)?.position ?? -1) + 1
      this.database
        .prepare(
          `INSERT INTO chapters (
            id, book_id, title, content, position, created_at, updated_at, word_count
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          newId,
          original.book_id,
          parsed.newTitle,
          parts.after,
          temporaryPosition,
          timestamp,
          timestamp,
          countWords(parts.after)
        )
      this.database
        .prepare(
          `UPDATE bookmarks
           SET location = MIN(1, MAX(0, location / ?)), updated_at = ?,
             row_version = row_version + 1
           WHERE chapter_id = ? AND location <= ? AND deleted_at IS NULL`
        )
        .run(Math.max(splitRatio, Number.EPSILON), timestamp, original.id, splitRatio)
      this.database
        .prepare(
          `UPDATE bookmarks
           SET chapter_id = ?, location = MIN(1, MAX(0, (location - ?) / ?)),
             updated_at = ?, row_version = row_version + 1
           WHERE chapter_id = ? AND location > ? AND deleted_at IS NULL`
        )
        .run(newId, splitRatio, remainingRatio, timestamp, original.id, splitRatio)
      this.database
        .prepare(
          `UPDATE chapter_anchors
           SET fallback_location = MIN(1, MAX(0, fallback_location / ?)), updated_at = ?,
             row_version = row_version + 1
           WHERE chapter_id = ? AND fallback_location <= ? AND deleted_at IS NULL`
        )
        .run(Math.max(splitRatio, Number.EPSILON), timestamp, original.id, splitRatio)
      this.database
        .prepare(
          `UPDATE chapter_anchors
           SET chapter_id = ?,
             fallback_location = MIN(1, MAX(0, (fallback_location - ?) / ?)),
             start_offset = CASE WHEN start_offset IS NULL THEN NULL ELSE MAX(0, start_offset - ?) END,
             end_offset = CASE WHEN end_offset IS NULL THEN NULL ELSE MAX(0, end_offset - ?) END,
             updated_at = ?, row_version = row_version + 1
           WHERE chapter_id = ? AND fallback_location > ? AND deleted_at IS NULL`
        )
        .run(
          newId,
          splitRatio,
          remainingRatio,
          parsed.offset,
          parsed.offset,
          timestamp,
          original.id,
          splitRatio
        )
      this.database
        .prepare(
          `UPDATE reading_states
           SET scroll_position = MIN(1, MAX(0, scroll_position / ?)),
             has_finished_current_content = 0
           WHERE chapter_id = ? AND scroll_position <= ?`
        )
        .run(Math.max(splitRatio, Number.EPSILON), original.id, splitRatio)
      this.database
        .prepare(
          `UPDATE reading_states
           SET chapter_id = ?, scroll_position = MIN(1, MAX(0, (scroll_position - ?) / ?))
           WHERE chapter_id = ? AND scroll_position > ?`
        )
        .run(newId, splitRatio, remainingRatio, original.id, splitRatio)
      const order = existing.map((chapter) => chapter.id).filter((id) => id !== newId)
      const index = order.indexOf(original.id)
      order.splice(index + 1, 0, newId)
      this.setChapterOrder(original.book_id, order)
      this.refreshBook(original.book_id, timestamp)
      this.recalculateReadingProgress(original.book_id)
    })()
    return this.getChapter(newId)
  }

  mergeChapter(input: MergeChapterInput): Chapter {
    const parsed = mergeChapterSchema.parse(input)
    const chapters = this.chapterRows(this.requireChapter(parsed.chapterId).book_id)
    const currentIndex = chapters.findIndex((chapter) => chapter.id === parsed.chapterId)
    const neighborIndex = parsed.direction === 'previous' ? currentIndex - 1 : currentIndex + 1
    const neighbor = chapters[neighborIndex]
    if (!neighbor) {
      throw new StoryboundError(
        'CONFLICT',
        `There is no ${parsed.direction} chapter to merge with.`
      )
    }
    const current = chapters[currentIndex]
    const survivor = parsed.direction === 'previous' ? neighbor : current
    const removed = parsed.direction === 'previous' ? current : neighbor
    const first = parsed.direction === 'previous' ? neighbor : current
    const second = parsed.direction === 'previous' ? current : neighbor
    const content = mergeChapterContent(first.content, second.content)
    const firstLength = first.content.trimEnd().length
    const secondLength = second.content.trimStart().length
    const secondOffset = firstLength > 0 && secondLength > 0 ? firstLength + 2 : firstLength
    const mergedLength = Math.max(content.length, 1)
    const timestamp = now()
    this.database.transaction(() => {
      this.saveChapterRevision(survivor, 'Before merging chapters')
      this.saveChapterRevisionFor(survivor.id, removed, `Merged from chapter “${removed.title}”`)
      this.database
        .prepare(
          `UPDATE chapters SET content = ?, word_count = ?, updated_at = ?,
            row_version = row_version + 1 WHERE id = ?`
        )
        .run(content, countWords(content), timestamp, survivor.id)
      this.database
        .prepare(
          `UPDATE bookmarks
           SET location = MIN(1, MAX(0, location * ? / ?)), updated_at = ?,
             row_version = row_version + 1
           WHERE chapter_id = ? AND deleted_at IS NULL`
        )
        .run(firstLength, mergedLength, timestamp, survivor.id)
      this.database
        .prepare(
          `UPDATE bookmarks
           SET chapter_id = ?, location = MIN(1, MAX(0, (? + location * ?) / ?)),
             updated_at = ?, row_version = row_version + 1
           WHERE chapter_id = ? AND deleted_at IS NULL`
        )
        .run(survivor.id, secondOffset, secondLength, mergedLength, timestamp, removed.id)
      this.database
        .prepare(
          `UPDATE chapter_anchors
           SET fallback_location = MIN(1, MAX(0, fallback_location * ? / ?)),
             updated_at = ?, row_version = row_version + 1
           WHERE chapter_id = ? AND deleted_at IS NULL`
        )
        .run(firstLength, mergedLength, timestamp, survivor.id)
      this.database
        .prepare(
          `UPDATE chapter_anchors
           SET chapter_id = ?,
             fallback_location = MIN(1, MAX(0, (? + fallback_location * ?) / ?)),
             start_offset = CASE WHEN start_offset IS NULL THEN NULL ELSE start_offset + ? END,
             end_offset = CASE WHEN end_offset IS NULL THEN NULL ELSE end_offset + ? END,
             updated_at = ?, row_version = row_version + 1
           WHERE chapter_id = ? AND deleted_at IS NULL`
        )
        .run(
          survivor.id,
          secondOffset,
          secondLength,
          mergedLength,
          secondOffset,
          secondOffset,
          timestamp,
          removed.id
        )
      this.database
        .prepare(
          `UPDATE reading_states
           SET scroll_position = MIN(1, MAX(0, scroll_position * ? / ?))
           WHERE chapter_id = ?`
        )
        .run(firstLength, mergedLength, survivor.id)
      this.database
        .prepare(
          `UPDATE reading_states
           SET chapter_id = ?, scroll_position = MIN(1, MAX(0, (? + scroll_position * ?) / ?))
           WHERE chapter_id = ?`
        )
        .run(survivor.id, secondOffset, secondLength, mergedLength, removed.id)
      this.database.prepare('DELETE FROM chapters WHERE id = ?').run(removed.id)
      this.setChapterOrder(
        survivor.book_id,
        chapters.map((chapter) => chapter.id).filter((id) => id !== removed.id)
      )
      this.refreshBook(survivor.book_id, timestamp)
      this.recalculateReadingProgress(survivor.book_id)
    })()
    return this.getChapter(survivor.id)
  }

  detectSplits(id: string): SplitCandidate[] {
    return detectChapterSplits(this.requireChapter(idSchema.parse(id)).content)
  }

  applyDetectedSplits(chapterId: string, splits: SplitCandidate[]): ChapterSummary[] {
    const id = idSchema.parse(chapterId)
    const original = this.requireChapter(id)
    const parsedSplits = z.array(splitCandidateSchema).min(1).parse(splits)
    const ordered = [...parsedSplits].sort((a, b) => a.offset - b.offset)
    if (new Set(ordered.map((split) => split.offset)).size !== ordered.length) {
      throw new StoryboundError(
        'VALIDATION_ERROR',
        'Each proposed split must have a unique location.'
      )
    }
    if (ordered.some((split) => split.offset <= 0 || split.offset >= original.content.length)) {
      throw new StoryboundError('VALIDATION_ERROR', 'A proposed split is outside this chapter.')
    }

    const segments = [original.content.slice(0, ordered[0].offset).trim()]
    const segmentRanges: Array<{ start: number; contentStart: number; end: number }> = [
      { start: 0, contentStart: 0, end: ordered[0].offset }
    ]
    for (let index = 0; index < ordered.length; index += 1) {
      const split = ordered[index]
      const lineEnd = original.content.indexOf('\n', split.offset)
      const contentStart = lineEnd < 0 ? original.content.length : lineEnd + 1
      const contentEnd = ordered[index + 1]?.offset ?? original.content.length
      segments.push(original.content.slice(contentStart, contentEnd).trim())
      segmentRanges.push({ start: split.offset, contentStart, end: contentEnd })
    }
    const timestamp = now()
    this.database.transaction(() => {
      this.saveChapterRevision(original, 'Before applying detected splits')
      this.database
        .prepare(
          `UPDATE chapters SET content = ?, word_count = ?, updated_at = ?,
            row_version = row_version + 1 WHERE id = ?`
        )
        .run(segments[0], countWords(segments[0]), timestamp, original.id)

      const currentOrder = this.chapterRows(original.book_id).map((chapter) => chapter.id)
      const insertionIndex = currentOrder.indexOf(original.id) + 1
      const newIds: string[] = []
      let temporaryPosition = currentOrder.length
      for (let index = 0; index < ordered.length; index += 1) {
        const split = ordered[index]
        const newId = randomUUID()
        const content = segments[index + 1]
        newIds.push(newId)
        this.database
          .prepare(
            `INSERT INTO chapters (
              id, book_id, title, content, position, created_at, updated_at, word_count
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            newId,
            original.book_id,
            split.title,
            content,
            temporaryPosition,
            timestamp,
            timestamp,
            countWords(content)
          )
        temporaryPosition += 1
      }
      const destinationIds = [original.id, ...newIds]
      const locateSegment = (location: number): { index: number; location: number } => {
        const absolute = Math.min(
          original.content.length,
          Math.max(0, location * original.content.length)
        )
        const index = Math.max(
          0,
          segmentRanges.findIndex(
            (range, rangeIndex) =>
              absolute >= range.start &&
              (absolute < range.end || rangeIndex === segmentRanges.length - 1)
          )
        )
        const range = segmentRanges[index]
        return {
          index,
          location: Math.min(
            1,
            Math.max(0, (absolute - range.start) / Math.max(1, range.end - range.start))
          )
        }
      }
      const bookmarkRows = this.database
        .prepare('SELECT id, location FROM bookmarks WHERE chapter_id = ? AND deleted_at IS NULL')
        .all(original.id) as Array<{ id: string; location: number }>
      const updateBookmark = this.database.prepare(
        `UPDATE bookmarks SET chapter_id = ?, location = ?, updated_at = ?,
          row_version = row_version + 1 WHERE id = ?`
      )
      for (const bookmark of bookmarkRows) {
        const located = locateSegment(bookmark.location)
        updateBookmark.run(destinationIds[located.index], located.location, timestamp, bookmark.id)
      }
      const anchorRows = this.database
        .prepare(
          `SELECT id, fallback_location, start_offset, end_offset
           FROM chapter_anchors WHERE chapter_id = ? AND deleted_at IS NULL`
        )
        .all(original.id) as Array<{
        id: string
        fallback_location: number
        start_offset: number | null
        end_offset: number | null
      }>
      const updateAnchor = this.database.prepare(
        `UPDATE chapter_anchors SET chapter_id = ?, fallback_location = ?,
          start_offset = ?, end_offset = ?, updated_at = ?, row_version = row_version + 1
         WHERE id = ?`
      )
      for (const anchor of anchorRows) {
        const located = locateSegment(anchor.fallback_location)
        const contentStart = segmentRanges[located.index].contentStart
        updateAnchor.run(
          destinationIds[located.index],
          located.location,
          anchor.start_offset === null ? null : Math.max(0, anchor.start_offset - contentStart),
          anchor.end_offset === null ? null : Math.max(0, anchor.end_offset - contentStart),
          timestamp,
          anchor.id
        )
      }
      const reading = this.database
        .prepare('SELECT scroll_position FROM reading_states WHERE chapter_id = ?')
        .get(original.id) as { scroll_position: number } | undefined
      if (reading) {
        const located = locateSegment(reading.scroll_position)
        this.database
          .prepare(
            `UPDATE reading_states SET chapter_id = ?, scroll_position = ?,
              has_finished_current_content = 0 WHERE chapter_id = ?`
          )
          .run(destinationIds[located.index], located.location, original.id)
      }
      currentOrder.splice(insertionIndex, 0, ...newIds)
      this.setChapterOrder(original.book_id, currentOrder)
      this.refreshBook(original.book_id, timestamp)
      this.recalculateReadingProgress(original.book_id)
    })()
    return this.listChapterSummaries(original.book_id)
  }

  getReadingState(id: string): ReadingState {
    const bookId = idSchema.parse(id)
    this.requireBook(bookId)
    const row = this.database
      .prepare('SELECT * FROM reading_states WHERE book_id = ?')
      .get(bookId) as ReadingRow | undefined
    return row
      ? this.mapReading(row)
      : {
          bookId,
          chapterId: null,
          scrollPosition: 0,
          progressPercentage: 0,
          lastReadAt: null,
          hasFinishedCurrentContent: false
        }
  }

  saveReadingState(input: SaveReadingStateInput): ReadingState {
    const parsed = saveReadingStateSchema.parse(input)
    this.requireBook(parsed.bookId)
    const chapter = this.requireChapter(parsed.chapterId)
    if (chapter.book_id !== parsed.bookId) {
      throw new StoryboundError('VALIDATION_ERROR', 'That chapter does not belong to this book.')
    }
    const timestamp = now()
    this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO reading_states (
            book_id, chapter_id, scroll_position, progress_percentage, last_read_at,
            has_finished_current_content
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(book_id) DO UPDATE SET
            chapter_id = excluded.chapter_id,
            scroll_position = excluded.scroll_position,
            progress_percentage = excluded.progress_percentage,
            last_read_at = excluded.last_read_at,
            has_finished_current_content = excluded.has_finished_current_content`
        )
        .run(
          parsed.bookId,
          parsed.chapterId,
          parsed.scrollPosition,
          parsed.progressPercentage,
          timestamp,
          parsed.hasFinishedCurrentContent ? 1 : 0
        )
      this.database
        .prepare('UPDATE books SET last_opened_at = ? WHERE id = ?')
        .run(timestamp, parsed.bookId)
    })()
    return this.getReadingState(parsed.bookId)
  }

  listBookmarks(id: string): Bookmark[] {
    const bookId = idSchema.parse(id)
    this.requireActiveStoryBook(bookId)
    const rows = this.database
      .prepare(
        `SELECT bm.id, bm.book_id, bm.chapter_id, c.title AS chapter_title,
          bm.location, bm.note, bm.label, bm.color, bm.created_at, bm.updated_at,
          bm.row_version, ${ANCHOR_SELECT}
         FROM bookmarks bm
         JOIN chapters c ON c.id = bm.chapter_id
         JOIN chapter_anchors anchor ON anchor.id = bm.anchor_id
         JOIN books book ON book.id = bm.book_id
         JOIN book_libraries book_library ON book_library.book_id = book.id
         WHERE bm.book_id = ? AND book_library.library_id = ?
           AND bm.deleted_at IS NULL AND c.deleted_at IS NULL
           AND anchor.deleted_at IS NULL AND book.deleted_at IS NULL
           AND book_library.deleted_at IS NULL
         ORDER BY bm.created_at DESC`
      )
      .all(bookId, this.activeLibraryId()) as BookmarkRow[]
    return rows.map((row) => this.mapBookmark(row))
  }

  createBookmark(input: CreateBookmarkInput): Bookmark {
    const parsed = createBookmarkSchema.parse(input)
    this.requireActiveStoryBook(parsed.bookId)
    const chapter = this.requireChapter(parsed.chapterId)
    if (chapter.book_id !== parsed.bookId) {
      throw new StoryboundError('VALIDATION_ERROR', 'That chapter does not belong to this book.')
    }
    const id = randomUUID()
    const timestamp = now()
    this.database.transaction(() => {
      const anchor = this.createAnchor(
        chapter,
        parsed.anchor ?? { fallbackLocation: parsed.location },
        timestamp
      )
      this.database
        .prepare(
          `INSERT INTO bookmarks (
            id, book_id, chapter_id, location, note, anchor_id, label, color,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          parsed.bookId,
          parsed.chapterId,
          anchor.fallback_location,
          parsed.note,
          anchor.id,
          parsed.label,
          parsed.color,
          timestamp,
          timestamp
        )
    })()
    return this.listBookmarks(parsed.bookId).find((bookmark) => bookmark.id === id)!
  }

  updateBookmark(input: UpdateBookmarkInput): Bookmark {
    const parsed = updateBookmarkSchema.parse(input)
    const existing = this.requireActiveBookmarkRow(parsed.id)
    const timestamp = now()
    this.database.transaction(() => {
      if (parsed.anchor) {
        const chapter = this.requireChapter(existing.chapter_id)
        this.updateAnchor(existing.anchor_id, chapter, parsed.anchor, timestamp)
      }
      const assignments: string[] = []
      const values: unknown[] = []
      if (parsed.note !== undefined) {
        assignments.push('note = ?')
        values.push(parsed.note)
      }
      if (parsed.label !== undefined) {
        assignments.push('label = ?')
        values.push(parsed.label)
      }
      if (parsed.color !== undefined) {
        assignments.push('color = ?')
        values.push(parsed.color)
      }
      if (parsed.anchor) {
        assignments.push('location = ?')
        values.push(parsed.anchor.fallbackLocation)
      }
      assignments.push('updated_at = ?', 'row_version = row_version + 1')
      values.push(timestamp, parsed.id, parsed.expectedRowVersion)
      const result = this.database
        .prepare(
          `UPDATE bookmarks SET ${assignments.join(', ')}
           WHERE id = ? AND row_version = ? AND deleted_at IS NULL`
        )
        .run(...values)
      if (result.changes === 0) this.throwVersionConflict('bookmark')
    })()
    return this.requireActiveBookmark(parsed.id)
  }

  removeBookmark(id: string): void {
    const bookmark = this.requireActiveBookmark(idSchema.parse(id))
    const timestamp = now()
    this.database.transaction(() => {
      this.database
        .prepare(
          `UPDATE bookmarks SET deleted_at = ?, updated_at = ?, row_version = row_version + 1
           WHERE id = ? AND deleted_at IS NULL`
        )
        .run(timestamp, timestamp, bookmark.id)
      this.database
        .prepare(
          `UPDATE chapter_anchors
           SET deleted_at = ?, updated_at = ?, row_version = row_version + 1
           WHERE id = ? AND deleted_at IS NULL`
        )
        .run(timestamp, timestamp, bookmark.anchor.id)
    })()
  }

  listAnnotations(id: string): Annotation[] {
    const bookId = idSchema.parse(id)
    this.requireActiveStoryBook(bookId)
    const rows = this.database
      .prepare(
        `SELECT annotation.id, annotation.book_id, chapter.id AS chapter_id,
          chapter.title AS chapter_title, annotation.kind, annotation.body, annotation.color,
          annotation.created_at, annotation.updated_at, annotation.row_version, ${ANCHOR_SELECT}
         FROM annotations annotation
         JOIN chapter_anchors anchor ON anchor.id = annotation.anchor_id
         JOIN chapters chapter ON chapter.id = anchor.chapter_id
         JOIN books book ON book.id = annotation.book_id
         JOIN book_libraries book_library ON book_library.book_id = book.id
         WHERE annotation.book_id = ? AND book_library.library_id = ?
           AND annotation.deleted_at IS NULL AND anchor.deleted_at IS NULL
           AND chapter.deleted_at IS NULL AND book.deleted_at IS NULL
           AND book_library.deleted_at IS NULL
         ORDER BY chapter.position, anchor.fallback_location, annotation.created_at`
      )
      .all(bookId, this.activeLibraryId()) as AnnotationRow[]
    return rows.map((row) => this.mapAnnotation(row))
  }

  createAnnotation(input: CreateAnnotationInput): Annotation {
    const parsed = createAnnotationSchema.parse(input)
    this.requireActiveStoryBook(parsed.bookId)
    const chapter = this.requireChapter(parsed.chapterId)
    if (chapter.book_id !== parsed.bookId) {
      throw new StoryboundError('VALIDATION_ERROR', 'That chapter does not belong to this book.')
    }
    const annotationId = randomUUID()
    const timestamp = now()
    this.database.transaction(() => {
      const anchor = this.createAnchor(chapter, parsed.anchor, timestamp)
      this.database
        .prepare(
          `INSERT INTO annotations (
            id, book_id, anchor_id, kind, body, color, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          annotationId,
          parsed.bookId,
          anchor.id,
          parsed.kind,
          parsed.body,
          parsed.color,
          timestamp,
          timestamp
        )
    })()
    return this.requireActiveAnnotation(annotationId)
  }

  updateAnnotation(input: UpdateAnnotationInput): Annotation {
    const parsed = updateAnnotationSchema.parse(input)
    const existing = this.requireActiveAnnotationRow(parsed.id)
    const timestamp = now()
    this.database.transaction(() => {
      if (parsed.anchor) {
        const chapter = this.requireChapter(existing.chapter_id)
        this.updateAnchor(existing.anchor_id, chapter, parsed.anchor, timestamp)
      }
      const assignments: string[] = []
      const values: unknown[] = []
      if (parsed.kind !== undefined) {
        assignments.push('kind = ?')
        values.push(parsed.kind)
      }
      if (parsed.body !== undefined) {
        assignments.push('body = ?')
        values.push(parsed.body)
      }
      if (parsed.color !== undefined) {
        assignments.push('color = ?')
        values.push(parsed.color)
      }
      assignments.push('updated_at = ?', 'row_version = row_version + 1')
      values.push(timestamp, parsed.id, parsed.expectedRowVersion)
      const result = this.database
        .prepare(
          `UPDATE annotations SET ${assignments.join(', ')}
           WHERE id = ? AND row_version = ? AND deleted_at IS NULL`
        )
        .run(...values)
      if (result.changes === 0) this.throwVersionConflict('annotation')
    })()
    return this.requireActiveAnnotation(parsed.id)
  }

  removeAnnotation(input: VersionedIdInput): void {
    const parsed = versionedIdSchema.parse(input)
    const annotation = this.requireActiveAnnotationRow(parsed.id)
    const timestamp = now()
    this.database.transaction(() => {
      const result = this.database
        .prepare(
          `UPDATE annotations
           SET deleted_at = ?, updated_at = ?, row_version = row_version + 1
           WHERE id = ? AND row_version = ? AND deleted_at IS NULL`
        )
        .run(timestamp, timestamp, parsed.id, parsed.expectedRowVersion)
      if (result.changes === 0) this.throwVersionConflict('annotation')
      this.database
        .prepare(
          `UPDATE chapter_anchors
           SET deleted_at = ?, updated_at = ?, row_version = row_version + 1
           WHERE id = ? AND deleted_at IS NULL`
        )
        .run(timestamp, timestamp, annotation.anchor_id)
    })()
  }

  listWritingGoals(): WritingGoal[] {
    const rows = this.database
      .prepare(
        `SELECT goal.*, book.title AS book_title
         FROM writing_goals goal
         LEFT JOIN books book ON book.id = goal.book_id AND book.deleted_at IS NULL
         WHERE goal.library_id = ? AND goal.deleted_at IS NULL
         ORDER BY goal.is_active DESC, goal.created_at DESC`
      )
      .all(this.activeLibraryId()) as WritingGoalRow[]
    return rows.map((row) => this.mapWritingGoal(row))
  }

  createWritingGoal(input: CreateWritingGoalInput): WritingGoal {
    const parsed = createWritingGoalSchema.parse(input)
    const libraryId = parsed.libraryId ?? this.activeLibraryId()
    if (libraryId !== this.activeLibraryId()) {
      throw new StoryboundError(
        'NOT_FOUND',
        'That writing goal is not available in the active library.'
      )
    }
    if (parsed.bookId) this.requireActiveStoryBook(parsed.bookId)
    const id = randomUUID()
    const timestamp = now()
    this.database
      .prepare(
        `INSERT INTO writing_goals (
          id, library_id, book_id, metric, period, target_value, start_on, end_on,
          timezone, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        libraryId,
        parsed.bookId ?? null,
        parsed.metric,
        parsed.period,
        parsed.targetValue,
        parsed.startOn,
        parsed.endOn ?? null,
        parsed.timezone ?? systemTimezone(),
        parsed.isActive ? 1 : 0,
        timestamp,
        timestamp
      )
    return this.requireActiveWritingGoal(id)
  }

  updateWritingGoal(input: UpdateWritingGoalInput): WritingGoal {
    const parsed = updateWritingGoalSchema.parse(input)
    const existing = this.requireActiveWritingGoal(parsed.id)
    if (parsed.bookId) this.requireActiveStoryBook(parsed.bookId)
    const startOn = parsed.startOn ?? existing.startOn
    const endOn = parsed.endOn === undefined ? existing.endOn : parsed.endOn
    if (endOn && endOn < startOn) {
      throw new StoryboundError(
        'VALIDATION_ERROR',
        'The goal end date must not precede its start date.'
      )
    }
    const columns = {
      bookId: 'book_id',
      metric: 'metric',
      period: 'period',
      targetValue: 'target_value',
      startOn: 'start_on',
      endOn: 'end_on',
      timezone: 'timezone',
      isActive: 'is_active'
    } as const
    const assignments: string[] = []
    const values: unknown[] = []
    for (const [field, column] of Object.entries(columns) as Array<
      [keyof typeof columns, (typeof columns)[keyof typeof columns]]
    >) {
      if (parsed[field] !== undefined) {
        assignments.push(`${column} = ?`)
        values.push(field === 'isActive' ? (parsed[field] ? 1 : 0) : parsed[field])
      }
    }
    assignments.push('updated_at = ?', 'row_version = row_version + 1')
    values.push(now(), parsed.id, parsed.expectedRowVersion)
    const result = this.database
      .prepare(
        `UPDATE writing_goals SET ${assignments.join(', ')}
         WHERE id = ? AND row_version = ? AND deleted_at IS NULL`
      )
      .run(...values)
    if (result.changes === 0) this.throwVersionConflict('writing goal')
    return this.requireActiveWritingGoal(parsed.id)
  }

  removeWritingGoal(input: VersionedIdInput): void {
    const parsed = versionedIdSchema.parse(input)
    this.requireActiveWritingGoal(parsed.id)
    const timestamp = now()
    const result = this.database
      .prepare(
        `UPDATE writing_goals
         SET deleted_at = ?, updated_at = ?, row_version = row_version + 1
         WHERE id = ? AND library_id = ? AND row_version = ? AND deleted_at IS NULL`
      )
      .run(timestamp, timestamp, parsed.id, this.activeLibraryId(), parsed.expectedRowVersion)
    if (result.changes === 0) this.throwVersionConflict('writing goal')
  }

  getWritingStats(input: WritingStatsQuery): WritingStats {
    const parsed = writingStatsQuerySchema.parse(input)
    const libraryId = this.activeLibraryId()
    if (parsed.bookId) this.requireActiveStoryBook(parsed.bookId)
    const bookClause = parsed.bookId ? ' AND event.book_id = ?' : ''
    const parameters = parsed.bookId
      ? [libraryId, parsed.from, parsed.to, parsed.bookId]
      : [libraryId, parsed.from, parsed.to]
    const days = this.database
      .prepare(
        `SELECT event.local_day, SUM(event.words_added) AS words_added,
          SUM(event.words_removed) AS words_removed,
          MAX(event.word_count_after) AS word_count_after
         FROM writing_events event
         WHERE event.library_id = ? AND event.local_day BETWEEN ? AND ?${bookClause}
         GROUP BY event.local_day ORDER BY event.local_day`
      )
      .all(...parameters) as Array<{
      local_day: string
      words_added: number
      words_removed: number
      word_count_after: number
    }>
    const books = this.database
      .prepare(
        `SELECT event.book_id, book.title AS book_title,
          SUM(event.words_added) AS words_added, SUM(event.words_removed) AS words_removed,
          book.total_word_count AS current_word_count
         FROM writing_events event JOIN books book ON book.id = event.book_id
         WHERE event.library_id = ? AND event.local_day BETWEEN ? AND ?${bookClause}
         GROUP BY event.book_id ORDER BY words_added DESC, book.title COLLATE NOCASE`
      )
      .all(...parameters) as Array<{
      book_id: string
      book_title: string
      words_added: number
      words_removed: number
      current_word_count: number
    }>
    const dayStats: WritingDayStats[] = days.map((row) => ({
      date: row.local_day,
      wordsAdded: row.words_added,
      wordsRemoved: row.words_removed,
      netWords: row.words_added - row.words_removed,
      wordCountAfter: row.word_count_after
    }))
    const bookStats: WritingBookStats[] = books.map((row) => ({
      bookId: row.book_id,
      bookTitle: row.book_title,
      wordsAdded: row.words_added,
      wordsRemoved: row.words_removed,
      netWords: row.words_added - row.words_removed,
      currentWordCount: row.current_word_count
    }))
    const totalWordsAdded = dayStats.reduce((total, day) => total + day.wordsAdded, 0)
    const totalWordsRemoved = dayStats.reduce((total, day) => total + day.wordsRemoved, 0)
    return {
      from: parsed.from,
      to: parsed.to,
      totalWordsAdded,
      totalWordsRemoved,
      netWords: totalWordsAdded - totalWordsRemoved,
      days: dayStats,
      books: bookStats,
      activeGoals: this.activeWritingGoalProgress()
    }
  }

  search(term: string): SearchResult[] {
    const parsed = searchTermSchema.parse(term)
    const fts = toFtsQuery(parsed)
    if (!fts) return []
    const bookRows = this.database
      .prepare(
        `SELECT b.id AS book_id, b.title AS book_title, b.blurb, bm25(book_search) AS rank
         FROM book_search JOIN books b ON b.id = book_search.book_id
         JOIN book_libraries bl ON bl.book_id = b.id AND bl.deleted_at IS NULL
         WHERE book_search MATCH ? AND b.deleted_at IS NULL AND bl.library_id = ?
         ORDER BY rank LIMIT 50`
      )
      .all(fts, this.activeLibraryId()) as Array<{
      book_id: string
      book_title: string
      blurb: string
      rank: number
    }>
    const chapterRows = this.database
      .prepare(
        `SELECT b.id AS book_id, b.title AS book_title, c.id AS chapter_id,
          c.title AS chapter_title,
          snippet(chapter_search, 3, '', '', ' … ', 32) AS excerpt,
          bm25(chapter_search) AS rank
         FROM chapter_search
         JOIN chapters c ON c.id = chapter_search.chapter_id
         JOIN books b ON b.id = chapter_search.book_id
         JOIN book_libraries bl ON bl.book_id = b.id AND bl.deleted_at IS NULL
         WHERE chapter_search MATCH ? AND b.deleted_at IS NULL AND c.deleted_at IS NULL
           AND bl.library_id = ?
         ORDER BY rank LIMIT 100`
      )
      .all(fts, this.activeLibraryId()) as Array<{
      book_id: string
      book_title: string
      chapter_id: string
      chapter_title: string
      excerpt: string
      rank: number
    }>
    const storyEntityRows = this.database
      .prepare(
        `SELECT book.id AS book_id, book.title AS book_title, entity.id AS entity_id,
          entity.entity_type, entity.title AS entity_title,
          snippet(story_entity_search, 4, '', '', ' … ', 32) AS excerpt,
          bm25(story_entity_search) AS rank
         FROM story_entity_search
         JOIN story_entities entity ON entity.id = story_entity_search.entity_id
         JOIN books book ON book.id = story_entity_search.book_id
         JOIN book_libraries book_library
           ON book_library.book_id = book.id AND book_library.deleted_at IS NULL
         WHERE story_entity_search MATCH ? AND entity.deleted_at IS NULL
           AND book.deleted_at IS NULL AND book_library.library_id = ?
         ORDER BY rank LIMIT 100`
      )
      .all(fts, this.activeLibraryId()) as Array<{
      book_id: string
      book_title: string
      entity_id: string
      entity_type: StoryEntityType
      entity_title: string
      excerpt: string
      rank: number
    }>

    return [
      ...bookRows.map<SearchResult>((row) => ({
        type: 'book',
        bookId: row.book_id,
        bookTitle: row.book_title,
        chapterId: null,
        chapterTitle: null,
        excerpt: normalizeSearch(row.book_title).includes(normalizeSearch(parsed))
          ? row.book_title
          : createExcerpt(row.blurb, parsed),
        rank: row.rank
      })),
      ...chapterRows.map<SearchResult>((row) => ({
        type: 'chapter',
        bookId: row.book_id,
        bookTitle: row.book_title,
        chapterId: row.chapter_id,
        chapterTitle: row.chapter_title,
        excerpt: normalizeSearch(row.chapter_title).includes(normalizeSearch(parsed))
          ? row.chapter_title
          : row.excerpt,
        rank: row.rank
      })),
      ...storyEntityRows.map<SearchResult>((row) => ({
        type: 'story-entity',
        bookId: row.book_id,
        bookTitle: row.book_title,
        chapterId: null,
        chapterTitle: row.entity_title,
        storyEntityId: row.entity_id,
        storyEntityType: row.entity_type,
        excerpt: row.excerpt,
        rank: row.rank
      }))
    ].sort((left, right) => left.rank - right.rank)
  }

  locateSearchHit(input: LocateSearchHitInput): SearchHit {
    const parsed = locateSearchHitSchema.parse(input)
    const row = this.database
      .prepare(
        `SELECT c.content
         FROM chapters c JOIN books b ON b.id = c.book_id
         JOIN book_libraries bl ON bl.book_id = b.id AND bl.deleted_at IS NULL
         WHERE c.id = ? AND b.deleted_at IS NULL AND c.deleted_at IS NULL
           AND bl.library_id = ?`
      )
      .get(parsed.chapterId, this.activeLibraryId()) as { content: string } | undefined
    if (!row) throw new StoryboundError('NOT_FOUND', 'That search result is no longer available.')

    const source = row.content.toLocaleLowerCase()
    const requested = parsed.term.trim()
    const tokens = requested.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu) ?? []
    const candidates = [requested, ...tokens].filter(
      (candidate, index, values) =>
        candidate.length > 0 && values.findIndex((value) => value === candidate) === index
    )
    const matched = candidates.find((candidate) => source.includes(candidate.toLocaleLowerCase()))
    const matchedTerm = matched ?? tokens[0] ?? requested
    let offset = matched ? source.indexOf(matched.toLocaleLowerCase()) : -1
    if (offset < 0) {
      const normalizedSource = normalizeSearch(row.content)
      offset = normalizedSource.indexOf(normalizeSearch(matchedTerm))
    }

    return {
      chapterId: parsed.chapterId,
      location: offset < 0 ? 0 : Math.min(1, Math.max(0, offset / Math.max(1, source.length))),
      matchedTerm
    }
  }

  getSettings(): ApplicationSettings {
    const row = this.database
      .prepare('SELECT * FROM application_settings WHERE id = 1')
      .get() as SettingsRow
    return this.mapSettings(row)
  }

  updateSettings(input: Partial<ApplicationSettings>): ApplicationSettings {
    const parsed = settingsUpdateSchema.parse(input)
    if (Object.keys(parsed).length === 0) return this.getSettings()
    const columns: Record<keyof ApplicationSettings, string> = {
      appTheme: 'app_theme',
      reducedMotion: 'reduced_motion',
      hasSeenGettingStarted: 'has_seen_getting_started',
      readerTheme: 'reader_theme',
      readerFont: 'reader_font',
      readerFontSize: 'reader_font_size',
      lineHeight: 'line_height',
      columnWidth: 'column_width',
      paragraphSpacing: 'paragraph_spacing',
      paragraphIndentation: 'paragraph_indentation',
      textAlignment: 'text_alignment',
      defaultLibrarySort: 'default_library_sort'
    }
    const assignments: string[] = []
    const values: unknown[] = []
    for (const [key, value] of Object.entries(parsed) as Array<
      [keyof ApplicationSettings, ApplicationSettings[keyof ApplicationSettings]]
    >) {
      assignments.push(`${columns[key]} = ?`)
      values.push(typeof value === 'boolean' ? (value ? 1 : 0) : value)
    }
    this.database
      .prepare(`UPDATE application_settings SET ${assignments.join(', ')} WHERE id = 1`)
      .run(...values)
    return this.getSettings()
  }

  getRecoveryDraft(id: string): RecoveryDraft | null {
    const chapterId = idSchema.parse(id)
    this.requireChapter(chapterId)
    const row = this.database
      .prepare('SELECT * FROM recovery_drafts WHERE chapter_id = ?')
      .get(chapterId) as RecoveryRow | undefined
    return row
      ? { chapterId: row.chapter_id, title: row.title, content: row.content, savedAt: row.saved_at }
      : null
  }

  saveRecoveryDraft(input: SaveRecoveryDraftInput): RecoveryDraft {
    const parsed = saveRecoveryDraftSchema.parse(input)
    this.requireChapter(parsed.chapterId)
    const timestamp = now()
    this.database
      .prepare(
        `INSERT INTO recovery_drafts (chapter_id, title, content, saved_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(chapter_id) DO UPDATE SET
           title = excluded.title, content = excluded.content, saved_at = excluded.saved_at`
      )
      .run(parsed.chapterId, parsed.title, parsed.content, timestamp)
    return { ...parsed, savedAt: timestamp }
  }

  clearRecoveryDraft(id: string): void {
    const chapterId = idSchema.parse(id)
    this.database.prepare('DELETE FROM recovery_drafts WHERE chapter_id = ?').run(chapterId)
  }

  listBackupPlans(): BackupPlan[] {
    const rows = this.database
      .prepare(
        `SELECT id, destination_path, cadence, retention_count, enabled, next_run_at,
          created_at, updated_at
         FROM backup_plans
         WHERE library_id = ?
         ORDER BY created_at DESC`
      )
      .all(this.activeLibraryId()) as BackupPlanRow[]
    return rows.map((row) => this.mapBackupPlan(row))
  }

  createBackupPlan(destinationPath: string, input: BackupScheduleInput): BackupPlan {
    const parsed = backupScheduleSchema.parse(input)
    const destination = resolve(destinationPath)
    if (!lstatSync(destination).isDirectory()) {
      throw new StoryboundError('FILE_ERROR', 'Choose a folder for scheduled backups.')
    }
    const timestamp = now()
    const id = randomUUID()
    this.database
      .prepare(
        `INSERT INTO backup_plans (
          id, machine_id, library_id, destination_path, cadence, retention_count,
          enabled, next_run_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
      )
      .run(
        id,
        randomUUID(),
        this.activeLibraryId(),
        destination,
        parsed.cadence,
        parsed.retentionCount,
        nextBackupRun(parsed.cadence),
        timestamp,
        timestamp
      )
    return this.requireBackupPlan(id)
  }

  updateBackupPlan(input: UpdateBackupPlanInput): BackupPlan {
    const parsed = updateBackupPlanSchema.parse(input)
    this.requireBackupPlan(parsed.id)
    const timestamp = now()
    this.database
      .prepare(
        `UPDATE backup_plans
         SET cadence = ?, retention_count = ?, enabled = ?, next_run_at = ?, updated_at = ?
         WHERE id = ? AND library_id = ?`
      )
      .run(
        parsed.cadence,
        parsed.retentionCount,
        parsed.enabled ? 1 : 0,
        parsed.enabled ? nextBackupRun(parsed.cadence) : null,
        timestamp,
        parsed.id,
        this.activeLibraryId()
      )
    return this.requireBackupPlan(parsed.id)
  }

  removeBackupPlan(id: string): void {
    const plan = this.requireBackupPlan(idSchema.parse(id))
    this.database.prepare('DELETE FROM backup_plans WHERE id = ?').run(plan.id)
  }

  async runBackupPlan(id: string, appVersion: string): Promise<BackupRun> {
    const plan = this.requireBackupPlan(idSchema.parse(id))
    const runId = randomUUID()
    const startedAt = now()
    this.database
      .prepare(
        `INSERT INTO backup_runs (
          id, plan_id, library_id, started_at, status, app_version
        ) VALUES (?, ?, ?, ?, 'running', ?)`
      )
      .run(runId, plan.id, this.activeLibraryId(), startedAt, appVersion)
    const outputPath = join(
      plan.destinationPath,
      `Storybound Scheduled ${startedAt.replaceAll(':', '-').replaceAll('.', '-')}.storybound-backup`
    )
    try {
      await this.exportLibraryToPath(outputPath, appVersion)
      const completedAt = now()
      const bytes = statSync(outputPath).size
      const checksum = createHash('sha256').update(readFileSync(outputPath)).digest('hex')
      this.database.transaction(() => {
        this.database
          .prepare(
            `UPDATE backup_runs
             SET completed_at = ?, status = 'succeeded', output_path = ?, byte_size = ?,
               sha256 = ?, verified_at = ?
             WHERE id = ?`
          )
          .run(completedAt, outputPath, bytes, checksum, completedAt, runId)
        this.database
          .prepare('UPDATE backup_plans SET next_run_at = ?, updated_at = ? WHERE id = ?')
          .run(nextBackupRun(plan.cadence), completedAt, plan.id)
      })()
      this.enforceBackupRetention(plan)
      return this.requireBackupRun(runId)
    } catch (error) {
      const completedAt = now()
      this.database
        .prepare(
          `UPDATE backup_runs
           SET completed_at = ?, status = 'failed', output_path = ?, error_code = ?,
             error_message = ?
           WHERE id = ?`
        )
        .run(
          completedAt,
          existsSync(outputPath) ? outputPath : null,
          error instanceof StoryboundError ? error.code : 'FILE_ERROR',
          error instanceof Error ? error.message : 'Scheduled backup failed.',
          runId
        )
      this.database
        .prepare('UPDATE backup_plans SET next_run_at = ?, updated_at = ? WHERE id = ?')
        .run(nextBackupRun(plan.cadence), completedAt, plan.id)
      if (error instanceof StoryboundError) throw error
      throw new StoryboundError('FILE_ERROR', 'The scheduled backup could not be created.', error)
    }
  }

  async runDueBackups(appVersion: string): Promise<BackupRun[]> {
    const ids = this.database
      .prepare(
        `SELECT id FROM backup_plans
         WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?
         ORDER BY next_run_at`
      )
      .pluck()
      .all(now()) as string[]
    const completed: BackupRun[] = []
    for (const id of ids) {
      try {
        completed.push(await this.runBackupPlan(id, appVersion))
      } catch {
        // The failure is recorded in backup_runs; the next plan remains scheduled.
      }
    }
    return completed
  }

  integrityCheck(): IntegrityResult {
    try {
      const rows = this.database.pragma('integrity_check') as Array<{ integrity_check: string }>
      const foreignKeys = this.database.pragma('foreign_key_check') as Array<
        Record<string, unknown>
      >
      const details = [
        ...rows.map((row) => row.integrity_check),
        ...foreignKeys.map((row) => `Foreign-key issue: ${JSON.stringify(row)}`)
      ].join('\n')
      const healthy =
        rows.length === 1 && rows[0]?.integrity_check === 'ok' && foreignKeys.length === 0
      return { healthy, details: healthy ? 'Database integrity check passed.' : details }
    } catch (error) {
      throw new StoryboundError(
        'INTEGRITY_ERROR',
        'The database integrity check could not run.',
        error
      )
    }
  }

  async exportBookToPath(bookId: string, targetPath: string): Promise<OperationResult> {
    const id = idSchema.parse(bookId)
    const book = this.getBook(id)
    const chapters = this.chapterRows(id).map((row) =>
      this.mapChapter(row, this.isChapterRead(row))
    )
    const bookmarks = this.listBookmarks(id)
    const readingState = this.getReadingState(id)
    const coverFile = this.requireBook(id).cover_image_path
    const coverPath = coverFile ? managedCoverPath(this.paths.media, coverFile) : null
    const manifest = createBookPackageManifest({
      book,
      chapters,
      bookmarks,
      readingState,
      coverFile: coverFile && coverPath && existsSync(coverPath) ? coverFile : null
    })
    const zip = new AdmZip()
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'))
    const markdown = [
      `# ${book.title}`,
      '',
      book.blurb,
      '',
      ...chapters.flatMap((chapter) => [`## ${chapter.title}`, '', chapter.content, ''])
    ].join('\n')
    zip.addFile('book.md', Buffer.from(markdown, 'utf8'))
    for (const chapter of chapters) {
      zip.addFile(
        `chapters/${markdownFilename(chapter.title, chapter.position)}`,
        Buffer.from(`# ${chapter.title}\n\n${chapter.content}\n`, 'utf8')
      )
    }
    if (manifest.book.coverFile) {
      zip.addLocalFile(join(this.paths.media, manifest.book.coverFile), 'media')
    }
    assertPortableExportSize(zip, 'book package')
    this.writeZipAtomically(zip, targetPath)
    return { path: targetPath, message: `Exported “${book.title}”.` }
  }

  async importBookFromPath(sourcePath: string): Promise<OperationResult> {
    this.assertImportSize(sourcePath)
    let zip: AdmZip
    try {
      zip = new AdmZip(sourcePath)
      validateArchive(zip)
    } catch (error) {
      if (error instanceof StoryboundError) throw error
      throw new StoryboundError(
        'IMPORT_ERROR',
        'Storybound could not open that book package.',
        error
      )
    }
    const parsed = bookPackageManifestSchema.safeParse(parseJsonEntry(zip, 'manifest.json'))
    if (!parsed.success) {
      throw new StoryboundError(
        'IMPORT_ERROR',
        'That package is not a valid Storybound book export.',
        parsed.error
      )
    }
    const manifest = parsed.data
    const chapterIds = new Set(manifest.chapters.map((chapter) => chapter.id))
    if (
      chapterIds.size !== manifest.chapters.length ||
      new Set(manifest.chapters.map((chapter) => chapter.position)).size !==
        manifest.chapters.length ||
      manifest.bookmarks.some((bookmark) => !chapterIds.has(bookmark.chapterId)) ||
      (manifest.readingState?.chapterId && !chapterIds.has(manifest.readingState.chapterId))
    ) {
      throw new StoryboundError(
        'IMPORT_ERROR',
        'The book package contains inconsistent chapter references.'
      )
    }

    const newBookId = randomUUID()
    const newChapterIds = new Map(manifest.chapters.map((chapter) => [chapter.id, randomUUID()]))
    let coverFilename: string | null = null
    if (manifest.book.coverFile) {
      const entry = zip.getEntry(`media/${manifest.book.coverFile}`)
      if (!entry || entry.isDirectory || entry.header.size > MAX_COVER_BYTES) {
        throw new StoryboundError(
          'IMPORT_ERROR',
          'The exported cover image is missing or too large.'
        )
      }
      const buffer = entry.getData()
      const extension = coverExtension(buffer, manifest.book.coverFile)
      coverFilename = `${randomUUID()}${extension}`
      try {
        writeFileSync(join(this.paths.media, coverFilename), buffer, { flag: 'wx' })
      } catch (error) {
        throw new StoryboundError(
          'FILE_ERROR',
          'The imported cover image could not be saved.',
          error
        )
      }
    }

    try {
      this.database.transaction(() => {
        const importedAt = now()
        this.database
          .prepare(
            `INSERT INTO books (
              id, title, subtitle, series_name, series_position, author_name, blurb, status,
              language_code, source_label, source_url, personal_notes, rating, favourited_at,
              pinned_at, cover_image_path, cover_style, cover_position_x, cover_position_y,
              created_at, updated_at, completed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            newBookId,
            manifest.book.title,
            manifest.book.subtitle,
            manifest.book.seriesName,
            manifest.book.seriesPosition,
            manifest.book.authorName,
            manifest.book.blurb,
            manifest.book.status,
            manifest.book.languageCode,
            manifest.book.sourceLabel,
            manifest.book.sourceUrl,
            manifest.book.personalNotes,
            manifest.book.rating,
            manifest.book.isFavourite ? importedAt : null,
            manifest.book.isPinned ? importedAt : null,
            coverFilename,
            manifest.book.coverStyle,
            manifest.book.coverPositionX,
            manifest.book.coverPositionY,
            manifest.book.createdAt,
            importedAt,
            manifest.book.completedAt
          )
        for (const [position, chapter] of [...manifest.chapters]
          .sort((left, right) => left.position - right.position)
          .entries()) {
          this.database
            .prepare(
              `INSERT INTO chapters (
                id, book_id, title, content, position, created_at, updated_at, word_count
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              newChapterIds.get(chapter.id),
              newBookId,
              chapter.title,
              chapter.content,
              position,
              chapter.createdAt,
              chapter.updatedAt,
              countWords(chapter.content)
            )
        }
        for (const bookmark of manifest.bookmarks) {
          const chapterId = newChapterIds.get(bookmark.chapterId)
          if (!chapterId) {
            throw new StoryboundError(
              'IMPORT_ERROR',
              'An imported bookmark refers to a missing chapter.'
            )
          }
          const anchor = this.createAnchor(
            this.requireChapter(chapterId),
            bookmark.anchor ?? { fallbackLocation: bookmark.location },
            bookmark.createdAt
          )
          this.database
            .prepare(
              `INSERT INTO bookmarks (
                id, book_id, chapter_id, location, note, label, color, anchor_id,
                created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              randomUUID(),
              newBookId,
              chapterId,
              bookmark.location,
              bookmark.note,
              bookmark.label,
              bookmark.color,
              anchor.id,
              bookmark.createdAt,
              importedAt
            )
        }
        if (manifest.readingState) {
          this.database
            .prepare(
              `INSERT INTO reading_states (
                book_id, chapter_id, scroll_position, progress_percentage, last_read_at,
                has_finished_current_content
              ) VALUES (?, ?, ?, ?, ?, ?)`
            )
            .run(
              newBookId,
              manifest.readingState.chapterId
                ? newChapterIds.get(manifest.readingState.chapterId)
                : null,
              manifest.readingState.scrollPosition,
              manifest.readingState.progressPercentage,
              manifest.readingState.lastReadAt,
              manifest.readingState.hasFinishedCurrentContent ? 1 : 0
            )
        }
        this.refreshBook(newBookId, importedAt)
      })()
    } catch (error) {
      if (coverFilename) safeRemove(join(this.paths.media, coverFilename))
      throw error
    }

    return {
      importedBookId: newBookId,
      message: `Imported “${manifest.book.title}” as a separate copy.`
    }
  }

  async exportLibraryToPath(targetPath: string, appVersion: string): Promise<OperationResult> {
    const temporaryDatabase = join(this.paths.backups, `.backup-${randomUUID()}.sqlite`)
    try {
      await this.database.backup(temporaryDatabase)
      const mediaFiles = this.validatedBackupMediaFiles(temporaryDatabase)
      const zip = new AdmZip()
      const manifest = createLibraryBackupManifest(appVersion)
      const manifestData = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8')
      let totalSize = manifestData.length + statSync(temporaryDatabase).size
      for (const filename of mediaFiles) {
        const mediaPath = join(this.paths.media, filename)
        totalSize += statSync(mediaPath).size
        if (totalSize > MAX_EXPORT_BYTES) {
          throw new StoryboundError(
            'FILE_ERROR',
            "This library backup would exceed Storybound's 500 MB portable export limit and could not be restored safely. Reduce large cover images or story content, then try again."
          )
        }
      }
      zip.addFile('backup-manifest.json', manifestData)
      zip.addLocalFile(temporaryDatabase, '', manifest.databaseFile)
      for (const filename of mediaFiles) {
        zip.addLocalFile(join(this.paths.media, filename), manifest.mediaDirectory)
      }
      assertPortableExportSize(zip, 'library backup')
      this.writeZipAtomically(zip, targetPath)
      return { path: targetPath, message: 'Your Storybound library backup is ready.' }
    } catch (error) {
      if (error instanceof StoryboundError) throw error
      throw new StoryboundError(
        'FILE_ERROR',
        'Storybound could not create the library backup.',
        error
      )
    } finally {
      safeRemove(temporaryDatabase)
    }
  }

  async restoreLibraryFromPath(sourcePath: string): Promise<OperationResult> {
    this.assertImportSize(sourcePath)
    let zip: AdmZip
    try {
      zip = new AdmZip(sourcePath)
      validateArchive(zip)
    } catch (error) {
      if (error instanceof StoryboundError) throw error
      throw new StoryboundError(
        'IMPORT_ERROR',
        'Storybound could not open that library backup.',
        error
      )
    }
    const parsed = libraryBackupManifestSchema.safeParse(
      parseJsonEntry(zip, 'backup-manifest.json')
    )
    if (!parsed.success) {
      throw new StoryboundError(
        'IMPORT_ERROR',
        'That file is not a valid Storybound library backup.',
        parsed.error
      )
    }
    const manifest = parsed.data
    const databaseEntry = zip.getEntry(manifest.databaseFile)
    if (!databaseEntry || databaseEntry.isDirectory) {
      throw new StoryboundError('IMPORT_ERROR', 'The library backup does not contain its database.')
    }

    const restoreId = randomUUID()
    const stagedDatabase = join(this.paths.root, `.restore-${restoreId}.sqlite`)
    const stagedMedia = join(this.paths.root, `.restore-media-${restoreId}`)
    const stagedMigrationBackups = join(this.paths.root, `.restore-migrations-${restoreId}`)
    mkdirSync(stagedMedia, { recursive: true })
    mkdirSync(stagedMigrationBackups, { recursive: true })
    try {
      writeFileSync(stagedDatabase, databaseEntry.getData(), { flag: 'wx' })
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory || !entry.entryName.startsWith(`${manifest.mediaDirectory}/`))
          continue
        const filename = entry.entryName.slice(manifest.mediaDirectory.length + 1)
        if (
          basename(filename) !== filename ||
          !COVER_EXTENSIONS.has(extname(filename).toLocaleLowerCase())
        ) {
          throw new StoryboundError(
            'IMPORT_ERROR',
            'The backup contains an invalid media filename.'
          )
        }
        const data = entry.getData()
        if (data.length > MAX_COVER_BYTES) {
          throw new StoryboundError('IMPORT_ERROR', 'A cover in the backup is too large.')
        }
        coverExtension(data, filename)
        writeFileSync(join(stagedMedia, filename), data, { flag: 'wx' })
      }
      const candidate = new Database(stagedDatabase)
      try {
        configureDatabase(candidate)
        const integrity = candidate.pragma('integrity_check') as Array<{ integrity_check: string }>
        if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') {
          throw new StoryboundError(
            'INTEGRITY_ERROR',
            'The backup database did not pass its integrity check.'
          )
        }
        const version = Number(candidate.pragma('user_version', { simple: true }))
        if (version > LATEST_SCHEMA_VERSION) {
          throw new StoryboundError(
            'IMPORT_ERROR',
            'This backup uses an unsupported Storybound database version.'
          )
        }
        try {
          await migrateDatabase(candidate, {
            root: this.paths.root,
            database: stagedDatabase,
            media: stagedMedia,
            backups: stagedMigrationBackups,
            logs: this.paths.logs
          })
        } catch (error) {
          if (error instanceof StoryboundError && error.code === 'IMPORT_ERROR') throw error
          throw new StoryboundError(
            'IMPORT_ERROR',
            'The backup database has an incompatible library structure.',
            error
          )
        }
        candidate.pragma('wal_checkpoint(TRUNCATE)')
      } finally {
        candidate.close()
      }
      this.validateRestoredDatabase(stagedDatabase, stagedMedia)
    } catch (error) {
      safeRemove(stagedDatabase)
      safeRemove(stagedMedia)
      safeRemove(stagedMigrationBackups)
      if (error instanceof StoryboundError) throw error
      throw new StoryboundError('IMPORT_ERROR', 'The library backup could not be validated.', error)
    }

    const safetyDatabase = join(this.paths.backups, `before-restore-${restoreId}.sqlite`)
    const previousDatabase = join(this.paths.root, `.previous-${restoreId}.sqlite`)
    const safetyMedia = join(this.paths.backups, `before-restore-media-${restoreId}`)
    try {
      await this.database.backup(safetyDatabase)
    } catch (error) {
      safeRemove(stagedDatabase)
      safeRemove(stagedMedia)
      throw new StoryboundError(
        'FILE_ERROR',
        'Storybound could not create a safety copy before restoring the backup.',
        error
      )
    }

    let previousDatabaseMoved = false
    let previousMediaMoved = false
    let restoredDatabaseInstalled = false
    let restoredMediaInstalled = false
    try {
      this.close()
      safeRemove(`${this.paths.database}-wal`)
      safeRemove(`${this.paths.database}-shm`)
      renameSync(this.paths.database, previousDatabase)
      previousDatabaseMoved = true
      if (existsSync(this.paths.media)) {
        renameSync(this.paths.media, safetyMedia)
        previousMediaMoved = true
      }
      renameSync(stagedMedia, this.paths.media)
      restoredMediaInstalled = true
      renameSync(stagedDatabase, this.paths.database)
      restoredDatabaseInstalled = true
      this.database = new Database(this.paths.database)
      configureDatabase(this.database)
      const healthy = this.integrityCheck()
      if (!healthy.healthy) throw new Error(healthy.details)
      safeRemove(previousDatabase)
    } catch (error) {
      if (this.database.open) this.database.close()
      if (restoredDatabaseInstalled) safeRemove(this.paths.database)
      if (restoredMediaInstalled) safeRemove(this.paths.media)
      if (previousDatabaseMoved && existsSync(previousDatabase)) {
        renameSync(previousDatabase, this.paths.database)
      } else if (!existsSync(this.paths.database) && existsSync(safetyDatabase)) {
        copyFileSync(safetyDatabase, this.paths.database)
      }
      if (previousMediaMoved && existsSync(safetyMedia)) {
        renameSync(safetyMedia, this.paths.media)
      } else {
        mkdirSync(this.paths.media, { recursive: true })
      }
      try {
        this.database = new Database(this.paths.database)
        configureDatabase(this.database)
      } catch (reopenError) {
        throw new StoryboundError(
          'DATABASE_ERROR',
          'Storybound could not reopen your previous library. A safety copy remains in Backups.',
          reopenError
        )
      }
      throw new StoryboundError(
        'IMPORT_ERROR',
        'The backup could not be restored, so Storybound returned to your previous library.',
        error
      )
    } finally {
      safeRemove(stagedDatabase)
      safeRemove(stagedMedia)
      safeRemove(stagedMigrationBackups)
    }
    return {
      message:
        'Your Storybound library was restored successfully. A safety copy of the previous library remains in Backups.',
      path: sourcePath
    }
  }

  private mapBackupRun(row: BackupRunRow): BackupRun {
    return {
      id: row.id,
      planId: row.plan_id,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      status: row.status,
      outputPath: row.output_path,
      byteSize: row.byte_size,
      verifiedAt: row.verified_at,
      errorMessage: row.error_message
    }
  }

  private mapBackupPlan(row: BackupPlanRow): BackupPlan {
    const lastRun = this.database
      .prepare(
        `SELECT id, plan_id, started_at, completed_at, status, output_path, byte_size,
          verified_at, error_message
         FROM backup_runs WHERE plan_id = ? ORDER BY started_at DESC LIMIT 1`
      )
      .get(row.id) as BackupRunRow | undefined
    return {
      id: row.id,
      destinationPath: row.destination_path,
      cadence: row.cadence,
      retentionCount: row.retention_count,
      enabled: boolean(row.enabled),
      nextRunAt: row.next_run_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastRun: lastRun ? this.mapBackupRun(lastRun) : null
    }
  }

  private requireBackupPlan(id: string): BackupPlan {
    const row = this.database
      .prepare(
        `SELECT id, destination_path, cadence, retention_count, enabled, next_run_at,
          created_at, updated_at
         FROM backup_plans WHERE id = ? AND library_id = ?`
      )
      .get(id, this.activeLibraryId()) as BackupPlanRow | undefined
    if (!row) throw new StoryboundError('NOT_FOUND', 'That backup schedule could not be found.')
    return this.mapBackupPlan(row)
  }

  private requireBackupRun(id: string): BackupRun {
    const row = this.database
      .prepare(
        `SELECT run.id, run.plan_id, run.started_at, run.completed_at, run.status,
          run.output_path, run.byte_size, run.verified_at, run.error_message
         FROM backup_runs run JOIN backup_plans plan ON plan.id = run.plan_id
         WHERE run.id = ? AND plan.library_id = ?`
      )
      .get(id, this.activeLibraryId()) as BackupRunRow | undefined
    if (!row) throw new StoryboundError('NOT_FOUND', 'That backup run could not be found.')
    return this.mapBackupRun(row)
  }

  private enforceBackupRetention(plan: BackupPlan): void {
    const expired = this.database
      .prepare(
        `SELECT id, output_path
         FROM backup_runs
         WHERE plan_id = ? AND status = 'succeeded' AND output_path IS NOT NULL
         ORDER BY completed_at DESC LIMIT -1 OFFSET ?`
      )
      .all(plan.id, plan.retentionCount) as Array<{ id: string; output_path: string }>
    for (const run of expired) {
      const output = resolve(run.output_path)
      if (
        dirname(output) === resolve(plan.destinationPath) &&
        basename(output).startsWith('Storybound Scheduled ') &&
        output.endsWith('.storybound-backup')
      ) {
        safeRemove(output)
        this.database.prepare('DELETE FROM backup_runs WHERE id = ?').run(run.id)
      }
    }
  }

  private mapBook(row: BookRow): BookSummary {
    const coverPath = row.cover_image_path
      ? managedCoverPath(this.paths.media, row.cover_image_path)
      : null
    const hasCover = coverPath !== null && existsSync(coverPath)
    return {
      id: row.id,
      libraryId: row.library_id,
      title: row.title,
      subtitle: row.subtitle,
      seriesName: row.series_name,
      seriesPosition: row.series_position,
      authorName: row.author_name,
      blurb: row.blurb,
      status: row.status,
      languageCode: row.language_code,
      sourceLabel: row.source_label,
      sourceUrl: row.source_url,
      personalNotes: row.personal_notes,
      rating: row.rating,
      isFavourite: row.favourited_at !== null,
      isPinned: row.pinned_at !== null,
      coverImageUrl: hasCover
        ? `storybound-media://covers/${encodeURIComponent(row.cover_image_path!)}`
        : null,
      coverStyle: row.cover_style,
      coverPositionX: row.cover_position_x,
      coverPositionY: row.cover_position_y,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastOpenedAt: row.last_opened_at,
      completedAt: row.completed_at,
      totalWordCount: row.total_word_count,
      chapterCount: row.chapter_count,
      progressPercentage: row.progress_percentage,
      hasFinishedCurrentContent: boolean(row.has_finished_current_content),
      isArchived: boolean(row.is_archived)
    }
  }

  private mapLibrary(row: LibraryRow): Library {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      isActive: boolean(row.is_active),
      bookCount: row.book_count
    }
  }

  private mapTag(row: TagRow): Tag {
    return {
      id: row.id,
      libraryId: row.library_id,
      name: row.name,
      color: row.color,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      bookCount: row.book_count
    }
  }

  private mapCollection(row: CollectionRow): Collection {
    return {
      id: row.id,
      libraryId: row.library_id,
      name: row.name,
      description: row.description,
      color: row.color,
      icon: row.icon,
      position: row.position,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      bookCount: row.book_count
    }
  }

  private mapSavedFilter(row: SavedFilterRow): SavedFilter {
    try {
      const query = libraryQuerySchema.parse(JSON.parse(row.definition_json)) ?? {}
      return {
        id: row.id,
        libraryId: row.library_id,
        name: row.name,
        query,
        position: row.position,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }
    } catch (error) {
      throw new StoryboundError(
        'DATABASE_ERROR',
        `The saved filter “${row.name}” is damaged and could not be loaded.`,
        error
      )
    }
  }

  private mapStoryEntity(row: StoryEntityRow): StoryEntity {
    try {
      return {
        id: row.id,
        bookId: row.book_id,
        entityType: row.entity_type,
        title: row.title,
        summary: row.summary,
        bodyMarkdown: row.body_markdown,
        detailsVersion: row.details_version,
        details: storyEntityDetailsSchema.parse(JSON.parse(row.details_json)),
        position: row.position,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        rowVersion: row.row_version
      }
    } catch (error) {
      throw new StoryboundError(
        'DATABASE_ERROR',
        `The story-bible entry “${row.title}” has damaged structured details.`,
        error
      )
    }
  }

  private mapStoryEntityChapterLink(row: StoryEntityChapterLinkRow): StoryEntityChapterLink {
    return {
      id: row.id,
      bookId: row.book_id,
      entityId: row.entity_id,
      chapterId: row.chapter_id,
      chapterTitle: row.chapter_title,
      note: row.note,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      rowVersion: row.row_version
    }
  }

  private mapStoryEntityRelation(row: StoryEntityRelationRow): StoryEntityRelation {
    return {
      id: row.id,
      bookId: row.book_id,
      fromEntityId: row.from_entity_id,
      toEntityId: row.to_entity_id,
      relationshipType: row.relationship_type,
      label: row.label,
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      rowVersion: row.row_version
    }
  }

  private mapChapter(row: ChapterRow, isRead: boolean): Chapter {
    return { ...this.mapChapterSummary(row, isRead), content: row.content }
  }

  private mapChapterSummary(row: ChapterRow, isRead: boolean): ChapterSummary {
    return {
      id: row.id,
      bookId: row.book_id,
      title: row.title,
      position: row.position,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      wordCount: row.word_count,
      isRead
    }
  }

  private mapChapterRevision(row: ChapterRevisionRow, includeContent: boolean): ChapterRevision {
    let content: string | undefined
    if (includeContent) {
      try {
        content = gunzipSync(row.content_blob).toString('utf8')
      } catch (error) {
        throw new StoryboundError(
          'DATABASE_ERROR',
          'That chapter version is damaged and could not be opened.',
          error
        )
      }
    }
    return {
      id: row.id,
      chapterId: row.chapter_id,
      revisionNumber: row.revision_number,
      title: row.title,
      ...(content === undefined ? {} : { content }),
      wordCount: row.word_count,
      reason: row.reason,
      createdAt: row.created_at
    }
  }

  private mapReading(row: ReadingRow): ReadingState {
    return {
      bookId: row.book_id,
      chapterId: row.chapter_id,
      scrollPosition: row.scroll_position,
      progressPercentage: row.progress_percentage,
      lastReadAt: row.last_read_at,
      hasFinishedCurrentContent: boolean(row.has_finished_current_content)
    }
  }

  private mapBookmark(row: BookmarkRow): Bookmark {
    return {
      id: row.id,
      bookId: row.book_id,
      chapterId: row.chapter_id,
      chapterTitle: row.chapter_title,
      location: row.location,
      note: row.note,
      label: row.label,
      color: row.color,
      anchor: this.mapJoinedAnchor(row),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      rowVersion: row.row_version
    }
  }

  private mapJoinedAnchor(row: BookmarkRow | AnnotationRow): Annotation['anchor'] {
    return {
      id: row.anchor_id,
      chapterId: row.anchor_chapter_id,
      startOffset: row.anchor_start_offset,
      endOffset: row.anchor_end_offset,
      fallbackLocation: row.anchor_fallback_location,
      quote: row.anchor_quote,
      prefix: row.anchor_prefix,
      suffix: row.anchor_suffix,
      contentHash: row.anchor_content_hash,
      resolutionStatus: row.anchor_resolution_status,
      createdAt: row.anchor_created_at,
      updatedAt: row.anchor_updated_at,
      rowVersion: row.anchor_row_version
    }
  }

  private mapAnnotation(row: AnnotationRow): Annotation {
    return {
      id: row.id,
      bookId: row.book_id,
      chapterId: row.chapter_id,
      chapterTitle: row.chapter_title,
      kind: row.kind,
      body: row.body,
      color: row.color,
      anchor: this.mapJoinedAnchor(row),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      rowVersion: row.row_version
    }
  }

  private mapWritingGoal(row: WritingGoalRow): WritingGoal {
    return {
      id: row.id,
      libraryId: row.library_id,
      bookId: row.book_id,
      bookTitle: row.book_title,
      metric: row.metric,
      period: row.period,
      targetValue: row.target_value,
      startOn: row.start_on,
      endOn: row.end_on,
      timezone: row.timezone,
      isActive: boolean(row.is_active),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      rowVersion: row.row_version
    }
  }

  private mapSettings(row: SettingsRow): ApplicationSettings {
    return {
      appTheme: row.app_theme,
      reducedMotion: boolean(row.reduced_motion),
      hasSeenGettingStarted: boolean(row.has_seen_getting_started),
      readerTheme: row.reader_theme,
      readerFont: row.reader_font,
      readerFontSize: row.reader_font_size,
      lineHeight: row.line_height,
      columnWidth: row.column_width,
      paragraphSpacing: row.paragraph_spacing,
      paragraphIndentation: boolean(row.paragraph_indentation),
      textAlignment: row.text_alignment,
      defaultLibrarySort: row.default_library_sort
    }
  }

  private listChapterSummaries(bookId: string): ChapterSummary[] {
    const chapters = this.chapterRows(bookId)
    const lastPosition = chapters.at(-1)?.position ?? -1
    const reading = this.database
      .prepare('SELECT * FROM reading_states WHERE book_id = ?')
      .get(bookId) as ReadingRow | undefined
    const current = reading?.chapter_id
      ? chapters.find((chapter) => chapter.id === reading.chapter_id)
      : undefined
    return chapters.map((chapter) =>
      this.mapChapterSummary(
        chapter,
        Boolean(reading?.has_finished_current_content) ||
          (current !== undefined &&
            (chapter.position < current.position ||
              (chapter.id === current.id &&
                reading !== undefined &&
                reading.scroll_position >= 0.995 &&
                current.position < lastPosition)))
      )
    )
  }

  private isChapterRead(chapter: ChapterRow): boolean {
    const reading = this.database
      .prepare(
        `SELECT rs.chapter_id, rs.scroll_position, rs.has_finished_current_content,
          current.position AS current_position,
          (SELECT COALESCE(MAX(position), -1) FROM chapters
           WHERE book_id = rs.book_id AND deleted_at IS NULL)
            AS last_position
         FROM reading_states rs
         LEFT JOIN chapters current ON current.id = rs.chapter_id AND current.deleted_at IS NULL
         WHERE rs.book_id = ?`
      )
      .get(chapter.book_id) as
      | {
          chapter_id: string | null
          scroll_position: number
          has_finished_current_content: number
          current_position: number | null
          last_position: number
        }
      | undefined
    return (
      Boolean(reading?.has_finished_current_content) ||
      (reading?.current_position !== null &&
        reading?.current_position !== undefined &&
        (chapter.position < reading.current_position ||
          (chapter.id === reading.chapter_id &&
            reading.scroll_position >= 0.995 &&
            reading.current_position < reading.last_position)))
    )
  }

  private requireBook(id: string): BookRow {
    const row = this.database.prepare(`${BOOK_SELECT} WHERE b.id = ? GROUP BY b.id`).get(id) as
      BookRow | undefined
    if (!row) throw new StoryboundError('NOT_FOUND', 'That book could not be found.')
    return row
  }

  private requireActiveStoryBook(id: string): { id: string } {
    const row = this.database
      .prepare(
        `SELECT book.id
         FROM books book
         JOIN book_libraries book_library ON book_library.book_id = book.id
         WHERE book.id = ? AND book.deleted_at IS NULL
           AND book_library.library_id = ? AND book_library.deleted_at IS NULL`
      )
      .get(id, this.activeLibraryId()) as { id: string } | undefined
    if (!row) {
      throw new StoryboundError('NOT_FOUND', 'That book is not available in the active library.')
    }
    return row
  }

  private createAnchor(
    chapter: ChapterRow,
    input: AnchorInput,
    timestamp: string
  ): ChapterAnchorRow {
    const parsed = anchorInputSchema.parse(input)
    const startOffset = parsed.startOffset ?? null
    const endOffset = parsed.endOffset ?? null
    if (endOffset !== null && endOffset > chapter.content.length) {
      throw new StoryboundError(
        'VALIDATION_ERROR',
        'The annotation selection extends beyond the end of this chapter.'
      )
    }
    const selected =
      startOffset === null || endOffset === null
        ? ''
        : chapter.content.slice(startOffset, endOffset)
    const quote = parsed.quote || selected
    const prefix =
      parsed.prefix ||
      (startOffset === null
        ? ''
        : chapter.content.slice(Math.max(0, startOffset - 128), startOffset))
    const suffix =
      parsed.suffix ||
      (endOffset === null
        ? ''
        : chapter.content.slice(endOffset, Math.min(chapter.content.length, endOffset + 128)))
    const resolutionStatus =
      startOffset === null || endOffset === null
        ? 'approximate'
        : !quote || quote === selected
          ? 'resolved'
          : 'approximate'
    const id = randomUUID()
    this.database
      .prepare(
        `INSERT INTO chapter_anchors (
          id, chapter_id, start_offset, end_offset, fallback_location, quote, prefix,
          suffix, content_hash, resolution_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        chapter.id,
        startOffset,
        endOffset,
        parsed.fallbackLocation,
        quote,
        prefix,
        suffix,
        createHash('sha256').update(chapter.content).digest('hex'),
        resolutionStatus,
        timestamp,
        timestamp
      )
    return this.database
      .prepare('SELECT * FROM chapter_anchors WHERE id = ?')
      .get(id) as ChapterAnchorRow
  }

  private updateAnchor(
    id: string,
    chapter: ChapterRow,
    input: AnchorInput,
    timestamp: string
  ): void {
    const replacement = this.createAnchor(chapter, input, timestamp)
    this.database
      .prepare(
        `UPDATE chapter_anchors SET start_offset = ?, end_offset = ?, fallback_location = ?,
          quote = ?, prefix = ?, suffix = ?, content_hash = ?, resolution_status = ?,
          updated_at = ?, row_version = row_version + 1
         WHERE id = ? AND deleted_at IS NULL`
      )
      .run(
        replacement.start_offset,
        replacement.end_offset,
        replacement.fallback_location,
        replacement.quote,
        replacement.prefix,
        replacement.suffix,
        replacement.content_hash,
        replacement.resolution_status,
        timestamp,
        id
      )
    this.database.prepare('DELETE FROM chapter_anchors WHERE id = ?').run(replacement.id)
  }

  private requireActiveBookmarkRow(id: string): BookmarkRow {
    const row = this.database
      .prepare(
        `SELECT bm.id, bm.book_id, bm.chapter_id, chapter.title AS chapter_title,
          bm.location, bm.note, bm.label, bm.color, bm.created_at, bm.updated_at,
          bm.row_version, ${ANCHOR_SELECT}
         FROM bookmarks bm
         JOIN chapter_anchors anchor ON anchor.id = bm.anchor_id
         JOIN chapters chapter ON chapter.id = bm.chapter_id
         JOIN books book ON book.id = bm.book_id
         JOIN book_libraries book_library ON book_library.book_id = book.id
         WHERE bm.id = ? AND book_library.library_id = ? AND bm.deleted_at IS NULL
           AND anchor.deleted_at IS NULL AND chapter.deleted_at IS NULL
           AND book.deleted_at IS NULL AND book_library.deleted_at IS NULL`
      )
      .get(id, this.activeLibraryId()) as BookmarkRow | undefined
    if (!row) throw new StoryboundError('NOT_FOUND', 'That bookmark could not be found.')
    return row
  }

  private requireActiveBookmark(id: string): Bookmark {
    return this.mapBookmark(this.requireActiveBookmarkRow(id))
  }

  private requireActiveAnnotationRow(id: string): AnnotationRow {
    const row = this.database
      .prepare(
        `SELECT annotation.id, annotation.book_id, chapter.id AS chapter_id,
          chapter.title AS chapter_title, annotation.kind, annotation.body, annotation.color,
          annotation.created_at, annotation.updated_at, annotation.row_version, ${ANCHOR_SELECT}
         FROM annotations annotation
         JOIN chapter_anchors anchor ON anchor.id = annotation.anchor_id
         JOIN chapters chapter ON chapter.id = anchor.chapter_id
         JOIN books book ON book.id = annotation.book_id
         JOIN book_libraries book_library ON book_library.book_id = book.id
         WHERE annotation.id = ? AND book_library.library_id = ?
           AND annotation.deleted_at IS NULL AND anchor.deleted_at IS NULL
           AND chapter.deleted_at IS NULL AND book.deleted_at IS NULL
           AND book_library.deleted_at IS NULL`
      )
      .get(id, this.activeLibraryId()) as AnnotationRow | undefined
    if (!row) throw new StoryboundError('NOT_FOUND', 'That annotation could not be found.')
    return row
  }

  private requireActiveAnnotation(id: string): Annotation {
    return this.mapAnnotation(this.requireActiveAnnotationRow(id))
  }

  private requireActiveWritingGoal(id: string): WritingGoal {
    const row = this.database
      .prepare(
        `SELECT goal.*, book.title AS book_title
         FROM writing_goals goal
         LEFT JOIN books book ON book.id = goal.book_id AND book.deleted_at IS NULL
         WHERE goal.id = ? AND goal.library_id = ? AND goal.deleted_at IS NULL`
      )
      .get(id, this.activeLibraryId()) as WritingGoalRow | undefined
    if (!row) throw new StoryboundError('NOT_FOUND', 'That writing goal could not be found.')
    return this.mapWritingGoal(row)
  }

  private activeWritingGoalProgress(): WritingGoalProgress[] {
    return this.listWritingGoals()
      .filter((goal) => goal.isActive)
      .map((goal) => {
        const today = localDay(new Date(), goal.timezone)
        const period = goalPeriodRange(goal, today)
        let achievedValue = 0
        if (goal.metric === 'words') {
          const bookClause = goal.bookId ? ' AND book_id = ?' : ''
          const parameters = goal.bookId
            ? [goal.libraryId, period.start, period.end, goal.bookId]
            : [goal.libraryId, period.start, period.end]
          achievedValue = Number(
            this.database
              .prepare(
                `SELECT COALESCE(SUM(words_added), 0) FROM writing_events
                 WHERE library_id = ? AND local_day BETWEEN ? AND ?${bookClause}`
              )
              .pluck()
              .get(...parameters)
          )
        } else if (goal.metric === 'chapters') {
          const bookClause = goal.bookId ? ' AND book_id = ?' : ''
          const parameters = goal.bookId
            ? [goal.libraryId, period.start, period.end, goal.bookId]
            : [goal.libraryId, period.start, period.end]
          achievedValue = Number(
            this.database
              .prepare(
                `SELECT COUNT(DISTINCT chapter_id) FROM writing_events
                 WHERE library_id = ? AND local_day BETWEEN ? AND ?${bookClause}`
              )
              .pluck()
              .get(...parameters)
          )
        }
        return {
          goal,
          periodStart: period.start,
          periodEnd: period.end,
          achievedValue,
          remainingValue: Math.max(0, goal.targetValue - achievedValue),
          progressPercentage: Number(
            Math.min(100, (achievedValue / goal.targetValue) * 100).toFixed(2)
          )
        }
      })
  }

  private throwVersionConflict(entity: string): never {
    throw new StoryboundError(
      'CONFLICT',
      `That ${entity} changed elsewhere. Reload it before saving your changes.`
    )
  }

  private requireActiveStoryEntity(id: string): StoryEntityRow {
    const row = this.database
      .prepare(
        `SELECT entity.*
         FROM story_entities entity
         JOIN books book ON book.id = entity.book_id
         JOIN book_libraries book_library ON book_library.book_id = book.id
         WHERE entity.id = ? AND entity.deleted_at IS NULL AND book.deleted_at IS NULL
           AND book_library.library_id = ? AND book_library.deleted_at IS NULL`
      )
      .get(id, this.activeLibraryId()) as StoryEntityRow | undefined
    if (!row) {
      throw new StoryboundError('NOT_FOUND', 'That story-bible entity could not be found.')
    }
    return row
  }

  private getActiveStoryEntityChapterLink(id: string): StoryEntityChapterLink {
    const row = this.database
      .prepare(
        `SELECT link.*, entity.book_id, chapter.title AS chapter_title
         FROM story_entity_chapters link
         JOIN story_entities entity ON entity.id = link.entity_id
         JOIN chapters chapter ON chapter.id = link.chapter_id
         JOIN books book ON book.id = entity.book_id
         JOIN book_libraries book_library ON book_library.book_id = book.id
         WHERE link.id = ? AND link.deleted_at IS NULL
           AND entity.deleted_at IS NULL AND chapter.deleted_at IS NULL
           AND book.deleted_at IS NULL AND book_library.deleted_at IS NULL
           AND book_library.library_id = ?`
      )
      .get(id, this.activeLibraryId()) as StoryEntityChapterLinkRow | undefined
    if (!row) {
      throw new StoryboundError('NOT_FOUND', 'That entity-to-chapter link could not be found.')
    }
    return this.mapStoryEntityChapterLink(row)
  }

  private getActiveStoryEntityRelation(id: string): StoryEntityRelation {
    const row = this.database
      .prepare(
        `SELECT relation.*
         FROM story_entity_relations relation
         JOIN story_entities source ON source.id = relation.from_entity_id
         JOIN story_entities target ON target.id = relation.to_entity_id
         JOIN books book ON book.id = relation.book_id
         JOIN book_libraries book_library ON book_library.book_id = book.id
         WHERE relation.id = ? AND relation.deleted_at IS NULL
           AND source.deleted_at IS NULL AND target.deleted_at IS NULL
           AND book.deleted_at IS NULL AND book_library.deleted_at IS NULL
           AND book_library.library_id = ?`
      )
      .get(id, this.activeLibraryId()) as StoryEntityRelationRow | undefined
    if (!row) {
      throw new StoryboundError('NOT_FOUND', 'That entity relationship could not be found.')
    }
    return this.mapStoryEntityRelation(row)
  }

  private activeLibraryId(): string {
    const id = this.database
      .prepare('SELECT active_library_id FROM app_state WHERE id = 1')
      .pluck()
      .get()
    if (typeof id !== 'string') {
      throw new StoryboundError('DATABASE_ERROR', 'The active library could not be found.')
    }
    return id
  }

  private requireLibrary(id: string): { id: string } {
    const row = this.database
      .prepare('SELECT id FROM libraries WHERE id = ? AND deleted_at IS NULL')
      .get(id) as { id: string } | undefined
    if (!row) throw new StoryboundError('NOT_FOUND', 'That library could not be found.')
    return row
  }

  private requireTag(id: string): { id: string; library_id: string } {
    const row = this.database
      .prepare('SELECT id, library_id FROM tags WHERE id = ? AND deleted_at IS NULL')
      .get(id) as { id: string; library_id: string } | undefined
    if (!row) throw new StoryboundError('NOT_FOUND', 'That tag could not be found.')
    return row
  }

  private requireCollection(id: string): { id: string; library_id: string } {
    const row = this.database
      .prepare('SELECT id, library_id FROM collections WHERE id = ? AND deleted_at IS NULL')
      .get(id) as { id: string; library_id: string } | undefined
    if (!row) throw new StoryboundError('NOT_FOUND', 'That collection could not be found.')
    return row
  }

  private requireSavedFilter(id: string): { id: string; library_id: string } {
    const row = this.database
      .prepare('SELECT id, library_id FROM saved_filters WHERE id = ? AND deleted_at IS NULL')
      .get(id) as { id: string; library_id: string } | undefined
    if (!row) throw new StoryboundError('NOT_FOUND', 'That saved filter could not be found.')
    return row
  }

  private normalizeOrganizationName(value: string): string {
    return value.normalize('NFKC').trim().toLocaleLowerCase()
  }

  private bookRelationIds(
    table: 'book_tags' | 'collection_books',
    foreignKey: 'tag_id' | 'collection_id',
    bookId: string
  ): string[] {
    return this.database
      .prepare(`SELECT ${foreignKey} FROM ${table} WHERE book_id = ? AND deleted_at IS NULL`)
      .pluck()
      .all(bookId) as string[]
  }

  private replaceBookRelations(
    table: 'book_tags' | 'collection_books',
    foreignKey: 'tag_id' | 'collection_id',
    bookId: string,
    ids: string[]
  ): void {
    const timestamp = now()
    this.database.transaction(() => {
      this.database
        .prepare(
          `UPDATE ${table} SET deleted_at = ?, updated_at = ?, row_version = row_version + 1
           WHERE book_id = ? AND deleted_at IS NULL`
        )
        .run(timestamp, timestamp, bookId)
      for (const relationId of ids) {
        const existing = this.database
          .prepare(`SELECT id FROM ${table} WHERE book_id = ? AND ${foreignKey} = ?`)
          .pluck()
          .get(bookId, relationId)
        if (typeof existing === 'string') {
          this.database
            .prepare(
              `UPDATE ${table} SET deleted_at = NULL, updated_at = ?, row_version = row_version + 1
               WHERE id = ?`
            )
            .run(timestamp, existing)
        } else {
          this.database
            .prepare(
              `INSERT INTO ${table} (id, book_id, ${foreignKey}, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?)`
            )
            .run(randomUUID(), bookId, relationId, timestamp, timestamp)
        }
      }
    })()
  }

  private requireChapter(id: string): ChapterRow {
    const row = this.database
      .prepare('SELECT * FROM chapters WHERE id = ? AND deleted_at IS NULL')
      .get(id) as ChapterRow | undefined
    if (!row) throw new StoryboundError('NOT_FOUND', 'That chapter could not be found.')
    return row
  }

  private requireAnyChapter(id: string): ChapterRow {
    const row = this.database.prepare('SELECT * FROM chapters WHERE id = ?').get(id) as
      ChapterRow | undefined
    if (!row) throw new StoryboundError('NOT_FOUND', 'That chapter could not be found.')
    return row
  }

  private chapterRows(bookId: string): ChapterRow[] {
    return this.database
      .prepare('SELECT * FROM chapters WHERE book_id = ? AND deleted_at IS NULL ORDER BY position')
      .all(bookId) as ChapterRow[]
  }

  private saveChapterRevision(chapter: ChapterRow, reason: string): void {
    this.saveChapterRevisionFor(chapter.id, chapter, reason)
  }

  private saveChapterRevisionFor(
    historyChapterId: string,
    snapshot: ChapterRow,
    reason: string
  ): void {
    const contentHash = createHash('sha256')
      .update(snapshot.title)
      .update('\u0000')
      .update(snapshot.content)
      .digest('hex')
    const existing = this.database
      .prepare('SELECT id FROM chapter_revisions WHERE chapter_id = ? AND content_hash = ?')
      .pluck()
      .get(historyChapterId, contentHash)
    if (existing) return
    const revisionNumber = Number(
      this.database
        .prepare(
          'SELECT COALESCE(MAX(revision_number), 0) + 1 FROM chapter_revisions WHERE chapter_id = ?'
        )
        .pluck()
        .get(historyChapterId)
    )
    this.database
      .prepare(
        `INSERT INTO chapter_revisions (
          id, chapter_id, revision_number, title, content_blob, content_hash,
          word_count, reason, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        historyChapterId,
        revisionNumber,
        snapshot.title,
        gzipSync(Buffer.from(snapshot.content, 'utf8')),
        contentHash,
        snapshot.word_count,
        reason,
        now()
      )
  }

  private refreshBook(bookId: string, timestamp: string): void {
    this.database
      .prepare(
        `UPDATE books SET
          total_word_count = COALESCE((
            SELECT SUM(word_count) FROM chapters WHERE book_id = ? AND deleted_at IS NULL
          ), 0),
          updated_at = ?
         WHERE id = ?`
      )
      .run(bookId, timestamp, bookId)
  }

  private recalculateReadingProgress(
    bookId: string,
    newlyAddedChapterId?: string,
    forceUnfinished = false
  ): void {
    const reading = this.database
      .prepare('SELECT * FROM reading_states WHERE book_id = ?')
      .get(bookId) as ReadingRow | undefined
    if (!reading) return

    if (newlyAddedChapterId && boolean(reading.has_finished_current_content)) {
      this.database
        .prepare(
          `UPDATE reading_states SET chapter_id = ?, scroll_position = 0,
            has_finished_current_content = 0 WHERE book_id = ?`
        )
        .run(newlyAddedChapterId, bookId)
    }

    const location = this.database
      .prepare(
        `SELECT rs.chapter_id, rs.scroll_position, current.position AS current_position,
          (SELECT COUNT(*) FROM chapters
           WHERE book_id = rs.book_id AND deleted_at IS NULL) AS chapter_count
         FROM reading_states rs
         LEFT JOIN chapters current ON current.id = rs.chapter_id AND current.deleted_at IS NULL
         WHERE rs.book_id = ?`
      )
      .get(bookId) as
      | {
          chapter_id: string | null
          scroll_position: number
          current_position: number | null
          chapter_count: number
        }
      | undefined
    if (!location || location.chapter_id === null || location.current_position === null) {
      this.database
        .prepare(
          `UPDATE reading_states SET chapter_id = NULL, scroll_position = 0,
            progress_percentage = 0, has_finished_current_content = 0 WHERE book_id = ?`
        )
        .run(bookId)
      return
    }

    const scrollPosition = Math.min(1, Math.max(0, location.scroll_position))
    const progressPercentage =
      location.chapter_count === 0
        ? 0
        : Number(
            (((location.current_position + scrollPosition) / location.chapter_count) * 100).toFixed(
              2
            )
          )
    const hasFinishedCurrentContent =
      !forceUnfinished &&
      location.current_position === location.chapter_count - 1 &&
      scrollPosition >= 0.995
    this.database
      .prepare(
        `UPDATE reading_states SET scroll_position = ?, progress_percentage = ?,
          has_finished_current_content = ? WHERE book_id = ?`
      )
      .run(scrollPosition, progressPercentage, Number(hasFinishedCurrentContent), bookId)
  }

  private setChapterOrder(bookId: string, orderedIds: string[]): void {
    if (orderedIds.length === 0) return
    const maximum = Number(
      this.database
        .prepare('SELECT COALESCE(MAX(position), 0) FROM chapters WHERE book_id = ?')
        .pluck()
        .get(bookId)
    )
    const offset = maximum + orderedIds.length + 1
    this.database
      .prepare('UPDATE chapters SET position = position + ? WHERE book_id = ?')
      .run(offset, bookId)
    const update = this.database.prepare(
      'UPDATE chapters SET position = ?, row_version = row_version + 1 WHERE id = ? AND book_id = ?'
    )
    orderedIds.forEach((id, position) => update.run(position, id, bookId))
  }

  private writeZipAtomically(zip: AdmZip, targetPath: string): void {
    mkdirSync(dirname(targetPath), { recursive: true })
    const temporary = join(dirname(targetPath), `.${basename(targetPath)}.${randomUUID()}.tmp`)
    try {
      zip.writeZip(temporary)
      if (statSync(temporary).size > MAX_IMPORT_BYTES) {
        throw new StoryboundError(
          'FILE_ERROR',
          'The completed export would exceed Storybound’s restore file-size limit. Reduce large cover images or story content, then try again.'
        )
      }
      try {
        validateArchive(new AdmZip(temporary))
      } catch (error) {
        throw new StoryboundError(
          'FILE_ERROR',
          'Storybound created the export but could not verify it as safely restorable.',
          error
        )
      }
      renameSync(temporary, targetPath)
    } catch (error) {
      safeRemove(temporary)
      if (error instanceof StoryboundError) throw error
      throw new StoryboundError(
        'FILE_ERROR',
        'Storybound could not write the selected export file.',
        error
      )
    }
  }

  private assertImportSize(sourcePath: string): void {
    try {
      const stats = statSync(sourcePath)
      if (!stats.isFile() || stats.size > MAX_IMPORT_BYTES) {
        throw new StoryboundError(
          'IMPORT_ERROR',
          'The selected archive is too large to import safely.'
        )
      }
    } catch (error) {
      if (error instanceof StoryboundError) throw error
      throw new StoryboundError(
        'FILE_ERROR',
        'Storybound could not read the selected archive.',
        error
      )
    }
  }

  private validatedBackupMediaFiles(databasePath: string): string[] {
    const snapshot = new Database(databasePath, { readonly: true, fileMustExist: true })
    try {
      const references = snapshot
        .prepare(
          `SELECT title, cover_image_path
           FROM books
           WHERE cover_image_path IS NOT NULL
           ORDER BY id`
        )
        .all() as Array<{ title: string; cover_image_path: string }>
      const files = new Set<string>()
      for (const reference of references) {
        const coverPath = managedCoverPath(this.paths.media, reference.cover_image_path)
        try {
          if (!coverPath || !lstatSync(coverPath).isFile()) throw new Error('Missing cover')
          const stats = statSync(coverPath)
          if (stats.size > MAX_COVER_BYTES) throw new Error('Oversized cover')
          coverExtension(readCoverHeader(coverPath), reference.cover_image_path)
        } catch (error) {
          throw new StoryboundError(
            'FILE_ERROR',
            `“${reference.title}” has a missing or invalid managed cover. Replace or remove that cover before creating a full backup.`,
            error
          )
        }
        files.add(reference.cover_image_path)
      }
      return [...files]
    } finally {
      snapshot.close()
    }
  }

  private validateRestoredDatabase(path: string, stagedMediaDirectory: string): void {
    let candidate: Database.Database | undefined
    try {
      candidate = new Database(path, { readonly: true, fileMustExist: true })
      candidate.pragma('foreign_keys = ON')
      const version = Number(candidate.pragma('user_version', { simple: true }))
      if (version !== LATEST_SCHEMA_VERSION) {
        throw new StoryboundError(
          'IMPORT_ERROR',
          'This backup uses an unsupported Storybound database version.'
        )
      }
      const integrity = candidate.pragma('integrity_check') as Array<{ integrity_check: string }>
      if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') {
        throw new StoryboundError(
          'INTEGRITY_ERROR',
          'The backup database did not pass its integrity check.'
        )
      }
      const foreignKeys = candidate.pragma('foreign_key_check') as Array<Record<string, unknown>>
      if (foreignKeys.length > 0) {
        throw new StoryboundError(
          'INTEGRITY_ERROR',
          'The backup database contains broken relationships.'
        )
      }
      if (schemaSignature(candidate) !== currentSchemaSignature()) {
        throw new StoryboundError(
          'IMPORT_ERROR',
          'The backup database has an incompatible library structure.'
        )
      }
      const tableColumns = candidate.prepare('SELECT name FROM pragma_table_info(?)')
      for (const [table, expectedColumns] of Object.entries(RESTORE_REQUIRED_COLUMNS)) {
        const columns = new Set(
          (tableColumns.all(table) as Array<{ name: string }>).map(({ name }) => name)
        )
        if (expectedColumns.some((column) => !columns.has(column))) {
          throw new StoryboundError(
            'IMPORT_ERROR',
            'The backup database has an incompatible library structure.'
          )
        }
      }
      const triggerRows = candidate
        .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'")
        .all() as Array<{ name: string }>
      const triggers = new Set(triggerRows.map(({ name }) => name))
      if ([...RESTORE_REQUIRED_TRIGGERS].some((trigger) => !triggers.has(trigger))) {
        throw new StoryboundError(
          'IMPORT_ERROR',
          'The backup database is missing required search maintenance data.'
        )
      }
      const settings = candidate
        .prepare(
          `SELECT app_theme, reduced_motion, has_seen_getting_started,
            reader_theme, reader_font, reader_font_size,
            line_height, column_width, paragraph_spacing, paragraph_indentation,
            text_alignment, default_library_sort
          FROM application_settings WHERE id = 1`
        )
        .get() as SettingsRow | undefined
      if (
        !settings ||
        ![0, 1].includes(settings.reduced_motion) ||
        ![0, 1].includes(settings.has_seen_getting_started) ||
        ![0, 1].includes(settings.paragraph_indentation) ||
        !settingsUpdateSchema.safeParse({
          appTheme: settings.app_theme,
          reducedMotion: boolean(settings.reduced_motion),
          hasSeenGettingStarted: boolean(settings.has_seen_getting_started),
          readerTheme: settings.reader_theme,
          readerFont: settings.reader_font,
          readerFontSize: settings.reader_font_size,
          lineHeight: settings.line_height,
          columnWidth: settings.column_width,
          paragraphSpacing: settings.paragraph_spacing,
          paragraphIndentation: boolean(settings.paragraph_indentation),
          textAlignment: settings.text_alignment,
          defaultLibrarySort: settings.default_library_sort
        }).success
      ) {
        throw new StoryboundError(
          'IMPORT_ERROR',
          'The backup database contains invalid application settings.'
        )
      }
      const covers = candidate
        .prepare('SELECT cover_image_path FROM books WHERE cover_image_path IS NOT NULL')
        .all() as Array<{ cover_image_path: string }>
      if (
        covers.some(({ cover_image_path }) => {
          const coverPath = managedCoverPath(stagedMediaDirectory, cover_image_path)
          return coverPath === null || !existsSync(coverPath) || !lstatSync(coverPath).isFile()
        })
      ) {
        throw new StoryboundError(
          'IMPORT_ERROR',
          'The backup database contains an invalid cover reference or a referenced cover is missing.'
        )
      }
    } finally {
      candidate?.close()
    }
  }
}
