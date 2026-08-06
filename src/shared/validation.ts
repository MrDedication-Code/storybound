import { z } from 'zod'

export const idSchema = z.uuid()
export const bookStatusSchema = z.enum(['ongoing', 'completed'])
export const coverStyleSchema = z.enum(['classic', 'moonlit', 'forest', 'ember', 'ocean', 'rose'])
export const libraryFilterSchema = z.enum([
  'all',
  'ongoing',
  'completed',
  'unread',
  'in-progress',
  'finished'
])
export const librarySortSchema = z.enum([
  'recently-opened',
  'recently-updated',
  'title',
  'progress',
  'created'
])

const titleSchema = z.string().trim().min(1, 'A title is required').max(240)
const contentSchema = z.string().max(10_000_000)
const dateSchema = z.iso.date()
const rowVersionSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value }).format()
      return true
    } catch {
      return false
    }
  }, 'Choose a valid IANA timezone.')

export const libraryQuerySchema = z
  .object({
    libraryId: idSchema.optional(),
    search: z.string().max(500).optional(),
    filter: libraryFilterSchema.optional(),
    sort: librarySortSchema.optional(),
    includeArchived: z.boolean().optional(),
    favouriteOnly: z.boolean().optional(),
    pinnedOnly: z.boolean().optional(),
    tagIds: z.array(idSchema).max(50).optional(),
    collectionId: idSchema.optional(),
    seriesName: z.string().trim().max(240).optional(),
    limit: z.number().int().min(1).max(1000).optional(),
    offset: z.number().int().min(0).optional()
  })
  .optional()

export const createBookSchema = z.object({
  libraryId: idSchema.optional(),
  title: titleSchema,
  blurb: z.string().max(20_000).optional().default(''),
  status: bookStatusSchema.optional().default('ongoing'),
  initialChapterTitle: z.string().trim().max(240).optional(),
  initialChapterContent: contentSchema.optional()
})

export const updateBookSchema = z
  .object({
    id: idSchema,
    title: titleSchema.optional(),
    blurb: z.string().max(20_000).optional(),
    status: bookStatusSchema.optional(),
    subtitle: z.string().trim().max(240).optional(),
    seriesName: z.string().trim().max(240).optional(),
    seriesPosition: z.number().positive().max(10_000).nullable().optional(),
    authorName: z.string().trim().max(240).optional(),
    languageCode: z.string().trim().max(35).optional(),
    sourceLabel: z.string().trim().max(240).optional(),
    sourceUrl: z.union([z.literal(''), z.url().max(2_000)]).optional(),
    personalNotes: z.string().max(100_000).optional(),
    rating: z.number().int().min(1).max(5).nullable().optional(),
    isFavourite: z.boolean().optional(),
    isPinned: z.boolean().optional(),
    coverStyle: coverStyleSchema.optional(),
    coverPositionX: z.number().int().min(0).max(100).optional(),
    coverPositionY: z.number().int().min(0).max(100).optional()
  })
  .refine((value) => Object.keys(value).some((key) => key !== 'id'), {
    message: 'No changes were supplied'
  })

const nameSchema = z.string().trim().min(1, 'A name is required').max(120)
const descriptionSchema = z.string().trim().max(2_000)
const colorSchema = z.string().trim().max(40)

export const optionalLibraryIdSchema = idSchema.optional()
export const encryptedTransferSchema = z.object({
  passphrase: z.string().min(10, 'Use at least 10 characters.').max(1024)
})
export const aiAssistantSchema = z.object({
  task: z.enum(['blurb', 'chapter-cleanup']),
  apiKey: z.string().trim().min(1, 'Enter an OpenAI API key.').max(2048),
  text: z.string().min(1, 'Choose some text to send.').max(50_000),
  context: z.string().max(20_000).optional()
})
export const createLibrarySchema = z.object({
  name: nameSchema,
  description: descriptionSchema.optional().default('')
})
export const updateLibrarySchema = z
  .object({ id: idSchema, name: nameSchema.optional(), description: descriptionSchema.optional() })
  .refine((value) => value.name !== undefined || value.description !== undefined, {
    message: 'No changes were supplied'
  })
export const createTagSchema = z.object({
  libraryId: idSchema.optional(),
  name: nameSchema,
  color: colorSchema.optional().default('')
})
export const updateTagSchema = z
  .object({ id: idSchema, name: nameSchema.optional(), color: colorSchema.optional() })
  .refine((value) => value.name !== undefined || value.color !== undefined, {
    message: 'No changes were supplied'
  })
export const createCollectionSchema = z.object({
  libraryId: idSchema.optional(),
  name: nameSchema,
  description: descriptionSchema.optional().default(''),
  color: colorSchema.optional().default(''),
  icon: z.string().trim().min(1).max(80).optional().default('books')
})
export const updateCollectionSchema = z
  .object({
    id: idSchema,
    name: nameSchema.optional(),
    description: descriptionSchema.optional(),
    color: colorSchema.optional(),
    icon: z.string().trim().min(1).max(80).optional()
  })
  .refine((value) => Object.keys(value).some((key) => key !== 'id'), {
    message: 'No changes were supplied'
  })
export const setBookRelationsSchema = z.object({
  bookId: idSchema,
  ids: z.array(idSchema).max(100)
})
export const createSavedFilterSchema = z.object({
  libraryId: idSchema.optional(),
  name: nameSchema,
  query: libraryQuerySchema.unwrap()
})
export const updateSavedFilterSchema = z
  .object({
    id: idSchema,
    name: nameSchema.optional(),
    query: libraryQuerySchema.unwrap().optional()
  })
  .refine((value) => value.name !== undefined || value.query !== undefined, {
    message: 'No changes were supplied'
  })

export const storyEntityTypeSchema = z.enum(['character', 'location', 'lore', 'event', 'custom'])
const storyEntitySummarySchema = z.string().max(20_000)
const storyEntityBodySchema = z.string().max(2_000_000)
const storyEntityNoteSchema = z.string().max(20_000)
const detailsVersionSchema = z.number().int().min(1).max(10_000)
const storyEntityPositionSchema = z.number().int().min(0).max(1_000_000)

export const storyEntityDetailsSchema = z
  .record(z.string().trim().min(1).max(120), z.json())
  .superRefine((details, context) => {
    if (
      details.date !== undefined &&
      (typeof details.date !== 'string' || details.date.length > 120)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['date'],
        message: 'Timeline dates must be text up to 120 characters.'
      })
    }
    if (
      details.order !== undefined &&
      (typeof details.order !== 'number' ||
        !Number.isFinite(details.order) ||
        Math.abs(details.order) > 1_000_000_000)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['order'],
        message: 'Timeline order must be a finite number.'
      })
    }
    if (JSON.stringify(details).length > 500_000) {
      context.addIssue({ code: 'custom', message: 'Entity details are too large.' })
    }
  })

export const storyEntityQuerySchema = z.object({
  bookId: idSchema,
  entityType: storyEntityTypeSchema.optional(),
  search: z.string().trim().min(1).max(500).optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional()
})

export const createStoryEntitySchema = z.object({
  bookId: idSchema,
  entityType: storyEntityTypeSchema,
  title: titleSchema,
  summary: storyEntitySummarySchema.optional().default(''),
  bodyMarkdown: storyEntityBodySchema.optional().default(''),
  detailsVersion: detailsVersionSchema.optional().default(1),
  details: storyEntityDetailsSchema.optional().default({}),
  position: storyEntityPositionSchema.optional()
})

export const updateStoryEntitySchema = z
  .object({
    id: idSchema,
    entityType: storyEntityTypeSchema.optional(),
    title: titleSchema.optional(),
    summary: storyEntitySummarySchema.optional(),
    bodyMarkdown: storyEntityBodySchema.optional(),
    detailsVersion: detailsVersionSchema.optional(),
    details: storyEntityDetailsSchema.optional(),
    position: storyEntityPositionSchema.optional()
  })
  .refine((value) => Object.keys(value).some((key) => key !== 'id'), {
    message: 'No changes were supplied'
  })

export const createStoryEntityChapterLinkSchema = z.object({
  entityId: idSchema,
  chapterId: idSchema,
  note: storyEntityNoteSchema.optional().default('')
})

export const updateStoryEntityChapterLinkSchema = z
  .object({
    id: idSchema,
    chapterId: idSchema.optional(),
    note: storyEntityNoteSchema.optional()
  })
  .refine((value) => value.chapterId !== undefined || value.note !== undefined, {
    message: 'No changes were supplied'
  })

export const storyEntityRelationQuerySchema = z.object({
  bookId: idSchema,
  entityId: idSchema.optional()
})

const relationshipTypeSchema = z.string().trim().min(1).max(120)
const relationshipLabelSchema = z.string().trim().max(240)

export const createStoryEntityRelationSchema = z
  .object({
    fromEntityId: idSchema,
    toEntityId: idSchema,
    relationshipType: relationshipTypeSchema,
    label: relationshipLabelSchema.optional().default(''),
    notes: storyEntityNoteSchema.optional().default('')
  })
  .refine((value) => value.fromEntityId !== value.toEntityId, {
    message: 'An entity cannot have a directional relationship to itself.'
  })

export const updateStoryEntityRelationSchema = z
  .object({
    id: idSchema,
    fromEntityId: idSchema.optional(),
    toEntityId: idSchema.optional(),
    relationshipType: relationshipTypeSchema.optional(),
    label: relationshipLabelSchema.optional(),
    notes: storyEntityNoteSchema.optional()
  })
  .refine((value) => Object.keys(value).some((key) => key !== 'id'), {
    message: 'No changes were supplied'
  })

export const createChapterSchema = z.object({
  bookId: idSchema,
  title: titleSchema,
  content: contentSchema.optional().default('')
})

export const updateChapterSchema = z
  .object({
    id: idSchema,
    title: titleSchema.optional(),
    content: contentSchema.optional(),
    writingTimezone: timezoneSchema.optional()
  })
  .refine((value) => value.title !== undefined || value.content !== undefined, {
    message: 'No changes were supplied'
  })

export const restoreChapterRevisionSchema = z.object({
  chapterId: idSchema,
  revisionId: idSchema
})

export const reorderChaptersSchema = z.object({
  bookId: idSchema,
  chapterIds: z.array(idSchema).min(1)
})

export const splitChapterSchema = z.object({
  chapterId: idSchema,
  offset: z.number().int().min(0),
  newTitle: titleSchema
})

export const mergeChapterSchema = z.object({
  chapterId: idSchema,
  direction: z.enum(['previous', 'next'])
})

export const splitCandidateSchema = z.object({
  offset: z.number().int().min(0),
  title: titleSchema,
  line: z.number().int().min(1)
})

export const saveReadingStateSchema = z.object({
  bookId: idSchema,
  chapterId: idSchema,
  scrollPosition: z.number().min(0).max(1),
  progressPercentage: z.number().min(0).max(100),
  hasFinishedCurrentContent: z.boolean()
})

const annotationColorSchema = z.string().trim().min(1).max(40)
const anchorTextSchema = z.string().max(2_000)

export const anchorInputSchema = z
  .object({
    startOffset: z.number().int().min(0).max(10_000_000).nullable().optional(),
    endOffset: z.number().int().min(0).max(10_000_000).nullable().optional(),
    fallbackLocation: z.number().min(0).max(1),
    quote: anchorTextSchema.optional().default(''),
    prefix: anchorTextSchema.optional().default(''),
    suffix: anchorTextSchema.optional().default('')
  })
  .superRefine((value, context) => {
    const start = value.startOffset ?? null
    const end = value.endOffset ?? null
    if ((start === null) !== (end === null)) {
      context.addIssue({
        code: 'custom',
        message: 'Anchor start and end offsets must be supplied together.'
      })
    } else if (start !== null && end !== null && start > end) {
      context.addIssue({
        code: 'custom',
        path: ['endOffset'],
        message: 'The anchor end offset must not precede its start offset.'
      })
    }
  })

export const createBookmarkSchema = z.object({
  bookId: idSchema,
  chapterId: idSchema,
  location: z.number().min(0).max(1),
  note: z.string().max(10_000).optional().default(''),
  label: z.string().trim().max(240).optional().default(''),
  color: annotationColorSchema.optional().default('gold'),
  anchor: anchorInputSchema.optional()
})

export const updateBookmarkSchema = z
  .object({
    id: idSchema,
    expectedRowVersion: rowVersionSchema,
    note: z.string().max(10_000).optional(),
    label: z.string().trim().max(240).optional(),
    color: annotationColorSchema.optional(),
    anchor: anchorInputSchema.optional()
  })
  .refine(
    (value) =>
      value.note !== undefined ||
      value.label !== undefined ||
      value.color !== undefined ||
      value.anchor !== undefined,
    { message: 'No changes were supplied' }
  )

export const annotationKindSchema = z.enum(['highlight', 'note'])
export const createAnnotationSchema = z.object({
  bookId: idSchema,
  chapterId: idSchema,
  kind: annotationKindSchema,
  body: z.string().max(100_000).optional().default(''),
  color: annotationColorSchema.optional().default('gold'),
  anchor: anchorInputSchema
})
export const updateAnnotationSchema = z
  .object({
    id: idSchema,
    expectedRowVersion: rowVersionSchema,
    kind: annotationKindSchema.optional(),
    body: z.string().max(100_000).optional(),
    color: annotationColorSchema.optional(),
    anchor: anchorInputSchema.optional()
  })
  .refine(
    (value) =>
      value.kind !== undefined ||
      value.body !== undefined ||
      value.color !== undefined ||
      value.anchor !== undefined,
    { message: 'No changes were supplied' }
  )

export const versionedIdSchema = z.object({
  id: idSchema,
  expectedRowVersion: rowVersionSchema
})

export const writingGoalMetricSchema = z.enum(['words', 'minutes', 'chapters'])
export const writingGoalPeriodSchema = z.enum(['daily', 'weekly', 'monthly', 'project'])
export const createWritingGoalSchema = z
  .object({
    libraryId: idSchema.optional(),
    bookId: idSchema.nullable().optional(),
    metric: writingGoalMetricSchema,
    period: writingGoalPeriodSchema,
    targetValue: z.number().int().min(1).max(100_000_000),
    startOn: dateSchema,
    endOn: dateSchema.nullable().optional(),
    timezone: timezoneSchema.optional(),
    isActive: z.boolean().optional().default(true)
  })
  .refine((value) => !value.endOn || value.endOn >= value.startOn, {
    path: ['endOn'],
    message: 'The goal end date must not precede its start date.'
  })

export const updateWritingGoalSchema = z
  .object({
    id: idSchema,
    expectedRowVersion: rowVersionSchema,
    bookId: idSchema.nullable().optional(),
    metric: writingGoalMetricSchema.optional(),
    period: writingGoalPeriodSchema.optional(),
    targetValue: z.number().int().min(1).max(100_000_000).optional(),
    startOn: dateSchema.optional(),
    endOn: dateSchema.nullable().optional(),
    timezone: timezoneSchema.optional(),
    isActive: z.boolean().optional()
  })
  .refine(
    (value) => Object.keys(value).some((key) => !['id', 'expectedRowVersion'].includes(key)),
    {
      message: 'No changes were supplied'
    }
  )

export const writingStatsQuerySchema = z
  .object({
    from: dateSchema,
    to: dateSchema,
    bookId: idSchema.optional()
  })
  .superRefine((value, context) => {
    if (value.to < value.from) {
      context.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'The statistics end date must not precede its start date.'
      })
      return
    }
    const rangeDays = (Date.parse(value.to) - Date.parse(value.from)) / 86_400_000
    if (rangeDays > 3_660) {
      context.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'Choose a statistics range of ten years or less.'
      })
    }
  })

export const standardBookExportSchema = z.object({
  bookId: idSchema,
  format: z.enum(['markdown', 'epub', 'pdf'])
})

export const backupScheduleSchema = z.object({
  cadence: z.enum(['daily', 'weekly', 'monthly']),
  retentionCount: z.number().int().min(1).max(100)
})

export const updateBackupPlanSchema = backupScheduleSchema.extend({
  id: idSchema,
  enabled: z.boolean()
})

export const settingsUpdateSchema = z
  .object({
    appTheme: z.enum(['system', 'dark', 'light']),
    reducedMotion: z.boolean(),
    hasSeenGettingStarted: z.boolean(),
    readerTheme: z.enum(['light', 'sepia', 'dark']),
    readerFont: z.enum(['literary', 'classic', 'modern']),
    readerFontSize: z.number().int().min(14).max(34),
    lineHeight: z.number().min(1.3).max(2.2),
    columnWidth: z.number().int().min(480).max(1000),
    paragraphSpacing: z.number().min(0).max(2),
    paragraphIndentation: z.boolean(),
    textAlignment: z.enum(['left', 'justify']),
    defaultLibrarySort: librarySortSchema
  })
  .partial()

export const saveRecoveryDraftSchema = z.object({
  chapterId: idSchema,
  title: titleSchema,
  content: contentSchema
})

export const searchTermSchema = z.string().trim().min(1).max(500)
export const locateSearchHitSchema = z.object({
  chapterId: idSchema,
  term: searchTermSchema
})
export const closeReadySchema = z.boolean()
