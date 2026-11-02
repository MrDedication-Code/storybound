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
  chapters: ChapterSummary[]
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
}

export const READER_FONT_SIZE_MIN = 15
export const READER_FONT_SIZE_MAX = 31

export const DEFAULT_PREFERENCES: MobilePreferences = {
  mode: 'reader',
  readerTheme: 'sepia',
  readerFontSize: 19
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
  getSyncStatus(): Promise<LocalSyncStatus>
  getPreferences(): Promise<MobilePreferences>
  savePreferences(changes: Partial<MobilePreferences>): Promise<MobilePreferences>
}

export type MobileRoute =
  | { name: 'library' }
  | { name: 'book'; bookId: string }
  | { name: 'reader'; bookId: string; chapterId?: string }
  | { name: 'editor'; bookId: string; chapterId: string }
  | { name: 'sync-settings' }
