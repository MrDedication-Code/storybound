import type { BookStatus, Chapter, ReaderTheme } from '../../domain/contracts'

export interface SeedLibrary {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

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

export const seedLibrary: SeedLibrary = {
  id: 'default-library',
  name: 'My Library',
  createdAt: timestamp,
  updatedAt: timestamp
}

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
