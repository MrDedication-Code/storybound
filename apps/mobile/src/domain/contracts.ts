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

export interface MobileRepository {
  listBooks(): Promise<BookSummary[]>
  getBook(bookId: string): Promise<BookDetail>
  getChapter(chapterId: string): Promise<Chapter>
  updateChapter(input: UpdateChapterInput): Promise<Chapter>
  getReadingState(bookId: string): Promise<ReadingState>
  saveReadingState(input: SaveReadingStateInput): Promise<ReadingState>
  getSyncStatus(): Promise<LocalSyncStatus>
}

export type MobileRoute =
  | { name: 'library' }
  | { name: 'book'; bookId: string }
  | { name: 'reader'; bookId: string; chapterId?: string }
  | { name: 'editor'; bookId: string; chapterId: string }
  | { name: 'sync-settings' }
