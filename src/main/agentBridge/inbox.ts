import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { BookStatus, InboxScanResult } from '../../shared/types'
import { StoryboundError, toStoryboundError } from '../errors'
import type { StoryboundStore } from '../store'
import { findBooksByTitle, normalizeChapterContent, type AgentContentChange } from './tools'

export const IMPORTED_FOLDER = 'Imported'
export const FAILED_FOLDER = 'Failed'
const ACCEPTED_EXTENSIONS = new Set(['.md', '.markdown', '.txt'])
const MAX_FILE_BYTES = 10 * 1024 * 1024
// A file still being written by another app must not be imported half-finished.
const SETTLE_MILLISECONDS = 3_000

export interface InboxFile {
  bookTitle: string
  chapterTitle: string | null
  content: string
  blurb: string | null
  status: BookStatus | null
  seriesName: string | null
  seriesPosition: number | null
  authorName: string | null
  replace: boolean
}

export interface InboxEvents {
  onChange(change: AgentContentChange): void
  onActivity(message: string, failed: boolean): void
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[\s_-]/g, '')
}

function unquote(value: string): string {
  const trimmed = value.trim()
  const quoted = /^(["'])(.*)\1$/.exec(trimmed)
  return quoted ? quoted[2] : trimmed
}

function parseFrontMatter(raw: string): { fields: Map<string, string>; body: string } {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const fields = new Map<string, string>()
  if (!text.startsWith('---\n')) return { fields, body: text }
  const end = text.indexOf('\n---', 4)
  if (end < 0) return { fields, body: text }
  for (const line of text.slice(4, end).split('\n')) {
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    fields.set(normalizeKey(line.slice(0, separator)), unquote(line.slice(separator + 1)))
  }
  const afterClosing = text.indexOf('\n', end + 4)
  return { fields, body: afterClosing < 0 ? '' : text.slice(afterClosing + 1) }
}

function firstHeading(body: string): string | null {
  const first = body.split('\n').find((line) => line.trim().length > 0)
  const heading = first ? /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(first.trim()) : null
  return heading ? heading[1] : null
}

/**
 * Reads one inbox file. The book comes from `book:` front matter or, failing that, the
 * sub-folder the file sits in. The chapter title comes from `chapter:`, then a leading
 * Markdown heading, then the file name.
 */
export function parseInboxFile(
  fileName: string,
  folderBookTitle: string | null,
  raw: string
): InboxFile {
  const { fields, body } = parseFrontMatter(raw)
  const bookTitle = (fields.get('book') || folderBookTitle || '').trim()
  if (!bookTitle) {
    throw new StoryboundError(
      'VALIDATION_ERROR',
      'No book title. Add a “book:” line to the front matter, or put the file in a sub-folder named after the book.'
    )
  }
  const status = fields.get('status')?.toLowerCase() || null
  if (status && status !== 'ongoing' && status !== 'completed') {
    throw new StoryboundError('VALIDATION_ERROR', 'status must be “ongoing” or “completed”.')
  }
  const seriesPositionText = fields.get('seriesposition')
  const seriesPosition = seriesPositionText ? Number(seriesPositionText) : null
  if (seriesPosition !== null && (!Number.isFinite(seriesPosition) || seriesPosition <= 0)) {
    throw new StoryboundError('VALIDATION_ERROR', 'series position must be a positive number.')
  }
  const content = body.trim()
  const stem = basename(fileName, extname(fileName)).trim()
  const chapterTitle = content
    ? (fields.get('chapter') || firstHeading(content) || stem).trim()
    : fields.get('chapter')?.trim() || null
  return {
    bookTitle,
    chapterTitle,
    content: chapterTitle ? normalizeChapterContent(chapterTitle, content) : '',
    blurb: fields.get('blurb') ?? null,
    status: status as BookStatus | null,
    seriesName: fields.get('series') ?? null,
    seriesPosition,
    authorName: fields.get('author') ?? null,
    replace: ['replace', 'update'].includes(fields.get('mode')?.toLowerCase() ?? '')
  }
}

/** Applies a parsed inbox file to the active library and describes what changed. */
export function applyInboxFile(store: StoryboundStore, file: InboxFile): AgentContentChange | null {
  const matches = findBooksByTitle(store, file.bookTitle)
  if (matches.length > 1) {
    throw new StoryboundError(
      'CONFLICT',
      `More than one book is called “${file.bookTitle}”. Rename one of them in Storybound first.`
    )
  }
  const metadata = {
    ...(file.blurb !== null ? { blurb: file.blurb } : {}),
    ...(file.status !== null ? { status: file.status } : {}),
    ...(file.seriesName !== null ? { seriesName: file.seriesName } : {}),
    ...(file.seriesPosition !== null ? { seriesPosition: file.seriesPosition } : {}),
    ...(file.authorName !== null ? { authorName: file.authorName } : {})
  }
  let book = matches[0] ? store.getBook(matches[0].id) : null
  let createdBook = false
  if (!book) {
    book = store.createBook({ title: file.bookTitle })
    createdBook = true
  }
  if (Object.keys(metadata).length > 0) book = store.updateBook({ id: book.id, ...metadata })

  if (!file.chapterTitle) {
    return {
      bookId: book.id,
      chapterId: null,
      message: createdBook
        ? `Inbox created “${book.title}”.`
        : `Inbox updated the details of “${book.title}”.`
    }
  }

  const wanted = file.chapterTitle.trim().toLocaleLowerCase()
  const sameTitle = book.chapters.filter(
    (chapter) => chapter.title.trim().toLocaleLowerCase() === wanted
  )
  if (file.replace) {
    if (sameTitle.length !== 1) {
      throw new StoryboundError(
        'CONFLICT',
        sameTitle.length === 0
          ? `“${book.title}” has no chapter called “${file.chapterTitle}” to replace.`
          : `“${book.title}” has more than one chapter called “${file.chapterTitle}”.`
      )
    }
    const chapter = store.updateChapter({ id: sameTitle[0].id, content: file.content })
    return {
      bookId: book.id,
      chapterId: chapter.id,
      message: `Inbox revised “${chapter.title}” in “${book.title}”.`
    }
  }
  for (const existing of sameTitle) {
    // Re-dropping a file that was already imported must not create a duplicate chapter.
    if (store.getChapter(existing.id).content === file.content) return null
  }
  const chapter = store.createChapter({
    bookId: book.id,
    title: file.chapterTitle,
    content: file.content
  })
  return {
    bookId: book.id,
    chapterId: chapter.id,
    message: `Inbox added “${chapter.title}” to “${book.title}”${createdBook ? ' (new book)' : ''}.`
  }
}

function uniqueDestination(folder: string, fileName: string): string {
  mkdirSync(folder, { recursive: true })
  const extension = extname(fileName)
  const stem = basename(fileName, extension)
  let candidate = join(folder, fileName)
  for (let attempt = 2; existsSync(candidate); attempt += 1) {
    candidate = join(folder, `${stem} (${attempt})${extension}`)
  }
  return candidate
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

interface Candidate {
  path: string
  name: string
  folderBookTitle: string | null
}

function listCandidates(inboxPath: string): Candidate[] {
  const candidates: Candidate[] = []
  const visit = (folder: string, folderBookTitle: string | null): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const path = join(folder, entry.name)
      if (entry.isDirectory()) {
        const reserved = entry.name === IMPORTED_FOLDER || entry.name === FAILED_FOLDER
        if (folderBookTitle === null && !reserved) visit(path, entry.name)
      } else if (entry.isFile() && ACCEPTED_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        candidates.push({ path, name: entry.name, folderBookTitle })
      }
    }
  }
  visit(inboxPath, null)
  return candidates.sort((left, right) =>
    left.path.localeCompare(right.path, undefined, { numeric: true, sensitivity: 'base' })
  )
}

/** Imports every settled file in the inbox, filing each under Imported/ or Failed/. */
export function scanInbox(
  store: StoryboundStore,
  inboxPath: string,
  events: InboxEvents,
  now = Date.now()
): InboxScanResult {
  if (!existsSync(inboxPath) || !statSync(inboxPath).isDirectory()) {
    throw new StoryboundError('FILE_ERROR', 'The inbox folder could not be found.')
  }
  const result: InboxScanResult = { imported: 0, failed: 0, skipped: 0 }
  for (const candidate of listCandidates(inboxPath)) {
    const stats = statSync(candidate.path)
    if (now - stats.mtimeMs < SETTLE_MILLISECONDS) {
      result.skipped += 1
      continue
    }
    const displayName = candidate.folderBookTitle
      ? `${candidate.folderBookTitle}/${candidate.name}`
      : candidate.name
    try {
      if (stats.size > MAX_FILE_BYTES) {
        throw new StoryboundError('VALIDATION_ERROR', 'The file is larger than 10 MB.')
      }
      const file = parseInboxFile(
        candidate.name,
        candidate.folderBookTitle,
        readFileSync(candidate.path, 'utf8')
      )
      const change = applyInboxFile(store, file)
      renameSync(
        candidate.path,
        uniqueDestination(join(inboxPath, IMPORTED_FOLDER, today()), candidate.name)
      )
      result.imported += 1
      if (change) {
        events.onChange(change)
        events.onActivity(change.message, false)
      } else {
        events.onActivity(
          `Inbox skipped “${displayName}”: that chapter is already in the book.`,
          false
        )
      }
    } catch (error) {
      const message = toStoryboundError(error).message
      const destination = uniqueDestination(join(inboxPath, FAILED_FOLDER), candidate.name)
      try {
        renameSync(candidate.path, destination)
        writeFileSync(
          `${destination}.error.txt`,
          `Storybound could not import this file.\n\n${message}\n`
        )
      } catch {
        // If the file cannot even be moved, leave it; the activity log still reports why.
      }
      result.failed += 1
      events.onActivity(`Inbox could not import “${displayName}”: ${message}`, true)
    }
  }
  return result
}
