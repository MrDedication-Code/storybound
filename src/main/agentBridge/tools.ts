import { z } from 'zod'
import type {
  Annotation,
  BookDetail,
  BookSummary,
  Chapter,
  StoryEntity,
  StoryEntityType
} from '../../shared/types'
import { StoryboundError } from '../errors'
import type { StoryboundStore } from '../store'
import { locateAnchor } from './annotationAnchors'

export interface AgentContentChange {
  bookId: string
  chapterId: string | null
  message: string
}

export interface AgentToolResult {
  text: string
  change?: AgentContentChange
}

export interface AgentToolAnnotations {
  readOnlyHint: boolean
  destructiveHint: boolean
  idempotentHint: boolean
  openWorldHint: boolean
}

export interface AgentTool {
  name: string
  title: string
  description: string
  schema: z.ZodType
  annotations: AgentToolAnnotations
  run(store: StoryboundStore, input: unknown): AgentToolResult
}

export const MCP_SERVER_INSTRUCTIONS = [
  'Storybound is the user’s local library app for AI-assisted fiction.',
  'Use these tools to save the story you are writing with the user straight into their library.',
  'Workflow: call list_books first to check whether the book already exists. Call create_book once',
  'per story, then add_chapter for each chapter in reading order, normally after the user has',
  'approved that chapter. Use get_book and get_chapter to re-read earlier chapters for continuity.',
  'Use update_chapter only when the user asks to revise a chapter; the previous text is kept in',
  'the chapter’s revision history. Call get_annotations to read the highlights and notes the user',
  'left on chapters, and take them into account when writing or revising; an annotation marked',
  'orphaned no longer matches the current text but still carries the user’s note and the text it',
  'was attached to. Each book also has a story bible (characters, locations, lore, timeline,',
  'other): read it with get_bible before writing for continuity, keep it current with',
  'update_bible_section (pass the updatedAt you read as expectedUpdatedAt so the user’s own',
  'edits are never overwritten) and add entries with create_bible_section.',
  'Chapter content is Markdown prose. Do not repeat the chapter',
  'title as a heading inside the content, and never include notes to the user in chapter text.',
  'Nothing can be deleted through these tools.'
].join(' ')

const LIST_LIMIT = 1000
const ANNOTATION_CONTEXT_CHARACTERS = 150

const bookIdSchema = z.uuid().describe('The bookId returned by list_books or create_book.')
const chapterIdSchema = z.uuid().describe('The chapterId returned by get_book or add_chapter.')
const titleSchema = z.string().trim().min(1).max(240)
const blurbSchema = z.string().max(20_000)
const contentSchema = z.string().max(10_000_000)
const statusSchema = z
  .enum(['ongoing', 'completed'])
  .describe('Manuscript status: ongoing while still being written, completed when finished.')
const seriesNameSchema = z.string().trim().max(240)
const seriesPositionSchema = z.number().positive().max(10_000)
const authorSchema = z.string().trim().max(240)

function normalizeTitle(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

/** Normalises line endings and removes a leading heading that only repeats the chapter title. */
export function normalizeChapterContent(title: string, content: string): string {
  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  const firstIndex = lines.findIndex((line) => line.trim().length > 0)
  if (firstIndex >= 0) {
    const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(lines[firstIndex].trim())
    if (heading && normalizeTitle(heading[1]) === normalizeTitle(title)) {
      lines.splice(0, firstIndex + 1)
    }
  }
  return lines.join('\n').replace(/^\n+/, '').replace(/\s+$/, '')
}

export function findBooksByTitle(store: StoryboundStore, title: string): BookSummary[] {
  const wanted = normalizeTitle(title)
  return store
    .listBooks({ sort: 'title', limit: LIST_LIMIT })
    .filter((book) => normalizeTitle(book.title) === wanted)
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function describeBook(book: BookDetail): Record<string, unknown> {
  return {
    bookId: book.id,
    title: book.title,
    status: book.status,
    blurb: book.blurb,
    seriesName: book.seriesName || null,
    seriesPosition: book.seriesPosition,
    authorName: book.authorName || null,
    chapterCount: book.chapterCount,
    totalWordCount: book.totalWordCount,
    chapters: book.chapters.map((chapter, index) => ({
      chapterId: chapter.id,
      number: index + 1,
      title: chapter.title,
      wordCount: chapter.wordCount
    }))
  }
}

function describeChapter(chapter: Chapter, number: number): Record<string, unknown> {
  return {
    chapterId: chapter.id,
    bookId: chapter.bookId,
    number,
    title: chapter.title,
    wordCount: chapter.wordCount
  }
}

function chapterNumber(store: StoryboundStore, chapter: Chapter): number {
  return store.getBook(chapter.bookId).chapters.findIndex((item) => item.id === chapter.id) + 1
}

const BIBLE_CATEGORIES: Record<StoryEntityType, string> = {
  character: 'Characters',
  location: 'Locations',
  lore: 'Lore',
  event: 'Timeline',
  custom: 'Other'
}

function describeBibleSection(
  store: StoryboundStore,
  entity: StoryEntity
): Record<string, unknown> {
  return {
    sectionId: entity.id,
    name: entity.title,
    category: entity.entityType,
    categoryLabel: BIBLE_CATEGORIES[entity.entityType],
    summary: entity.summary,
    content: entity.bodyMarkdown,
    ...(entity.entityType === 'event'
      ? {
          date: typeof entity.details.date === 'string' ? entity.details.date : null,
          timelineOrder: typeof entity.details.order === 'number' ? entity.details.order : null
        }
      : {}),
    appearsInChapters: store.listStoryEntityChapterLinks(entity.id).map((link) => ({
      chapterId: link.chapterId,
      chapterTitle: link.chapterTitle,
      note: link.note
    })),
    updatedAt: entity.updatedAt
  }
}

function requireBibleSection(
  store: StoryboundStore,
  bookId: string,
  sectionId: string
): StoryEntity {
  const entity = store.getStoryEntity(sectionId)
  if (entity.bookId !== bookId) {
    throw new StoryboundError('NOT_FOUND', 'That bible section does not belong to this book.')
  }
  return entity
}

function sameMoment(left: string, right: string): boolean {
  return (
    left === right || (!Number.isNaN(Date.parse(left)) && Date.parse(left) === Date.parse(right))
  )
}

function orphanedIn(annotations: Annotation[], content: string): Annotation[] {
  return annotations.filter(
    (annotation) => locateAnchor(content, annotation.anchor).status === 'orphaned'
  )
}

function describeAnnotations(
  store: StoryboundStore,
  bookId: string,
  chapterId: string | null
): Record<string, unknown>[] {
  const book = store.getBook(bookId)
  const numbers = new Map(book.chapters.map((chapter, index) => [chapter.id, index + 1]))
  const contents = new Map<string, string>()
  const contentOf = (id: string): string => {
    if (!contents.has(id)) contents.set(id, store.getChapter(id).content)
    return contents.get(id)!
  }

  return store
    .listAnnotations(bookId)
    .filter((annotation) => chapterId === null || annotation.chapterId === chapterId)
    .map((annotation) => {
      const content = contentOf(annotation.chapterId)
      const located = locateAnchor(content, annotation.anchor)
      const orphaned = located.status === 'orphaned'
      const start = located.start ?? Math.round(annotation.anchor.fallbackLocation * content.length)
      const end = located.end ?? start
      return {
        sortKey: [numbers.get(annotation.chapterId) ?? 0, start, annotation.createdAt] as const,
        value: {
          annotationId: annotation.id,
          chapterId: annotation.chapterId,
          chapterTitle: annotation.chapterTitle,
          chapterNumber: numbers.get(annotation.chapterId) ?? null,
          type: annotation.kind,
          // An orphan keeps the words and surroundings saved when it was made, so its note
          // always stays meaningful even though that text is gone from the chapter.
          highlightedText: orphaned
            ? annotation.anchor.quote
            : located.status === 'chapter-position'
              ? ''
              : content.slice(start, end),
          contextBefore: orphaned
            ? annotation.anchor.prefix
            : content.slice(Math.max(0, start - ANNOTATION_CONTEXT_CHARACTERS), start),
          contextAfter: orphaned
            ? annotation.anchor.suffix
            : content.slice(end, end + ANNOTATION_CONTEXT_CHARACTERS),
          note: annotation.body,
          color: annotation.color,
          orphaned,
          anchorStatus: located.status,
          positionInChapterPercent: Math.round(
            (content.length === 0 ? annotation.anchor.fallbackLocation : start / content.length) *
              100
          ),
          createdAt: annotation.createdAt,
          updatedAt: annotation.updatedAt
        }
      }
    })
    .sort((left, right) => {
      const [leftChapter, leftStart, leftCreated] = left.sortKey
      const [rightChapter, rightStart, rightCreated] = right.sortKey
      return (
        leftChapter - rightChapter ||
        leftStart - rightStart ||
        leftCreated.localeCompare(rightCreated)
      )
    })
    .map((entry) => entry.value)
}

function defineTool<S extends z.ZodType>(tool: {
  name: string
  title: string
  description: string
  schema: S
  annotations: AgentToolAnnotations
  run(store: StoryboundStore, input: z.output<S>): AgentToolResult
}): AgentTool {
  return {
    ...tool,
    run: (store, input) => {
      const parsed = tool.schema.safeParse(input ?? {})
      if (!parsed.success) {
        const issue = parsed.error.issues[0]
        const field = issue?.path.join('.')
        throw new StoryboundError(
          'VALIDATION_ERROR',
          `${field ? `${field}: ` : ''}${issue?.message ?? 'The tool arguments are invalid.'}`,
          parsed.error
        )
      }
      return tool.run(store, parsed.data)
    }
  }
}

const readOnly: AgentToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
}

export const AGENT_TOOLS: AgentTool[] = [
  defineTool({
    name: 'list_books',
    title: 'List books',
    description:
      'List the books in the user’s active Storybound library. Use this before create_book to avoid duplicates.',
    schema: z.object({
      search: z
        .string()
        .trim()
        .max(240)
        .optional()
        .describe('Optional case-insensitive text to match against book titles.')
    }),
    annotations: readOnly,
    run: (store, input) => {
      const search = input.search ? input.search.toLocaleLowerCase() : null
      const books = store
        .listBooks({ sort: 'recently-updated', limit: LIST_LIMIT })
        .filter((book) => !search || book.title.toLocaleLowerCase().includes(search))
        .map((book) => ({
          bookId: book.id,
          title: book.title,
          status: book.status,
          seriesName: book.seriesName || null,
          seriesPosition: book.seriesPosition,
          chapterCount: book.chapterCount,
          totalWordCount: book.totalWordCount,
          updatedAt: book.updatedAt
        }))
      return { text: json({ books }) }
    }
  }),
  defineTool({
    name: 'get_book',
    title: 'Get book',
    description: 'Get a book’s details and its chapters in reading order (without chapter text).',
    schema: z.object({ bookId: bookIdSchema }),
    annotations: readOnly,
    run: (store, input) => ({ text: json(describeBook(store.getBook(input.bookId))) })
  }),
  defineTool({
    name: 'get_chapter',
    title: 'Get chapter',
    description: 'Get the full Markdown text of one chapter, for continuity or revision.',
    schema: z.object({ chapterId: chapterIdSchema }),
    annotations: readOnly,
    run: (store, input) => {
      const chapter = store.getChapter(input.chapterId)
      return {
        text: json({
          ...describeChapter(chapter, chapterNumber(store, chapter)),
          content: chapter.content
        })
      }
    }
  }),
  defineTool({
    name: 'get_annotations',
    title: 'Get highlights and notes',
    description:
      'Read the highlights and notes the user left in a book (pass bookId) or one chapter (pass chapterId), in reading order. Each result has the highlighted text, about 150 characters of text before and after it, the user’s note, its colour, and timestamps. orphaned: true means the chapter was edited and the highlighted words no longer appear; the original words and note are still returned. type "note" with anchorStatus "chapter-position" is a note pinned to a place in the chapter rather than to specific words. Storybound has no labels, tags, or resolved status for notes.',
    schema: z
      .object({
        bookId: bookIdSchema.optional().describe('Return every annotation in this book.'),
        chapterId: chapterIdSchema.optional().describe('Return only this chapter’s annotations.')
      })
      .refine((value) => (value.bookId === undefined) !== (value.chapterId === undefined), {
        message: 'Supply either bookId or chapterId, not both.'
      }),
    annotations: readOnly,
    run: (store, input) => {
      const chapter = input.chapterId ? store.getChapter(input.chapterId) : null
      const bookId = chapter ? chapter.bookId : input.bookId!
      const book = store.getBook(bookId)
      const annotations = describeAnnotations(store, bookId, chapter?.id ?? null)
      const inTrash = chapter ? 0 : store.countAnnotationsInTrashedChapters(bookId)
      return {
        text: json({
          bookId: book.id,
          bookTitle: book.title,
          ...(chapter ? { chapterId: chapter.id, chapterTitle: chapter.title } : {}),
          annotationCount: annotations.length,
          orphanedCount: annotations.filter((annotation) => annotation.orphaned).length,
          ...(inTrash > 0 ? { annotationsInTrashedChapters: inTrash } : {}),
          annotations
        })
      }
    }
  }),
  defineTool({
    name: 'create_book',
    title: 'Create book',
    description:
      'Create a new, empty book in the active library. Add chapters afterwards with add_chapter. Refuses a title that already exists unless allowDuplicateTitle is true.',
    schema: z.object({
      title: titleSchema.describe('The book title.'),
      blurb: blurbSchema.optional().describe('A short back-cover style description.'),
      status: statusSchema.optional(),
      seriesName: seriesNameSchema.optional().describe('Series name, if the book is part of one.'),
      seriesPosition: seriesPositionSchema.optional().describe('Position within the series.'),
      authorName: authorSchema.optional().describe('Author name to show on the book.'),
      allowDuplicateTitle: z
        .boolean()
        .optional()
        .describe('Only set true when the user really wants a second book with the same title.')
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    run: (store, input) => {
      const existing = findBooksByTitle(store, input.title)
      if (existing.length > 0 && !input.allowDuplicateTitle) {
        throw new StoryboundError(
          'CONFLICT',
          `A book called “${existing[0].title}” already exists (bookId ${existing[0].id}). Add chapters to it with add_chapter, or set allowDuplicateTitle to true if the user wants a separate copy.`
        )
      }
      let book = store.createBook({
        title: input.title,
        blurb: input.blurb,
        status: input.status
      })
      if (input.seriesName || input.seriesPosition !== undefined || input.authorName) {
        book = store.updateBook({
          id: book.id,
          seriesName: input.seriesName,
          seriesPosition: input.seriesPosition,
          authorName: input.authorName
        })
      }
      return {
        text: json({ created: true, ...describeBook(book) }),
        change: { bookId: book.id, chapterId: null, message: `Claude created “${book.title}”.` }
      }
    }
  }),
  defineTool({
    name: 'update_book',
    title: 'Update book',
    description: 'Change a book’s title, blurb, status, series, or author name.',
    schema: z
      .object({
        bookId: bookIdSchema,
        title: titleSchema.optional(),
        blurb: blurbSchema.optional(),
        status: statusSchema.optional(),
        seriesName: seriesNameSchema.optional(),
        seriesPosition: seriesPositionSchema.nullable().optional(),
        authorName: authorSchema.optional()
      })
      .refine((value) => Object.keys(value).some((key) => key !== 'bookId'), {
        message: 'Supply at least one field to change.'
      }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    run: (store, input) => {
      const { bookId, ...changes } = input
      const book = store.updateBook({ id: bookId, ...changes })
      return {
        text: json({ updated: true, ...describeBook(book) }),
        change: { bookId: book.id, chapterId: null, message: `Claude updated “${book.title}”.` }
      }
    }
  }),
  defineTool({
    name: 'add_chapter',
    title: 'Add chapter',
    description:
      'Append the next chapter to the end of a book. Call once per chapter, in reading order. Content is Markdown prose without the chapter title as a heading.',
    schema: z.object({
      bookId: bookIdSchema,
      title: titleSchema.describe('The chapter title, for example “Chapter 3: The Crossing”.'),
      content: contentSchema.describe('The chapter text in Markdown.')
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    run: (store, input) => {
      const book = store.getBook(input.bookId)
      const content = normalizeChapterContent(input.title, input.content)
      const last = book.chapters.at(-1)
      if (last && normalizeTitle(last.title) === normalizeTitle(input.title)) {
        const lastChapter = store.getChapter(last.id)
        // A retried call must not duplicate the chapter it already saved.
        if (lastChapter.content === content) {
          return {
            text: json({
              added: false,
              alreadyPresent: true,
              ...describeChapter(lastChapter, book.chapters.length)
            })
          }
        }
      }
      const chapter = store.createChapter({ bookId: book.id, title: input.title, content })
      const number = book.chapters.length + 1
      return {
        text: json({ added: true, ...describeChapter(chapter, number) }),
        change: {
          bookId: book.id,
          chapterId: chapter.id,
          message: `Claude added “${chapter.title}” to “${book.title}”.`
        }
      }
    }
  }),
  defineTool({
    name: 'update_chapter',
    title: 'Update chapter',
    description:
      'Replace a chapter’s title and/or text when the user asks for a revision. The previous version stays in the chapter’s revision history. The response lists orphanedAnnotations: highlights whose words this rewrite removed (with the original words and the user’s note), so you can tell the user or carry the feedback into the new text. It is empty when none were affected.',
    schema: z
      .object({
        chapterId: chapterIdSchema,
        title: titleSchema.optional(),
        content: contentSchema.optional().describe('The full replacement chapter text in Markdown.')
      })
      .refine((value) => value.title !== undefined || value.content !== undefined, {
        message: 'Supply a new title, new content, or both.'
      }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    run: (store, input) => {
      const current = store.getChapter(input.chapterId)
      const title = input.title ?? current.title
      // The orphan report is read-only and best-effort: it never blocks or alters the revision.
      let alreadyOrphaned: Set<string> | null = null
      try {
        alreadyOrphaned = new Set(
          orphanedIn(store.listChapterAnnotations(current.id), current.content).map(
            (annotation) => annotation.id
          )
        )
      } catch {
        alreadyOrphaned = null
      }
      const chapter = store.updateChapter({
        id: input.chapterId,
        title: input.title,
        content:
          input.content === undefined ? undefined : normalizeChapterContent(title, input.content)
      })
      let orphanedAnnotations: Record<string, string>[] | null = null
      if (alreadyOrphaned) {
        const before = alreadyOrphaned
        try {
          orphanedAnnotations = orphanedIn(
            store.listChapterAnnotations(chapter.id),
            chapter.content
          )
            .filter((annotation) => !before.has(annotation.id))
            .map((annotation) => ({
              annotationId: annotation.id,
              highlightedText: annotation.anchor.quote,
              note: annotation.body
            }))
        } catch {
          orphanedAnnotations = null
        }
      }
      const book = store.getBook(chapter.bookId)
      return {
        text: json({
          updated: true,
          previousVersionSaved: true,
          ...describeChapter(chapter, chapterNumber(store, chapter)),
          orphanedAnnotations: orphanedAnnotations ?? [],
          ...(orphanedAnnotations === null ? { orphanedAnnotationsCheckFailed: true } : {})
        }),
        change: {
          bookId: book.id,
          chapterId: chapter.id,
          message: `Claude revised “${chapter.title}” in “${book.title}”.`
        }
      }
    }
  }),
  defineTool({
    name: 'get_bible',
    title: 'Get story bible',
    description:
      'Read a book’s story bible: every entry in the order the app shows it, plus the relationships between entries. Each entry (a “section”) has a sectionId, name, category (character, location, lore, event for the timeline, or custom for Other), a short summary shown on its card, its full Markdown content, the chapters it is linked to, and updatedAt. Timeline entries also have a date and timelineOrder.',
    schema: z.object({ bookId: bookIdSchema }),
    annotations: readOnly,
    run: (store, input) => {
      const book = store.getBook(input.bookId)
      const entities = store.listStoryEntities({ bookId: book.id })
      const names = new Map(entities.map((entity) => [entity.id, entity.title]))
      return {
        text: json({
          bookId: book.id,
          bookTitle: book.title,
          sectionCount: entities.length,
          sections: entities.map((entity) => describeBibleSection(store, entity)),
          relationships: store.listStoryEntityRelations({ bookId: book.id }).map((relation) => ({
            fromSectionId: relation.fromEntityId,
            from: names.get(relation.fromEntityId) ?? null,
            relationshipType: relation.relationshipType,
            toSectionId: relation.toEntityId,
            to: names.get(relation.toEntityId) ?? null,
            label: relation.label,
            notes: relation.notes
          }))
        })
      }
    }
  }),
  defineTool({
    name: 'update_bible_section',
    title: 'Update story bible section',
    description:
      'Replace the full Markdown content of one story bible entry. Nothing else changes: not its name, summary, category, or any other entry. Storybound keeps no bible history, so the response includes the previous content. Pass expectedUpdatedAt (the updatedAt you last read); if the user has edited the entry since, nothing is changed and the current version is returned instead.',
    schema: z.object({
      bookId: bookIdSchema,
      sectionId: z.uuid().describe('The sectionId returned by get_bible or create_bible_section.'),
      content: z.string().max(2_000_000).describe('The complete new content, in Markdown.'),
      expectedUpdatedAt: z
        .string()
        .max(64)
        .optional()
        .describe('The updatedAt value you last read for this section.')
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    run: (store, input) => {
      const book = store.getBook(input.bookId)
      const current = requireBibleSection(store, book.id, input.sectionId)
      if (
        input.expectedUpdatedAt !== undefined &&
        !sameMoment(input.expectedUpdatedAt, current.updatedAt)
      ) {
        return {
          text: json({
            updated: false,
            conflict: true,
            reason:
              'This section was edited after the version you read, so nothing was changed. Review the current content below and try again with its updatedAt.',
            current: describeBibleSection(store, current)
          })
        }
      }
      if (current.bodyMarkdown === input.content) {
        return {
          text: json({
            updated: false,
            unchanged: true,
            section: describeBibleSection(store, current)
          })
        }
      }
      const updated = store.updateStoryEntity({ id: current.id, bodyMarkdown: input.content })
      return {
        text: json({
          updated: true,
          section: describeBibleSection(store, updated),
          previousContent: current.bodyMarkdown,
          previousUpdatedAt: current.updatedAt
        }),
        change: {
          bookId: book.id,
          chapterId: null,
          message: `Claude updated “${updated.title}” in the story bible of “${book.title}”.`
        }
      }
    }
  }),
  defineTool({
    name: 'create_bible_section',
    title: 'Create story bible section',
    description:
      'Add a new entry to a book’s story bible. It is filed under Other unless you choose a category. Refuses a name that already exists in this book’s bible unless allowDuplicateName is true; use update_bible_section to change an existing entry.',
    schema: z.object({
      bookId: bookIdSchema,
      name: titleSchema.describe('The entry name, for example a character’s name.'),
      content: z.string().max(2_000_000).describe('The entry’s full content, in Markdown.'),
      category: z
        .enum(['character', 'location', 'lore', 'event', 'custom'])
        .optional()
        .describe('character, location, lore, event (timeline), or custom (Other, the default).'),
      summary: z
        .string()
        .max(20_000)
        .optional()
        .describe('A one or two sentence summary shown on the entry’s card.'),
      allowDuplicateName: z
        .boolean()
        .optional()
        .describe('Only set true when the user really wants two entries with the same name.')
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    run: (store, input) => {
      const book = store.getBook(input.bookId)
      const existing = store
        .listStoryEntities({ bookId: book.id })
        .find((entity) => normalizeTitle(entity.title) === normalizeTitle(input.name))
      if (existing && !input.allowDuplicateName) {
        throw new StoryboundError(
          'CONFLICT',
          `The story bible already has an entry called “${existing.title}” (sectionId ${existing.id}). Change it with update_bible_section, or set allowDuplicateName to true if the user wants a separate entry.`
        )
      }
      const entity = store.createStoryEntity({
        bookId: book.id,
        entityType: input.category ?? 'custom',
        title: input.name,
        summary: input.summary,
        bodyMarkdown: input.content
      })
      return {
        text: json({ created: true, section: describeBibleSection(store, entity) }),
        change: {
          bookId: book.id,
          chapterId: null,
          message: `Claude added “${entity.title}” to the story bible of “${book.title}”.`
        }
      }
    }
  })
]

export function toolInputSchema(tool: AgentTool): Record<string, unknown> {
  const schema = z.toJSONSchema(tool.schema, { io: 'input' }) as Record<string, unknown>
  delete schema.$schema
  return schema
}
