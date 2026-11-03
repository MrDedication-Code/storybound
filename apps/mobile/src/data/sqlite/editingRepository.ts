import type {
  BookDetailsInput,
  Chapter,
  ChapterRevision,
  CreateBookInput,
  MobileRepository,
  SplitChapterInput,
  TrashedBook,
  TrashedChapter
} from '../../domain/contracts'
import { countWords, recordChange } from './changeRecords'
import type { SqlDatabasePort, SqlWriteCoordinator } from './databasePort'

interface ChapterRow {
  id: string
  book_id: string
  title: string
  content: string
  position: number
  word_count: number
  updated_at: string
  row_version: number
  deleted_at: string | null
  trashed_from_position: number | null
}

const chapterColumns = `id, book_id, title, content, position, word_count, updated_at, row_version,
  deleted_at, trashed_from_position`

const MAX_TITLE = 240
const MAX_BLURB = 20_000
/** Versions kept per chapter on this phone; the oldest go first. */
const MAX_REVISIONS = 50
/** An edit keeps the text it replaces at most this often, so history stays readable. */
const ROLLING_REVISION_MS = 10 * 60 * 1000

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

function cleanTitle(value: string, what: string): string {
  const title = value.trim()
  if (!title) throw new Error(`Every ${what} needs a title.`)
  if (title.length > MAX_TITLE) throw new Error(`That ${what} title is too long.`)
  return title
}

/** Keeps a copy of a chapter's text in its local history, unless that exact text is kept. */
export async function saveChapterRevision(
  transaction: SqlDatabasePort,
  chapter: { id: string; title: string; content: string; word_count: number },
  reason: string,
  createdAt: string,
  id: string
): Promise<void> {
  const latest = await transaction.getFirstAsync<{ title: string; content: string }>(
    `SELECT title, content FROM chapter_revisions
     WHERE chapter_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    [chapter.id]
  )
  if (latest && latest.title === chapter.title && latest.content === chapter.content) return
  await transaction.runAsync(
    `INSERT INTO chapter_revisions (id, chapter_id, title, content, word_count, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, chapter.id, chapter.title, chapter.content, chapter.word_count, reason, createdAt]
  )
  await transaction.runAsync(
    `DELETE FROM chapter_revisions WHERE chapter_id = ? AND id NOT IN (
       SELECT id FROM chapter_revisions WHERE chapter_id = ?
       ORDER BY created_at DESC, rowid DESC LIMIT ?
     )`,
    [chapter.id, chapter.id, MAX_REVISIONS]
  )
}

/** While writing, the text being replaced is kept once every ten minutes. */
export async function saveRollingRevision(
  transaction: SqlDatabasePort,
  chapter: { id: string; title: string; content: string; word_count: number },
  now: Date,
  id: string
): Promise<void> {
  const latest = await transaction.getFirstAsync<{ created_at: string }>(
    `SELECT created_at FROM chapter_revisions
     WHERE chapter_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    [chapter.id]
  )
  if (latest && now.getTime() - Date.parse(latest.created_at) < ROLLING_REVISION_MS) return
  await saveChapterRevision(transaction, chapter, 'While writing', now.toISOString(), id)
}

/**
 * Positions are unique within a book, trashed chapters included, so every position is first
 * moved past the end and then renumbered. Only chapters whose place changed are sent to sync.
 */
async function setChapterOrder(
  transaction: SqlDatabasePort,
  bookId: string,
  orderedIds: string[],
  changedAt: string
): Promise<void> {
  if (orderedIds.length === 0) return
  const before = await transaction.getAllAsync<{ id: string; position: number }>(
    'SELECT id, position FROM chapters WHERE book_id = ?',
    [bookId]
  )
  const original = new Map(before.map((row) => [row.id, row.position]))
  const maximum = Math.max(0, ...before.map((row) => row.position))
  await transaction.runAsync('UPDATE chapters SET position = position + ? WHERE book_id = ?', [
    maximum + orderedIds.length + 1,
    bookId
  ])
  for (const [position, id] of orderedIds.entries()) {
    if (original.get(id) === position) {
      await transaction.runAsync('UPDATE chapters SET position = ? WHERE id = ?', [position, id])
      continue
    }
    await transaction.runAsync(
      'UPDATE chapters SET position = ?, row_version = row_version + 1 WHERE id = ?',
      [position, id]
    )
    const version = await transaction.getFirstAsync<{ row_version: number }>(
      'SELECT row_version FROM chapters WHERE id = ?',
      [id]
    )
    await recordChange(transaction, 'chapter', id, changedAt, version?.row_version ?? 1)
  }
}

async function activeChapterIds(transaction: SqlDatabasePort, bookId: string): Promise<string[]> {
  const rows = await transaction.getAllAsync<{ id: string }>(
    'SELECT id FROM chapters WHERE book_id = ? AND deleted_at IS NULL ORDER BY position, id',
    [bookId]
  )
  return rows.map((row) => row.id)
}

async function requireChapterRow(
  transaction: SqlDatabasePort,
  chapterId: string,
  options: { trashed?: boolean } = {}
): Promise<ChapterRow> {
  const row = await transaction.getFirstAsync<ChapterRow>(
    `SELECT ${chapterColumns} FROM chapters WHERE id = ? AND deleted_at IS ${
      options.trashed ? 'NOT NULL' : 'NULL'
    }`,
    [chapterId]
  )
  if (!row) throw new Error('That chapter could not be found.')
  return row
}

async function requireActiveBook(transaction: SqlDatabasePort, bookId: string): Promise<void> {
  const book = await transaction.getFirstAsync<{ id: string }>(
    'SELECT id FROM books WHERE id = ? AND deleted_at IS NULL',
    [bookId]
  )
  if (!book) throw new Error('That book could not be found in this library.')
}

async function insertChapter(
  transaction: SqlDatabasePort,
  input: { id: string; bookId: string; title: string; content: string; createdAt: string }
): Promise<void> {
  const end = await transaction.getFirstAsync<{ position: number }>(
    'SELECT COALESCE(MAX(position), -1) + 1 AS position FROM chapters WHERE book_id = ?',
    [input.bookId]
  )
  await transaction.runAsync(
    `INSERT INTO chapters (
       id, book_id, title, content, position, word_count, created_at, updated_at,
       deleted_at, trashed_from_position, row_version
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 1)`,
    [
      input.id,
      input.bookId,
      input.title,
      input.content,
      end?.position ?? 0,
      countWords(input.content),
      input.createdAt,
      input.createdAt
    ]
  )
  await recordChange(transaction, 'chapter', input.id, input.createdAt, 1)
}

async function writeChapter(
  transaction: SqlDatabasePort,
  chapterId: string,
  changes: { title: string; content: string },
  updatedAt: string
): Promise<void> {
  await transaction.runAsync(
    `UPDATE chapters
     SET title = ?, content = ?, word_count = ?, updated_at = ?, row_version = row_version + 1
     WHERE id = ?`,
    [changes.title, changes.content, countWords(changes.content), updatedAt, chapterId]
  )
  const version = await transaction.getFirstAsync<{ row_version: number }>(
    'SELECT row_version FROM chapters WHERE id = ?',
    [chapterId]
  )
  await recordChange(transaction, 'chapter', chapterId, updatedAt, version?.row_version ?? 1)
}

async function trashChapterRow(
  transaction: SqlDatabasePort,
  chapter: ChapterRow,
  deletedAt: string
): Promise<void> {
  // Like the desktop: the chapter remembers its place and parks past the end of the book.
  await transaction.runAsync(
    `UPDATE chapters
     SET deleted_at = ?, trashed_from_position = position, updated_at = ?,
       position = (SELECT MAX(position) + 1 FROM chapters WHERE book_id = ?),
       row_version = row_version + 1
     WHERE id = ?`,
    [deletedAt, deletedAt, chapter.book_id, chapter.id]
  )
  await recordChange(transaction, 'chapter', chapter.id, deletedAt, chapter.row_version + 1)
  await setChapterOrder(
    transaction,
    chapter.book_id,
    await activeChapterIds(transaction, chapter.book_id),
    deletedAt
  )
}

async function bumpBook(
  transaction: SqlDatabasePort,
  bookId: string,
  assignments: string,
  values: Array<string | number | null>,
  changedAt: string
): Promise<void> {
  await transaction.runAsync(
    `UPDATE books SET ${assignments}, updated_at = ?, row_version = row_version + 1 WHERE id = ?`,
    [...values, changedAt, bookId]
  )
  const version = await transaction.getFirstAsync<{ row_version: number }>(
    'SELECT row_version FROM books WHERE id = ?',
    [bookId]
  )
  await recordChange(transaction, 'book', bookId, changedAt, version?.row_version ?? 1)
}

function cleanDetails(input: BookDetailsInput): BookDetailsInput {
  const position = input.seriesPosition
  if (position !== null && !(Number.isFinite(position) && position > 0)) {
    throw new Error('The series number must be above zero.')
  }
  const blurb = input.blurb.trim()
  if (blurb.length > MAX_BLURB) throw new Error('That description is too long.')
  return {
    title: cleanTitle(input.title, 'book'),
    subtitle: input.subtitle.trim().slice(0, MAX_TITLE),
    authorName: input.authorName.trim().slice(0, MAX_TITLE),
    blurb,
    status: input.status === 'completed' ? 'completed' : 'ongoing',
    seriesName: input.seriesName.trim().slice(0, MAX_TITLE),
    seriesPosition: position
  }
}

type EditingOperations = Pick<
  MobileRepository,
  | 'trashBook'
  | 'restoreBook'
  | 'listTrashedBooks'
  | 'createChapter'
  | 'duplicateChapter'
  | 'reorderChapters'
  | 'trashChapter'
  | 'restoreChapter'
  | 'listTrashedChapters'
  | 'splitChapter'
  | 'mergeWithNextChapter'
  | 'listChapterRevisions'
  | 'restoreChapterRevision'
> & {
  /** Returns the new book's id; the repository reads the book back. */
  createBook(input: CreateBookInput): Promise<string>
  updateBookDetails(bookId: string, input: BookDetailsInput): Promise<void>
}

/** Book, chapter, and version operations for the phone's editor mode. */
export function createEditingOperations(
  database: SqlDatabasePort,
  now: () => Date,
  writes: SqlWriteCoordinator,
  createId: () => string
): EditingOperations {
  const getChapterRow = async (chapterId: string): Promise<Chapter> =>
    mapChapter(await requireChapterRow(database, chapterId))

  return {
    createBook(input: CreateBookInput): Promise<string> {
      return writes.run(async () => {
        const details = cleanDetails(input)
        const createdAt = now().toISOString()
        const bookId = createId()
        await database.transactionAsync(async (transaction) => {
          const library = await transaction.getFirstAsync<{ id: string }>(
            input.libraryId
              ? 'SELECT id FROM libraries WHERE id = ? AND deleted_at IS NULL'
              : 'SELECT id FROM libraries WHERE deleted_at IS NULL ORDER BY created_at, id LIMIT 1',
            input.libraryId ? [input.libraryId] : []
          )
          if (!library) throw new Error('That library could not be found.')
          const libraryId = library.id
          await transaction.runAsync(
            `INSERT INTO books (
               id, library_id, title, subtitle, author_name, blurb, status, cover_tone, position,
               created_at, updated_at, deleted_at, completed_at, is_archived, language_code,
               source_label, source_url, personal_notes, series_name, series_position,
               cover_style, cover_position_x, cover_position_y, row_version
             ) VALUES (
               ?, ?, ?, ?, ?, ?, ?, 'forest',
               (SELECT COALESCE(MAX(position), -1) + 1 FROM books WHERE library_id = ?),
               ?, ?, NULL, ?, 0, '', '', '', '', ?, ?, 'classic', 50, 50, 1
             )`,
            [
              bookId,
              libraryId,
              details.title,
              details.subtitle,
              details.authorName,
              details.blurb,
              details.status,
              libraryId,
              createdAt,
              createdAt,
              details.status === 'completed' ? createdAt : null,
              details.seriesName,
              details.seriesPosition
            ]
          )
          await recordChange(transaction, 'book', bookId, createdAt, 1)
          await insertChapter(transaction, {
            id: createId(),
            bookId,
            title: 'Chapter 1',
            content: '',
            createdAt
          })
        })
        return bookId
      })
    },

    updateBookDetails(bookId: string, input: BookDetailsInput): Promise<void> {
      return writes.run(async () => {
        const details = cleanDetails(input)
        const changedAt = now().toISOString()
        await database.transactionAsync(async (transaction) => {
          await requireActiveBook(transaction, bookId)
          await bumpBook(
            transaction,
            bookId,
            `title = ?, subtitle = ?, author_name = ?, blurb = ?, status = ?,
             completed_at = CASE WHEN ? = 'completed' THEN COALESCE(completed_at, ?) ELSE NULL END,
             series_name = ?, series_position = ?`,
            [
              details.title,
              details.subtitle,
              details.authorName,
              details.blurb,
              details.status,
              details.status,
              changedAt,
              details.seriesName,
              details.seriesPosition
            ],
            changedAt
          )
        })
      })
    },

    trashBook(bookId: string): Promise<void> {
      return writes.run(async () => {
        const changedAt = now().toISOString()
        await database.transactionAsync(async (transaction) => {
          await requireActiveBook(transaction, bookId)
          // The desktop also marks a book in Trash as archived.
          await bumpBook(
            transaction,
            bookId,
            'deleted_at = ?, is_archived = 1',
            [changedAt],
            changedAt
          )
        })
      })
    },

    restoreBook(bookId: string): Promise<void> {
      return writes.run(async () => {
        const changedAt = now().toISOString()
        await database.transactionAsync(async (transaction) => {
          const book = await transaction.getFirstAsync<{ id: string }>(
            'SELECT id FROM books WHERE id = ? AND deleted_at IS NOT NULL',
            [bookId]
          )
          if (!book) throw new Error('That book is not in Trash.')
          await bumpBook(transaction, bookId, 'deleted_at = NULL, is_archived = 0', [], changedAt)
        })
      })
    },

    async listTrashedBooks(): Promise<TrashedBook[]> {
      const rows = await database.getAllAsync<{
        id: string
        library_id: string
        title: string
        deleted_at: string
      }>(
        `SELECT id, library_id, title, deleted_at FROM books
         WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`
      )
      return rows.map((row) => ({
        id: row.id,
        libraryId: row.library_id,
        title: row.title,
        deletedAt: row.deleted_at
      }))
    },

    createChapter(bookId: string, title?: string): Promise<Chapter> {
      return writes.run(async () => {
        const createdAt = now().toISOString()
        const chapterId = createId()
        await database.transactionAsync(async (transaction) => {
          await requireActiveBook(transaction, bookId)
          const count = (await activeChapterIds(transaction, bookId)).length
          await insertChapter(transaction, {
            id: chapterId,
            bookId,
            title: cleanTitle(title ?? `Chapter ${count + 1}`, 'chapter'),
            content: '',
            createdAt
          })
          await setChapterOrder(
            transaction,
            bookId,
            await activeChapterIds(transaction, bookId),
            createdAt
          )
        })
        return getChapterRow(chapterId)
      })
    },

    duplicateChapter(chapterId: string): Promise<Chapter> {
      return writes.run(async () => {
        const createdAt = now().toISOString()
        const copyId = createId()
        await database.transactionAsync(async (transaction) => {
          const original = await requireChapterRow(transaction, chapterId)
          await insertChapter(transaction, {
            id: copyId,
            bookId: original.book_id,
            title: `${original.title} (copy)`.slice(0, MAX_TITLE),
            content: original.content,
            createdAt
          })
          const order = (await activeChapterIds(transaction, original.book_id)).filter(
            (id) => id !== copyId
          )
          order.splice(order.indexOf(chapterId) + 1, 0, copyId)
          await setChapterOrder(transaction, original.book_id, order, createdAt)
        })
        return getChapterRow(copyId)
      })
    },

    reorderChapters(bookId: string, chapterIds: string[]): Promise<void> {
      return writes.run(async () => {
        const changedAt = now().toISOString()
        await database.transactionAsync(async (transaction) => {
          const current = await activeChapterIds(transaction, bookId)
          if (
            current.length !== chapterIds.length ||
            new Set(chapterIds).size !== chapterIds.length ||
            chapterIds.some((id) => !current.includes(id))
          ) {
            throw new Error('The chapter list changed. Try arranging it again.')
          }
          await setChapterOrder(transaction, bookId, chapterIds, changedAt)
        })
      })
    },

    trashChapter(chapterId: string): Promise<void> {
      return writes.run(async () => {
        const deletedAt = now().toISOString()
        await database.transactionAsync(async (transaction) => {
          const chapter = await requireChapterRow(transaction, chapterId)
          await saveChapterRevision(transaction, chapter, 'Moved to Trash', deletedAt, createId())
          await trashChapterRow(transaction, chapter, deletedAt)
        })
      })
    },

    restoreChapter(chapterId: string): Promise<void> {
      return writes.run(async () => {
        const changedAt = now().toISOString()
        await database.transactionAsync(async (transaction) => {
          const chapter = await requireChapterRow(transaction, chapterId, { trashed: true })
          await requireActiveBook(transaction, chapter.book_id)
          const order = await activeChapterIds(transaction, chapter.book_id)
          order.splice(
            Math.min(chapter.trashed_from_position ?? order.length, order.length),
            0,
            chapterId
          )
          await transaction.runAsync(
            `UPDATE chapters
             SET deleted_at = NULL, trashed_from_position = NULL, updated_at = ?,
               row_version = row_version + 1
             WHERE id = ?`,
            [changedAt, chapterId]
          )
          await recordChange(transaction, 'chapter', chapterId, changedAt, chapter.row_version + 1)
          await setChapterOrder(transaction, chapter.book_id, order, changedAt)
        })
      })
    },

    async listTrashedChapters(bookId: string): Promise<TrashedChapter[]> {
      const rows = await database.getAllAsync<ChapterRow>(
        `SELECT ${chapterColumns} FROM chapters
         WHERE book_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC`,
        [bookId]
      )
      return rows.map((row) => ({
        id: row.id,
        bookId: row.book_id,
        title: row.title,
        wordCount: row.word_count,
        deletedAt: row.deleted_at ?? ''
      }))
    },

    splitChapter(input: SplitChapterInput): Promise<Chapter> {
      return writes.run(async () => {
        const changedAt = now().toISOString()
        const newId = createId()
        await database.transactionAsync(async (transaction) => {
          const chapter = await requireChapterRow(transaction, input.id)
          const offset = Math.trunc(input.offset)
          const before = chapter.content.slice(0, offset).trimEnd()
          const after = chapter.content.slice(offset).trimStart()
          if (!before || !after) {
            throw new Error('Place the cursor inside the text, where the new chapter should begin.')
          }
          await saveChapterRevision(transaction, chapter, 'Before splitting', changedAt, createId())
          await writeChapter(
            transaction,
            chapter.id,
            { title: chapter.title, content: before },
            changedAt
          )
          await insertChapter(transaction, {
            id: newId,
            bookId: chapter.book_id,
            title: cleanTitle(input.newTitle, 'chapter'),
            content: after,
            createdAt: changedAt
          })
          const order = (await activeChapterIds(transaction, chapter.book_id)).filter(
            (id) => id !== newId
          )
          order.splice(order.indexOf(chapter.id) + 1, 0, newId)
          await setChapterOrder(transaction, chapter.book_id, order, changedAt)
        })
        return getChapterRow(newId)
      })
    },

    mergeWithNextChapter(chapterId: string): Promise<Chapter> {
      return writes.run(async () => {
        const changedAt = now().toISOString()
        await database.transactionAsync(async (transaction) => {
          const chapter = await requireChapterRow(transaction, chapterId)
          const order = await activeChapterIds(transaction, chapter.book_id)
          const nextId = order[order.indexOf(chapterId) + 1]
          if (!nextId) throw new Error('This is the last chapter, so there is nothing to merge.')
          const next = await requireChapterRow(transaction, nextId)
          await saveChapterRevision(transaction, chapter, 'Before merging', changedAt, createId())
          const content = [chapter.content.trimEnd(), next.content.trimStart()]
            .filter(Boolean)
            .join('\n\n')
          await writeChapter(transaction, chapter.id, { title: chapter.title, content }, changedAt)
          // The merged chapter stays recoverable in Trash, as on the desktop.
          await saveChapterRevision(
            transaction,
            next,
            'Merged into the previous chapter',
            changedAt,
            createId()
          )
          await trashChapterRow(transaction, next, changedAt)
        })
        return getChapterRow(chapterId)
      })
    },

    async listChapterRevisions(chapterId: string): Promise<ChapterRevision[]> {
      const rows = await database.getAllAsync<{
        id: string
        chapter_id: string
        title: string
        content: string
        word_count: number
        reason: string
        created_at: string
      }>(
        `SELECT id, chapter_id, title, content, word_count, reason, created_at
         FROM chapter_revisions WHERE chapter_id = ? ORDER BY created_at DESC, rowid DESC`,
        [chapterId]
      )
      return rows.map((row) => ({
        id: row.id,
        chapterId: row.chapter_id,
        title: row.title,
        content: row.content,
        wordCount: row.word_count,
        reason: row.reason,
        createdAt: row.created_at
      }))
    },

    restoreChapterRevision(revisionId: string): Promise<Chapter> {
      return writes.run(async () => {
        const changedAt = now().toISOString()
        let chapterId = ''
        await database.transactionAsync(async (transaction) => {
          const revision = await transaction.getFirstAsync<{
            chapter_id: string
            title: string
            content: string
          }>('SELECT chapter_id, title, content FROM chapter_revisions WHERE id = ?', [revisionId])
          if (!revision) throw new Error('That version could not be found.')
          chapterId = revision.chapter_id
          const chapter = await requireChapterRow(transaction, chapterId)
          await saveChapterRevision(
            transaction,
            chapter,
            'Before restoring a version',
            changedAt,
            createId()
          )
          await writeChapter(transaction, chapterId, revision, changedAt)
        })
        return getChapterRow(chapterId)
      })
    }
  }
}
