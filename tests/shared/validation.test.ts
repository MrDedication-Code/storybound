import {
  closeReadySchema,
  createBookSchema,
  createBookmarkSchema,
  createChapterSchema,
  libraryQuerySchema,
  locateSearchHitSchema,
  reorderChaptersSchema,
  saveReadingStateSchema,
  searchTermSchema,
  settingsUpdateSchema,
  splitChapterSchema,
  updateBookSchema,
  updateChapterSchema
} from '../../src/shared/validation'

const BOOK_ID = '58de60ef-a90b-4574-9e4d-f38fba735b5b'
const CHAPTER_ID = '8489827f-82fe-4bc4-9c1c-f0fdaf744da3'

describe('application lifecycle contracts', () => {
  it('accepts only a boolean renderer close confirmation', () => {
    expect(closeReadySchema.parse(true)).toBe(true)
    expect(closeReadySchema.safeParse('true').success).toBe(false)
  })
})

describe('book input contracts', () => {
  it('trims a required title and applies safe creation defaults', () => {
    expect(createBookSchema.parse({ title: '  The Long Way Home  ' })).toEqual({
      title: 'The Long Way Home',
      blurb: '',
      status: 'ongoing'
    })
  })

  it('rejects a blank title and unsupported writing status', () => {
    expect(createBookSchema.safeParse({ title: '   ' }).success).toBe(false)
    expect(createBookSchema.safeParse({ title: 'Story', status: 'paused' }).success).toBe(false)
  })

  it('requires an id and at least one actual book change', () => {
    expect(updateBookSchema.safeParse({ id: BOOK_ID }).success).toBe(false)
    expect(updateBookSchema.safeParse({ id: 'not-an-id', title: 'New title' }).success).toBe(false)
    expect(updateBookSchema.parse({ id: BOOK_ID, status: 'completed' })).toEqual({
      id: BOOK_ID,
      status: 'completed'
    })
  })
})

describe('chapter input contracts', () => {
  it('defaults new chapter content and trims its title', () => {
    expect(createChapterSchema.parse({ bookId: BOOK_ID, title: '  Interlude  ' })).toEqual({
      bookId: BOOK_ID,
      title: 'Interlude',
      content: ''
    })
  })

  it('requires at least one update and validates ordered chapter ids', () => {
    expect(updateChapterSchema.safeParse({ id: CHAPTER_ID }).success).toBe(false)
    expect(updateChapterSchema.safeParse({ id: CHAPTER_ID, content: '' }).success).toBe(true)
    expect(reorderChaptersSchema.safeParse({ bookId: BOOK_ID, chapterIds: [] }).success).toBe(false)
    expect(
      reorderChaptersSchema.safeParse({ bookId: BOOK_ID, chapterIds: [CHAPTER_ID] }).success
    ).toBe(true)
  })

  it('accepts a valid split and rejects negative offsets or empty titles', () => {
    expect(
      splitChapterSchema.safeParse({ chapterId: CHAPTER_ID, offset: 12, newTitle: 'Part Two' })
        .success
    ).toBe(true)
    expect(
      splitChapterSchema.safeParse({ chapterId: CHAPTER_ID, offset: -1, newTitle: 'Part Two' })
        .success
    ).toBe(false)
    expect(
      splitChapterSchema.safeParse({ chapterId: CHAPTER_ID, offset: 12, newTitle: ' ' }).success
    ).toBe(false)
  })
})

describe('reader, settings, and query contracts', () => {
  it('constrains normalized reading positions and percentages', () => {
    const valid = {
      bookId: BOOK_ID,
      chapterId: CHAPTER_ID,
      scrollPosition: 0.72,
      progressPercentage: 86,
      hasFinishedCurrentContent: false
    }

    expect(saveReadingStateSchema.safeParse(valid).success).toBe(true)
    expect(saveReadingStateSchema.safeParse({ ...valid, scrollPosition: 1.01 }).success).toBe(false)
    expect(saveReadingStateSchema.safeParse({ ...valid, progressPercentage: -1 }).success).toBe(
      false
    )
  })

  it('accepts partial reader settings but rejects unusable values', () => {
    expect(
      settingsUpdateSchema.safeParse({ readerTheme: 'sepia', readerFontSize: 22 }).success
    ).toBe(true)
    expect(settingsUpdateSchema.safeParse({ readerFontSize: 8 }).success).toBe(false)
    expect(settingsUpdateSchema.safeParse({ columnWidth: 2000 }).success).toBe(false)
  })

  it('normalizes search input and constrains library pagination', () => {
    expect(searchTermSchema.parse('  lost city  ')).toBe('lost city')
    expect(searchTermSchema.safeParse('   ').success).toBe(false)
    expect(
      libraryQuerySchema.safeParse({ filter: 'in-progress', limit: 100, offset: 0 }).success
    ).toBe(true)
    expect(
      locateSearchHitSchema.safeParse({
        chapterId: '9d836d86-0c0d-4af8-9c63-78157545d43a',
        term: 'remembered line'
      }).success
    ).toBe(true)
    expect(libraryQuerySchema.safeParse({ limit: 0 }).success).toBe(false)
  })

  it('validates bookmark location and defaults its note', () => {
    expect(
      createBookmarkSchema.parse({ bookId: BOOK_ID, chapterId: CHAPTER_ID, location: 0.5 })
    ).toEqual({
      bookId: BOOK_ID,
      chapterId: CHAPTER_ID,
      location: 0.5,
      note: '',
      label: '',
      color: 'gold'
    })
    expect(
      createBookmarkSchema.safeParse({ bookId: BOOK_ID, chapterId: CHAPTER_ID, location: 2 })
        .success
    ).toBe(false)
  })
})
