import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { StoryboundError } from '../../src/main/errors'
import { StoryboundStore } from '../../src/main/store'

const temporaryDirectories: string[] = []
const openStores: StoryboundStore[] = []
const openDatabases: Database.Database[] = []

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'storybound-chapter-safety-test-'))
  temporaryDirectories.push(directory)
  return directory
}

async function createStore(): Promise<StoryboundStore> {
  const store = await StoryboundStore.open(temporaryDirectory())
  openStores.push(store)
  return store
}

function inspectDatabase(store: StoryboundStore): Database.Database {
  const database = new Database(store.paths.database, { readonly: true })
  openDatabases.push(database)
  return database
}

function revisionContents(store: StoryboundStore, chapterId: string): string[] {
  return store
    .listChapterRevisions(chapterId)
    .map((revision) => store.getChapterRevision(revision.id).content ?? '')
}

afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close()
  for (const store of openStores.splice(0)) store.close()
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('chapter revisions', () => {
  it('stores a compressed prior snapshot and snapshots the current text before restoration', async () => {
    const store = await createStore()
    const book = store.createBook({ title: 'Revision Ledger' })
    const originalContent = `${'A repeated sentence makes compression visible. '.repeat(120)}Fin.`
    const chapter = store.createChapter({
      bookId: book.id,
      title: 'Original title',
      content: originalContent
    })
    const currentContent = 'A completely rewritten scene with a different ending.'

    store.updateChapter({ id: chapter.id, title: 'Rewritten title', content: currentContent })

    const [prior] = store.listChapterRevisions(chapter.id)
    expect(prior).toMatchObject({
      chapterId: chapter.id,
      revisionNumber: 1,
      title: 'Original title',
      reason: 'Before edit'
    })
    expect(prior.content).toBeUndefined()
    expect(store.getChapterRevision(prior.id).content).toBe(originalContent)

    const database = inspectDatabase(store)
    const stored = database
      .prepare('SELECT encoding, content_blob FROM chapter_revisions WHERE id = ?')
      .get(prior.id) as { encoding: string; content_blob: Buffer }
    expect(stored.encoding).toBe('gzip-utf8')
    expect([...stored.content_blob.subarray(0, 2)]).toEqual([0x1f, 0x8b])
    expect(stored.content_blob.byteLength).toBeLessThan(Buffer.byteLength(originalContent, 'utf8'))

    const restored = store.restoreChapterRevision({
      chapterId: chapter.id,
      revisionId: prior.id
    })
    expect(restored).toMatchObject({ title: 'Original title', content: originalContent })

    const versions = store.listChapterRevisions(chapter.id)
    expect(versions.map((revision) => revision.revisionNumber)).toEqual([2, 1])
    expect(store.getChapterRevision(versions[0].id)).toMatchObject({
      title: 'Rewritten title',
      content: currentContent,
      reason: 'Before restoring an earlier version'
    })
  })

  it('deduplicates recurring chapter snapshots by title and content', async () => {
    const store = await createStore()
    const book = store.createBook({ title: 'Recurring Drafts' })
    const chapter = store.createChapter({
      bookId: book.id,
      title: 'Draft',
      content: 'Version one.'
    })

    store.updateChapter({ id: chapter.id, content: 'Version two.' })
    store.updateChapter({ id: chapter.id, content: 'Version three.' })
    store.updateChapter({ id: chapter.id, content: 'Version two.' })
    store.updateChapter({ id: chapter.id, content: 'Version three.' })
    store.updateChapter({ id: chapter.id, content: 'Version two.' })

    expect(store.listChapterRevisions(chapter.id)).toHaveLength(3)
    expect(new Set(revisionContents(store, chapter.id))).toEqual(
      new Set(['Version one.', 'Version two.', 'Version three.'])
    )
  })
})

describe('chapter trash', () => {
  it('hides trashed content while preserving recovery data and choosing the next reading fallback', async () => {
    const store = await createStore()
    const book = store.createBook({ title: 'A Safe Shelf' })
    const first = store.createChapter({
      bookId: book.id,
      title: 'First',
      content: 'two opening words'
    })
    const middle = store.createChapter({
      bookId: book.id,
      title: 'Middle',
      content: 'quartz lantern signal'
    })
    const last = store.createChapter({
      bookId: book.id,
      title: 'Last',
      content: 'four final story words'
    })
    const bookmark = store.createBookmark({
      bookId: book.id,
      chapterId: middle.id,
      location: 0.4,
      note: 'Keep this place'
    })
    store.saveRecoveryDraft({
      chapterId: middle.id,
      title: 'Middle recovery',
      content: 'Unsaved recovery text'
    })
    store.saveReadingState({
      bookId: book.id,
      chapterId: middle.id,
      scrollPosition: 0.4,
      progressPercentage: 46.67,
      hasFinishedCurrentContent: false
    })

    store.removeChapter(middle.id)

    expect(() => store.getChapter(middle.id)).toThrow('could not be found')
    expect(store.search('quartz lantern')).toHaveLength(0)
    expect(store.listBookmarks(book.id)).not.toContainEqual(
      expect.objectContaining({ id: bookmark.id })
    )
    expect(store.getBook(book.id)).toMatchObject({
      totalWordCount: 7,
      chapters: [
        expect.objectContaining({ id: first.id, position: 0 }),
        expect.objectContaining({ id: last.id, position: 1 })
      ]
    })
    expect(store.getReadingState(book.id)).toMatchObject({
      chapterId: last.id,
      scrollPosition: 0,
      progressPercentage: 50,
      hasFinishedCurrentContent: false
    })
    expect(store.listChapterTrash(book.id)).toEqual([
      expect.objectContaining({ id: middle.id, originalPosition: 1, wordCount: 3 })
    ])
    expect(store.listChapterRevisions(middle.id)).toEqual([
      expect.objectContaining({ reason: 'Moved to chapter trash' })
    ])
    expect(store.getChapterRevision(store.listChapterRevisions(middle.id)[0].id).content).toBe(
      'quartz lantern signal'
    )

    const database = inspectDatabase(store)
    expect(
      database.prepare('SELECT COUNT(*) FROM bookmarks WHERE id = ?').pluck().get(bookmark.id)
    ).toBe(1)
    expect(
      database
        .prepare('SELECT COUNT(*) FROM recovery_drafts WHERE chapter_id = ?')
        .pluck()
        .get(middle.id)
    ).toBe(1)
  })

  it('restores a chapter at its bounded original position without losing hidden data', async () => {
    const store = await createStore()
    const book = store.createBook({ title: 'Restoration Order' })
    const first = store.createChapter({ bookId: book.id, title: 'First', content: 'First.' })
    const middle = store.createChapter({ bookId: book.id, title: 'Middle', content: 'Middle.' })
    const last = store.createChapter({ bookId: book.id, title: 'Last', content: 'Last.' })
    const bookmark = store.createBookmark({
      bookId: book.id,
      chapterId: middle.id,
      location: 0.5
    })
    store.saveRecoveryDraft({
      chapterId: middle.id,
      title: 'Recovered middle',
      content: 'Recovered draft'
    })

    store.removeChapter(middle.id)
    const appended = store.createChapter({ bookId: book.id, title: 'Appended', content: 'New.' })
    const restored = store.restoreChapter(middle.id)

    expect(restored.position).toBe(1)
    expect(
      store.getBook(book.id).chapters.map((chapter) => [chapter.id, chapter.position])
    ).toEqual([
      [first.id, 0],
      [middle.id, 1],
      [last.id, 2],
      [appended.id, 3]
    ])
    expect(store.listBookmarks(book.id)).toContainEqual(
      expect.objectContaining({ id: bookmark.id })
    )
    expect(store.getRecoveryDraft(middle.id)).toMatchObject({ content: 'Recovered draft' })
    expect(store.search('Middle.')).toContainEqual(
      expect.objectContaining({ type: 'chapter', chapterId: middle.id })
    )
    expect(store.listChapterTrash(book.id)).toHaveLength(0)
    expect(store.restoreChapter(middle.id).position).toBe(1)
  })

  it('requires trash before permanent deletion and cascades every chapter-owned record', async () => {
    const store = await createStore()
    const book = store.createBook({ title: 'Permanent Safety' })
    const chapter = store.createChapter({
      bookId: book.id,
      title: 'Disposable',
      content: 'Original disposable text.'
    })
    store.createBookmark({ bookId: book.id, chapterId: chapter.id, location: 0.25 })
    store.saveRecoveryDraft({
      chapterId: chapter.id,
      title: 'Disposable recovery',
      content: 'Recovery copy.'
    })
    store.saveReadingState({
      bookId: book.id,
      chapterId: chapter.id,
      scrollPosition: 0.25,
      progressPercentage: 25,
      hasFinishedCurrentContent: false
    })
    store.updateChapter({ id: chapter.id, content: 'Edited disposable text.' })

    expect(() => store.removeChapterPermanently(chapter.id)).toThrow(StoryboundError)

    store.removeChapter(chapter.id)
    const database = inspectDatabase(store)
    expect(
      database
        .prepare('SELECT COUNT(*) FROM chapter_revisions WHERE chapter_id = ?')
        .pluck()
        .get(chapter.id)
    ).toBeGreaterThan(0)

    store.removeChapterPermanently(chapter.id)

    expect(() => store.getChapter(chapter.id)).toThrow('could not be found')
    expect(store.listChapterTrash(book.id)).toHaveLength(0)
    expect(store.getBook(book.id)).toMatchObject({ chapters: [], totalWordCount: 0 })
    expect(store.getReadingState(book.id)).toMatchObject({
      chapterId: null,
      scrollPosition: 0,
      progressPercentage: 0
    })
    for (const table of ['chapter_revisions', 'bookmarks', 'recovery_drafts', 'chapter_search']) {
      expect(
        database
          .prepare(`SELECT COUNT(*) FROM ${table} WHERE chapter_id = ?`)
          .pluck()
          .get(chapter.id)
      ).toBe(0)
    }
    expect(database.pragma('foreign_key_check')).toEqual([])
  })
})

describe('destructive chapter transformations', () => {
  it('keeps recoverable snapshots for split and both sides of merge', async () => {
    const store = await createStore()
    const book = store.createBook({ title: 'Split and Merge' })
    const originalContent = 'First half. Second half.'
    const chapter = store.createChapter({
      bookId: book.id,
      title: 'Whole',
      content: originalContent
    })

    const split = store.splitChapter({
      chapterId: chapter.id,
      offset: originalContent.indexOf('Second'),
      newTitle: 'Second'
    })
    expect(revisionContents(store, chapter.id)).toContain(originalContent)
    expect(store.listChapterRevisions(chapter.id)).toContainEqual(
      expect.objectContaining({ reason: 'Before splitting chapter' })
    )

    const merged = store.mergeChapter({ chapterId: chapter.id, direction: 'next' })
    const mergedHistory = revisionContents(store, merged.id)
    expect(mergedHistory).toContain('First half.')
    expect(mergedHistory).toContain('Second half.')
    expect(() => store.getChapter(split.id)).toThrow('could not be found')
  })

  it('snapshots the complete imported chapter before applying detected splits', async () => {
    const store = await createStore()
    const book = store.createBook({ title: 'Detected Headings' })
    const originalContent =
      'Opening paragraph.\n\nCHAPTER TWO\nThe second passage.\n\nEpilogue\nThe final passage.'
    const chapter = store.createChapter({
      bookId: book.id,
      title: 'Imported text',
      content: originalContent
    })

    const result = store.applyDetectedSplits(chapter.id, store.detectSplits(chapter.id))

    expect(result).toHaveLength(3)
    expect(revisionContents(store, chapter.id)).toEqual([originalContent])
    expect(store.listChapterRevisions(chapter.id)).toEqual([
      expect.objectContaining({ reason: 'Before applying detected splits' })
    ])
  })
})
