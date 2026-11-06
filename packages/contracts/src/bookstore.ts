import { z } from 'zod'
import { sharedBookSchema } from './sharedBook'

/** A Bookstore book's copy in a library is marked with this before its listing's id. */
export const BOOKSTORE_ADDRESS_PREFIX = 'bookstore:'

export const BOOKSTORE_GENRES = [
  { id: 'fantasy', label: 'Fantasy' },
  { id: 'science-fiction', label: 'Science fiction' },
  { id: 'romance', label: 'Romance' },
  { id: 'thriller', label: 'Thriller' },
  { id: 'mystery', label: 'Mystery' },
  { id: 'horror', label: 'Horror' },
  { id: 'historical', label: 'Historical' },
  { id: 'literary', label: 'Literary' },
  { id: 'adventure', label: 'Adventure' },
  { id: 'comedy', label: 'Comedy' },
  { id: 'other', label: 'Other' }
] as const

export const CONTENT_WARNINGS = [
  { id: 'violence', label: 'Violence' },
  { id: 'sexual-themes', label: 'Sexual themes' },
  { id: 'strong-language', label: 'Strong language' },
  { id: 'self-harm', label: 'Self-harm' },
  { id: 'abuse', label: 'Abuse' },
  { id: 'drug-use', label: 'Drug use' },
  { id: 'death', label: 'Death' }
] as const

export const AI_USES = [
  { id: 'none', label: 'No AI', detail: 'Written entirely by a person.' },
  {
    id: 'assisted',
    label: 'AI-assisted',
    detail: 'A person wrote it, using AI for ideas, editing or polish.'
  },
  { id: 'generated', label: 'AI-generated', detail: 'AI wrote the text, guided by a person.' }
] as const

export const REPORT_REASONS = [
  { id: 'illegal', label: 'Illegal content' },
  { id: 'sexual', label: 'Explicit sexual content' },
  { id: 'copyright', label: 'Copied from someone else' },
  { id: 'hate', label: 'Hate or harassment' },
  { id: 'spam', label: 'Spam or nonsense' },
  { id: 'other', label: 'Something else' }
] as const

const ids = <T extends readonly { id: string }[]>(
  items: T
): [T[number]['id'], ...T[number]['id'][]] =>
  items.map((item) => item.id) as [T[number]['id'], ...T[number]['id'][]]

const genreSchema = z.enum(ids(BOOKSTORE_GENRES))
const warningSchema = z.enum(ids(CONTENT_WARNINGS))
const aiUseSchema = z.enum(ids(AI_USES))
const reportReasonSchema = z.enum(ids(REPORT_REASONS))
const listingStatusSchema = z.enum(['pending', 'live', 'rejected', 'withdrawn', 'removed'])

export type BookstoreGenre = z.infer<typeof genreSchema>
export type ContentWarning = z.infer<typeof warningSchema>
export type AiUse = z.infer<typeof aiUseSchema>
export type ReportReason = z.infer<typeof reportReasonSchema>
export type ListingStatus = z.infer<typeof listingStatusSchema>

export const storeCardSchema = z.object({
  id: z.uuid(),
  status: listingStatusSchema,
  version: z.number().int(),
  title: z.string(),
  subtitle: z.string(),
  authorName: z.string(),
  blurb: z.string(),
  genre: genreSchema,
  contentWarnings: z.array(warningSchema),
  aiUse: aiUseSchema,
  languageCode: z.string(),
  chapterCount: z.number().int(),
  wordCount: z.number().int(),
  coverStyle: sharedBookSchema.shape.book.shape.coverStyle,
  coverThumb: z.string().nullable(),
  addCount: z.number().int(),
  publishedAt: z.string().nullable(),
  mine: z.boolean()
})
export type StoreCard = z.infer<typeof storeCardSchema>

export const storePageSchema = z.object({
  items: z.array(storeCardSchema),
  hasMore: z.boolean()
})
export type StorePage = z.infer<typeof storePageSchema>

export const storeListingSchema = storeCardSchema.extend({ added: z.boolean() })
/** A book's page: its card, and where the reader's own copy is, if they have one. */
export type StoreListing = z.infer<typeof storeListingSchema> & { libraryBookId: string | null }

export const storeProfileSchema = z.object({
  joined: z.boolean(),
  penName: z.string().nullable(),
  suspended: z.boolean(),
  isAdmin: z.boolean(),
  termsVersion: z.number().int()
})

export type BookstoreStatus =
  | { phase: 'unavailable' }
  | { phase: 'signed-out' }
  | ({ phase: 'signed-in'; email: string | null } & z.infer<typeof storeProfileSchema>)

export const myListingSchema = z.object({
  id: z.uuid(),
  sourceBookId: z.uuid(),
  status: listingStatusSchema,
  liveVersion: z.number().int().nullable(),
  addCount: z.number().int(),
  removalReason: z.string().nullable(),
  latestVersion: z.number().int(),
  latestStatus: z.enum(['pending', 'approved', 'rejected', 'superseded']),
  latestReason: z.string().nullable(),
  title: z.string(),
  subtitle: z.string(),
  blurb: z.string(),
  genre: genreSchema,
  contentWarnings: z.array(warningSchema),
  aiUse: aiUseSchema,
  submittedAt: z.string()
})
export type MyListing = z.infer<typeof myListingSchema>

export const reviewItemSchema = storeCardSchema.extend({
  filePath: z.string(),
  sha256: z.string(),
  submittedAt: z.string(),
  isUpdate: z.boolean()
})
export type ReviewItem = z.infer<typeof reviewItemSchema>

export const storeReportSchema = z.object({
  id: z.uuid(),
  listingId: z.uuid(),
  title: z.string().nullable(),
  authorName: z.string().nullable(),
  reason: reportReasonSchema,
  detail: z.string(),
  createdAt: z.string()
})
export type StoreReport = z.infer<typeof storeReportSchema>

/** The whole text of a book waiting for review. */
export interface ReviewBook {
  title: string
  authorName: string
  /** True when the file's title differs from the one given in the listing. */
  titleMismatch: boolean
  chapters: Array<{ title: string; content: string }>
}

export const browseStoreSchema = z.object({
  query: z.string().max(200).default(''),
  genre: genreSchema.nullable().default(null),
  sort: z.enum(['new', 'popular']).default('new'),
  page: z.number().int().min(0).default(0)
})
export type BrowseStoreInput = z.input<typeof browseStoreSchema>

export const publishBookSchema = z.object({
  bookId: z.uuid(),
  blurb: z.string().trim().min(20).max(4000),
  genre: genreSchema,
  contentWarnings: z.array(warningSchema).max(7),
  aiUse: aiUseSchema,
  /** The author confirms they may publish it, and that readers may hear it read by AI voices. */
  rightsConfirmed: z.literal(true)
})
export type PublishBookInput = z.infer<typeof publishBookSchema>

export const reviewDecisionSchema = z.object({
  listingId: z.uuid(),
  version: z.number().int().min(1),
  approve: z.boolean(),
  reason: z.string().trim().max(2000)
})
export type ReviewDecisionInput = z.infer<typeof reviewDecisionSchema>

export const readForReviewSchema = z.object({
  listingId: z.uuid(),
  version: z.number().int().min(1)
})
export type ReadForReviewInput = z.infer<typeof readForReviewSchema>

export const removeListingSchema = z.object({
  listingId: z.uuid(),
  reason: z.string().trim().min(1).max(2000)
})
export type RemoveListingInput = z.infer<typeof removeListingSchema>

export const reportListingSchema = z.object({
  listingId: z.uuid(),
  reason: reportReasonSchema,
  detail: z.string().trim().max(2000)
})
export type ReportListingInput = z.infer<typeof reportListingSchema>

export const closeReportSchema = z.object({
  reportId: z.uuid(),
  outcome: z.string().trim().max(2000)
})
export type CloseReportInput = z.infer<typeof closeReportSchema>

/** Where to fetch a book's file, and how to know it arrived whole. */
export const addedBookSchema = z.object({
  listingId: z.uuid(),
  version: z.number().int(),
  authorName: z.string(),
  filePath: z.string(),
  sha256: z.string()
})
export type AddedBook = z.infer<typeof addedBookSchema>

export const checkedBooksSchema = z.array(
  z.object({
    listingId: z.uuid(),
    status: z.string(),
    version: z.number().int().nullable(),
    authorName: z.string().nullable(),
    filePath: z.string().nullable(),
    sha256: z.string().nullable(),
    removalReason: z.string().nullable()
  })
)

const SERVER_MESSAGES = [
  'Accept the Bookstore terms first',
  'The Bookstore terms have changed',
  'This account can no longer use the Bookstore',
  'A pen name needs 2 to 60 characters',
  'That pen name is taken',
  'That book is not in the Bookstore',
  'This is your own book',
  'Choose a pen name first',
  'You can publish one new book a week',
  'This book was removed from the Bookstore',
  'Too many versions of this book today',
  'Say why it was not approved',
  'Say why it was removed',
  'That version is not waiting',
  'Not allowed'
]

/** The server's own wording, when it is one of the messages meant for people. */
export function bookstoreServerMessage(detail: string): string | null {
  return SERVER_MESSAGES.find((message) => detail.includes(message)) ?? null
}

export const passwordResetRequestSchema = z.object({ email: z.email() })

export const passwordResetSchema = z.object({
  email: z.email(),
  code: z.string().trim().min(6).max(10),
  password: z.string().min(10).max(200)
})
export type PasswordResetInput = z.infer<typeof passwordResetSchema>

export const penNameSchema = z.string().trim().min(2).max(60)

/** What changed in the reader's copies since the last check. */
export interface BookstoreCheckResult {
  updated: Array<{ bookId: string; title: string }>
  removed: Array<{ bookId: string; title: string; reason: string }>
}
