import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { StoryboundError } from '../../src/main/errors'
import { StoryboundStore } from '../../src/main/store'

const temporaryDirectories: string[] = []
const openStores: StoryboundStore[] = []

async function createStore(): Promise<StoryboundStore> {
  const directory = mkdtempSync(join(tmpdir(), 'storybound-organization-test-'))
  temporaryDirectories.push(directory)
  const store = await StoryboundStore.open(directory)
  openStores.push(store)
  return store
}

function expectConflict(action: () => unknown, message: string): void {
  try {
    action()
    throw new Error('Expected the operation to fail with a conflict.')
  } catch (error) {
    expect(error).toBeInstanceOf(StoryboundError)
    expect(error).toMatchObject({ code: 'CONFLICT' })
    expect((error as Error).message).toContain(message)
  }
}

afterEach(() => {
  for (const store of openStores.splice(0)) store.close()
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('Storybound library organization', () => {
  it('isolates books by active library and honors explicit library selection', async () => {
    const store = await createStore()
    const primary = store.listLibraries()[0]
    const research = store.createLibrary({
      name: 'Research',
      description: 'Reference material and notes'
    })
    expect(
      store.updateLibrary({
        id: research.id,
        name: 'Research Archive',
        description: 'Reference material, notes, and source texts'
      })
    ).toMatchObject({
      id: research.id,
      name: 'Research Archive',
      description: 'Reference material, notes, and source texts'
    })

    const novel = store.createBook({ title: 'The Lantern House' })
    const reference = store.createBook({ libraryId: research.id, title: 'Maritime Notes' })

    expect(novel.libraryId).toBe(primary.id)
    expect(reference.libraryId).toBe(research.id)
    expect(store.listBooks().map((book) => book.id)).toEqual([novel.id])
    expect(store.listBooks({ libraryId: research.id }).map((book) => book.id)).toEqual([
      reference.id
    ])

    const active = store.setActiveLibrary(research.id)
    expect(active).toMatchObject({ id: research.id, isActive: true, bookCount: 1 })
    expect(store.listBooks().map((book) => book.id)).toEqual([reference.id])
    expect(store.listLibraries().find((library) => library.id === primary.id)).toMatchObject({
      isActive: false,
      bookCount: 1
    })

    store.createBook({ title: 'Active Research Book' })
    expect(store.listBooks().map((book) => book.title)).toEqual([
      'Active Research Book',
      'Maritime Notes'
    ])
    expect(store.listBooks({ libraryId: primary.id }).map((book) => book.id)).toEqual([novel.id])
  })

  it('round-trips metadata and applies favourite and pinned filters independently', async () => {
    const store = await createStore()
    const featured = store.createBook({ title: 'Untitled Draft', blurb: 'Initial notes.' })
    const favouriteOnly = store.createBook({ title: 'A Quiet Favourite' })
    store.createBook({ title: 'Unmarked Story' })

    const updated = store.updateBook({
      id: featured.id,
      title: 'The Glass Harbour',
      subtitle: 'A Tidebound Chronicle',
      seriesName: 'Harbour Lights',
      seriesPosition: 2,
      authorName: 'Mara Vale',
      blurb: 'A keeper follows the lights beyond the breakwater.',
      status: 'completed',
      languageCode: 'en-GB',
      sourceLabel: 'Writing group',
      sourceUrl: 'https://example.com/glass-harbour',
      personalNotes: 'Revise the final scene before sharing.',
      rating: 5,
      isFavourite: true,
      isPinned: true,
      coverStyle: 'ocean',
      coverPositionX: 25,
      coverPositionY: 70
    })
    store.updateBook({ id: favouriteOnly.id, isFavourite: true })

    expect(updated).toMatchObject({
      title: 'The Glass Harbour',
      subtitle: 'A Tidebound Chronicle',
      seriesName: 'Harbour Lights',
      seriesPosition: 2,
      authorName: 'Mara Vale',
      blurb: 'A keeper follows the lights beyond the breakwater.',
      status: 'completed',
      languageCode: 'en-GB',
      sourceLabel: 'Writing group',
      sourceUrl: 'https://example.com/glass-harbour',
      personalNotes: 'Revise the final scene before sharing.',
      rating: 5,
      isFavourite: true,
      isPinned: true,
      coverStyle: 'ocean',
      coverPositionX: 25,
      coverPositionY: 70
    })
    expect(updated.completedAt).not.toBeNull()
    expect(
      store
        .listBooks({ favouriteOnly: true })
        .map((book) => book.id)
        .sort()
    ).toEqual([featured.id, favouriteOnly.id].sort())
    expect(store.listBooks({ pinnedOnly: true }).map((book) => book.id)).toEqual([featured.id])
    expect(store.listBooks({ seriesName: 'harbour lights' }).map((book) => book.id)).toEqual([
      featured.id
    ])
    expect(store.listBooks({ search: 'Harbour Lights' }).map((book) => book.id)).toContain(
      featured.id
    )
    expect(
      store.listBooks({ favouriteOnly: true, pinnedOnly: true }).map((book) => book.id)
    ).toEqual([featured.id])

    const cleared = store.updateBook({
      id: featured.id,
      rating: null,
      isFavourite: false,
      isPinned: false
    })
    expect(cleared).toMatchObject({ rating: null, isFavourite: false, isPinned: false })
  })

  it('enforces per-library tag uniqueness and filters by all assigned tags', async () => {
    const store = await createStore()
    const primary = store.listLibraries()[0]
    const secondary = store.createLibrary({ name: 'Secondary' })
    const first = store.createBook({ title: 'First Tagged Story' })
    const second = store.createBook({ title: 'Second Tagged Story' })
    const fantasy = store.createTag({ name: 'Fantasy', color: '#7257a8' })
    const short = store.createTag({ name: 'Short', color: '#31786f' })

    expectConflict(() => store.createTag({ name: '  FANTASY  ' }), 'already exists')
    expectConflict(() => store.updateTag({ id: short.id, name: 'fantasy' }), 'already exists')
    expect(
      store.updateTag({ id: short.id, name: 'Short fiction', color: '#28655e' })
    ).toMatchObject({
      name: 'Short fiction',
      color: '#28655e'
    })
    const otherFantasy = store.createTag({
      libraryId: secondary.id,
      name: 'fantasy',
      color: '#333333'
    })
    expect(otherFantasy.libraryId).toBe(secondary.id)

    expect(
      store.setBookTags({ bookId: first.id, ids: [fantasy.id, short.id, fantasy.id] })
    ).toHaveLength(2)
    store.setBookTags({ bookId: second.id, ids: [fantasy.id] })
    expect(store.getBook(first.id).tagIds.sort()).toEqual([fantasy.id, short.id].sort())
    expect(store.listTags(primary.id).find((tag) => tag.id === fantasy.id)?.bookCount).toBe(2)
    expect(
      store
        .listBooks({ tagIds: [fantasy.id] })
        .map((book) => book.id)
        .sort()
    ).toEqual([first.id, second.id].sort())
    expect(store.listBooks({ tagIds: [fantasy.id, short.id] }).map((book) => book.id)).toEqual([
      first.id
    ])
    expect(() => store.setBookTags({ bookId: first.id, ids: [otherFantasy.id] })).toThrow(
      'same library'
    )

    store.setBookTags({ bookId: first.id, ids: [] })
    expect(store.getBook(first.id).tagIds).toEqual([])
    expect(store.listTags(primary.id).find((tag) => tag.id === fantasy.id)?.bookCount).toBe(1)

    store.removeTag(fantasy.id)
    expect(store.listTags(primary.id).some((tag) => tag.id === fantasy.id)).toBe(false)
    expect(store.getBook(second.id).tagIds).toEqual([])
  })

  it('assigns collections, filters membership, and prevents cross-library relations', async () => {
    const store = await createStore()
    const secondary = store.createLibrary({ name: 'Secondary' })
    const first = store.createBook({ title: 'Collected Story' })
    const second = store.createBook({ title: 'Uncollected Story' })
    const favourites = store.createCollection({
      name: 'Weekend Reads',
      description: 'Stories for a quiet weekend',
      color: '#b66a3c',
      icon: 'coffee'
    })
    const other = store.createCollection({ libraryId: secondary.id, name: 'Other Shelf' })

    expect(
      store.updateCollection({
        id: favourites.id,
        name: 'Sunday Reads',
        description: 'Stories for a quiet Sunday',
        color: '#a85c32',
        icon: 'sun'
      })
    ).toMatchObject({
      name: 'Sunday Reads',
      description: 'Stories for a quiet Sunday',
      color: '#a85c32',
      icon: 'sun'
    })

    expect(store.setBookCollections({ bookId: first.id, ids: [favourites.id] })).toEqual([
      expect.objectContaining({ id: favourites.id, bookCount: 1 })
    ])
    expect(store.getBook(first.id).collectionIds).toEqual([favourites.id])
    expect(store.getBook(second.id).collectionIds).toEqual([])
    expect(store.listBooks({ collectionId: favourites.id }).map((book) => book.id)).toEqual([
      first.id
    ])
    expect(
      store.listCollections().find((collection) => collection.id === favourites.id)
    ).toMatchObject({
      name: 'Sunday Reads',
      description: 'Stories for a quiet Sunday',
      color: '#a85c32',
      icon: 'sun',
      bookCount: 1
    })
    expect(() => store.setBookCollections({ bookId: first.id, ids: [other.id] })).toThrow(
      'same library'
    )

    store.setBookCollections({ bookId: first.id, ids: [] })
    expect(store.listBooks({ collectionId: favourites.id })).toEqual([])
    store.removeCollection(favourites.id)
    expect(store.listCollections().some((collection) => collection.id === favourites.id)).toBe(
      false
    )
  })

  it('round-trips saved filter definitions and updates without losing library scope', async () => {
    const store = await createStore()
    const primary = store.listLibraries()[0]
    const tag = store.createTag({ name: 'To revise' })
    const collection = store.createCollection({ name: 'Drafts' })
    const saved = store.createSavedFilter({
      name: 'Pinned revisions',
      query: {
        search: 'harbour',
        filter: 'in-progress',
        sort: 'recently-updated',
        favouriteOnly: true,
        pinnedOnly: true,
        tagIds: [tag.id],
        collectionId: collection.id,
        includeArchived: true,
        limit: 25,
        offset: 5
      }
    })

    expect(saved).toMatchObject({
      libraryId: primary.id,
      name: 'Pinned revisions',
      position: 0,
      query: {
        search: 'harbour',
        filter: 'in-progress',
        sort: 'recently-updated',
        favouriteOnly: true,
        pinnedOnly: true,
        tagIds: [tag.id],
        collectionId: collection.id,
        includeArchived: true,
        limit: 25,
        offset: 5
      }
    })

    const updated = store.updateSavedFilter({
      id: saved.id,
      name: 'Favourite drafts',
      query: { filter: 'ongoing', sort: 'title', favouriteOnly: true }
    })
    expect(updated).toMatchObject({
      id: saved.id,
      libraryId: primary.id,
      name: 'Favourite drafts',
      position: 0,
      query: { filter: 'ongoing', sort: 'title', favouriteOnly: true }
    })
    expect(store.listSavedFilters()).toEqual([updated])

    store.removeSavedFilter(saved.id)
    expect(store.listSavedFilters()).toEqual([])
  })

  it('refuses unsafe library deletion while preserving every conflicted library', async () => {
    const store = await createStore()
    const primary = store.listLibraries()[0]
    const occupied = store.createLibrary({ name: 'Occupied' })
    const empty = store.createLibrary({ name: 'Empty' })
    store.createBook({ libraryId: occupied.id, title: 'Do Not Lose Me' })

    expectConflict(() => store.removeLibrary(primary.id), 'Switch to another library')
    expect(store.listLibraries().some((library) => library.id === primary.id)).toBe(true)

    store.setActiveLibrary(empty.id)
    expectConflict(() => store.removeLibrary(occupied.id), 'books before removing')
    expect(store.listLibraries().find((library) => library.id === occupied.id)).toMatchObject({
      bookCount: 1
    })
    expect(store.listBooks({ libraryId: occupied.id }).map((book) => book.title)).toEqual([
      'Do Not Lose Me'
    ])

    store.removeLibrary(primary.id)
    expect(store.listLibraries().some((library) => library.id === primary.id)).toBe(false)
    expect(store.listLibraries().find((library) => library.id === empty.id)?.isActive).toBe(true)
  })
})
