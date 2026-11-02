import type {
  BookDetail,
  BookSummary,
  Chapter,
  ChapterSummary,
  LibrarySummary,
  LocalSyncStatus,
  MobilePreferences,
  MobileRepository,
  ReadingState,
  SaveReadingStateInput,
  UpdateChapterInput
} from '../../domain/contracts'
import {
  DEFAULT_PREFERENCES,
  READER_FONT_SIZE_MAX,
  READER_FONT_SIZE_MIN
} from '../../domain/contracts'
import { clamp } from '../../domain/reading'
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

async function getBookSummary(database: SqlDatabasePort, bookId: string): Promise<BookSummary> {
  const row = await database.getFirstAsync<BookRow>(
    `${bookSummaryQuery} WHERE b.id = ? AND b.deleted_at IS NULL`,
    [bookId]
  )
  if (!row) throw new Error('That book could not be found in this library.')
  return mapBook(row)
}

async function recordChange(
  transaction: SqlDatabasePort,
  entityType: 'chapter' | 'reading_state',
  entityId: string,
  changedAt: string,
  rowVersion: number
): Promise<void> {
  const syncEntityType = entityType === 'reading_state' ? 'reading-state' : entityType
  await transaction.runAsync(
    `INSERT INTO change_records (
       entity_type, entity_id, operation, changed_at, row_version,
       base_remote_revision, mutation_id
     ) VALUES (
       ?, ?, 'upsert', ?, ?,
       (SELECT remote_revision FROM sync_entity_state WHERE entity_type = ? AND entity_id = ?),
       NULL
     )
     ON CONFLICT (entity_type, entity_id) DO UPDATE SET
       operation = excluded.operation,
       changed_at = excluded.changed_at,
       row_version = excluded.row_version,
       mutation_id = NULL`,
    [syncEntityType, entityId, changedAt, rowVersion, syncEntityType, entityId]
  )
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
  writes: SqlWriteCoordinator = createSqlWriteCoordinator()
): MobileRepository {
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

  return {
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
      const [book, chapterRows] = await Promise.all([
        getBookSummary(database, bookId),
        database.getAllAsync<ChapterRow>(
          `SELECT id, book_id, title, content, position, word_count, updated_at
           FROM chapters
           WHERE book_id = ? AND deleted_at IS NULL
           ORDER BY position, id`,
          [bookId]
        )
      ])
      return { ...book, chapters: chapterRows.map(mapChapterSummary) }
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
        const wordCount = content.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu)?.length ?? 0
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
}
