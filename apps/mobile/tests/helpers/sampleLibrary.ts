import type { SqlDatabasePort } from '../../src/data/sqlite/databasePort'
import { seedLibrary } from '../../src/data/sqlite/seedData'
import type { BookStatus, Chapter, ReaderTheme } from '../../src/domain/contracts'

// Test fixtures only: the app itself no longer ships sample books.
export interface SeedBook {
  id: string
  libraryId: string
  title: string
  subtitle: string
  authorName: string
  blurb: string
  status: BookStatus
  coverTone: 'forest' | 'moonlit' | 'ember'
  position: number
  createdAt: string
  updatedAt: string
}

export interface SeedReadingState {
  bookId: string
  chapterId: string
  scrollPosition: number
  progressPercentage: number
  readerTheme: ReaderTheme
  fontSize: number
  lastReadAt: string
}

const timestamp = '2026-08-06T08:00:00.000Z'

export const seedBooks: SeedBook[] = [
  {
    id: 'lantern-house',
    libraryId: seedLibrary.id,
    title: 'The Lantern House',
    subtitle: 'A story of the Blackwater coast',
    authorName: 'Storybound Preview',
    blurb: 'A lighthouse keeper, an impossible visitor, and a light that remembers the way home.',
    status: 'ongoing',
    coverTone: 'moonlit',
    position: 0,
    createdAt: timestamp,
    updatedAt: timestamp
  },
  {
    id: 'glass-orchard',
    libraryId: seedLibrary.id,
    title: 'The Glass Orchard',
    subtitle: '',
    authorName: 'Storybound Preview',
    blurb:
      'At the city limits, a forbidden orchard opens its gate for the first time in a century.',
    status: 'ongoing',
    coverTone: 'forest',
    position: 1,
    createdAt: timestamp,
    updatedAt: timestamp
  }
]

export const seedChapters: Chapter[] = [
  {
    id: 'lantern-1',
    bookId: 'lantern-house',
    title: 'The Light on Blackwater Point',
    position: 0,
    wordCount: 162,
    updatedAt: timestamp,
    content: `The lantern woke before the keeper did. Its glass chamber filled with a low amber glow, though no match had touched the wick and dawn was still an hour away.

Mara stood at the foot of the iron stair and listened. Beyond the stone walls, the sea pressed against Blackwater Point in long, deliberate breaths. The old tower answered each wave with a shiver.

## A visitor in the rain

Three knocks sounded at the door below.

No boat had crossed the bay in six days. The path from the village had vanished beneath the tide before midnight. Still, when Mara opened the door, a boy in a silver coat stood on the step with rain running from his hair.

“The light has been looking for me,” he said.

Above them, the lantern brightened.`
  },
  {
    id: 'lantern-2',
    bookId: 'lantern-house',
    title: 'A Map Drawn in Salt',
    position: 1,
    wordCount: 132,
    updatedAt: timestamp,
    content: `By morning, the storm had folded itself into mist. The boy slept beside the kitchen stove while Mara searched the keeper's ledgers for any mention of a silver coat.

She found none. Instead, between two pages dated forty years apart, a map had appeared in a crust of white salt.

The line began at Blackwater Point and crossed the open sea. It ended at an island omitted from every chart Mara owned.

* * *

When the boy woke, he looked at the map without surprise.

“That is where the light began,” he said. “And where it will go dark, unless we reach it first.”`
  },
  {
    id: 'orchard-1',
    bookId: 'glass-orchard',
    title: 'The Orchard Gate',
    position: 0,
    wordCount: 108,
    updatedAt: timestamp,
    content: `At the edge of the city, behind a wall no taller than a child, grew an orchard made entirely of glass.

Every branch held a different season. Spring blossoms chimed beside summer fruit; amber leaves turned slowly in air that never moved.

Iona had passed the gate every day for eleven years. On the twelfth, it stood open.

There was no keeper and no sign, only a narrow path shining beneath the trees. Somewhere deep inside the orchard, someone was singing the song her mother used to hum.`
  }
]

export const seedReadingState: SeedReadingState = {
  bookId: 'lantern-house',
  chapterId: 'lantern-1',
  scrollPosition: 0.68,
  progressPercentage: 34,
  readerTheme: 'sepia',
  fontSize: 19,
  lastReadAt: '2026-08-06T07:45:00.000Z'
}

/** Adds the sample books, chapters, and reading position to a freshly migrated database. */
export async function insertSampleLibrary(database: SqlDatabasePort): Promise<void> {
  for (const book of seedBooks) {
    await database.runAsync(
      `INSERT INTO books (
        id, library_id, title, subtitle, author_name, blurb, status, cover_tone, cover_style,
        position, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        book.id,
        book.libraryId,
        book.title,
        book.subtitle,
        book.authorName,
        book.blurb,
        book.status,
        book.coverTone,
        book.coverTone,
        book.position,
        book.createdAt,
        book.updatedAt
      ]
    )
  }
  for (const chapter of seedChapters) {
    await database.runAsync(
      `INSERT INTO chapters (
        id, book_id, title, content, position, word_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        chapter.id,
        chapter.bookId,
        chapter.title,
        chapter.content,
        chapter.position,
        chapter.wordCount,
        chapter.updatedAt,
        chapter.updatedAt
      ]
    )
  }
  await database.runAsync(
    `INSERT INTO reading_states (
      book_id, chapter_id, scroll_position, progress_percentage, reader_theme,
      font_size, last_read_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      seedReadingState.bookId,
      seedReadingState.chapterId,
      seedReadingState.scrollPosition,
      seedReadingState.progressPercentage,
      seedReadingState.readerTheme,
      seedReadingState.fontSize,
      seedReadingState.lastReadAt,
      seedReadingState.lastReadAt
    ]
  )
}
