import type {
  BookDetail,
  BookSummary,
  Chapter,
  ChapterSummary,
  LocalSyncStatus,
  MobileRepository,
  ReadingState,
  SaveReadingStateInput,
  UpdateChapterInput
} from '../../domain/contracts'
import { clamp } from '../../domain/reading'
import {
  createSqlWriteCoordinator,
  type SqlDatabasePort,
  type SqlWriteCoordinator
} from './databasePort'

interface BookRow {
  id: string
  title: string
  subtitle: string
  author_name: string
  blurb: string
  status: BookSummary['status']
  cover_tone: BookSummary['coverTone']
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
    b.title,
    b.subtitle,
    b.author_name,
    b.blurb,
    b.status,
    b.cover_tone,
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
`

function mapBook(row: BookRow): BookSummary {
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    authorName: row.author_name,
    blurb: row.blurb,
    status: row.status,
    coverTone: row.cover_tone,
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

export function createSQLiteRepository(
  database: SqlDatabasePort,
  now: () => Date = () => new Date(),
  writes: SqlWriteCoordinator = createSqlWriteCoordinator()
): MobileRepository {
  return {
    async listBooks(): Promise<BookSummary[]> {
      const rows = await database.getAllAsync<BookRow>(
        `${bookSummaryQuery}
         WHERE b.deleted_at IS NULL
         ORDER BY (r.last_read_at IS NULL), r.last_read_at DESC, b.position, b.title COLLATE NOCASE`
      )
      return rows.map(mapBook)
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
    }
  }
}
