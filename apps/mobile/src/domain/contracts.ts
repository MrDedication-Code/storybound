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
