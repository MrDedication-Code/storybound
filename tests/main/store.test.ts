import AdmZip from 'adm-zip'
import Database from 'better-sqlite3'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  truncateSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { LATEST_SCHEMA_VERSION, migrations } from '../../src/main/database'
import { StoryboundError } from '../../src/main/errors'
import { StoryboundStore } from '../../src/main/store'
import { bookPackageManifestSchema, createLibraryBackupManifest } from '../../src/shared/portable'

const temporaryDirectories: string[] = []
const openStores: StoryboundStore[] = []

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'storybound-main-test-'))
  temporaryDirectories.push(directory)
  return directory
}

async function createStore(directory = temporaryDirectory()): Promise<StoryboundStore> {
  const store = await StoryboundStore.open(directory)
  openStores.push(store)
  return store
}

function closeStore(store: StoryboundStore): void {
  store.close()
  const index = openStores.indexOf(store)
  if (index >= 0) openStores.splice(index, 1)
}

afterEach(() => {
  for (const store of openStores.splice(0)) store.close()
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('Storybound SQLite persistence', () => {
  it('migrates a clean database and persists books and chapters across restarts', async () => {
    const directory = temporaryDirectory()
    const store = await createStore(directory)
    const created = store.createBook({
      title: 'The Lantern Sea',
      blurb: 'A keeper follows a light beyond the horizon.',
      initialChapterTitle: 'The Last Beacon',
      initialChapterContent: 'The beacon burned through the long rain.'
    })
    const second = store.createChapter({
      bookId: created.id,
      title: 'Beyond the Reef',
      content: 'At dawn, the water became glass.'
    })
    expect(created.totalWordCount).toBe(7)
    expect(second.position).toBe(1)
    closeStore(store)

    const reopened = await createStore(directory)
    const book = reopened.getBook(created.id)
    expect(book.title).toBe('The Lantern Sea')
    expect(book.chapters.map((chapter) => chapter.title)).toEqual([
      'The Last Beacon',
      'Beyond the Reef'
    ])
    expect(reopened.getChapter(second.id).content).toBe('At dawn, the water became glass.')

    const database = new Database(reopened.paths.database, { readonly: true })
    expect(database.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
    database.close()
  })

  it('performs reorder, duplicate, split, merge, and delete operations atomically', async () => {
    const store = await createStore()
    const book = store.createBook({ title: 'Clockwork Orchard' })
    const first = store.createChapter({
      bookId: book.id,
      title: 'Seeds',
      content: 'First half. Second half.'
    })
    const second = store.createChapter({ bookId: book.id, title: 'Roots', content: 'Deep roots.' })
    const third = store.createChapter({
      bookId: book.id,
      title: 'Branches',
      content: 'High branches.'
    })

    const reordered = store.reorderChapters({
      bookId: book.id,
      chapterIds: [third.id, first.id, second.id]
    })
    expect(reordered.map((chapter) => [chapter.id, chapter.position])).toEqual([
      [third.id, 0],
      [first.id, 1],
      [second.id, 2]
    ])
    expect(() =>
      store.reorderChapters({ bookId: book.id, chapterIds: [first.id, first.id, second.id] })
    ).toThrow('exactly once')
    expect(store.getBook(book.id).chapters.map((chapter) => chapter.id)).toEqual([
      third.id,
      first.id,
      second.id
    ])

    const duplicate = store.duplicateChapter(first.id)
    expect(store.getBook(book.id).chapters.map((chapter) => chapter.id)).toEqual([
      third.id,
      first.id,
      duplicate.id,
      second.id
    ])

    const bookmark = store.createBookmark({
      bookId: book.id,
      chapterId: first.id,
      location: 0.75,
      note: 'After the split point'
    })
    store.saveReadingState({
      bookId: book.id,
      chapterId: first.id,
      scrollPosition: 0.75,
      progressPercentage: 50,
      hasFinishedCurrentContent: false
    })
    const split = store.splitChapter({
      chapterId: first.id,
      offset: 11,
      newTitle: 'After the Turn'
    })
    expect(store.getChapter(first.id).content).toBe('First half.')
    expect(split.content).toBe('Second half.')
    expect(split.position).toBe(2)
    expect(store.listBookmarks(book.id).find((item) => item.id === bookmark.id)).toMatchObject({
      chapterId: split.id
    })
    expect(store.getReadingState(book.id).chapterId).toBe(split.id)

    const merged = store.mergeChapter({ chapterId: split.id, direction: 'previous' })
    expect(merged.id).toBe(first.id)
    expect(merged.content).toBe('First half.\n\nSecond half.')
    expect(store.listBookmarks(book.id).find((item) => item.id === bookmark.id)).toMatchObject({
      chapterId: first.id
    })
    expect(store.getReadingState(book.id).chapterId).toBe(first.id)
    expect(store.getBook(book.id).chapters.map((chapter) => chapter.position)).toEqual([0, 1, 2, 3])

    store.removeChapter(duplicate.id)
    expect(store.getBook(book.id).chapters.map((chapter) => chapter.position)).toEqual([0, 1, 2])
  })

  it('detects and applies deterministic chapter headings without losing content', async () => {
    const store = await createStore()
    const book = store.createBook({ title: 'A River of Doors' })
    const chapter = store.createChapter({
      bookId: book.id,
      title: 'Imported text',
      content:
        'Opening paragraph.\n\nCHAPTER TWO\nThe second passage.\n\nEpilogue\nThe final passage.'
    })
    const candidates = store.detectSplits(chapter.id)
    expect(candidates.map((candidate) => candidate.title)).toEqual(['CHAPTER TWO', 'Epilogue'])

    const result = store.applyDetectedSplits(chapter.id, candidates)
    expect(result.map((item) => item.title)).toEqual(['Imported text', 'CHAPTER TWO', 'Epilogue'])
    expect(store.getChapter(result[0].id).content).toBe('Opening paragraph.')
    expect(store.getChapter(result[1].id).content).toBe('The second passage.')
    expect(store.getChapter(result[2].id).content).toBe('The final passage.')
  })

  it('indexes titles, blurbs, chapter titles, and chapter content with FTS5', async () => {
    const store = await createStore()
    const book = store.createBook({ title: 'The Café at Midnight', blurb: 'A quiet mystery.' })
    const chapter = store.createChapter({
      bookId: book.id,
      title: 'An Ordinary Cup',
      content: 'The obsidian key was hidden beneath the saucer.'
    })
    expect(store.listBooks({ search: 'cafe' }).map((result) => result.id)).toContain(book.id)
    const results = store.search('obsidian key')
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'chapter', bookId: book.id, chapterId: chapter.id })
      ])
    )
    const passage = results.find((result) => result.chapterId === chapter.id)
    expect(passage?.excerpt).toContain('obsidian key')
    expect(passage?.excerpt.length).toBeLessThan(500)
    expect(store.locateSearchHit({ chapterId: chapter.id, term: 'obsidian key' })).toMatchObject({
      chapterId: chapter.id,
      matchedTerm: 'obsidian key',
      location: expect.any(Number)
    })
    expect(
      store.locateSearchHit({ chapterId: chapter.id, term: 'missing obsidian' })
    ).toMatchObject({
      matchedTerm: 'obsidian'
    })

    store.updateChapter({ id: chapter.id, content: 'The silver key was beneath the saucer.' })
    expect(store.search('obsidian')).toHaveLength(0)
    expect(store.search('silver')).toHaveLength(1)
  })

  it('keeps writing status, reading progress, bookmarks, settings, and recovery independent', async () => {
    const store = await createStore()
    const book = store.createBook({ title: 'North of Morning', status: 'ongoing' })
    const first = store.createChapter({ bookId: book.id, title: 'One', content: 'One.' })
    const second = store.createChapter({ bookId: book.id, title: 'Two', content: 'Two.' })

    const reading = store.saveReadingState({
      bookId: book.id,
      chapterId: second.id,
      scrollPosition: 0.42,
      progressPercentage: 71,
      hasFinishedCurrentContent: false
    })
    expect(reading.scrollPosition).toBe(0.42)
    expect(store.getBook(book.id)).toMatchObject({ status: 'ongoing', progressPercentage: 71 })
    expect(store.getBook(book.id).chapters.find((chapter) => chapter.id === first.id)?.isRead).toBe(
      true
    )

    const bookmark = store.createBookmark({
      bookId: book.id,
      chapterId: second.id,
      location: 0.42,
      note: 'Return to this sentence'
    })
    expect(bookmark.chapterTitle).toBe('Two')

    expect(
      store.updateSettings({
        readerTheme: 'dark',
        readerFontSize: 23,
        paragraphIndentation: true,
        hasSeenGettingStarted: true
      })
    ).toMatchObject({
      readerTheme: 'dark',
      readerFontSize: 23,
      paragraphIndentation: true,
      hasSeenGettingStarted: true
    })

    const draft = store.saveRecoveryDraft({
      chapterId: second.id,
      title: 'Two revised',
      content: 'An edit that has not reached the chapter table.'
    })
    expect(store.getRecoveryDraft(second.id)).toEqual(draft)
    expect(store.getChapter(second.id).title).toBe('Two')
    store.clearRecoveryDraft(second.id)
    expect(store.getRecoveryDraft(second.id)).toBeNull()
  })

  it('moves Continue Reading to newly added content after the current edition was finished', async () => {
    const store = await createStore()
    const book = store.createBook({
      title: 'The Returning Tide',
      initialChapterTitle: 'The Shore',
      initialChapterContent: 'The tide went out.'
    })
    const first = book.chapters[0]
    store.saveReadingState({
      bookId: book.id,
      chapterId: first.id,
      scrollPosition: 1,
      progressPercentage: 100,
      hasFinishedCurrentContent: true
    })

    const second = store.createChapter({
      bookId: book.id,
      title: 'The Tide Returns',
      content: 'At dawn, the water crossed the sand again.'
    })

    expect(store.getReadingState(book.id)).toMatchObject({
      chapterId: second.id,
      scrollPosition: 0,
      progressPercentage: 50,
      hasFinishedCurrentContent: false
    })
    expect(store.getBook(book.id).chapters).toEqual([
      expect.objectContaining({ id: first.id, isRead: true }),
      expect.objectContaining({ id: second.id, isRead: false })
    ])
  })

  it('keeps Continue Reading before text appended to a previously finished chapter', async () => {
    const store = await createStore()
    const originalContent = 'a'.repeat(1_000)
    const book = store.createBook({
      title: 'The Growing Chapter',
      initialChapterTitle: 'Still Unfolding',
      initialChapterContent: originalContent
    })
    const chapter = book.chapters[0]
    store.saveReadingState({
      bookId: book.id,
      chapterId: chapter.id,
      scrollPosition: 1,
      progressPercentage: 100,
      hasFinishedCurrentContent: true
    })

    store.updateChapter({ id: chapter.id, content: `${originalContent}b` })

    const reading = store.getReadingState(book.id)
    expect(reading.chapterId).toBe(chapter.id)
    expect(reading.scrollPosition).toBeCloseTo(1_000 / 1_001)
    expect(reading.progressPercentage).toBe(99.9)
    expect(reading.hasFinishedCurrentContent).toBe(false)
    expect(store.getBook(book.id).hasFinishedCurrentContent).toBe(false)
    expect(store.getBook(book.id).chapters[0].isRead).toBe(false)
  })

  it('uses soft-delete trash before permanent deletion', async () => {
    const store = await createStore()
    const book = store.createBook({ title: 'A Temporary Tale' })
    expect(() => store.removeBookPermanently(book.id)).toThrow(StoryboundError)
    store.trashBook(book.id)
    expect(store.listBooks()).toHaveLength(0)
    expect(store.listBooks({ includeArchived: true })[0]).toMatchObject({
      id: book.id,
      isArchived: true
    })
    store.restoreBook(book.id)
    expect(store.listBooks()).toHaveLength(1)
    store.trashBook(book.id)
    store.removeBookPermanently(book.id)
    expect(() => store.getBook(book.id)).toThrow('could not be found')
  })
})

describe('Storybound portable archives', () => {
  it('exports and imports a complete book as a separate copy with fresh IDs', async () => {
    const directory = temporaryDirectory()
    const store = await createStore(directory)
    const createdBook = store.createBook({
      title: 'The Paper Constellation',
      blurb: 'Folded stars.'
    })
    const book = store.updateBook({
      id: createdBook.id,
      subtitle: 'An Origami Voyage',
      authorName: 'A. Writer',
      languageCode: 'en-GB',
      sourceLabel: 'Claude',
      personalNotes: 'Keep this edition.',
      rating: 5,
      isFavourite: true,
      isPinned: true
    })
    const first = store.createChapter({ bookId: book.id, title: 'Fold', content: 'Fold the page.' })
    const second = store.createChapter({
      bookId: book.id,
      title: 'Light',
      content: 'Hold it to the light.'
    })
    store.createBookmark({
      bookId: book.id,
      chapterId: second.id,
      location: 0.75,
      note: 'A favorite',
      label: 'Light clue',
      color: 'blue',
      anchor: {
        startOffset: 15,
        endOffset: 20,
        fallbackLocation: 0.75,
        quote: 'light'
      }
    })
    store.saveReadingState({
      bookId: book.id,
      chapterId: second.id,
      scrollPosition: 0.75,
      progressPercentage: 87.5,
      hasFinishedCurrentContent: false
    })
    const coverPath = join(directory, 'cover.png')
    writeFileSync(coverPath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]))
    store.setCoverFromFile(book.id, coverPath)

    const archivePath = join(directory, 'paper.storybound-book')
    await store.exportBookToPath(book.id, archivePath)
    const zip = new AdmZip(archivePath)
    const manifest = bookPackageManifestSchema.parse(
      JSON.parse(zip.readAsText('manifest.json')) as unknown
    )
    expect(manifest.chapters.map((chapter) => chapter.id)).toEqual([first.id, second.id])
    expect(zip.getEntry(`media/${manifest.book.coverFile}`)).not.toBeNull()

    const imported = await store.importBookFromPath(archivePath)
    expect(imported.importedBookId).not.toBe(book.id)
    const importedBook = store.getBook(imported.importedBookId!)
    expect(importedBook.chapters.map((chapter) => chapter.title)).toEqual(['Fold', 'Light'])
    expect(importedBook).toMatchObject({
      subtitle: 'An Origami Voyage',
      authorName: 'A. Writer',
      languageCode: 'en-GB',
      sourceLabel: 'Claude',
      personalNotes: 'Keep this edition.',
      rating: 5,
      isFavourite: true,
      isPinned: true
    })
    expect(importedBook.coverImageUrl).toMatch(/^storybound-media:\/\/covers\//)
    expect(store.getChapter(importedBook.chapters[1].id).content).toBe('Hold it to the light.')
    expect(store.listBookmarks(importedBook.id)[0]).toMatchObject({
      note: 'A favorite',
      label: 'Light clue',
      color: 'blue',
      chapterTitle: 'Light'
    })
    expect(store.listBookmarks(importedBook.id)[0].anchor).toMatchObject({
      startOffset: 15,
      endOffset: 20,
      quote: 'light',
      resolutionStatus: 'resolved'
    })
    expect(store.getReadingState(importedBook.id)).toMatchObject({ progressPercentage: 87.5 })
  })

  it('backs up and restores the entire database and media directory after validation', async () => {
    const directory = temporaryDirectory()
    const store = await createStore(directory)
    const retained = store.createBook({
      title: 'The Retained Library',
      initialChapterTitle: 'Opening',
      initialChapterContent: 'This survives the round trip.'
    })
    const coverPath = join(directory, 'retained.webp')
    writeFileSync(
      coverPath,
      Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.from([0])])
    )
    store.setCoverFromFile(retained.id, coverPath)
    const backupPath = join(directory, 'library.storybound-backup')
    await store.exportLibraryToPath(backupPath, '0.1.0-test')

    store.createBook({ title: 'Created After Backup' })
    expect(store.listBooks()).toHaveLength(2)
    await store.restoreLibraryFromPath(backupPath)

    expect(store.listBooks().map((book) => book.title)).toEqual(['The Retained Library'])
    expect(store.getBook(retained.id).coverImageUrl).toMatch(/^storybound-media:\/\/covers\//)
    expect(store.integrityCheck()).toEqual({
      healthy: true,
      details: 'Database integrity check passed.'
    })
    const retainedSafetyCopies = readdirSync(store.paths.backups)
    expect(retainedSafetyCopies.some((name) => /^before-restore-.+\.sqlite$/.test(name))).toBe(true)
    expect(retainedSafetyCopies.some((name) => /^before-restore-media-/.test(name))).toBe(true)
  })

  it('migrates a historical library database in staging before restoring it', async () => {
    const directory = temporaryDirectory()
    const store = await createStore(directory)
    store.createBook({ title: 'Current library' })

    const legacyPath = join(directory, 'legacy-v1.sqlite')
    const legacy = new Database(legacyPath)
    legacy.pragma('foreign_keys = ON')
    legacy.exec(migrations[0].sql)
    legacy.pragma('user_version = 1')
    legacy
      .prepare(
        `INSERT INTO books (id, title, blurb, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        '00000000-0000-4000-8000-000000000091',
        'A Library From Version One',
        '',
        'ongoing',
        '2025-01-01T00:00:00.000Z',
        '2025-01-01T00:00:00.000Z'
      )
    legacy
      .prepare(
        `INSERT INTO chapters (
          id, book_id, title, content, position, created_at, updated_at, word_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        '00000000-0000-4000-8000-000000000092',
        '00000000-0000-4000-8000-000000000091',
        'Opening',
        'Preserved historical words.',
        0,
        '2025-01-01T00:00:00.000Z',
        '2025-01-01T00:00:00.000Z',
        3
      )
    legacy.close()

    const archivePath = join(directory, 'legacy.storybound-backup')
    const zip = new AdmZip()
    zip.addFile(
      'backup-manifest.json',
      Buffer.from(JSON.stringify(createLibraryBackupManifest('0.0.1')), 'utf8')
    )
    zip.addLocalFile(legacyPath, '', 'storybound.sqlite')
    zip.writeZip(archivePath)

    await store.restoreLibraryFromPath(archivePath)

    expect(store.listBooks().map((book) => book.title)).toEqual(['A Library From Version One'])
    expect(store.getChapter('00000000-0000-4000-8000-000000000092').content).toBe(
      'Preserved historical words.'
    )
    expect(store.integrityCheck().healthy).toBe(true)
  })

  it('rejects a library backup when a referenced cover payload is missing', async () => {
    const directory = temporaryDirectory()
    const store = await createStore(directory)
    const book = store.createBook({ title: 'The Covered Archive' })
    const coverPath = join(directory, 'archive-cover.png')
    writeFileSync(coverPath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]))
    store.setCoverFromFile(book.id, coverPath)

    const completeBackup = join(directory, 'complete.storybound-backup')
    await store.exportLibraryToPath(completeBackup, '0.1.0-test')
    const incompleteBackup = join(directory, 'missing-cover.storybound-backup')
    const zip = new AdmZip(completeBackup)
    for (const entry of zip.getEntries()) {
      if (!entry.isDirectory && entry.entryName.startsWith('media/')) {
        zip.deleteFile(entry.entryName)
      }
    }
    zip.writeZip(incompleteBackup)

    await expect(store.restoreLibraryFromPath(incompleteBackup)).rejects.toThrow(
      'invalid cover reference or a referenced cover is missing'
    )
    expect(store.getBook(book.id).coverImageUrl).toMatch(/^storybound-media:\/\/covers\//)
    expect(store.integrityCheck().healthy).toBe(true)
  })

  it('refuses a false-success backup until a missing managed cover reference is repaired', async () => {
    const directory = temporaryDirectory()
    const store = await createStore(directory)
    const book = store.createBook({ title: 'The Missing Portrait' })
    const sourceCover = join(directory, 'portrait.png')
    writeFileSync(sourceCover, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]))
    store.setCoverFromFile(book.id, sourceCover)
    const managedCover = readdirSync(store.paths.media)[0]
    rmSync(join(store.paths.media, managedCover), { force: true })
    expect(store.getBook(book.id).coverImageUrl).toBeNull()

    const rejectedTarget = join(directory, 'missing-media.storybound-backup')
    await expect(store.exportLibraryToPath(rejectedTarget, '0.1.0-test')).rejects.toThrow(
      'missing or invalid managed cover'
    )
    expect(existsSync(rejectedTarget)).toBe(false)

    store.removeCover(book.id)
    const repairedTarget = join(directory, 'repaired.storybound-backup')
    await store.exportLibraryToPath(repairedTarget, '0.1.0-test')
    await store.restoreLibraryFromPath(repairedTarget)
    expect(store.getBook(book.id).coverImageUrl).toBeNull()
    expect(store.integrityCheck().healthy).toBe(true)
  })

  it('refuses to produce a library backup larger than its restore contract', async () => {
    const directory = temporaryDirectory()
    const store = await createStore(directory)
    const books = Array.from({ length: 34 }, (_, index) =>
      store.createBook({ title: `Still Safely Live ${index + 1}` })
    )
    const database = new Database(store.paths.database)
    const setCover = database.prepare('UPDATE books SET cover_image_path = ? WHERE id = ?')
    for (const [index, book] of books.entries()) {
      const filename = `cover-${index + 1}.png`
      const managedFile = join(store.paths.media, filename)
      writeFileSync(managedFile, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      truncateSync(managedFile, 15 * 1024 * 1024)
      setCover.run(filename, book.id)
    }
    database.close()
    const target = join(directory, 'unrestorable.storybound-backup')

    await expect(store.exportLibraryToPath(target, '0.1.0-test')).rejects.toThrow(
      '500 MB portable export limit'
    )
    expect(existsSync(target)).toBe(false)
    expect(store.listBooks()).toHaveLength(34)
    expect(store.integrityCheck().healthy).toBe(true)
  })

  it('rejects malformed packages without changing the existing library', async () => {
    const directory = temporaryDirectory()
    const store = await createStore(directory)
    store.createBook({ title: 'Safe Existing Book' })
    const malformed = join(directory, 'malformed.storybound-book')
    const zip = new AdmZip()
    zip.addFile('manifest.json', Buffer.from('{"format":"something-else"}', 'utf8'))
    zip.writeZip(malformed)

    await expect(store.importBookFromPath(malformed)).rejects.toThrow('not a valid Storybound book')
    expect(store.listBooks().map((book) => book.title)).toEqual(['Safe Existing Book'])
  })

  it('rejects a corrupt backup before swapping the live database', async () => {
    const directory = temporaryDirectory()
    const store = await createStore(directory)
    const existing = store.createBook({ title: 'Untouched by Corruption' })
    const corruptBackup = join(directory, 'corrupt.storybound-backup')
    const zip = new AdmZip()
    zip.addFile(
      'backup-manifest.json',
      Buffer.from(JSON.stringify(createLibraryBackupManifest('0.1.0-test')), 'utf8')
    )
    zip.addFile('storybound.sqlite', Buffer.from('this is not a SQLite database', 'utf8'))
    zip.writeZip(corruptBackup)

    await expect(store.restoreLibraryFromPath(corruptBackup)).rejects.toThrow()
    expect(store.getBook(existing.id).title).toBe('Untouched by Corruption')
    expect(store.integrityCheck().healthy).toBe(true)
  })

  it('rejects restored cover paths outside managed media without touching outside files', async () => {
    const directory = temporaryDirectory()
    const store = await createStore(directory)
    const existing = store.createBook({ title: 'Path-Safe Library' })
    const cleanBackup = join(directory, 'clean.storybound-backup')
    await store.exportLibraryToPath(cleanBackup, '0.1.0-test')

    const outsideDirectory = join(directory, 'outside-media')
    const sentinel = join(outsideDirectory, 'keep.txt')
    mkdirSync(outsideDirectory)
    writeFileSync(sentinel, 'do not delete', 'utf8')

    const cleanZip = new AdmZip(cleanBackup)
    const stagedDatabase = join(directory, 'tampered.sqlite')
    writeFileSync(stagedDatabase, cleanZip.getEntry('storybound.sqlite')!.getData())
    const database = new Database(stagedDatabase)
    database
      .prepare('UPDATE books SET cover_image_path = ? WHERE id = ?')
      .run('../outside-media', existing.id)
    database.close()

    const tamperedBackup = join(directory, 'tampered.storybound-backup')
    const tamperedZip = new AdmZip()
    tamperedZip.addFile(
      'backup-manifest.json',
      Buffer.from(JSON.stringify(createLibraryBackupManifest('0.1.0-test')), 'utf8')
    )
    tamperedZip.addFile('storybound.sqlite', readFileSync(stagedDatabase))
    tamperedZip.writeZip(tamperedBackup)

    await expect(store.restoreLibraryFromPath(tamperedBackup)).rejects.toThrow(
      'invalid cover reference'
    )
    expect(readFileSync(sentinel, 'utf8')).toBe('do not delete')
    expect(store.getBook(existing.id).title).toBe('Path-Safe Library')
    expect(store.integrityCheck().healthy).toBe(true)
  })

  it('rejects integrity-clean backups whose tables have an incompatible structure', async () => {
    const directory = temporaryDirectory()
    const store = await createStore(directory)
    const existing = store.createBook({ title: 'Known-Good Library' })
    const stagedDatabase = join(directory, 'wrong-schema.sqlite')
    const database = new Database(stagedDatabase)
    database.exec(`
      CREATE TABLE books (cover_image_path TEXT);
      CREATE TABLE chapters (placeholder TEXT);
      CREATE TABLE reading_states (placeholder TEXT);
      CREATE TABLE bookmarks (placeholder TEXT);
      CREATE TABLE application_settings (placeholder TEXT);
      CREATE TABLE recovery_drafts (placeholder TEXT);
      CREATE TABLE book_search (placeholder TEXT);
      CREATE TABLE chapter_search (placeholder TEXT);
    `)
    database.pragma(`user_version = ${LATEST_SCHEMA_VERSION}`)
    database.close()

    const wrongSchemaBackup = join(directory, 'wrong-schema.storybound-backup')
    const zip = new AdmZip()
    zip.addFile(
      'backup-manifest.json',
      Buffer.from(JSON.stringify(createLibraryBackupManifest('0.1.0-test')), 'utf8')
    )
    zip.addFile('storybound.sqlite', readFileSync(stagedDatabase))
    zip.writeZip(wrongSchemaBackup)

    await expect(store.restoreLibraryFromPath(wrongSchemaBackup)).rejects.toThrow(
      'incompatible library structure'
    )
    expect(store.getBook(existing.id).title).toBe('Known-Good Library')
    expect(store.integrityCheck().healthy).toBe(true)
  })

  it('rejects lookalike schemas with ordinary search tables and dummy triggers', async () => {
    const directory = temporaryDirectory()
    const store = await createStore(directory)
    const existing = store.createBook({ title: 'Searchable and Safe' })
    const cleanBackup = join(directory, 'search-clean.storybound-backup')
    await store.exportLibraryToPath(cleanBackup, '0.1.0-test')
    const cleanZip = new AdmZip(cleanBackup)
    const lookalikeDatabase = join(directory, 'lookalike.sqlite')
    writeFileSync(lookalikeDatabase, cleanZip.getEntry('storybound.sqlite')!.getData())

    const database = new Database(lookalikeDatabase)
    database.exec(`
      DROP TRIGGER books_search_insert;
      DROP TRIGGER books_search_update;
      DROP TRIGGER books_search_delete;
      DROP TRIGGER chapters_search_insert;
      DROP TRIGGER chapters_search_update;
      DROP TRIGGER chapters_search_delete;
      DROP TABLE book_search;
      DROP TABLE chapter_search;
      CREATE TABLE book_search (book_id TEXT, title TEXT, blurb TEXT);
      CREATE TABLE chapter_search (
        chapter_id TEXT, book_id TEXT, title TEXT, content TEXT
      );
      CREATE TRIGGER books_search_insert AFTER INSERT ON books BEGIN SELECT 1; END;
      CREATE TRIGGER books_search_update AFTER INSERT ON books BEGIN SELECT 1; END;
      CREATE TRIGGER books_search_delete AFTER INSERT ON books BEGIN SELECT 1; END;
      CREATE TRIGGER chapters_search_insert AFTER INSERT ON chapters BEGIN SELECT 1; END;
      CREATE TRIGGER chapters_search_update AFTER INSERT ON chapters BEGIN SELECT 1; END;
      CREATE TRIGGER chapters_search_delete AFTER INSERT ON chapters BEGIN SELECT 1; END;
    `)
    database.close()

    const lookalikeBackup = join(directory, 'lookalike.storybound-backup')
    const zip = new AdmZip()
    zip.addFile(
      'backup-manifest.json',
      Buffer.from(JSON.stringify(createLibraryBackupManifest('0.1.0-test')), 'utf8')
    )
    zip.addFile('storybound.sqlite', readFileSync(lookalikeDatabase))
    zip.writeZip(lookalikeBackup)

    await expect(store.restoreLibraryFromPath(lookalikeBackup)).rejects.toThrow(
      'incompatible library structure'
    )
    expect(store.getBook(existing.id).title).toBe('Searchable and Safe')
    expect(store.search('Searchable')).toHaveLength(1)
    expect(store.integrityCheck().healthy).toBe(true)
  })
})
