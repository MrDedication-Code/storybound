import {
  BookOpen,
  BookmarkPlus,
  FolderOpen,
  Heart,
  Import,
  LibraryBig,
  ListChecks,
  Pin,
  Plus,
  SearchX,
  Settings2,
  Tag as TagIcon,
  Trash2,
  X
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  BookSummary,
  Collection,
  Library,
  LibraryFilter,
  LibraryQuery,
  LibrarySort,
  SavedFilter,
  Tag
} from '@shared/types'
import { readableError, storyboundApi, unwrap } from '../lib/api'
import { navigate, routes } from '../lib/routing'
import { BookCard } from '../components/BookCard'
import { DirectImportModal, type DirectImportSubmission } from '../components/DirectImportModal'
import { Button, ErrorState, IconButton, LoadingState, Modal } from '../components/ui'

interface LibraryPageProps {
  defaultSort: LibrarySort
  onAddBook: () => void
  notify?: (message: string) => void
}

const FILTERS: Array<{ value: LibraryFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'ongoing', label: 'Ongoing' },
  { value: 'completed', label: 'Completed' },
  { value: 'unread', label: 'Unread' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'finished', label: 'Finished reading' }
]

export function LibraryPage({
  defaultSort,
  onAddBook,
  notify = () => undefined
}: LibraryPageProps): React.JSX.Element {
  const [books, setBooks] = useState<BookSummary[] | null>(null)
  const [continueBooks, setContinueBooks] = useState<BookSummary[]>([])
  const [libraries, setLibraries] = useState<Library[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [collections, setCollections] = useState<Collection[]>([])
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([])
  const [seriesNames, setSeriesNames] = useState<string[]>([])
  const [filter, setFilter] = useState<LibraryFilter>('all')
  const [sort, setSort] = useState<LibrarySort>(defaultSort)
  const [favouriteOnly, setFavouriteOnly] = useState(false)
  const [pinnedOnly, setPinnedOnly] = useState(false)
  const [tagIds, setTagIds] = useState<string[]>([])
  const [collectionId, setCollectionId] = useState<string>()
  const [seriesName, setSeriesName] = useState<string>()
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [batchTagId, setBatchTagId] = useState('')
  const [batchCollectionId, setBatchCollectionId] = useState('')
  const [newLibraryName, setNewLibraryName] = useState('')
  const [newFilterName, setNewFilterName] = useState('')
  const [showNewLibrary, setShowNewLibrary] = useState(false)
  const [showSaveFilter, setShowSaveFilter] = useState(false)
  const [directImportOpen, setDirectImportOpen] = useState(false)
  const [organizerOpen, setOrganizerOpen] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [newCollectionName, setNewCollectionName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)

  const query = useMemo<LibraryQuery>(
    () => ({
      filter,
      sort,
      favouriteOnly: favouriteOnly || undefined,
      pinnedOnly: pinnedOnly || undefined,
      tagIds: tagIds.length > 0 ? tagIds : undefined,
      collectionId,
      seriesName
    }),
    [collectionId, favouriteOnly, filter, pinnedOnly, seriesName, sort, tagIds]
  )

  const loadLibrary = useCallback(async (): Promise<void> => {
    setError('')
    try {
      const [
        nextBooks,
        nextContinue,
        nextAllBooks,
        nextLibraries,
        nextTags,
        nextCollections,
        nextFilters
      ] = await Promise.all([
        storyboundApi().books.list(query),
        storyboundApi().books.list({ sort: 'recently-opened', limit: 5 }),
        storyboundApi().books.list({ sort: 'title', limit: 1000 }),
        storyboundApi().libraries.list(),
        storyboundApi().tags.list(),
        storyboundApi().collections.list(),
        storyboundApi().savedFilters.list()
      ])
      setBooks(unwrap(nextBooks))
      setContinueBooks(unwrap(nextContinue).filter((book) => book.lastOpenedAt))
      setSeriesNames(
        [
          ...new Set(
            unwrap(nextAllBooks)
              .map((book) => book.seriesName)
              .filter(Boolean)
          )
        ].sort((left, right) => left.localeCompare(right))
      )
      setLibraries(unwrap(nextLibraries))
      setTags(unwrap(nextTags))
      setCollections(unwrap(nextCollections))
      setSavedFilters(unwrap(nextFilters))
    } catch (caught) {
      setError(readableError(caught))
    }
  }, [query])

  useEffect(() => {
    void Promise.resolve().then(loadLibrary)
  }, [loadLibrary, reload])

  const refresh = (): void => setReload((value) => value + 1)

  const openEditor = async (book: BookSummary): Promise<void> => {
    setError('')
    try {
      const detail = unwrap(await storyboundApi().books.get(book.id))
      navigate(routes.editor(book.id, detail.chapters[0]?.id))
    } catch (caught) {
      setError(readableError(caught))
    }
  }

  const run = async (operation: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await operation()
      refresh()
    } catch (caught) {
      setError(readableError(caught))
    } finally {
      setBusy(false)
    }
  }

  const switchLibrary = (id: string): void => {
    void run(async () => {
      unwrap(await storyboundApi().libraries.setActive(id))
      setFilter('all')
      setFavouriteOnly(false)
      setPinnedOnly(false)
      setTagIds([])
      setCollectionId(undefined)
      setSeriesName(undefined)
      setSelectedIds([])
    })
  }

  const createLibrary = (): void => {
    const name = newLibraryName.trim()
    if (!name) return
    void run(async () => {
      const created = unwrap(await storyboundApi().libraries.create({ name }))
      unwrap(await storyboundApi().libraries.setActive(created.id))
      setNewLibraryName('')
      setShowNewLibrary(false)
    })
  }

  const saveFilter = (): void => {
    const name = newFilterName.trim()
    if (!name) return
    void run(async () => {
      unwrap(await storyboundApi().savedFilters.create({ name, query }))
      setNewFilterName('')
      setShowSaveFilter(false)
    })
  }

  const applySavedFilter = (saved: SavedFilter): void => {
    setFilter(saved.query.filter ?? 'all')
    setSort(saved.query.sort ?? defaultSort)
    setFavouriteOnly(Boolean(saved.query.favouriteOnly))
    setPinnedOnly(Boolean(saved.query.pinnedOnly))
    setTagIds(saved.query.tagIds ?? [])
    setCollectionId(saved.query.collectionId)
    setSeriesName(saved.query.seriesName)
  }

  const toggleSelected = (id: string): void => {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    )
  }

  const assignRelations = (
    kind: 'tag' | 'collection',
    relationId: string,
    ids = selectedIds
  ): void => {
    if (!relationId || ids.length === 0) return
    void run(async () => {
      await Promise.all(
        ids.map(async (bookId) => {
          const detail = unwrap(await storyboundApi().books.get(bookId))
          if (kind === 'tag') {
            unwrap(
              await storyboundApi().tags.setForBook({
                bookId,
                ids: [...new Set([...detail.tagIds, relationId])]
              })
            )
          } else {
            unwrap(
              await storyboundApi().collections.setForBook({
                bookId,
                ids: [...new Set([...detail.collectionIds, relationId])]
              })
            )
          }
        })
      )
      setSelectedIds([])
    })
  }

  const importDirectText = async (submission: DirectImportSubmission): Promise<void> => {
    const [first, ...remaining] = submission.chapters
    if (!first) throw new Error('Select at least one chapter to import.')
    let createdBookId: string | undefined
    try {
      const created = unwrap(
        await storyboundApi().books.create({
          title: submission.title,
          status: 'ongoing',
          initialChapterTitle: first.title,
          initialChapterContent: first.content
        })
      )
      createdBookId = created.id
      for (const importedChapter of remaining) {
        unwrap(
          await storyboundApi().chapters.create({
            bookId: created.id,
            title: importedChapter.title,
            content: importedChapter.content
          })
        )
      }
      const sourceLabel =
        submission.source.format === 'chat'
          ? 'AI chat import'
          : submission.source.format === 'markdown'
            ? 'Markdown import'
            : 'Text import'
      unwrap(
        await storyboundApi().books.update({
          id: created.id,
          sourceLabel,
          personalNotes: submission.source.fileName
            ? `Imported from ${submission.source.fileName}`
            : ''
        })
      )
      const detail = unwrap(await storyboundApi().books.get(created.id))
      setDirectImportOpen(false)
      notify(
        `Imported “${detail.title}” with ${detail.chapters.length} ${detail.chapters.length === 1 ? 'chapter' : 'chapters'}.`
      )
      navigate(routes.editor(detail.id, detail.chapters[0]?.id))
    } catch (caught) {
      if (createdBookId) {
        try {
          unwrap(await storyboundApi().books.trash(createdBookId))
        } catch {
          // Preserve the original error; the incomplete book remains visible for manual recovery.
        }
      }
      throw new Error(`The text import could not be completed: ${readableError(caught)}`)
    }
  }

  const createTag = (): void => {
    const name = newTagName.trim()
    if (!name) return
    void run(async () => {
      unwrap(await storyboundApi().tags.create({ name, color: 'gold' }))
      setNewTagName('')
      notify(`Created tag “${name}”.`)
    })
  }

  const createCollection = (): void => {
    const name = newCollectionName.trim()
    if (!name) return
    void run(async () => {
      unwrap(await storyboundApi().collections.create({ name }))
      setNewCollectionName('')
      notify(`Created collection “${name}”.`)
    })
  }

  const lastReadId = continueBooks[0]?.id
  const hasCustomFilter =
    filter !== 'all' ||
    favouriteOnly ||
    pinnedOnly ||
    tagIds.length > 0 ||
    collectionId ||
    seriesName

  if (error && !books) {
    return (
      <div className="page">
        <ErrorState message={error} onRetry={refresh} />
      </div>
    )
  }

  return (
    <div className="page page--library">
      <header className="page-heading library-heading">
        <div>
          <p className="eyebrow">Your collection</p>
          <h1>{libraries.find((library) => library.isActive)?.name ?? 'Library'}</h1>
          <p>A quiet home for every story you choose to keep.</p>
        </div>
        <div className="library-heading__actions">
          {books ? (
            <span className="book-count">
              {books.length} {books.length === 1 ? 'book' : 'books'}
            </span>
          ) : null}
          <label className="library-switcher">
            <span>Library</span>
            <select
              aria-label="Active library"
              disabled={busy}
              value={libraries.find((library) => library.isActive)?.id ?? ''}
              onChange={(event) => switchLibrary(event.target.value)}
            >
              {libraries.map((library) => (
                <option key={library.id} value={library.id}>
                  {library.name} ({library.bookCount})
                </option>
              ))}
            </select>
          </label>
          <Button icon={Plus} onClick={() => setShowNewLibrary((value) => !value)}>
            New library
          </Button>
          <Button icon={Import} onClick={() => setDirectImportOpen(true)}>
            Import text
          </Button>
          <Button icon={Settings2} onClick={() => setOrganizerOpen(true)}>
            Organize
          </Button>
        </div>
      </header>

      {showNewLibrary ? (
        <form
          className="library-inline-form"
          onSubmit={(event) => {
            event.preventDefault()
            createLibrary()
          }}
        >
          <label>
            <span>Library name</span>
            <input
              autoFocus
              maxLength={120}
              value={newLibraryName}
              onChange={(event) => setNewLibraryName(event.target.value)}
            />
          </label>
          <Button disabled={busy || !newLibraryName.trim()} type="submit" variant="primary">
            Create and switch
          </Button>
          <IconButton
            icon={X}
            label="Cancel new library"
            onClick={() => setShowNewLibrary(false)}
          />
        </form>
      ) : null}

      {continueBooks.length > 0 ? (
        <section className="continue-shelf" aria-labelledby="continue-shelf-title">
          <div>
            <p className="eyebrow">Pick up where you left off</p>
            <h2 id="continue-shelf-title">Continue reading</h2>
          </div>
          <div className="continue-shelf__books">
            {continueBooks.map((book) => (
              <button key={book.id} onClick={() => navigate(routes.reader(book.id))}>
                <BookOpen aria-hidden="true" size={17} />
                <span>
                  <strong>{book.title}</strong>
                  <small>{Math.round(book.progressPercentage)}% read</small>
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="library-organizer" aria-label="Organize library">
        <div className="library-organizer__row">
          <button
            aria-pressed={favouriteOnly}
            className={favouriteOnly ? 'is-active' : ''}
            onClick={() => setFavouriteOnly((value) => !value)}
          >
            <Heart aria-hidden="true" size={15} /> Favourites
          </button>
          <button
            aria-pressed={pinnedOnly}
            className={pinnedOnly ? 'is-active' : ''}
            onClick={() => setPinnedOnly((value) => !value)}
          >
            <Pin aria-hidden="true" size={15} /> Pinned
          </button>
          {collections.map((collection) => (
            <button
              aria-pressed={collectionId === collection.id}
              className={collectionId === collection.id ? 'is-active' : ''}
              key={collection.id}
              title="Drop selected or dragged books here"
              onClick={() =>
                setCollectionId((current) =>
                  current === collection.id ? undefined : collection.id
                )
              }
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                const bookId = event.dataTransfer.getData('text/storybound-book-id')
                if (bookId) assignRelations('collection', collection.id, [bookId])
              }}
            >
              <FolderOpen aria-hidden="true" size={15} /> {collection.name}
              <small>{collection.bookCount}</small>
            </button>
          ))}
          {tags.map((tag) => (
            <button
              aria-pressed={tagIds.includes(tag.id)}
              className={tagIds.includes(tag.id) ? 'is-active' : ''}
              key={tag.id}
              onClick={() =>
                setTagIds((current) =>
                  current.includes(tag.id)
                    ? current.filter((id) => id !== tag.id)
                    : [...current, tag.id]
                )
              }
            >
              <TagIcon aria-hidden="true" size={14} /> {tag.name}
            </button>
          ))}
          {seriesNames.map((name) => (
            <button
              aria-pressed={seriesName === name}
              className={seriesName === name ? 'is-active' : ''}
              key={name}
              onClick={() => setSeriesName((current) => (current === name ? undefined : name))}
            >
              <BookOpen aria-hidden="true" size={14} /> {name}
            </button>
          ))}
        </div>
        <div className="library-organizer__row library-organizer__row--saved">
          {savedFilters.map((saved) => (
            <button key={saved.id} onClick={() => applySavedFilter(saved)}>
              <BookmarkPlus aria-hidden="true" size={14} /> {saved.name}
            </button>
          ))}
          <Button icon={BookmarkPlus} onClick={() => setShowSaveFilter((value) => !value)}>
            Save this view
          </Button>
          <Button
            icon={ListChecks}
            onClick={() => {
              setSelectionMode((value) => !value)
              setSelectedIds([])
            }}
          >
            {selectionMode ? 'Done selecting' : 'Select books'}
          </Button>
        </div>
      </section>

      {showSaveFilter ? (
        <form
          className="library-inline-form"
          onSubmit={(event) => {
            event.preventDefault()
            saveFilter()
          }}
        >
          <label>
            <span>Saved view name</span>
            <input
              autoFocus
              maxLength={120}
              value={newFilterName}
              onChange={(event) => setNewFilterName(event.target.value)}
            />
          </label>
          <Button disabled={busy || !newFilterName.trim()} type="submit" variant="primary">
            Save view
          </Button>
        </form>
      ) : null}

      {selectionMode && selectedIds.length > 0 ? (
        <div className="batch-actions" role="region" aria-label="Selected book actions">
          <strong>{selectedIds.length} selected</strong>
          <select
            aria-label="Tag to add"
            value={batchTagId}
            onChange={(event) => setBatchTagId(event.target.value)}
          >
            <option value="">Choose tag…</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
          <Button disabled={!batchTagId || busy} onClick={() => assignRelations('tag', batchTagId)}>
            Add tag
          </Button>
          <select
            aria-label="Collection to add"
            value={batchCollectionId}
            onChange={(event) => setBatchCollectionId(event.target.value)}
          >
            <option value="">Choose collection…</option>
            {collections.map((collection) => (
              <option key={collection.id} value={collection.id}>
                {collection.name}
              </option>
            ))}
          </select>
          <Button
            disabled={!batchCollectionId || busy}
            onClick={() => assignRelations('collection', batchCollectionId)}
          >
            Add to collection
          </Button>
        </div>
      ) : null}

      {error ? (
        <div className="inline-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="library-controls">
        <div className="filter-tabs" aria-label="Filter library" role="group">
          {FILTERS.map((item) => (
            <button
              aria-pressed={filter === item.value}
              className={filter === item.value ? 'is-active' : ''}
              key={item.value}
              onClick={() => setFilter(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="sort-control">
          <span>Sort by</span>
          <select
            aria-label="Sort library"
            value={sort}
            onChange={(event) => setSort(event.target.value as LibrarySort)}
          >
            <option value="recently-opened">Recently opened</option>
            <option value="recently-updated">Recently updated</option>
            <option value="title">Title A–Z</option>
            <option value="progress">Reading progress</option>
            <option value="created">Date created</option>
          </select>
        </label>
      </div>

      {!books ? (
        <LoadingState />
      ) : books.length > 0 ? (
        <div className="book-grid">
          {books.map((book) => (
            <div
              draggable
              key={book.id}
              onDragStart={(event) =>
                event.dataTransfer.setData('text/storybound-book-id', book.id)
              }
            >
              <BookCard
                book={book}
                isLastRead={book.id === lastReadId}
                selected={selectedIds.includes(book.id)}
                onEdit={() => void openEditor(book)}
                onFavourite={() =>
                  void run(async () => {
                    unwrap(
                      await storyboundApi().books.update({
                        id: book.id,
                        isFavourite: !book.isFavourite
                      })
                    )
                  })
                }
                onOpen={() => navigate(routes.book(book.id))}
                onPin={() =>
                  void run(async () => {
                    unwrap(
                      await storyboundApi().books.update({ id: book.id, isPinned: !book.isPinned })
                    )
                  })
                }
                onRead={() => navigate(routes.reader(book.id))}
                onSelect={selectionMode ? () => toggleSelected(book.id) : undefined}
              />
            </div>
          ))}
        </div>
      ) : !hasCustomFilter ? (
        <section className="empty-library">
          <div className="empty-library__books" aria-hidden="true">
            <span />
            <span>
              <LibraryBig size={31} />
            </span>
            <span />
          </div>
          <p className="eyebrow">A shelf of your own</p>
          <h2>Turn your AI-generated stories into a personal library.</h2>
          <p>Create a book, paste in a chapter, and return whenever the story continues.</p>
          <Button icon={Plus} onClick={onAddBook} variant="primary">
            Create your first book
          </Button>
        </section>
      ) : (
        <section className="empty-filter">
          <SearchX aria-hidden="true" size={32} />
          <h2>No books match this shelf</h2>
          <p>Choose another filter to see the rest of your library.</p>
          <Button
            icon={BookOpen}
            onClick={() => {
              setFilter('all')
              setFavouriteOnly(false)
              setPinnedOnly(false)
              setTagIds([])
              setCollectionId(undefined)
              setSeriesName(undefined)
            }}
          >
            Show all books
          </Button>
        </section>
      )}
      {directImportOpen ? (
        <DirectImportModal
          onClose={() => setDirectImportOpen(false)}
          onConfirm={importDirectText}
        />
      ) : null}
      {organizerOpen ? (
        <Modal
          description="Create, rename, and remove the shelves that organize the active library."
          onClose={() => setOrganizerOpen(false)}
          size="large"
          title="Manage your library"
        >
          <div className="organizer-manager">
            <section>
              <h3>Libraries</h3>
              <p>Switch away from an empty library before removing it.</p>
              <div className="organizer-manager__list">
                {libraries.map((library) => (
                  <div key={library.id}>
                    <input
                      aria-label={`Library name for ${library.name}`}
                      defaultValue={library.name}
                      maxLength={120}
                      onBlur={(event) => {
                        const name = event.target.value.trim()
                        if (!name || name === library.name) return
                        void run(async () => {
                          unwrap(await storyboundApi().libraries.update({ id: library.id, name }))
                        })
                      }}
                    />
                    <span>{library.bookCount} books</span>
                    {library.isActive ? <em>Active</em> : null}
                    <IconButton
                      disabled={busy || library.isActive || library.bookCount > 0}
                      icon={Trash2}
                      label={`Remove ${library.name}`}
                      onClick={() =>
                        void run(async () => {
                          unwrap(await storyboundApi().libraries.remove(library.id))
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            </section>
            <section>
              <h3>Tags</h3>
              <form
                className="organizer-manager__create"
                onSubmit={(event) => {
                  event.preventDefault()
                  createTag()
                }}
              >
                <input
                  aria-label="New tag name"
                  maxLength={120}
                  placeholder="New tag"
                  value={newTagName}
                  onChange={(event) => setNewTagName(event.target.value)}
                />
                <Button disabled={busy || !newTagName.trim()} type="submit">
                  Add tag
                </Button>
              </form>
              <div className="organizer-manager__list">
                {tags.map((tag) => (
                  <div key={tag.id}>
                    <TagIcon aria-hidden="true" size={15} />
                    <input
                      aria-label={`Tag name for ${tag.name}`}
                      defaultValue={tag.name}
                      maxLength={120}
                      onBlur={(event) => {
                        const name = event.target.value.trim()
                        if (!name || name === tag.name) return
                        void run(async () => {
                          unwrap(await storyboundApi().tags.update({ id: tag.id, name }))
                        })
                      }}
                    />
                    <span>{tag.bookCount} books</span>
                    <IconButton
                      disabled={busy}
                      icon={Trash2}
                      label={`Remove ${tag.name}`}
                      onClick={() =>
                        void run(async () => {
                          unwrap(await storyboundApi().tags.remove(tag.id))
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            </section>
            <section>
              <h3>Collections</h3>
              <form
                className="organizer-manager__create"
                onSubmit={(event) => {
                  event.preventDefault()
                  createCollection()
                }}
              >
                <input
                  aria-label="New collection name"
                  maxLength={120}
                  placeholder="New collection"
                  value={newCollectionName}
                  onChange={(event) => setNewCollectionName(event.target.value)}
                />
                <Button disabled={busy || !newCollectionName.trim()} type="submit">
                  Add collection
                </Button>
              </form>
              <div className="organizer-manager__list">
                {collections.map((collection) => (
                  <div key={collection.id}>
                    <FolderOpen aria-hidden="true" size={15} />
                    <input
                      aria-label={`Collection name for ${collection.name}`}
                      defaultValue={collection.name}
                      maxLength={120}
                      onBlur={(event) => {
                        const name = event.target.value.trim()
                        if (!name || name === collection.name) return
                        void run(async () => {
                          unwrap(
                            await storyboundApi().collections.update({
                              id: collection.id,
                              name
                            })
                          )
                        })
                      }}
                    />
                    <span>{collection.bookCount} books</span>
                    <IconButton
                      disabled={busy}
                      icon={Trash2}
                      label={`Remove ${collection.name}`}
                      onClick={() =>
                        void run(async () => {
                          unwrap(await storyboundApi().collections.remove(collection.id))
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            </section>
            {savedFilters.length ? (
              <section>
                <h3>Saved views</h3>
                <div className="organizer-manager__list">
                  {savedFilters.map((saved) => (
                    <div key={saved.id}>
                      <BookmarkPlus aria-hidden="true" size={15} />
                      <strong>{saved.name}</strong>
                      <span />
                      <IconButton
                        disabled={busy}
                        icon={Trash2}
                        label={`Remove ${saved.name}`}
                        onClick={() =>
                          void run(async () => {
                            unwrap(await storyboundApi().savedFilters.remove(saved.id))
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
          <div className="modal__actions">
            <Button onClick={() => setOrganizerOpen(false)}>Done</Button>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
