import {
  bookPackageManifestSchema,
  createBookPackageManifest,
  createLibraryBackupManifest,
  libraryBackupManifestSchema
} from '../../src/shared/portable'
import type { BookDetail, Bookmark, Chapter, ReadingState } from '../../src/shared/types'

const EXPORTED_AT = '2026-08-05T12:00:00.000Z'
const BOOK_ID = '58de60ef-a90b-4574-9e4d-f38fba735b5b'
const CHAPTER_ONE_ID = '8489827f-82fe-4bc4-9c1c-f0fdaf744da3'
const CHAPTER_TWO_ID = '0c25227e-8f63-4a46-990a-457d0c832482'
const BOOKMARK_ID = 'f2ef53cc-e0cc-4db5-949b-ff1719cb8aa0'

const chapters: Chapter[] = [
  {
    id: CHAPTER_ONE_ID,
    bookId: BOOK_ID,
    title: 'First Light',
    content: 'The harbour woke beneath a copper sky.',
    position: 0,
    createdAt: EXPORTED_AT,
    updatedAt: EXPORTED_AT,
    wordCount: 8,
    isRead: true
  },
  {
    id: CHAPTER_TWO_ID,
    bookId: BOOK_ID,
    title: 'The Crossing',
    content: 'At noon, the small ship cleared the headland.',
    position: 1,
    createdAt: EXPORTED_AT,
    updatedAt: EXPORTED_AT,
    wordCount: 9,
    isRead: false
  }
]

const book: BookDetail = {
  id: BOOK_ID,
  title: 'The Lantern Coast',
  blurb: 'A voyage beyond the last familiar light.',
  status: 'ongoing',
  coverImageUrl: 'storybound-media://cover.webp',
  coverStyle: 'classic',
  coverPositionX: 50,
  coverPositionY: 50,
  createdAt: EXPORTED_AT,
  updatedAt: EXPORTED_AT,
  lastOpenedAt: EXPORTED_AT,
  completedAt: null,
  totalWordCount: 17,
  chapterCount: 2,
  progressPercentage: 72,
  hasFinishedCurrentContent: false,
  isArchived: false,
  chapters: chapters.map((chapter) => ({
    id: chapter.id,
    bookId: chapter.bookId,
    title: chapter.title,
    position: chapter.position,
    createdAt: chapter.createdAt,
    updatedAt: chapter.updatedAt,
    wordCount: chapter.wordCount,
    isRead: chapter.isRead
  }))
}

const bookmarks: Bookmark[] = [
  {
    id: BOOKMARK_ID,
    bookId: BOOK_ID,
    chapterId: CHAPTER_TWO_ID,
    chapterTitle: 'The Crossing',
    location: 0.42,
    note: 'Return to the lighthouse clue.',
    createdAt: EXPORTED_AT
  }
]

const readingState: ReadingState = {
  bookId: BOOK_ID,
  chapterId: CHAPTER_TWO_ID,
  scrollPosition: 0.42,
  progressPercentage: 72,
  lastReadAt: EXPORTED_AT,
  hasFinishedCurrentContent: false
}

describe('book package manifests', () => {
  it('creates a validated, portable manifest with ordered chapter content', () => {
    const manifest = createBookPackageManifest({
      book,
      chapters,
      bookmarks,
      readingState,
      coverFile: 'cover.webp',
      exportedAt: EXPORTED_AT
    })

    expect(manifest).toMatchObject({
      format: 'storybound-book',
      formatVersion: 2,
      exportedAt: EXPORTED_AT,
      book: {
        id: BOOK_ID,
        title: 'The Lantern Coast',
        coverFile: 'cover.webp'
      },
      readingState: {
        chapterId: CHAPTER_TWO_ID,
        scrollPosition: 0.42
      }
    })
    expect(manifest.chapters.map((chapter) => chapter.title)).toEqual([
      'First Light',
      'The Crossing'
    ])
    expect(manifest.chapters[0]).not.toHaveProperty('bookId')
    expect(manifest.chapters[0]).not.toHaveProperty('wordCount')
    expect(manifest.bookmarks[0]).not.toHaveProperty('bookId')
    expect(bookPackageManifestSchema.parse(manifest)).toEqual(manifest)
  })

  it.each(['../cover.webp', 'covers/cover.webp', 'covers\\cover.webp', '..'])(
    'rejects a path-traversal or nested cover filename: %s',
    (coverFile) => {
      expect(() =>
        createBookPackageManifest({
          book,
          chapters,
          bookmarks,
          readingState,
          coverFile,
          exportedAt: EXPORTED_AT
        })
      ).toThrow()
    }
  )

  it('rejects malformed or unsupported imported manifests', () => {
    const valid = createBookPackageManifest({
      book,
      chapters,
      bookmarks,
      readingState,
      coverFile: null,
      exportedAt: EXPORTED_AT
    })

    expect(bookPackageManifestSchema.safeParse({ ...valid, formatVersion: 999 }).success).toBe(
      false
    )
    expect(
      bookPackageManifestSchema.safeParse({
        ...valid,
        chapters: [{ ...valid.chapters[0], id: 'not-a-uuid' }]
      }).success
    ).toBe(false)
    expect(
      bookPackageManifestSchema.safeParse({
        ...valid,
        readingState: { ...valid.readingState, scrollPosition: 2 }
      }).success
    ).toBe(false)
  })

  it('accepts a version-one package and supplies safe defaults for richer fields', () => {
    const current = createBookPackageManifest({
      book,
      chapters,
      bookmarks,
      readingState,
      coverFile: null,
      exportedAt: EXPORTED_AT
    })
    const legacy = {
      ...current,
      formatVersion: 1,
      book: {
        id: current.book.id,
        title: current.book.title,
        blurb: current.book.blurb,
        status: current.book.status,
        createdAt: current.book.createdAt,
        updatedAt: current.book.updatedAt,
        completedAt: current.book.completedAt,
        coverFile: current.book.coverFile
      },
      bookmarks: current.bookmarks.map(({ id, chapterId, location, note, createdAt }) => ({
        id,
        chapterId,
        location,
        note,
        createdAt
      }))
    }

    const parsed = bookPackageManifestSchema.parse(legacy)
    expect(parsed.book).toMatchObject({ subtitle: '', rating: null, isFavourite: false })
    expect(parsed.bookmarks[0]).toMatchObject({ label: '', color: 'gold' })
  })
})

describe('library backup manifests', () => {
  it('pins database and media paths to application-controlled archive entries', () => {
    expect(createLibraryBackupManifest('0.1.0', EXPORTED_AT)).toEqual({
      format: 'storybound-library-backup',
      formatVersion: 2,
      exportedAt: EXPORTED_AT,
      appVersion: '0.1.0',
      databaseFile: 'storybound.sqlite',
      mediaDirectory: 'media'
    })
  })

  it('rejects a backup manifest that redirects extraction paths', () => {
    const valid = createLibraryBackupManifest('0.1.0', EXPORTED_AT)

    expect(
      libraryBackupManifestSchema.safeParse({ ...valid, databaseFile: '../storybound.sqlite' })
        .success
    ).toBe(false)
    expect(
      libraryBackupManifestSchema.safeParse({ ...valid, mediaDirectory: '../../media' }).success
    ).toBe(false)
  })
})
