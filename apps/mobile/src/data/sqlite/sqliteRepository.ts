import type {
  Annotation,
  BookDetail,
  Bookmark,
  BookSummary,
  Chapter,
  ChapterSummary,
  CreateAnnotationInput,
  CreateBookmarkInput,
  LibrarySummary,
  LocalSyncStatus,
  MobilePreferences,
  MobileRepository,
  ReadingState,
  SaveReadingStateInput,
  UpdateAnnotationInput,
  UpdateBookmarkInput,
  UpdateChapterInput
} from '../../domain/contracts'
import {
  DEFAULT_PREFERENCES,
  READER_FONT_SIZE_MAX,
  READER_FONT_SIZE_MIN
} from '../../domain/contracts'
import { clamp, quoteText } from '../../domain/reading'
import { countWords, recordChange } from './changeRecords'
import { createEditingOperations, saveRollingRevision } from './editingRepository'
import {
  createSqlWriteCoordinator,
  type SqlDatabasePort,
  type SqlWriteCoordinator
} from './databasePort'

interface BookRow {
  id: string
  library_id: string
  title: string
  subtitle: string
  author_name: string
  blurb: string
  status: BookSummary['status']
  cover_tone: BookSummary['coverTone']
  cover_uri: string | null
  chapter_count: number
  total_word_count: number
  progress_percentage: number
  last_read_at: string | null
}

interface ChapterRow {
  id: string
  book_id: string
  title: string
  content: string
  position: number
  word_count: number
  updated_at: string
}

interface ReadingStateRow {
  book_id: string
  chapter_id: string | null
  scroll_position: number
  progress_percentage: number
  last_read_at: string | null
}

const bookSummaryQuery = `
  SELECT
    b.id,
    b.library_id,
    b.title,
    b.subtitle,
    b.author_name,
    b.blurb,
    b.status,
    b.cover_tone,
    CASE WHEN bc.book_id IS NULL THEN NULL
      ELSE 'data:' || bc.mime_type || ';base64,' || bc.data END AS cover_uri,
    (
      SELECT COUNT(*)
      FROM chapters c
      WHERE c.book_id = b.id AND c.deleted_at IS NULL
    ) AS chapter_count,
    (
      SELECT COALESCE(SUM(c.word_count), 0)
      FROM chapters c
      WHERE c.book_id = b.id AND c.deleted_at IS NULL
    ) AS total_word_count,
    COALESCE(r.progress_percentage, 0) AS progress_percentage,
    r.last_read_at
  FROM books b
  LEFT JOIN reading_states r ON r.book_id = b.id
  LEFT JOIN book_covers bc ON bc.book_id = b.id
`

function mapBook(row: BookRow): BookSummary {
  return {
    id: row.id,
    libraryId: row.library_id,
    title: row.title,
    subtitle: row.subtitle,
    authorName: row.author_name,
    blurb: row.blurb,
    status: row.status,
    coverTone: row.cover_tone,
    coverUri: row.cover_uri,
    chapterCount: row.chapter_count,
    totalWordCount: row.total_word_count,
    progressPercentage: row.progress_percentage,
    lastReadAt: row.last_read_at
  }
}

function mapChapter(row: ChapterRow): Chapter {
  return {
    id: row.id,
    bookId: row.book_id,
    title: row.title,
    content: row.content,
    position: row.position,
    wordCount: row.word_count,
    updatedAt: row.updated_at
  }
}

function mapChapterSummary(row: ChapterRow): ChapterSummary {
  return {
    id: row.id,
    bookId: row.book_id,
    title: row.title,
    position: row.position,
    wordCount: row.word_count,
    updatedAt: row.updated_at
  }
}

function mapReadingState(row: ReadingStateRow): ReadingState {
  return {
    bookId: row.book_id,
    chapterId: row.chapter_id,
    scrollPosition: row.scroll_position,
    progressPercentage: row.progress_percentage,
    lastReadAt: row.last_read_at
  }
}

interface AnnotationRow {
  id: string
  book_id: string
  chapter_id: string
  chapter_title: string
  kind: Annotation['kind']
  body: string
  color: string
  start_offset: number | null
  end_offset: number | null
  fallback_location: number
  quote: string
  prefix: string
  suffix: string
  created_at: string
  updated_at: string
}

const annotationQuery = `
  SELECT a.id, a.book_id, a.chapter_id, c.title AS chapter_title, a.kind, a.body, a.color,
    a.start_offset, a.end_offset, a.fallback_location, a.quote, a.prefix, a.suffix,
    a.created_at, a.updated_at
  FROM annotations a
  JOIN chapters c ON c.id = a.chapter_id AND c.deleted_at IS NULL
  JOIN books b ON b.id = a.book_id AND b.deleted_at IS NULL
`

function mapAnnotation(row: AnnotationRow): Annotation {
  return {
    id: row.id,
    bookId: row.book_id,
    chapterId: row.chapter_id,
    chapterTitle: row.chapter_title,
    kind: row.kind,
    body: row.body,
    color: row.color,
    startOffset: row.start_offset,
    endOffset: row.end_offset,
    fallbackLocation: row.fallback_location,
    quote: row.quote,
    prefix: row.prefix,
    suffix: row.suffix,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

interface BookmarkRow {
  id: string
  book_id: string
  chapter_id: string
  chapter_title: string
  location: number
  label: string
  note: string
  color: string
  created_at: string
  updated_at: string
  row_version: number
}

const bookmarkQuery = `
  SELECT m.id, m.book_id, m.chapter_id, c.title AS chapter_title, m.location, m.label, m.note,
    m.color, m.created_at, m.updated_at, m.row_version
  FROM bookmarks m
  JOIN chapters c ON c.id = m.chapter_id AND c.deleted_at IS NULL
  JOIN books b ON b.id = m.book_id AND b.deleted_at IS NULL
`

function mapBookmark(row: BookmarkRow): Bookmark {
  return {
    id: row.id,
    bookId: row.book_id,
    chapterId: row.chapter_id,
    chapterTitle: row.chapter_title,
    location: row.location,
    label: row.label,
    note: row.note,
    color: row.color,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

const MAX_BOOKMARK_LABEL = 240
const MAX_BOOKMARK_NOTE = 10_000
const MAX_NOTE_LENGTH = 100_000
// How much text either side of a highlight is saved to find it again after edits.
const ANCHOR_CONTEXT = 128

async function getBookSummary(database: SqlDatabasePort, bookId: string): Promise<BookSummary> {
  const row = await database.getFirstAsync<BookRow>(
    `${bookSummaryQuery} WHERE b.id = ? AND b.deleted_at IS NULL`,
    [bookId]
  )
  if (!row) throw new Error('That book could not be found in this library.')
  return mapBook(row)
}

/** Drops anything unrecognised, so a damaged value can only fall back to the default. */
function sanitizePreferences(
  values: Partial<Record<keyof MobilePreferences, unknown>>
): Partial<MobilePreferences> {
  const clean: Partial<MobilePreferences> = {}
  if (values.mode === 'reader' || values.mode === 'editor') clean.mode = values.mode
  if (
    values.readerTheme === 'paper' ||
    values.readerTheme === 'sepia' ||
    values.readerTheme === 'night'
  ) {
    clean.readerTheme = values.readerTheme
  }
  if (typeof values.smartPunctuation === 'boolean') {
    clean.smartPunctuation = values.smartPunctuation
  }
  if (typeof values.readerFontSize === 'number' && Number.isFinite(values.readerFontSize)) {
    clean.readerFontSize = clamp(
      Math.round(values.readerFontSize),
      READER_FONT_SIZE_MIN,
      READER_FONT_SIZE_MAX
    )
  }
  return clean
}

export function createSQLiteRepository(
  database: SqlDatabasePort,
  now: () => Date = () => new Date(),
  writes: SqlWriteCoordinator = createSqlWriteCoordinator(),
  createId: () => string = () => globalThis.crypto.randomUUID()
): MobileRepository {
  async function requireAnnotation(
    source: SqlDatabasePort,
    id: string
  ): Promise<AnnotationRow & { row_version: number }> {
    const row = await source.getFirstAsync<AnnotationRow & { row_version: number }>(
      `SELECT a.id, a.book_id, a.chapter_id, COALESCE(c.title, '') AS chapter_title, a.kind,
         a.body, a.color, a.start_offset, a.end_offset, a.fallback_location, a.quote, a.prefix,
         a.suffix, a.created_at, a.updated_at, a.row_version
       FROM annotations a LEFT JOIN chapters c ON c.id = a.chapter_id
       WHERE a.id = ? AND a.deleted_at IS NULL`,
      [id]
    )
    if (!row) throw new Error('That highlight could not be found.')
    return row
  }

  async function readPreferences(): Promise<MobilePreferences> {
    const rows = await database.getAllAsync<{ key: string; value: string }>(
      'SELECT key, value FROM app_preferences'
    )
    const stored: Partial<Record<keyof MobilePreferences, unknown>> = {}
    for (const row of rows) {
      try {
        stored[row.key as keyof MobilePreferences] = JSON.parse(row.value)
      } catch {
        // An unreadable value simply falls back to its default.
      }
    }
    return { ...DEFAULT_PREFERENCES, ...sanitizePreferences(stored) }
  }

  const editing = createEditingOperations(database, now, writes, createId)
  const repository: MobileRepository = {
    ...editing,

    async createBook(input) {
      return repository.getBook(await editing.createBook(input))
    },

    async updateBookDetails(bookId, input) {
      await editing.updateBookDetails(bookId, input)
      return repository.getBook(bookId)
    },

    async listBooks(): Promise<BookSummary[]> {
      const rows = await database.getAllAsync<BookRow>(
        `${bookSummaryQuery}
         WHERE b.deleted_at IS NULL
         ORDER BY (r.last_read_at IS NULL), r.last_read_at DESC, b.position, b.title COLLATE NOCASE`
      )
      return rows.map(mapBook)
    },

    async listLibraries(): Promise<LibrarySummary[]> {
      const rows = await database.getAllAsync<{ id: string; name: string; book_count: number }>(
        `SELECT l.id, l.name, COUNT(b.id) AS book_count
         FROM libraries l
         JOIN books b ON b.library_id = l.id AND b.deleted_at IS NULL
         WHERE l.deleted_at IS NULL
         GROUP BY l.id
         ORDER BY l.name COLLATE NOCASE`
      )
      return rows.map((row) => ({ id: row.id, name: row.name, bookCount: row.book_count }))
    },

    async getBook(bookId: string): Promise<BookDetail> {
      const [book, series, chapterRows] = await Promise.all([
        getBookSummary(database, bookId),
        database.getFirstAsync<{ series_name: string | null; series_position: number | null }>(
          'SELECT series_name, series_position FROM books WHERE id = ?',
          [bookId]
        ),
        database.getAllAsync<ChapterRow>(
          `SELECT id, book_id, title, content, position, word_count, updated_at
           FROM chapters
           WHERE book_id = ? AND deleted_at IS NULL
           ORDER BY position, id`,
          [bookId]
        )
      ])
      return {
        ...book,
        seriesName: series?.series_name ?? '',
        seriesPosition: series?.series_position ?? null,
        chapters: chapterRows.map(mapChapterSummary)
      }
    },

    async getChapter(chapterId: string): Promise<Chapter> {
      const row = await database.getFirstAsync<ChapterRow>(
        `SELECT id, book_id, title, content, position, word_count, updated_at
         FROM chapters
         WHERE id = ? AND deleted_at IS NULL`,
        [chapterId]
      )
      if (!row) throw new Error('That chapter could not be found in this library.')
      return mapChapter(row)
    },

    updateChapter(input: UpdateChapterInput): Promise<Chapter> {
      return writes.run(async () => {
        const title = input.title.trim()
        if (!title) throw new Error('Every chapter needs a title.')
        const content = input.content.replace(/\r\n?/g, '\n')
        const wordCount = countWords(content)
        const updatedAt = now().toISOString()
        let updated: Chapter | null = null

        await database.transactionAsync(async (transaction) => {
          const previous = await transaction.getFirstAsync<ChapterRow>(
            `SELECT id, book_id, title, content, position, word_count, updated_at
             FROM chapters
             WHERE id = ? AND deleted_at IS NULL`,
            [input.id]
          )
          if (!previous) throw new Error('That chapter could not be found in this library.')
          if (previous.content !== content || previous.title !== title) {
            await saveRollingRevision(transaction, previous, now(), createId())
          }

          await transaction.runAsync(
            `UPDATE chapters
             SET title = ?, content = ?, word_count = ?, updated_at = ?, row_version = row_version + 1
             WHERE id = ? AND deleted_at IS NULL`,
            [title, content, wordCount, updatedAt, input.id]
          )
          const updatedRow = await transaction.getFirstAsync<ChapterRow & { row_version: number }>(
            `SELECT id, book_id, title, content, position, word_count, updated_at, row_version
             FROM chapters WHERE id = ?`,
            [input.id]
          )
          if (!updatedRow) throw new Error('The chapter update did not complete.')
          await recordChange(transaction, 'chapter', input.id, updatedAt, updatedRow.row_version)
          updated = mapChapter(updatedRow)
        })

        if (!updated) throw new Error('The chapter update did not complete.')
        return updated
      })
    },

    async getReadingState(bookId: string): Promise<ReadingState> {
      await getBookSummary(database, bookId)
      const row = await database.getFirstAsync<ReadingStateRow>(
        `SELECT book_id, chapter_id, scroll_position, progress_percentage, last_read_at
         FROM reading_states
         WHERE book_id = ?`,
        [bookId]
      )
      return row
        ? mapReadingState(row)
        : {
            bookId,
            chapterId: null,
            scrollPosition: 0,
            progressPercentage: 0,
            lastReadAt: null
          }
    },

    saveReadingState(input: SaveReadingStateInput): Promise<ReadingState> {
      return writes.run(async () => {
        const changedAt = now().toISOString()
        const next: ReadingState = {
          bookId: input.bookId,
          chapterId: input.chapterId,
          scrollPosition: clamp(input.scrollPosition, 0, 1),
          progressPercentage: clamp(input.progressPercentage, 0, 100),
          lastReadAt: changedAt
        }

        await database.transactionAsync(async (transaction) => {
          const relation = await transaction.getFirstAsync<{ chapter_id: string }>(
            `SELECT c.id AS chapter_id
             FROM books b
             JOIN chapters c ON c.book_id = b.id AND c.deleted_at IS NULL
             WHERE b.id = ? AND b.deleted_at IS NULL AND c.id = ?`,
            [input.bookId, input.chapterId]
          )
          if (!relation) throw new Error('That chapter does not belong to this book.')

          await transaction.runAsync(
            `INSERT INTO reading_states (
              book_id, chapter_id, scroll_position, progress_percentage, last_read_at,
              updated_at, row_version
            ) VALUES (?, ?, ?, ?, ?, ?, 1)
            ON CONFLICT (book_id) DO UPDATE SET
              chapter_id = excluded.chapter_id,
              scroll_position = excluded.scroll_position,
              progress_percentage = excluded.progress_percentage,
              last_read_at = excluded.last_read_at,
              updated_at = excluded.updated_at,
              row_version = reading_states.row_version + 1`,
            [
              next.bookId,
              next.chapterId,
              next.scrollPosition,
              next.progressPercentage,
              next.lastReadAt,
              next.lastReadAt
            ]
          )
          const version = await transaction.getFirstAsync<{ row_version: number }>(
            'SELECT row_version FROM reading_states WHERE book_id = ?',
            [input.bookId]
          )
          if (!version) throw new Error('Reading progress did not save.')
          await recordChange(
            transaction,
            'reading_state',
            input.bookId,
            changedAt,
            version.row_version
          )
        })

        return next
      })
    },

    async listAnnotations(bookId: string): Promise<Annotation[]> {
      const rows = await database.getAllAsync<AnnotationRow>(
        `${annotationQuery}
         WHERE a.book_id = ? AND a.deleted_at IS NULL
         ORDER BY c.position, a.fallback_location, a.created_at`,
        [bookId]
      )
      return rows.map(mapAnnotation)
    },

    createAnnotation(input: CreateAnnotationInput): Promise<Annotation> {
      return writes.run(async () => {
        const body = input.body.trim()
        if (body.length > MAX_NOTE_LENGTH) throw new Error('That note is too long.')
        const color = input.color.trim().slice(0, 40) || 'gold'
        const createdAt = now().toISOString()
        const id = createId()
        let created: Annotation | null = null

        await database.transactionAsync(async (transaction) => {
          const chapter = await transaction.getFirstAsync<{ content: string }>(
            `SELECT c.content FROM chapters c
             JOIN books b ON b.id = c.book_id AND b.deleted_at IS NULL
             WHERE c.id = ? AND c.book_id = ? AND c.deleted_at IS NULL`,
            [input.chapterId, input.bookId]
          )
          if (!chapter) throw new Error('That chapter does not belong to this book.')
          const { content } = chapter
          const start = Math.trunc(input.startOffset)
          const end = Math.trunc(input.endOffset)
          if (!(start >= 0 && end > start && end <= content.length)) {
            throw new Error('Choose some text to highlight.')
          }
          // The desktop finds highlights in the rendered page, so the quote is saved without
          // Markdown markers; the offsets still point at the stored text.
          const selected = content.slice(start, end)
          const quote = quoteText(selected)
          if (!quote) throw new Error('Choose some text to highlight.')
          // A new record starts at 2: the desktop counts a note and its anchor separately.
          const rowVersion = 2
          await transaction.runAsync(
            `INSERT INTO annotations (
               id, book_id, chapter_id, anchor_id, kind, body, color, start_offset, end_offset,
               fallback_location, quote, prefix, suffix, content_hash, resolution_status,
               created_at, updated_at, deleted_at, row_version
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, NULL, ?)`,
            [
              id,
              input.bookId,
              input.chapterId,
              createId(),
              body ? 'note' : 'highlight',
              body,
              color,
              start,
              end,
              content.length ? start / content.length : 0,
              quote,
              content.slice(Math.max(0, start - ANCHOR_CONTEXT), start),
              content.slice(end, end + ANCHOR_CONTEXT),
              quote === selected ? 'resolved' : 'approximate',
              createdAt,
              createdAt,
              rowVersion
            ]
          )
          await recordChange(transaction, 'annotation', id, createdAt, rowVersion)
          created = mapAnnotation(await requireAnnotation(transaction, id))
        })

        if (!created) throw new Error('The highlight did not save.')
        return created
      })
    },

    updateAnnotation(input: UpdateAnnotationInput): Promise<Annotation> {
      return writes.run(async () => {
        const body = input.body.trim()
        if (body.length > MAX_NOTE_LENGTH) throw new Error('That note is too long.')
        const updatedAt = now().toISOString()
        let updated: Annotation | null = null
        await database.transactionAsync(async (transaction) => {
          const existing = await requireAnnotation(transaction, input.id)
          // A plain highlight that gains words becomes a note, as it would on the desktop.
          const kind = existing.kind === 'highlight' && body ? 'note' : existing.kind
          await transaction.runAsync(
            `UPDATE annotations
             SET body = ?, color = ?, kind = ?, updated_at = ?, row_version = row_version + 1
             WHERE id = ?`,
            [body, input.color.trim().slice(0, 40) || existing.color, kind, updatedAt, input.id]
          )
          await recordChange(
            transaction,
            'annotation',
            input.id,
            updatedAt,
            existing.row_version + 1
          )
          updated = mapAnnotation(await requireAnnotation(transaction, input.id))
        })
        if (!updated) throw new Error('The highlight did not save.')
        return updated
      })
    },

    removeAnnotation(id: string): Promise<void> {
      return writes.run(async () => {
        const deletedAt = now().toISOString()
        await database.transactionAsync(async (transaction) => {
          const existing = await requireAnnotation(transaction, id)
          await transaction.runAsync(
            `UPDATE annotations
             SET deleted_at = ?, updated_at = ?, row_version = row_version + 1
             WHERE id = ?`,
            [deletedAt, deletedAt, id]
          )
          await recordChange(
            transaction,
            'annotation',
            id,
            deletedAt,
            existing.row_version + 1,
            'delete'
          )
        })
      })
    },

    async listBookmarks(bookId: string): Promise<Bookmark[]> {
      const rows = await database.getAllAsync<BookmarkRow>(
        `${bookmarkQuery}
         WHERE m.book_id = ? AND m.deleted_at IS NULL
         ORDER BY c.position, m.location, m.created_at`,
        [bookId]
      )
      return rows.map(mapBookmark)
    },

    createBookmark(input: CreateBookmarkInput): Promise<Bookmark> {
      return writes.run(async () => {
        const label = input.label.trim()
        const note = input.note.trim()
        if (label.length > MAX_BOOKMARK_LABEL) throw new Error('That bookmark name is too long.')
        if (note.length > MAX_BOOKMARK_NOTE) throw new Error('That bookmark note is too long.')
        const location = clamp(input.location, 0, 1)
        const createdAt = now().toISOString()
        const id = createId()
        let created: Bookmark | null = null
        await database.transactionAsync(async (transaction) => {
          const chapter = await transaction.getFirstAsync<{ id: string }>(
            `SELECT c.id FROM chapters c
             JOIN books b ON b.id = c.book_id AND b.deleted_at IS NULL
             WHERE c.id = ? AND c.book_id = ? AND c.deleted_at IS NULL`,
            [input.chapterId, input.bookId]
          )
          if (!chapter) throw new Error('That chapter does not belong to this book.')
          // A new record starts at 2: the desktop counts a bookmark and its anchor separately.
          const rowVersion = 2
          await transaction.runAsync(
            `INSERT INTO bookmarks (
               id, book_id, chapter_id, anchor_id, location, label, note, color,
               fallback_location, created_at, updated_at, deleted_at, row_version
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
            [
              id,
              input.bookId,
              input.chapterId,
              createId(),
              location,
              label,
              note,
              input.color.trim().slice(0, 40) || 'gold',
              location,
              createdAt,
              createdAt,
              rowVersion
            ]
          )
          await recordChange(transaction, 'bookmark', id, createdAt, rowVersion)
          const row = await transaction.getFirstAsync<BookmarkRow>(
            `${bookmarkQuery} WHERE m.id = ?`,
            [id]
          )
          if (row) created = mapBookmark(row)
        })
        if (!created) throw new Error('The bookmark did not save.')
        return created
      })
    },

    updateBookmark(input: UpdateBookmarkInput): Promise<Bookmark> {
      return writes.run(async () => {
        const label = input.label.trim()
        const note = input.note.trim()
        if (label.length > MAX_BOOKMARK_LABEL) throw new Error('That bookmark name is too long.')
        if (note.length > MAX_BOOKMARK_NOTE) throw new Error('That bookmark note is too long.')
        const updatedAt = now().toISOString()
        let updated: Bookmark | null = null
        await database.transactionAsync(async (transaction) => {
          const existing = await transaction.getFirstAsync<BookmarkRow>(
            `${bookmarkQuery} WHERE m.id = ? AND m.deleted_at IS NULL`,
            [input.id]
          )
          if (!existing) throw new Error('That bookmark could not be found.')
          await transaction.runAsync(
            `UPDATE bookmarks
             SET label = ?, note = ?, color = ?, updated_at = ?, row_version = row_version + 1
             WHERE id = ?`,
            [label, note, input.color.trim().slice(0, 40) || existing.color, updatedAt, input.id]
          )
          await recordChange(transaction, 'bookmark', input.id, updatedAt, existing.row_version + 1)
          const row = await transaction.getFirstAsync<BookmarkRow>(
            `${bookmarkQuery} WHERE m.id = ?`,
            [input.id]
          )
          if (row) updated = mapBookmark(row)
        })
        if (!updated) throw new Error('The bookmark did not save.')
        return updated
      })
    },

    removeBookmark(id: string): Promise<void> {
      return writes.run(async () => {
        const deletedAt = now().toISOString()
        await database.transactionAsync(async (transaction) => {
          const existing = await transaction.getFirstAsync<{ row_version: number }>(
            'SELECT row_version FROM bookmarks WHERE id = ? AND deleted_at IS NULL',
            [id]
          )
          if (!existing) throw new Error('That bookmark could not be found.')
          await transaction.runAsync(
            `UPDATE bookmarks
             SET deleted_at = ?, updated_at = ?, row_version = row_version + 1
             WHERE id = ?`,
            [deletedAt, deletedAt, id]
          )
          await recordChange(
            transaction,
            'bookmark',
            id,
            deletedAt,
            existing.row_version + 1,
            'delete'
          )
        })
      })
    },

    async getSyncStatus(): Promise<LocalSyncStatus> {
      const row = await database.getFirstAsync<{ pending_count: number }>(
        'SELECT COUNT(*) AS pending_count FROM change_records'
      )
      return {
        mode: 'local-only',
        deviceLabel: 'This device',
        pendingLocalRecords: row?.pending_count ?? 0,
        lastSyncAt: null
      }
    },

    getPreferences: readPreferences,

    savePreferences(changes: Partial<MobilePreferences>): Promise<MobilePreferences> {
      return writes.run(async () => {
        const clean = sanitizePreferences(changes)
        const updatedAt = now().toISOString()
        await database.transactionAsync(async (transaction) => {
          for (const [key, value] of Object.entries(clean)) {
            await transaction.runAsync(
              `INSERT INTO app_preferences (key, value, updated_at) VALUES (?, ?, ?)
               ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
              [key, JSON.stringify(value), updatedAt]
            )
          }
        })
        return readPreferences()
      })
    }
  }
  return repository
}
