export type BookStatus = 'ongoing' | 'completed'
export type ReaderTheme = 'paper' | 'sepia' | 'night'

export interface ChapterSummary {
  id: string
  bookId: string
  title: string
  position: number
  wordCount: number
  updatedAt: string
}

export interface Chapter extends ChapterSummary {
  content: string
}

export interface BookSummary {
  id: string
  libraryId: string
  title: string
  subtitle: string
  authorName: string
  blurb: string
  status: BookStatus
  coverTone: 'forest' | 'moonlit' | 'ember'
  /** A synced custom cover as a data URI, or null to draw the generated cover. */
  coverUri: string | null
  chapterCount: number
  totalWordCount: number
  progressPercentage: number
  lastReadAt: string | null
}

/** A library that holds at least one book; empty ones are not shown on the phone. */
export interface LibrarySummary {
  id: string
  name: string
  bookCount: number
}

export interface BookDetail extends BookSummary {
  seriesName: string
  seriesPosition: number | null
  chapters: ChapterSummary[]
}

/** The details a writer can edit on the phone; the desktop has more (tags, covers, notes). */
export interface BookDetailsInput {
  title: string
  subtitle: string
  authorName: string
  blurb: string
  status: BookStatus
  seriesName: string
  seriesPosition: number | null
}

export interface CreateBookInput extends BookDetailsInput {
  /** Null puts the book in this phone's first library. */
  libraryId: string | null
}

export interface TrashedBook {
  id: string
  libraryId: string
  title: string
  deletedAt: string
}

export interface TrashedChapter {
  id: string
  bookId: string
  title: string
  wordCount: number
  deletedAt: string
}

/** An earlier version of a chapter kept on this phone (versions are not synced). */
export interface ChapterRevision {
  id: string
  chapterId: string
  title: string
  content: string
  wordCount: number
  reason: string
  createdAt: string
}

export interface SplitChapterInput {
  id: string
  /** Character offset in the chapter text where the new chapter begins. */
  offset: number
  newTitle: string
}

export interface ReadingState {
  bookId: string
  chapterId: string | null
  scrollPosition: number
  progressPercentage: number
  lastReadAt: string | null
}

export interface SaveReadingStateInput {
  bookId: string
  chapterId: string
  scrollPosition: number
  progressPercentage: number
}

export interface UpdateChapterInput {
  id: string
  title: string
  content: string
}

export interface LocalSyncStatus {
  mode: 'local-only'
  deviceLabel: string
  pendingLocalRecords: number
  lastSyncAt: null
}

/** The highlight colours the desktop reader knows; others display as gold. */
export const ANNOTATION_COLORS = ['gold', 'blue', 'green', 'pink', 'purple', 'orange'] as const
export type AnnotationColor = (typeof ANNOTATION_COLORS)[number]

/** A highlight or a note, with where it was made in the chapter. */
export interface Annotation {
  id: string
  bookId: string
  chapterId: string
  chapterTitle: string
  kind: 'highlight' | 'note'
  body: string
  color: string
  startOffset: number | null
  endOffset: number | null
  fallbackLocation: number
  quote: string
  prefix: string
  suffix: string
  createdAt: string
  updatedAt: string
}

export interface CreateAnnotationInput {
  bookId: string
  chapterId: string
  /** Character offsets into the chapter's stored text. */
  startOffset: number
  endOffset: number
  body: string
  color: string
}

export interface UpdateAnnotationInput {
  id: string
  body: string
  color: string
}

/** A saved place in a chapter, kept as a position from 0 (start) to 1 (end), like the desktop. */
export interface Bookmark {
  id: string
  bookId: string
  chapterId: string
  chapterTitle: string
  location: number
  label: string
  note: string
  color: string
  createdAt: string
  updatedAt: string
}

export interface CreateBookmarkInput {
  bookId: string
  chapterId: string
  location: number
  label: string
  note: string
  color: string
}

export interface UpdateBookmarkInput {
  id: string
  label: string
  note: string
  color: string
}

/** Reader mode hides every editing control; editor mode adds them back. */
export type AppMode = 'reader' | 'editor'

/** Device-only preferences: they are not part of the library and never sync. */
export interface MobilePreferences {
  mode: AppMode
  readerTheme: ReaderTheme
  readerFontSize: number
  /** Turns typed straight quotes, -- and ... into curly quotes, dashes, and ellipses. */
  smartPunctuation: boolean
}

export const READER_FONT_SIZE_MIN = 15
export const READER_FONT_SIZE_MAX = 31

export const DEFAULT_PREFERENCES: MobilePreferences = {
  mode: 'reader',
  readerTheme: 'sepia',
  readerFontSize: 19,
  smartPunctuation: true
}

export interface MobileRepository {
  listBooks(): Promise<BookSummary[]>
  listLibraries(): Promise<LibrarySummary[]>
  getBook(bookId: string): Promise<BookDetail>
  getChapter(chapterId: string): Promise<Chapter>
  updateChapter(input: UpdateChapterInput): Promise<Chapter>
  getReadingState(bookId: string): Promise<ReadingState>
  saveReadingState(input: SaveReadingStateInput): Promise<ReadingState>
  /** Highlights and notes in the book's chapters that are not in Trash, in reading order. */
  listAnnotations(bookId: string): Promise<Annotation[]>
  createAnnotation(input: CreateAnnotationInput): Promise<Annotation>
  updateAnnotation(input: UpdateAnnotationInput): Promise<Annotation>
  removeAnnotation(id: string): Promise<void>
  /** Bookmarks in the book's chapters that are not in Trash, in reading order. */
  listBookmarks(bookId: string): Promise<Bookmark[]>
  createBookmark(input: CreateBookmarkInput): Promise<Bookmark>
  updateBookmark(input: UpdateBookmarkInput): Promise<Bookmark>
  removeBookmark(id: string): Promise<void>
  createBook(input: CreateBookInput): Promise<BookDetail>
  updateBookDetails(bookId: string, input: BookDetailsInput): Promise<BookDetail>
  trashBook(bookId: string): Promise<void>
  restoreBook(bookId: string): Promise<void>
  listTrashedBooks(): Promise<TrashedBook[]>
  /** Adds a chapter at the end of the book. */
  createChapter(bookId: string, title?: string): Promise<Chapter>
  duplicateChapter(chapterId: string): Promise<Chapter>
  /** Puts the book's chapters in this order; every active chapter must be listed. */
  reorderChapters(bookId: string, chapterIds: string[]): Promise<void>
  trashChapter(chapterId: string): Promise<void>
  restoreChapter(chapterId: string): Promise<void>
  listTrashedChapters(bookId: string): Promise<TrashedChapter[]>
  /** Returns the new chapter that holds the text from the split point on. */
  splitChapter(input: SplitChapterInput): Promise<Chapter>
  /** Appends the next chapter to this one and moves the next chapter to Trash. */
  mergeWithNextChapter(chapterId: string): Promise<Chapter>
  listChapterRevisions(chapterId: string): Promise<ChapterRevision[]>
  restoreChapterRevision(revisionId: string): Promise<Chapter>
  getSyncStatus(): Promise<LocalSyncStatus>
  getPreferences(): Promise<MobilePreferences>
  savePreferences(changes: Partial<MobilePreferences>): Promise<MobilePreferences>
}

export type MobileRoute =
  | { name: 'library' }
  | { name: 'book'; bookId: string }
  | { name: 'reader'; bookId: string; chapterId?: string }
  | { name: 'listening-settings' }
  | { name: 'editor'; bookId: string; chapterId: string }
  | { name: 'sync-settings' }
