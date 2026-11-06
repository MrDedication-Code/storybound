import { BOOKSTORE_ADDRESS_PREFIX, type SharedBook } from '@storybound/contracts'
import { sharedEntityId } from '@storybound/sync/sharedIds'
import type {
  BookstoreCopy,
  BookstoreOrigin,
  MobileRepository,
  ReceivedBookstoreBook
} from '../../domain/contracts'
import { countWords, recordChange } from './changeRecords'
import type { SqlDatabasePort, SqlWriteCoordinator } from './databasePort'
import { saveChapterRevision } from './editingRepository'

type BookstoreOperations = Pick<
  MobileRepository,
  'receiveBookstoreBook' | 'listBookstoreBooks' | 'findBookstoreBook'
>

interface ExistingBook {
  share_sequence: number
  deleted_at: string | null
  row_version: number
}

interface ExistingChapter {
  id: string
  title: string
  content: string
  word_count: number
  row_version: number
  deleted_at: string | null
}

/**
 * The phone's way of taking in a Bookstore book. Ids come from the listing and the author's ids,
 * as on a computer, so the same book added on both is one book. A Bookstore book is always
 * read-only, so unlike a parcel there are no edits of the reader's to keep.
 */
export function createBookstoreOperations(
  database: SqlDatabasePort,
  now: () => Date,
  writes: SqlWriteCoordinator,
  createId: () => string
): BookstoreOperations {
  return {
    receiveBookstoreBook(
      origin: BookstoreOrigin,
      book: SharedBook
    ): Promise<ReceivedBookstoreBook> {
      return writes.run(async () => {
        const bookId = sharedEntityId(origin.listingId, book.book.sourceId)
        const changedAt = now().toISOString()
        let received: ReceivedBookstoreBook = { bookId, title: book.book.title, stale: false }
        await database.transactionAsync(async (transaction) => {
          const existing = await transaction.getFirstAsync<ExistingBook>(
            'SELECT share_sequence, deleted_at, row_version FROM books WHERE id = ?',
            [bookId]
          )
          if (existing && origin.version <= existing.share_sequence) {
            received = { ...received, stale: true }
            if (existing.deleted_at) await bringBack(transaction, bookId, changedAt)
            return
          }
          const rowVersion = (existing?.row_version ?? 0) + 1
          if (existing) await updateBook(transaction, bookId, origin, book, rowVersion, changedAt)
          else await insertBook(transaction, bookId, origin, book, changedAt)
          await recordChange(transaction, 'book', bookId, changedAt, rowVersion)
          await writeCover(transaction, bookId, book, changedAt)
          await writeChapters(transaction, bookId, origin, book, changedAt, createId)
        })
        return received
      })
    },

    async listBookstoreBooks(): Promise<BookstoreCopy[]> {
      const rows = await database.getAllAsync<{
        id: string
        share_id: string
        title: string
        share_sender_name: string | null
        share_sequence: number
        deleted_at: string | null
      }>(
        `SELECT id, share_id, title, share_sender_name, share_sequence, deleted_at FROM books
         WHERE share_sender_address LIKE ? AND share_id IS NOT NULL`,
        [`${BOOKSTORE_ADDRESS_PREFIX}%`]
      )
      return rows.map((row) => ({
        bookId: row.id,
        listingId: row.share_id,
        title: row.title,
        authorName: row.share_sender_name ?? '',
        version: row.share_sequence,
        deleted: row.deleted_at !== null
      }))
    },

    async findBookstoreBook(listingId: string): Promise<string | null> {
      const row = await database.getFirstAsync<{ id: string }>(
        'SELECT id FROM books WHERE share_sender_address = ? AND deleted_at IS NULL',
        [`${BOOKSTORE_ADDRESS_PREFIX}${listingId}`]
      )
      return row?.id ?? null
    }
  }
}

async function bringBack(
  transaction: SqlDatabasePort,
  bookId: string,
  changedAt: string
): Promise<void> {
  await transaction.runAsync(
    `UPDATE books SET deleted_at = NULL, is_archived = 0, updated_at = ?,
       row_version = row_version + 1 WHERE id = ?`,
    [changedAt, bookId]
  )
  const version = await transaction.getFirstAsync<{ row_version: number }>(
    'SELECT row_version FROM books WHERE id = ?',
    [bookId]
  )
  await recordChange(transaction, 'book', bookId, changedAt, version?.row_version ?? 1)
}

async function insertBook(
  transaction: SqlDatabasePort,
  bookId: string,
  origin: BookstoreOrigin,
  { book }: SharedBook,
  changedAt: string
): Promise<void> {
  const library = await transaction.getFirstAsync<{ id: string }>(
    'SELECT id FROM libraries WHERE deleted_at IS NULL ORDER BY created_at, id LIMIT 1'
  )
  if (!library) throw new Error('That library could not be found.')
  await transaction.runAsync(
    `INSERT INTO books (
       id, library_id, title, subtitle, author_name, blurb, status, cover_tone, position,
       created_at, updated_at, deleted_at, completed_at, is_archived, language_code,
       source_label, source_url, personal_notes, series_name, series_position, cover_style,
       cover_position_x, cover_position_y, row_version, share_id, share_sender_name,
       share_sender_address, share_mode, share_sequence
     ) VALUES (
       ?, ?, ?, ?, ?, ?, ?, 'forest',
       (SELECT COALESCE(MAX(position), -1) + 1 FROM books WHERE library_id = ?),
       ?, ?, NULL, NULL, 0, ?, '', '', '', ?, ?, ?, ?, ?, 1, ?, ?, ?, 'read-only', ?
     )`,
    [
      bookId,
      library.id,
      book.title,
      book.subtitle,
      book.authorName,
      book.blurb,
      book.status,
      library.id,
      book.createdAt,
      changedAt,
      book.languageCode,
      book.seriesName,
      book.seriesPosition,
      book.coverStyle,
      book.coverPositionX,
      book.coverPositionY,
      origin.listingId,
      origin.authorName,
      `${BOOKSTORE_ADDRESS_PREFIX}${origin.listingId}`,
      origin.version
    ]
  )
}

async function updateBook(
  transaction: SqlDatabasePort,
  bookId: string,
  origin: BookstoreOrigin,
  { book }: SharedBook,
  rowVersion: number,
  changedAt: string
): Promise<void> {
  await transaction.runAsync(
    `UPDATE books SET title = ?, subtitle = ?, author_name = ?, blurb = ?, status = ?,
       language_code = ?, series_name = ?, series_position = ?, cover_style = ?,
       cover_position_x = ?, cover_position_y = ?, share_sender_name = ?, share_sequence = ?,
       deleted_at = NULL, is_archived = 0, updated_at = ?, row_version = ? WHERE id = ?`,
    [
      book.title,
      book.subtitle,
      book.authorName,
      book.blurb,
      book.status,
      book.languageCode,
      book.seriesName,
      book.seriesPosition,
      book.coverStyle,
      book.coverPositionX,
      book.coverPositionY,
      origin.authorName,
      origin.version,
      changedAt,
      rowVersion,
      bookId
    ]
  )
}

async function writeCover(
  transaction: SqlDatabasePort,
  bookId: string,
  { cover }: SharedBook,
  changedAt: string
): Promise<void> {
  if (!cover) {
    await transaction.runAsync('DELETE FROM book_covers WHERE book_id = ?', [bookId])
    return
  }
  await transaction.runAsync(
    `INSERT INTO book_covers (book_id, mime_type, data, row_version, updated_at)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT (book_id) DO UPDATE SET
       mime_type = excluded.mime_type, data = excluded.data,
       row_version = book_covers.row_version + 1, updated_at = excluded.updated_at`,
    [bookId, cover.mimeType, cover.data, changedAt]
  )
}

async function writeChapters(
  transaction: SqlDatabasePort,
  bookId: string,
  origin: BookstoreOrigin,
  book: SharedBook,
  changedAt: string,
  createId: () => string
): Promise<void> {
  const rows = await transaction.getAllAsync<ExistingChapter>(
    `SELECT id, title, content, word_count, row_version, deleted_at
     FROM chapters WHERE book_id = ?`,
    [bookId]
  )
  const current = new Map(rows.map((row) => [row.id, row]))
  const incoming = book.chapters.map((chapter) => ({
    ...chapter,
    id: sharedEntityId(origin.listingId, chapter.sourceId)
  }))
  const kept = new Set(incoming.map((chapter) => chapter.id))

  // Positions are unique within a book, so chapters leave them before taking their new ones.
  let parked = incoming.length + rows.length
  for (const row of rows) {
    await transaction.runAsync('UPDATE chapters SET position = ? WHERE id = ?', [parked, row.id])
    parked += 1
  }

  for (const [position, chapter] of incoming.entries()) {
    const existing = current.get(chapter.id)
    const wordCount = countWords(chapter.content)
    if (!existing) {
      await transaction.runAsync(
        `INSERT INTO chapters (
           id, book_id, title, content, position, word_count, created_at, updated_at,
           deleted_at, trashed_from_position, row_version
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 1)`,
        [
          chapter.id,
          bookId,
          chapter.title,
          chapter.content,
          position,
          wordCount,
          changedAt,
          changedAt
        ]
      )
      await recordChange(transaction, 'chapter', chapter.id, changedAt, 1)
      continue
    }
    if (existing.title !== chapter.title || existing.content !== chapter.content) {
      await saveChapterRevision(
        transaction,
        existing,
        `Before update from ${origin.authorName}`,
        changedAt,
        createId()
      )
    }
    const rowVersion = existing.row_version + 1
    await transaction.runAsync(
      `UPDATE chapters SET title = ?, content = ?, position = ?, word_count = ?, updated_at = ?,
         deleted_at = NULL, trashed_from_position = NULL, row_version = ? WHERE id = ?`,
      [chapter.title, chapter.content, position, wordCount, changedAt, rowVersion, chapter.id]
    )
    await recordChange(transaction, 'chapter', chapter.id, changedAt, rowVersion)
  }

  // A chapter the author removed goes to Trash, as on a computer.
  for (const row of rows) {
    if (kept.has(row.id) || row.deleted_at) continue
    const rowVersion = row.row_version + 1
    await transaction.runAsync(
      'UPDATE chapters SET deleted_at = ?, updated_at = ?, row_version = ? WHERE id = ?',
      [changedAt, changedAt, rowVersion, row.id]
    )
    await recordChange(transaction, 'chapter', row.id, changedAt, rowVersion)
  }
}
