import { z } from 'zod'
import {
  DATA_FORMAT_VERSION,
  type BookDetail,
  type Bookmark,
  type Chapter,
  type ReadingState
} from './types'

const timestampSchema = z.iso.datetime()
const archiveFilenameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => !value.includes('/') && !value.includes('\\') && value !== '..', {
    message: 'Archive filenames must not contain paths'
  })

export const portableChapterSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1).max(240),
  content: z.string().max(10_000_000),
  position: z.number().int().min(0),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})

export const portableBookmarkSchema = z.object({
  id: z.uuid(),
  chapterId: z.uuid(),
  location: z.number().min(0).max(1),
  note: z.string().max(500),
  label: z.string().max(240).optional().default(''),
  color: z.string().max(40).optional().default('gold'),
  anchor: z
    .object({
      startOffset: z.number().int().min(0).nullable(),
      endOffset: z.number().int().min(0).nullable(),
      fallbackLocation: z.number().min(0).max(1),
      quote: z.string().max(2_000),
      prefix: z.string().max(2_000),
      suffix: z.string().max(2_000)
    })
    .optional(),
  createdAt: timestampSchema
})

export const portableReadingStateSchema = z
  .object({
    chapterId: z.uuid().nullable(),
    scrollPosition: z.number().min(0).max(1),
    progressPercentage: z.number().min(0).max(100),
    lastReadAt: timestampSchema.nullable(),
    hasFinishedCurrentContent: z.boolean()
  })
  .nullable()

export const bookPackageManifestSchema = z.object({
  format: z.literal('storybound-book'),
  formatVersion: z.union([z.literal(1), z.literal(DATA_FORMAT_VERSION)]),
  exportedAt: timestampSchema,
  book: z.object({
    id: z.uuid(),
    title: z.string().min(1).max(240),
    subtitle: z.string().max(240).optional().default(''),
    seriesName: z.string().max(240).optional().default(''),
    seriesPosition: z.number().positive().max(10_000).nullable().optional().default(null),
    authorName: z.string().max(240).optional().default(''),
    blurb: z.string().max(20_000),
    status: z.enum(['ongoing', 'completed']),
    languageCode: z.string().max(35).optional().default(''),
    sourceLabel: z.string().max(240).optional().default(''),
    sourceUrl: z.string().max(2_000).optional().default(''),
    personalNotes: z.string().max(100_000).optional().default(''),
    rating: z.number().int().min(1).max(5).nullable().optional().default(null),
    isFavourite: z.boolean().optional().default(false),
    isPinned: z.boolean().optional().default(false),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    completedAt: timestampSchema.nullable(),
    coverFile: archiveFilenameSchema.nullable(),
    coverStyle: z
      .enum(['classic', 'moonlit', 'forest', 'ember', 'ocean', 'rose'])
      .optional()
      .default('classic'),
    coverPositionX: z.number().int().min(0).max(100).optional().default(50),
    coverPositionY: z.number().int().min(0).max(100).optional().default(50)
  }),
  chapters: z.array(portableChapterSchema).max(10_000),
  bookmarks: z.array(portableBookmarkSchema).max(100_000),
  readingState: portableReadingStateSchema
})

export const libraryBackupManifestSchema = z.object({
  format: z.literal('storybound-library-backup'),
  formatVersion: z.union([z.literal(1), z.literal(DATA_FORMAT_VERSION)]),
  exportedAt: timestampSchema,
  appVersion: z.string().min(1).max(50),
  databaseFile: z.literal('storybound.sqlite'),
  mediaDirectory: z.literal('media')
})

export type BookPackageManifest = z.infer<typeof bookPackageManifestSchema>
export type LibraryBackupManifest = z.infer<typeof libraryBackupManifestSchema>

interface CreateBookManifestInput {
  book: BookDetail
  chapters: Chapter[]
  bookmarks: Bookmark[]
  readingState: ReadingState | null
  coverFile: string | null
  exportedAt?: string
}

export function createBookPackageManifest(input: CreateBookManifestInput): BookPackageManifest {
  return bookPackageManifestSchema.parse({
    format: 'storybound-book',
    formatVersion: DATA_FORMAT_VERSION,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    book: {
      id: input.book.id,
      title: input.book.title,
      subtitle: input.book.subtitle,
      seriesName: input.book.seriesName,
      seriesPosition: input.book.seriesPosition,
      authorName: input.book.authorName,
      blurb: input.book.blurb,
      status: input.book.status,
      languageCode: input.book.languageCode,
      sourceLabel: input.book.sourceLabel,
      sourceUrl: input.book.sourceUrl,
      personalNotes: input.book.personalNotes,
      rating: input.book.rating,
      isFavourite: input.book.isFavourite,
      isPinned: input.book.isPinned,
      createdAt: input.book.createdAt,
      updatedAt: input.book.updatedAt,
      completedAt: input.book.completedAt,
      coverFile: input.coverFile,
      coverStyle: input.book.coverStyle,
      coverPositionX: input.book.coverPositionX,
      coverPositionY: input.book.coverPositionY
    },
    chapters: input.chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      content: chapter.content,
      position: chapter.position,
      createdAt: chapter.createdAt,
      updatedAt: chapter.updatedAt
    })),
    bookmarks: input.bookmarks.map((bookmark) => ({
      id: bookmark.id,
      chapterId: bookmark.chapterId,
      location: bookmark.location,
      note: bookmark.note,
      label: bookmark.label,
      color: bookmark.color,
      anchor: bookmark.anchor
        ? {
            startOffset: bookmark.anchor.startOffset,
            endOffset: bookmark.anchor.endOffset,
            fallbackLocation: bookmark.anchor.fallbackLocation,
            quote: bookmark.anchor.quote,
            prefix: bookmark.anchor.prefix,
            suffix: bookmark.anchor.suffix
          }
        : undefined,
      createdAt: bookmark.createdAt
    })),
    readingState: input.readingState
      ? {
          chapterId: input.readingState.chapterId,
          scrollPosition: input.readingState.scrollPosition,
          progressPercentage: input.readingState.progressPercentage,
          lastReadAt: input.readingState.lastReadAt,
          hasFinishedCurrentContent: input.readingState.hasFinishedCurrentContent
        }
      : null
  })
}

export function createLibraryBackupManifest(
  appVersion: string,
  exportedAt?: string
): LibraryBackupManifest {
  return libraryBackupManifestSchema.parse({
    format: 'storybound-library-backup',
    formatVersion: DATA_FORMAT_VERSION,
    exportedAt: exportedAt ?? new Date().toISOString(),
    appVersion,
    databaseFile: 'storybound.sqlite',
    mediaDirectory: 'media'
  })
}
