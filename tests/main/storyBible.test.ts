import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { StoryboundStore } from '../../src/main/store'

const temporaryDirectories: string[] = []
const openStores: StoryboundStore[] = []

async function createStore(): Promise<StoryboundStore> {
  const directory = mkdtempSync(join(tmpdir(), 'storybound-bible-test-'))
  temporaryDirectories.push(directory)
  const store = await StoryboundStore.open(directory)
  openStores.push(store)
  return store
}

afterEach(() => {
  for (const store of openStores.splice(0)) store.close()
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('story bible and timeline persistence', () => {
  it('creates, filters, searches, updates, and soft-deletes versioned entities', async () => {
    const store = await createStore()
    const book = store.createBook({ title: 'Atlas of Ash' })

    const character = store.createStoryEntity({
      bookId: book.id,
      entityType: 'character',
      title: 'Mara Voss',
      summary: 'Cartographer of impossible coastlines.',
      bodyMarkdown: 'She carries an obsidian compass.',
      detailsVersion: 7,
      details: { occupation: 'cartographer' }
    })
    const location = store.createStoryEntity({
      bookId: book.id,
      entityType: 'location',
      title: 'The Glass Harbour'
    })
    store.createStoryEntity({
      bookId: book.id,
      entityType: 'lore',
      title: 'The Ember Accord'
    })
    store.createStoryEntity({
      bookId: book.id,
      entityType: 'custom',
      title: 'Red Thread'
    })
    const laterEvent = store.createStoryEntity({
      bookId: book.id,
      entityType: 'event',
      title: 'Harbour falls',
      details: { date: 'Year 12, Frostwane', order: 20, stakes: ['harbour', 'fleet'] }
    })
    const earlierEvent = store.createStoryEntity({
      bookId: book.id,
      entityType: 'event',
      title: 'Fleet arrives',
      details: { date: 'Year 12, Firstwane', order: 10 }
    })

    expect(
      store.listStoryEntities({ bookId: book.id, entityType: 'event' }).map((entity) => entity.id)
    ).toEqual([earlierEvent.id, laterEvent.id])
    expect(store.listStoryEntities({ bookId: book.id })).toHaveLength(6)
    expect(store.listStoryEntities({ bookId: book.id, search: 'Mara Voss' })).toEqual([
      expect.objectContaining({ id: character.id })
    ])
    expect(store.listStoryEntities({ bookId: book.id, search: 'impossible coastlines' })).toEqual([
      expect.objectContaining({ id: character.id })
    ])
    expect(store.listStoryEntities({ bookId: book.id, search: 'obsidian compass' })).toEqual([
      expect.objectContaining({ id: character.id })
    ])
    expect(store.search('obsidian compass')).toEqual([
      expect.objectContaining({
        type: 'story-entity',
        bookId: book.id,
        storyEntityId: character.id,
        chapterTitle: 'Mara Voss'
      })
    ])

    const detailsUpdate = store.updateStoryEntity({
      id: laterEvent.id,
      details: { date: 'Year 11, Lastwane', order: 5 }
    })
    expect(detailsUpdate).toMatchObject({ detailsVersion: 1, rowVersion: 2 })
    const versionUpdate = store.updateStoryEntity({
      id: laterEvent.id,
      title: 'Harbour burns',
      detailsVersion: 2
    })
    expect(versionUpdate).toMatchObject({ detailsVersion: 2, rowVersion: 3 })
    expect(
      store.listStoryEntities({ bookId: book.id, entityType: 'event' }).map((entity) => entity.id)
    ).toEqual([laterEvent.id, earlierEvent.id])
    expect(store.listStoryEntities({ bookId: book.id, search: 'falls' })).toHaveLength(0)
    expect(store.listStoryEntities({ bookId: book.id, search: 'burns' })).toHaveLength(1)

    store.removeStoryEntity(location.id)
    expect(() => store.getStoryEntity(location.id)).toThrow('could not be found')
    expect(store.listStoryEntities({ bookId: book.id })).toHaveLength(5)

    const database = new Database(store.paths.database, { readonly: true })
    const deleted = database
      .prepare('SELECT deleted_at, row_version FROM story_entities WHERE id = ?')
      .get(location.id) as { deleted_at: string | null; row_version: number }
    database.close()
    expect(deleted.deleted_at).not.toBeNull()
    expect(deleted.row_version).toBe(2)
  })

  it('maintains same-book chapter links and directional relationships', async () => {
    const store = await createStore()
    const book = store.createBook({ title: 'The Quiet Engine' })
    const first = store.createChapter({ bookId: book.id, title: 'Arrival' })
    const second = store.createChapter({ bookId: book.id, title: 'Departure' })
    const otherBook = store.createBook({ title: 'Unrelated Notes' })
    const foreignChapter = store.createChapter({ bookId: otherBook.id, title: 'Elsewhere' })
    const pilot = store.createStoryEntity({
      bookId: book.id,
      entityType: 'character',
      title: 'Ilya'
    })
    const engine = store.createStoryEntity({
      bookId: book.id,
      entityType: 'lore',
      title: 'The Quiet Engine'
    })
    const outsider = store.createStoryEntity({
      bookId: otherBook.id,
      entityType: 'character',
      title: 'Outsider'
    })

    const link = store.createStoryEntityChapterLink({
      entityId: pilot.id,
      chapterId: first.id,
      note: 'First appearance'
    })
    expect(link).toMatchObject({ bookId: book.id, chapterTitle: 'Arrival', rowVersion: 1 })
    expect(() =>
      store.createStoryEntityChapterLink({
        entityId: pilot.id,
        chapterId: foreignChapter.id
      })
    ).toThrow('same book')
    expect(
      store.updateStoryEntityChapterLink({
        id: link.id,
        chapterId: second.id,
        note: 'Final appearance'
      })
    ).toMatchObject({ chapterTitle: 'Departure', note: 'Final appearance', rowVersion: 2 })

    const relation = store.createStoryEntityRelation({
      fromEntityId: pilot.id,
      toEntityId: engine.id,
      relationshipType: 'maintains',
      label: 'chief engineer'
    })
    expect(relation).toMatchObject({
      bookId: book.id,
      fromEntityId: pilot.id,
      toEntityId: engine.id,
      rowVersion: 1
    })
    expect(store.listStoryEntityRelations({ bookId: book.id, entityId: engine.id })).toEqual([
      relation
    ])
    expect(() =>
      store.createStoryEntityRelation({
        fromEntityId: pilot.id,
        toEntityId: outsider.id,
        relationshipType: 'knows'
      })
    ).toThrow('same book')
    expect(
      store.updateStoryEntityRelation({ id: relation.id, notes: 'Known only to the crew.' })
    ).toMatchObject({ notes: 'Known only to the crew.', rowVersion: 2 })

    store.removeStoryEntityChapterLink(link.id)
    expect(store.listStoryEntityChapterLinks(pilot.id)).toHaveLength(0)
    store.removeStoryEntity(engine.id)
    expect(store.listStoryEntityRelations({ bookId: book.id })).toHaveLength(0)

    const database = new Database(store.paths.database, { readonly: true })
    const deletedLink = database
      .prepare('SELECT deleted_at, row_version FROM story_entity_chapters WHERE id = ?')
      .get(link.id) as { deleted_at: string | null; row_version: number }
    const deletedRelation = database
      .prepare('SELECT deleted_at, row_version FROM story_entity_relations WHERE id = ?')
      .get(relation.id) as { deleted_at: string | null; row_version: number }
    database.close()
    expect(deletedLink).toMatchObject({ row_version: 3 })
    expect(deletedLink.deleted_at).not.toBeNull()
    expect(deletedRelation).toMatchObject({ row_version: 3 })
    expect(deletedRelation.deleted_at).not.toBeNull()
  })

  it('keeps story-bible reads and FTS searches inside the active nondeleted book', async () => {
    const store = await createStore()
    const firstLibrary = store.listLibraries().find((library) => library.isActive)!
    const firstBook = store.createBook({ title: 'First library story' })
    const firstEntity = store.createStoryEntity({
      bookId: firstBook.id,
      entityType: 'character',
      title: 'Shared Secret'
    })
    const secondLibrary = store.createLibrary({ name: 'Second library' })
    store.setActiveLibrary(secondLibrary.id)
    const secondBook = store.createBook({ title: 'Second library story' })
    const secondEntity = store.createStoryEntity({
      bookId: secondBook.id,
      entityType: 'character',
      title: 'Shared Secret'
    })

    expect(store.listStoryEntities({ bookId: secondBook.id, search: 'Shared Secret' })).toEqual([
      expect.objectContaining({ id: secondEntity.id })
    ])
    expect(() => store.getStoryEntity(firstEntity.id)).toThrow('could not be found')
    expect(() =>
      store.listStoryEntities({ bookId: firstBook.id, search: 'Shared Secret' })
    ).toThrow('active library')

    store.setActiveLibrary(firstLibrary.id)
    store.trashBook(firstBook.id)
    expect(() => store.getStoryEntity(firstEntity.id)).toThrow('could not be found')
    expect(() =>
      store.listStoryEntities({ bookId: firstBook.id, search: 'Shared Secret' })
    ).toThrow('not available')
  })
})
