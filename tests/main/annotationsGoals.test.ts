import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { StoryboundStore } from '../../src/main/store'

const temporaryDirectories: string[] = []
const openStores: StoryboundStore[] = []

async function createStore(): Promise<StoryboundStore> {
  const directory = mkdtempSync(join(tmpdir(), 'storybound-annotations-goals-'))
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

describe('rich annotations and bookmarks', () => {
  it('persists contextual anchors, validates chapter ownership, and uses row versions', async () => {
    const store = await createStore()
    const book = store.createBook({ title: 'Margin Notes' })
    const chapter = store.createChapter({
      bookId: book.id,
      title: 'One',
      content: 'Before the marked phrase comes after.'
    })
    const otherBook = store.createBook({ title: 'Other' })

    expect(() =>
      store.createAnnotation({
        bookId: otherBook.id,
        chapterId: chapter.id,
        kind: 'highlight',
        anchor: { startOffset: 11, endOffset: 24, fallbackLocation: 0.4 }
      })
    ).toThrow('does not belong')

    const annotation = store.createAnnotation({
      bookId: book.id,
      chapterId: chapter.id,
      kind: 'highlight',
      body: 'Keep this.',
      color: 'amber',
      anchor: { startOffset: 11, endOffset: 24, fallbackLocation: 0.4 }
    })
    expect(annotation).toMatchObject({
      chapterId: chapter.id,
      chapterTitle: 'One',
      rowVersion: 1,
      anchor: {
        startOffset: 11,
        endOffset: 24,
        quote: 'marked phrase',
        resolutionStatus: 'resolved',
        rowVersion: 1
      }
    })
    expect(annotation.anchor.prefix).toContain('Before the ')
    expect(annotation.anchor.suffix).toContain(' comes after.')

    const updated = store.updateAnnotation({
      id: annotation.id,
      expectedRowVersion: annotation.rowVersion,
      kind: 'note',
      body: 'Expanded note.'
    })
    expect(updated).toMatchObject({ kind: 'note', body: 'Expanded note.', rowVersion: 2 })
    expect(() =>
      store.updateAnnotation({
        id: annotation.id,
        expectedRowVersion: 1,
        body: 'Stale overwrite'
      })
    ).toThrow('changed elsewhere')

    store.removeAnnotation({ id: annotation.id, expectedRowVersion: updated.rowVersion })
    expect(store.listAnnotations(book.id)).toEqual([])
  })

  it('creates bookmark anchors and supports label, color, update, and soft-delete behavior', async () => {
    const store = await createStore()
    const book = store.createBook({ title: 'Bookmarks' })
    const chapter = store.createChapter({
      bookId: book.id,
      title: 'A Place',
      content: 'A line worth revisiting.'
    })
    const bookmark = store.createBookmark({
      bookId: book.id,
      chapterId: chapter.id,
      location: 0.25,
      note: 'Original',
      label: 'Clue',
      color: 'blue',
      anchor: { startOffset: 2, endOffset: 6, fallbackLocation: 0.25 }
    })
    expect(bookmark).toMatchObject({
      label: 'Clue',
      color: 'blue',
      rowVersion: 1,
      anchor: { quote: 'line', fallbackLocation: 0.25 }
    })
    const updated = store.updateBookmark({
      id: bookmark.id,
      expectedRowVersion: bookmark.rowVersion,
      note: 'Updated',
      label: 'Foreshadowing'
    })
    expect(updated).toMatchObject({ note: 'Updated', label: 'Foreshadowing', rowVersion: 2 })
    store.removeBookmark(bookmark.id)
    expect(store.listBookmarks(book.id)).toEqual([])
  })
})

describe('writing goals and statistics', () => {
  it('records token-level writing deltas and reports goal progress by day and book', async () => {
    const store = await createStore()
    const library = store.listLibraries().find((item) => item.isActive)!
    const book = store.createBook({ title: 'Daily Draft' })
    const chapter = store.createChapter({
      bookId: book.id,
      title: 'Draft',
      content: 'alpha beta'
    })
    const today = new Date().toISOString().slice(0, 10)
    const goal = store.createWritingGoal({
      metric: 'words',
      period: 'daily',
      targetValue: 5,
      startOn: today,
      timezone: 'UTC'
    })
    expect(goal).toMatchObject({ libraryId: library.id, rowVersion: 1, isActive: true })

    store.updateChapter({
      id: chapter.id,
      content: 'alpha gamma delta',
      writingTimezone: 'UTC'
    })
    const stats = store.getWritingStats({ from: today, to: today })
    expect(stats).toMatchObject({
      totalWordsAdded: 2,
      totalWordsRemoved: 1,
      netWords: 1
    })
    expect(stats.days).toEqual([
      expect.objectContaining({ date: today, wordsAdded: 2, wordsRemoved: 1, netWords: 1 })
    ])
    expect(stats.books).toEqual([
      expect.objectContaining({ bookId: book.id, wordsAdded: 2, wordsRemoved: 1 })
    ])
    expect(stats.activeGoals).toEqual([
      expect.objectContaining({ achievedValue: 2, remainingValue: 3, progressPercentage: 40 })
    ])

    const updated = store.updateWritingGoal({
      id: goal.id,
      expectedRowVersion: goal.rowVersion,
      targetValue: 10
    })
    expect(updated).toMatchObject({ targetValue: 10, rowVersion: 2 })
    expect(() =>
      store.updateWritingGoal({ id: goal.id, expectedRowVersion: 1, targetValue: 12 })
    ).toThrow('changed elsewhere')
    store.removeWritingGoal({ id: goal.id, expectedRowVersion: updated.rowVersion })
    expect(store.listWritingGoals()).toEqual([])
  })

  it('isolates annotations, goals, and statistics to the active library', async () => {
    const store = await createStore()
    const firstBook = store.createBook({ title: 'First Library Book' })
    const chapter = store.createChapter({ bookId: firstBook.id, title: 'One', content: 'text' })
    store.createAnnotation({
      bookId: firstBook.id,
      chapterId: chapter.id,
      kind: 'note',
      anchor: { fallbackLocation: 0 }
    })
    store.createWritingGoal({
      metric: 'words',
      period: 'project',
      targetValue: 100,
      startOn: '2026-01-01',
      timezone: 'UTC'
    })
    const second = store.createLibrary({ name: 'Second Library' })
    store.setActiveLibrary(second.id)

    expect(() => store.listAnnotations(firstBook.id)).toThrow('active library')
    expect(store.listWritingGoals()).toEqual([])
    expect(() =>
      store.getWritingStats({ from: '2026-01-01', to: '2026-12-31', bookId: firstBook.id })
    ).toThrow('active library')
  })
})
