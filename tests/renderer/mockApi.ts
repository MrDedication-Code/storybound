import { vi } from 'vitest'
import type {
  ApiResult,
  Annotation,
  ApplicationSettings,
  BookDetail,
  Chapter,
  ReadingState,
  StoryEntity,
  StoryEntityChapterLink,
  StoryEntityRelation,
  StoryboundApi,
  WritingGoal
} from '../../src/shared/types'

export const timestamp = '2026-08-05T10:00:00.000Z'

export const settings: ApplicationSettings = {
  appTheme: 'dark',
  reducedMotion: false,
  hasSeenGettingStarted: true,
  readerTheme: 'sepia',
  readerFont: 'literary',
  readerFontSize: 19,
  lineHeight: 1.7,
  columnWidth: 720,
  paragraphSpacing: 0.8,
  paragraphIndentation: false,
  textAlignment: 'left',
  defaultLibrarySort: 'recently-opened'
}

export const chapter: Chapter = {
  id: 'chapter-1',
  bookId: 'book-1',
  title: 'Chapter 1',
  content: 'The lantern burned through the long night.',
  position: 0,
  createdAt: timestamp,
  updatedAt: timestamp,
  wordCount: 8,
  isRead: false
}

export const book: BookDetail = {
  id: 'book-1',
  libraryId: 'library-1',
  title: 'The Lantern House',
  subtitle: '',
  seriesName: '',
  seriesPosition: null,
  authorName: '',
  blurb: 'A keeper waits beside a restless sea.',
  status: 'ongoing',
  languageCode: '',
  sourceLabel: '',
  sourceUrl: '',
  personalNotes: '',
  rating: null,
  isFavourite: false,
  isPinned: false,
  coverImageUrl: null,
  coverStyle: 'classic',
  coverPositionX: 50,
  coverPositionY: 50,
  createdAt: timestamp,
  updatedAt: timestamp,
  lastOpenedAt: timestamp,
  completedAt: null,
  totalWordCount: chapter.wordCount,
  chapterCount: 1,
  progressPercentage: 25,
  hasFinishedCurrentContent: false,
  isArchived: false,
  chapters: [chapter],
  tagIds: [],
  collectionIds: []
}

export const reading: ReadingState = {
  bookId: book.id,
  chapterId: chapter.id,
  scrollPosition: 0,
  progressPercentage: 25,
  lastReadAt: timestamp,
  hasFinishedCurrentContent: false
}

export const annotation: Annotation = {
  id: 'annotation-1',
  bookId: book.id,
  chapterId: chapter.id,
  chapterTitle: chapter.title,
  kind: 'highlight',
  body: '',
  color: 'gold',
  anchor: {
    id: 'anchor-annotation-1',
    chapterId: chapter.id,
    startOffset: 4,
    endOffset: 11,
    fallbackLocation: 0.2,
    quote: 'lantern',
    prefix: 'The ',
    suffix: ' burned',
    contentHash: 'fixture',
    resolutionStatus: 'resolved',
    createdAt: timestamp,
    updatedAt: timestamp,
    rowVersion: 1
  },
  createdAt: timestamp,
  updatedAt: timestamp,
  rowVersion: 1
}

export const writingGoal: WritingGoal = {
  id: 'goal-1',
  libraryId: book.libraryId,
  bookId: book.id,
  bookTitle: book.title,
  metric: 'words',
  period: 'daily',
  targetValue: 500,
  startOn: '2026-08-05',
  endOn: null,
  timezone: 'Europe/London',
  isActive: true,
  createdAt: timestamp,
  updatedAt: timestamp,
  rowVersion: 1
}

export const storyEntity: StoryEntity = {
  id: 'entity-1',
  bookId: book.id,
  entityType: 'character',
  title: 'The Keeper',
  summary: 'Keeper of the lantern house.',
  bodyMarkdown: '',
  detailsVersion: 1,
  details: {},
  position: 0,
  createdAt: timestamp,
  updatedAt: timestamp,
  rowVersion: 1
}

const storyEntityLink: StoryEntityChapterLink = {
  id: 'entity-link-1',
  bookId: book.id,
  entityId: storyEntity.id,
  chapterId: chapter.id,
  chapterTitle: chapter.title,
  note: '',
  createdAt: timestamp,
  updatedAt: timestamp,
  rowVersion: 1
}

const storyRelation: StoryEntityRelation = {
  id: 'relation-1',
  bookId: book.id,
  fromEntityId: storyEntity.id,
  toEntityId: 'entity-2',
  relationshipType: 'knows',
  label: '',
  notes: '',
  createdAt: timestamp,
  updatedAt: timestamp,
  rowVersion: 1
}

export function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data }
}

export function makeApi(): StoryboundApi {
  return {
    app: {
      info: vi.fn(async () =>
        ok({ name: 'Storybound', version: '0.1.0', dataPath: '/tmp/storybound' })
      ),
      openDataFolder: vi.fn(async () => ok({ message: 'Opened data folder.' })),
      confirmClose: vi.fn(async () => ok(undefined))
    },
    books: {
      list: vi.fn(async () => ok([book])),
      get: vi.fn(async () => ok(book)),
      create: vi.fn(async () => ok(book)),
      update: vi.fn(async () => ok(book)),
      trash: vi.fn(async () => ok(undefined)),
      restore: vi.fn(async () => ok(undefined)),
      removePermanently: vi.fn(async () => ok(undefined)),
      chooseCover: vi.fn(async () => ok(book)),
      removeCover: vi.fn(async () => ok(book))
    },
    libraries: {
      list: vi.fn(async () =>
        ok([
          {
            id: book.libraryId,
            name: 'My Library',
            description: '',
            createdAt: timestamp,
            updatedAt: timestamp,
            isActive: true,
            bookCount: 1
          }
        ])
      ),
      create: vi.fn(async (input) =>
        ok({
          id: 'library-created',
          name: input.name,
          description: input.description ?? '',
          createdAt: timestamp,
          updatedAt: timestamp,
          isActive: false,
          bookCount: 0
        })
      ),
      update: vi.fn(async (input) =>
        ok({
          id: input.id,
          name: input.name ?? 'My Library',
          description: input.description ?? '',
          createdAt: timestamp,
          updatedAt: timestamp,
          isActive: input.id === book.libraryId,
          bookCount: input.id === book.libraryId ? 1 : 0
        })
      ),
      setActive: vi.fn(async (id) =>
        ok({
          id,
          name: 'My Library',
          description: '',
          createdAt: timestamp,
          updatedAt: timestamp,
          isActive: true,
          bookCount: 1
        })
      ),
      remove: vi.fn(async () => ok(undefined))
    },
    tags: {
      list: vi.fn(async () => ok([])),
      create: vi.fn(async (input) =>
        ok({
          id: 'tag-created',
          libraryId: input.libraryId ?? book.libraryId,
          name: input.name,
          color: input.color ?? '',
          createdAt: timestamp,
          updatedAt: timestamp,
          bookCount: 0
        })
      ),
      update: vi.fn(async (input) =>
        ok({
          id: input.id,
          libraryId: book.libraryId,
          name: input.name ?? 'Tag',
          color: input.color ?? '',
          createdAt: timestamp,
          updatedAt: timestamp,
          bookCount: 0
        })
      ),
      remove: vi.fn(async () => ok(undefined)),
      setForBook: vi.fn(async () => ok([]))
    },
    collections: {
      list: vi.fn(async () => ok([])),
      create: vi.fn(async (input) =>
        ok({
          id: 'collection-created',
          libraryId: input.libraryId ?? book.libraryId,
          name: input.name,
          description: input.description ?? '',
          color: input.color ?? '',
          icon: input.icon ?? 'books',
          position: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
          bookCount: 0
        })
      ),
      update: vi.fn(async (input) =>
        ok({
          id: input.id,
          libraryId: book.libraryId,
          name: input.name ?? 'Collection',
          description: input.description ?? '',
          color: input.color ?? '',
          icon: input.icon ?? 'books',
          position: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
          bookCount: 0
        })
      ),
      remove: vi.fn(async () => ok(undefined)),
      setForBook: vi.fn(async () => ok([]))
    },
    savedFilters: {
      list: vi.fn(async () => ok([])),
      create: vi.fn(async (input) =>
        ok({
          id: 'filter-created',
          libraryId: input.libraryId ?? book.libraryId,
          name: input.name,
          query: input.query,
          position: 0,
          createdAt: timestamp,
          updatedAt: timestamp
        })
      ),
      update: vi.fn(async (input) =>
        ok({
          id: input.id,
          libraryId: book.libraryId,
          name: input.name ?? 'Saved filter',
          query: input.query ?? {},
          position: 0,
          createdAt: timestamp,
          updatedAt: timestamp
        })
      ),
      remove: vi.fn(async () => ok(undefined))
    },
    storyBible: {
      entities: {
        list: vi.fn(async () => ok([])),
        get: vi.fn(async () => ok(storyEntity)),
        create: vi.fn(async (input) =>
          ok({ ...storyEntity, ...input, id: 'entity-created', details: input.details ?? {} })
        ),
        update: vi.fn(async (input) => ok({ ...storyEntity, ...input })),
        remove: vi.fn(async () => ok(undefined))
      },
      chapterLinks: {
        list: vi.fn(async () => ok([])),
        create: vi.fn(async (input) => ok({ ...storyEntityLink, ...input })),
        update: vi.fn(async (input) => ok({ ...storyEntityLink, ...input })),
        remove: vi.fn(async () => ok(undefined))
      },
      relations: {
        list: vi.fn(async () => ok([])),
        create: vi.fn(async (input) => ok({ ...storyRelation, ...input, id: 'relation-created' })),
        update: vi.fn(async (input) => ok({ ...storyRelation, ...input })),
        remove: vi.fn(async () => ok(undefined))
      }
    },
    chapters: {
      get: vi.fn(async () => ok(chapter)),
      create: vi.fn(async (input) =>
        ok({
          ...chapter,
          id: 'chapter-created',
          title: input.title,
          content: input.content ?? ''
        })
      ),
      update: vi.fn(async (input) => ok({ ...chapter, ...input })),
      reorder: vi.fn(async () => ok(book.chapters)),
      duplicate: vi.fn(async () => ok({ ...chapter, id: 'chapter-copy' })),
      remove: vi.fn(async () => ok(undefined)),
      listTrash: vi.fn(async () => ok([])),
      restore: vi.fn(async () => ok(chapter)),
      removePermanently: vi.fn(async () => ok(undefined)),
      listRevisions: vi.fn(async () => ok([])),
      getRevision: vi.fn(async (id) =>
        ok({
          id,
          chapterId: chapter.id,
          revisionNumber: 1,
          title: chapter.title,
          content: chapter.content,
          wordCount: chapter.wordCount,
          reason: 'Before edit',
          createdAt: timestamp
        })
      ),
      restoreRevision: vi.fn(async () => ok(chapter)),
      split: vi.fn(async () => ok({ ...chapter, id: 'chapter-split' })),
      merge: vi.fn(async () => ok(chapter)),
      detectSplits: vi.fn(async () => ok([])),
      applyDetectedSplits: vi.fn(async () => ok(book.chapters))
    },
    reading: {
      get: vi.fn(async () => ok(reading)),
      save: vi.fn(async (input) => ok({ ...reading, ...input, lastReadAt: timestamp }))
    },
    bookmarks: {
      list: vi.fn(async () => ok([])),
      create: vi.fn(async (input) =>
        ok({
          id: 'bookmark-1',
          bookId: input.bookId,
          chapterId: input.chapterId,
          chapterTitle: chapter.title,
          location: input.location,
          note: input.note ?? '',
          label: input.label ?? '',
          color: input.color ?? 'gold',
          anchor: {
            ...annotation.anchor,
            id: 'anchor-bookmark-1',
            fallbackLocation: input.anchor?.fallbackLocation ?? input.location,
            startOffset: input.anchor?.startOffset ?? null,
            endOffset: input.anchor?.endOffset ?? null,
            quote: input.anchor?.quote ?? '',
            prefix: input.anchor?.prefix ?? '',
            suffix: input.anchor?.suffix ?? ''
          },
          createdAt: timestamp,
          updatedAt: timestamp,
          rowVersion: 1
        })
      ),
      update: vi.fn(async (input) =>
        ok({
          id: input.id,
          bookId: book.id,
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          location: input.anchor?.fallbackLocation ?? 0.2,
          note: input.note ?? '',
          label: input.label ?? '',
          color: input.color ?? 'gold',
          anchor: annotation.anchor,
          createdAt: timestamp,
          updatedAt: timestamp,
          rowVersion: input.expectedRowVersion + 1
        })
      ),
      remove: vi.fn(async () => ok(undefined))
    },
    annotations: {
      list: vi.fn(async () => ok([])),
      create: vi.fn(async (input) =>
        ok({
          ...annotation,
          ...input,
          id: 'annotation-created',
          body: input.body ?? '',
          color: input.color ?? 'gold',
          anchor: {
            ...annotation.anchor,
            ...input.anchor,
            id: 'anchor-annotation-created'
          }
        })
      ),
      update: vi.fn(async (input) =>
        ok({
          ...annotation,
          ...input,
          anchor: input.anchor ? { ...annotation.anchor, ...input.anchor } : annotation.anchor,
          rowVersion: input.expectedRowVersion + 1
        })
      ),
      remove: vi.fn(async () => ok(undefined))
    },
    writing: {
      goals: {
        list: vi.fn(async () => ok([writingGoal])),
        create: vi.fn(async (input) =>
          ok({
            ...writingGoal,
            ...input,
            id: 'goal-created',
            libraryId: input.libraryId ?? book.libraryId,
            bookId: input.bookId ?? null,
            bookTitle: input.bookId ? book.title : null,
            endOn: input.endOn ?? null,
            timezone: input.timezone ?? 'Europe/London',
            isActive: input.isActive ?? true
          })
        ),
        update: vi.fn(async (input) =>
          ok({ ...writingGoal, ...input, rowVersion: input.expectedRowVersion + 1 })
        ),
        remove: vi.fn(async () => ok(undefined))
      },
      stats: vi.fn(async (query) =>
        ok({
          from: query.from,
          to: query.to,
          totalWordsAdded: 500,
          totalWordsRemoved: 20,
          netWords: 480,
          days: [],
          books: [],
          activeGoals: [
            {
              goal: writingGoal,
              periodStart: query.from,
              periodEnd: query.to,
              achievedValue: 500,
              remainingValue: 0,
              progressPercentage: 100
            }
          ]
        })
      )
    },
    search: {
      query: vi.fn(async () => ok([])),
      locate: vi.fn(async (input) =>
        ok({ chapterId: input.chapterId, location: 0.5, matchedTerm: input.term })
      )
    },
    settings: {
      get: vi.fn(async () => ok(settings)),
      update: vi.fn(async (input) => ok({ ...settings, ...input }))
    },
    sync: {
      status: vi.fn(async () =>
        ok({
          configured: false,
          phase: 'local-only' as const,
          accountEmail: null,
          vaultId: null,
          deviceId: null,
          pendingChanges: 0,
          openConflicts: 0,
          lastSyncAt: null,
          lastError: null
        })
      ),
      signUp: vi.fn(async () => {
        throw new Error('Sync is not configured in this test.')
      }),
      signIn: vi.fn(async () => {
        throw new Error('Sync is not configured in this test.')
      }),
      signOut: vi.fn(async () => {
        throw new Error('Sync is not configured in this test.')
      }),
      createVault: vi.fn(async () => {
        throw new Error('Sync is not configured in this test.')
      }),
      rotateRecoveryCode: vi.fn(async () => {
        throw new Error('Sync is not configured in this test.')
      }),
      recover: vi.fn(async () => {
        throw new Error('Sync is not configured in this test.')
      }),
      runNow: vi.fn(async () => {
        throw new Error('Sync is not configured in this test.')
      }),
      listDevices: vi.fn(async () => ok([])),
      revokeDevice: vi.fn(async () => {
        throw new Error('Sync is not configured in this test.')
      }),
      listConflicts: vi.fn(async () => ok([])),
      resolveConflict: vi.fn(async () => {
        throw new Error('Sync is not configured in this test.')
      })
    },
    recovery: {
      get: vi.fn(async () => ok(null)),
      save: vi.fn(async (input) => ok({ ...input, savedAt: timestamp })),
      clear: vi.fn(async () => ok(undefined))
    },
    data: {
      exportBook: vi.fn(async () => ok({ message: 'Book exported.' })),
      exportStandard: vi.fn(async () => ok({ message: 'Book exported.' })),
      exportLibrary: vi.fn(async () => ok({ message: 'Library exported.' })),
      importPackage: vi.fn(async () => ok({ message: 'Book imported.' })),
      restoreBackup: vi.fn(async () => ok({ message: 'Backup restored.' })),
      exportEncrypted: vi.fn(async () => ok({ message: 'Encrypted vault exported.' })),
      restoreEncrypted: vi.fn(async () => ok({ message: 'Encrypted vault restored.' })),
      exportCompanion: vi.fn(async () => ok({ message: 'Companion exported.' })),
      aiAssist: vi.fn(async () => ok({ text: 'A polished suggestion.', model: 'gpt-5.6-luna' })),
      integrityCheck: vi.fn(async () => ok({ healthy: true, details: 'Database is healthy.' })),
      backupPlans: {
        list: vi.fn(async () => ok([])),
        chooseFolder: vi.fn(async () => ok(null)),
        update: vi.fn(async () => {
          throw new Error('No backup plan fixture is installed.')
        }),
        remove: vi.fn(async () => ok(undefined)),
        run: vi.fn(async () => {
          throw new Error('No backup run fixture is installed.')
        })
      }
    }
  }
}

export function installApi(api = makeApi()): StoryboundApi {
  Object.defineProperty(window, 'api', { configurable: true, value: api })
  return api
}
