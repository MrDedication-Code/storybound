import { z } from 'zod'

/** How a shared book may be used by the person who received it. */
export type ShareMode = 'read-only' | 'editable'

const coverStyleSchema = z.enum(['classic', 'moonlit', 'forest', 'ember', 'ocean', 'rose'])

/** What a parcel contains. Personal things, such as notes and highlights, are never in it. */
export const sharedBookSchema = z.object({
  format: z.literal('storybound-shared-book'),
  formatVersion: z.literal(1),
  book: z.object({
    sourceId: z.uuid(),
    title: z.string().min(1).max(240),
    subtitle: z.string().max(240),
    seriesName: z.string().max(240),
    seriesPosition: z.number().nullable(),
    authorName: z.string().max(240),
    blurb: z.string().max(20_000),
    status: z.enum(['ongoing', 'completed']),
    languageCode: z.string().max(40),
    coverStyle: coverStyleSchema,
    coverPositionX: z.number().min(0).max(100),
    coverPositionY: z.number().min(0).max(100),
    createdAt: z.iso.datetime(),
    /** What the sender last sent of these details, so a recipient's own changes can be kept. */
    baseHash: z.string().max(128).nullable()
  }),
  cover: z
    .object({
      mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
      data: z.string().min(1).max(12_000_000)
    })
    .nullable(),
  chapters: z
    .array(
      z.object({
        sourceId: z.uuid(),
        title: z.string().min(1).max(240),
        content: z.string().max(10_000_000),
        /** The version the sender last sent, so a recipient's own edits can be recognised. */
        baseHash: z.string().max(128).nullable()
      })
    )
    .max(5_000),
  bible: z
    .object({
      entities: z
        .array(
          z.object({
            sourceId: z.uuid(),
            entityType: z.string().min(1).max(40),
            title: z.string().min(1).max(240),
            summary: z.string().max(20_000),
            bodyMarkdown: z.string().max(2_000_000),
            detailsVersion: z.number().int().min(1),
            detailsJson: z.string().max(2_000_000),
            position: z.number().int().min(0)
          })
        )
        .max(5_000),
      relations: z
        .array(
          z.object({
            sourceId: z.uuid(),
            fromSourceId: z.uuid(),
            toSourceId: z.uuid(),
            relationshipType: z.string().min(1).max(80),
            label: z.string().max(240),
            notes: z.string().max(20_000)
          })
        )
        .max(20_000),
      chapterLinks: z
        .array(
          z.object({
            sourceId: z.uuid(),
            entitySourceId: z.uuid(),
            chapterSourceId: z.uuid(),
            note: z.string().max(20_000)
          })
        )
        .max(20_000)
    })
    .nullable()
})

export type SharedBook = z.infer<typeof sharedBookSchema>
