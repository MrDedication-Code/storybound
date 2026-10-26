import {
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BookOpen,
  Bookmark,
  CalendarDays,
  Check,
  Copy,
  Download,
  Edit3,
  Heart,
  ImagePlus,
  MapPinned,
  MoreHorizontal,
  PencilLine,
  Palette,
  Plus,
  RotateCcw,
  Star,
  Trash2,
  Users,
  X
} from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type {
  Bookmark as BookmarkType,
  BookDetail,
  ChapterTrashItem,
  ChapterSummary,
  Collection,
  CoverStyle,
  ReadingState,
  StoryEntity,
  StoryEntityRelation,
  StoryEntityType,
  StandardBookExportFormat,
  Tag,
  UpdateBookInput
} from '@shared/types'
import { readableError, storyboundApi, unwrap } from '../lib/api'
import { onContentChanged } from '../lib/events'
import { formatDate, formatNumber } from '../lib/format'
import { navigate, routes } from '../lib/routing'
import { BookCover } from '../components/BookCover'
import {
  Button,
  ConfirmDialog,
  ErrorState,
  IconButton,
  InlineNotice,
  LoadingState,
  Modal
} from '../components/ui'

interface BookPageProps {
  bookId: string
  notify: (message: string) => void
}

interface StoryEntityForm {
  id?: string
  entityType: StoryEntityType
  title: string
  summary: string
  bodyMarkdown: string
  date: string
  order: string
  chapterId: string
  chapterNote: string
}

interface CoverStudioDraft {
  style: CoverStyle
  x: number
  y: number
}

const EMPTY_STORY_ENTITY: StoryEntityForm = {
  entityType: 'character',
  title: '',
  summary: '',
  bodyMarkdown: '',
  date: '',
  order: '',
  chapterId: '',
  chapterNote: ''
}

export function BookPage({ bookId, notify }: BookPageProps): React.JSX.Element {
  const [book, setBook] = useState<BookDetail | null>(null)
  const [reading, setReading] = useState<ReadingState | null>(null)
  const [bookmarks, setBookmarks] = useState<BookmarkType[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [collections, setCollections] = useState<Collection[]>([])
  const [chapterTrash, setChapterTrash] = useState<ChapterTrashItem[]>([])
  const [storyEntities, setStoryEntities] = useState<StoryEntity[]>([])
  const [storyRelations, setStoryRelations] = useState<StoryEntityRelation[]>([])
  const [storyEntityType, setStoryEntityType] = useState<StoryEntityType | 'all'>('all')
  const [storyEntityForm, setStoryEntityForm] = useState<StoryEntityForm | null>(null)
  const [relationFrom, setRelationFrom] = useState('')
  const [relationTo, setRelationTo] = useState('')
  const [relationType, setRelationType] = useState('connected to')
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [confirm, setConfirm] = useState<{
    kind: 'book' | 'chapter' | 'chapterPermanent'
    chapter?: ChapterSummary
  } | null>(null)
  const [rename, setRename] = useState<ChapterSummary | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [metadata, setMetadata] = useState<UpdateBookInput | null>(null)
  const [metadataTagIds, setMetadataTagIds] = useState<string[]>([])
  const [metadataCollectionIds, setMetadataCollectionIds] = useState<string[]>([])
  const [exportOpen, setExportOpen] = useState(false)
  const [coverStudio, setCoverStudio] = useState<CoverStudioDraft | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setError('')
    try {
      const [
        bookResult,
        readingResult,
        bookmarkResult,
        tagResult,
        collectionResult,
        trashResult,
        entityResult,
        relationResult
      ] = await Promise.all([
        storyboundApi().books.get(bookId),
        storyboundApi().reading.get(bookId),
        storyboundApi().bookmarks.list(bookId),
        storyboundApi().tags.list(),
        storyboundApi().collections.list(),
        storyboundApi().chapters.listTrash(bookId),
        storyboundApi().storyBible.entities.list({ bookId }),
        storyboundApi().storyBible.relations.list({ bookId })
      ])
      const detail = unwrap(bookResult)
      setBook(detail)
      setReading(unwrap(readingResult))
      setBookmarks(unwrap(bookmarkResult))
      setTags(unwrap(tagResult))
      setCollections(unwrap(collectionResult))
      setChapterTrash(unwrap(trashResult))
      setStoryEntities(unwrap(entityResult))
      setStoryRelations(unwrap(relationResult))
    } catch (caught) {
      setError(readableError(caught))
    }
  }, [bookId])

  useEffect(() => {
    void Promise.resolve().then(load)
  }, [load, reload])

  useEffect(
    () =>
      onContentChanged((detail) => {
        if (detail.bookId === bookId) setReload((value) => value + 1)
      }),
    [bookId]
  )

  const updateStatus = async (): Promise<void> => {
    if (!book) return
    try {
      const updated = unwrap(
        await storyboundApi().books.update({
          id: book.id,
          status: book.status === 'ongoing' ? 'completed' : 'ongoing'
        })
      )
      setBook(updated)
      notify(`Marked “${book.title}” as ${updated.status}.`)
    } catch (caught) {
      setError(readableError(caught))
    }
  }

  const chooseCover = async (): Promise<void> => {
    if (!book) return
    try {
      const updated = unwrap(await storyboundApi().books.chooseCover(book.id))
      if (updated) {
        setBook(updated)
        notify('Cover updated.')
      }
    } catch (caught) {
      setError(readableError(caught))
    }
  }

  const removeCover = async (): Promise<void> => {
    if (!book) return
    try {
      setBook(unwrap(await storyboundApi().books.removeCover(book.id)))
      notify('Generated cover restored.')
    } catch (caught) {
      setError(readableError(caught))
    }
  }

  const saveCoverStudio = async (): Promise<void> => {
    if (!book || !coverStudio) return
    setBusy(true)
    try {
      const updated = unwrap(
        await storyboundApi().books.update({
          id: book.id,
          coverStyle: coverStudio.style,
          coverPositionX: coverStudio.x,
          coverPositionY: coverStudio.y
        })
      )
      setBook(updated)
      setCoverStudio(null)
      notify(updated.coverImageUrl ? 'Cover crop saved.' : 'Generated cover style saved.')
    } catch (caught) {
      setError(readableError(caught))
    } finally {
      setBusy(false)
    }
  }

  const reorder = async (index: number, direction: -1 | 1): Promise<void> => {
    if (!book) return
    const target = index + direction
    if (target < 0 || target >= book.chapters.length) return
    const ids = book.chapters.map((chapter) => chapter.id)
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    try {
      const chapters = unwrap(await storyboundApi().chapters.reorder({ bookId, chapterIds: ids }))
      setBook({ ...book, chapters })
      notify('Chapter order saved.')
    } catch (caught) {
      setError(readableError(caught))
    }
  }

  const duplicateChapter = async (chapter: ChapterSummary): Promise<void> => {
    try {
      const copy = unwrap(await storyboundApi().chapters.duplicate(chapter.id))
      notify(`Duplicated “${chapter.title}”.`)
      navigate(routes.editor(bookId, copy.id))
    } catch (caught) {
      setError(readableError(caught))
    }
  }

  const renameChapter = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!rename || !renameValue.trim()) return
    setBusy(true)
    try {
      await storyboundApi()
        .chapters.update({ id: rename.id, title: renameValue.trim() })
        .then(unwrap)
      setRename(null)
      setBusy(false)
      await load()
      notify('Chapter renamed.')
    } catch (caught) {
      setBusy(false)
      setError(readableError(caught))
    }
  }

  const openMetadata = (): void => {
    if (!book) return
    setMetadata({
      id: book.id,
      title: book.title,
      subtitle: book.subtitle,
      seriesName: book.seriesName,
      seriesPosition: book.seriesPosition,
      authorName: book.authorName,
      blurb: book.blurb,
      languageCode: book.languageCode,
      sourceLabel: book.sourceLabel,
      sourceUrl: book.sourceUrl,
      personalNotes: book.personalNotes,
      rating: book.rating
    })
    setMetadataTagIds(book.tagIds)
    setMetadataCollectionIds(book.collectionIds)
  }

  const saveMetadata = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!metadata) return
    setBusy(true)
    setError('')
    try {
      const [updated] = await Promise.all([
        storyboundApi().books.update(metadata),
        storyboundApi().tags.setForBook({ bookId, ids: metadataTagIds }),
        storyboundApi().collections.setForBook({ bookId, ids: metadataCollectionIds })
      ])
      setBook(unwrap(updated))
      setMetadata(null)
      await load()
      notify('Book details saved.')
    } catch (caught) {
      setError(readableError(caught))
    } finally {
      setBusy(false)
    }
  }

  const editStoryEntity = (entity: StoryEntity): void => {
    setStoryEntityForm({
      id: entity.id,
      entityType: entity.entityType,
      title: entity.title,
      summary: entity.summary,
      bodyMarkdown: entity.bodyMarkdown,
      date: typeof entity.details.date === 'string' ? entity.details.date : '',
      order: typeof entity.details.order === 'number' ? String(entity.details.order) : '',
      chapterId: '',
      chapterNote: ''
    })
  }

  const saveStoryEntity = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!storyEntityForm?.title.trim()) return
    setBusy(true)
    setError('')
    try {
      const details = {
        ...(storyEntityForm.date ? { date: storyEntityForm.date } : {}),
        ...(storyEntityForm.order ? { order: Number(storyEntityForm.order) } : {})
      }
      const entity = storyEntityForm.id
        ? unwrap(
            await storyboundApi().storyBible.entities.update({
              id: storyEntityForm.id,
              entityType: storyEntityForm.entityType,
              title: storyEntityForm.title,
              summary: storyEntityForm.summary,
              bodyMarkdown: storyEntityForm.bodyMarkdown,
              details
            })
          )
        : unwrap(
            await storyboundApi().storyBible.entities.create({
              bookId,
              entityType: storyEntityForm.entityType,
              title: storyEntityForm.title,
              summary: storyEntityForm.summary,
              bodyMarkdown: storyEntityForm.bodyMarkdown,
              details
            })
          )
      if (storyEntityForm.chapterId) {
        unwrap(
          await storyboundApi().storyBible.chapterLinks.create({
            entityId: entity.id,
            chapterId: storyEntityForm.chapterId,
            note: storyEntityForm.chapterNote
          })
        )
      }
      setStoryEntityForm(null)
      await load()
      notify(`${entity.entityType === 'event' ? 'Timeline event' : 'Story-bible entry'} saved.`)
    } catch (caught) {
      setError(readableError(caught))
    } finally {
      setBusy(false)
    }
  }

  const removeStoryEntity = async (entity: StoryEntity): Promise<void> => {
    setBusy(true)
    try {
      unwrap(await storyboundApi().storyBible.entities.remove(entity.id))
      await load()
      notify(`Removed “${entity.title}” from the story bible.`)
    } catch (caught) {
      setError(readableError(caught))
    } finally {
      setBusy(false)
    }
  }

  const createStoryRelation = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!relationFrom || !relationTo || relationFrom === relationTo || !relationType.trim()) return
    setBusy(true)
    try {
      unwrap(
        await storyboundApi().storyBible.relations.create({
          fromEntityId: relationFrom,
          toEntityId: relationTo,
          relationshipType: relationType.trim()
        })
      )
      setRelationFrom('')
      setRelationTo('')
      await load()
      notify('Story relationship saved.')
    } catch (caught) {
      setError(readableError(caught))
    } finally {
      setBusy(false)
    }
  }

  const restoreTrashedChapter = async (chapter: ChapterTrashItem): Promise<void> => {
    setBusy(true)
    try {
      unwrap(await storyboundApi().chapters.restore(chapter.id))
      await load()
      notify(`Restored “${chapter.title}”.`)
    } catch (caught) {
      setError(readableError(caught))
    } finally {
      setBusy(false)
    }
  }

  const executeDelete = async (): Promise<void> => {
    if (!confirm || !book) return
    setBusy(true)
    try {
      if (confirm.kind === 'book') {
        unwrap(await storyboundApi().books.trash(book.id))
        notify(`“${book.title}” moved to Trash.`)
        navigate(routes.library())
      } else if (confirm.kind === 'chapterPermanent' && confirm.chapter) {
        unwrap(await storyboundApi().chapters.removePermanently(confirm.chapter.id))
        setConfirm(null)
        setBusy(false)
        notify(`Permanently deleted “${confirm.chapter.title}”.`)
        await load()
      } else if (confirm.chapter) {
        unwrap(await storyboundApi().chapters.remove(confirm.chapter.id))
        setConfirm(null)
        setBusy(false)
        notify(`“${confirm.chapter.title}” moved to chapter trash.`)
        await load()
      }
    } catch (caught) {
      setBusy(false)
      setConfirm(null)
      setError(readableError(caught))
    }
  }

  const exportBook = async (): Promise<void> => {
    if (!book) return
    setBusy(true)
    try {
      const result = unwrap(await storyboundApi().data.exportBook(book.id))
      notify(result.message)
      if (!result.canceled) setExportOpen(false)
    } catch (caught) {
      setError(readableError(caught))
    } finally {
      setBusy(false)
    }
  }

  const exportCompanion = async (): Promise<void> => {
    if (!book) return
    setBusy(true)
    try {
      const result = unwrap(await storyboundApi().data.exportCompanion(book.id))
      notify(result.message)
      if (!result.canceled) setExportOpen(false)
    } catch (caught) {
      setError(readableError(caught))
    } finally {
      setBusy(false)
    }
  }

  const exportStandard = async (format: StandardBookExportFormat): Promise<void> => {
    if (!book) return
    setBusy(true)
    try {
      const result = unwrap(await storyboundApi().data.exportStandard({ bookId: book.id, format }))
      notify(result.message)
      if (!result.canceled) setExportOpen(false)
    } catch (caught) {
      setError(readableError(caught))
    } finally {
      setBusy(false)
    }
  }

  if (error && !book)
    return (
      <div className="page">
        <ErrorState message={error} onRetry={() => setReload((value) => value + 1)} />
      </div>
    )
  if (!book)
    return (
      <div className="page">
        <LoadingState label="Opening book…" />
      </div>
    )

  const firstChapter = book.chapters[0]
  const continueChapterId = reading?.chapterId ?? firstChapter?.id
  const visibleStoryEntities = storyEntities.filter(
    (entity) => storyEntityType === 'all' || entity.entityType === storyEntityType
  )
  const storyEntityNames = new Map(storyEntities.map((entity) => [entity.id, entity.title]))

  return (
    <div className="page page--book">
      <button className="back-link" onClick={() => navigate(routes.library())}>
        <ArrowLeft size={17} />
        Library
      </button>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      <section className="book-hero">
        <div className="book-hero__cover">
          <BookCover
            bookId={book.id}
            coverImageUrl={book.coverImageUrl}
            coverPositionX={book.coverPositionX}
            coverPositionY={book.coverPositionY}
            coverStyle={book.coverStyle}
            size="hero"
            title={book.title}
          />
          <div className="cover-actions">
            <Button icon={ImagePlus} onClick={() => void chooseCover()}>
              {book.coverImageUrl ? 'Replace cover' : 'Choose cover'}
            </Button>
            <Button
              icon={Palette}
              onClick={() =>
                setCoverStudio({
                  style: book.coverStyle,
                  x: book.coverPositionX,
                  y: book.coverPositionY
                })
              }
            >
              Cover studio
            </Button>
            {book.coverImageUrl ? (
              <IconButton icon={X} label="Remove custom cover" onClick={() => void removeCover()} />
            ) : null}
          </div>
        </div>
        <div className="book-hero__copy">
          <span className={`status-pill status-pill--${book.status}`}>
            {book.status === 'completed' ? <Check size={14} /> : <MoreHorizontal size={14} />}
            {book.status === 'completed' ? 'Completed' : 'Ongoing'}
          </span>
          <h1>{book.title}</h1>
          {book.subtitle ? <p className="book-subtitle">{book.subtitle}</p> : null}
          {book.seriesName ? (
            <p className="book-series">
              {book.seriesName}
              {book.seriesPosition ? ` · Book ${book.seriesPosition}` : ''}
            </p>
          ) : null}
          {book.authorName ? <p className="book-byline">by {book.authorName}</p> : null}
          <p className="book-blurb">
            {book.blurb ||
              'No blurb yet. Add one in the book editor when the story reveals itself.'}
          </p>
          <dl className="book-stats">
            <div>
              <dt>Chapters</dt>
              <dd>{book.chapterCount}</dd>
            </div>
            <div>
              <dt>Words</dt>
              <dd>{formatNumber(book.totalWordCount)}</dd>
            </div>
            <div>
              <dt>Reading</dt>
              <dd>{Math.round(book.progressPercentage)}%</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{formatDate(book.updatedAt)}</dd>
            </div>
            <div>
              <dt>Last read</dt>
              <dd>{formatDate(book.lastOpenedAt)}</dd>
            </div>
          </dl>
          <div className="hero-actions">
            <Button
              disabled={!continueChapterId}
              icon={BookOpen}
              variant="primary"
              onClick={() => navigate(routes.reader(book.id, continueChapterId))}
            >
              Continue reading
            </Button>
            <Button
              disabled={!firstChapter}
              onClick={() => navigate(routes.reader(book.id, firstChapter?.id, 0))}
            >
              Read from beginning
            </Button>
            <Button icon={Edit3} onClick={() => navigate(routes.editor(book.id, firstChapter?.id))}>
              Edit book
            </Button>
          </div>
          <div className="hero-secondary-actions">
            <button onClick={openMetadata}>
              <PencilLine size={15} />
              Edit details
            </button>
            <button
              aria-pressed={book.isFavourite}
              onClick={async () => {
                try {
                  setBook(
                    unwrap(
                      await storyboundApi().books.update({
                        id: book.id,
                        isFavourite: !book.isFavourite
                      })
                    )
                  )
                } catch (caught) {
                  setError(readableError(caught))
                }
              }}
            >
              <Heart size={15} />
              {book.isFavourite ? 'Remove favourite' : 'Add to favourites'}
            </button>
            <button onClick={() => void updateStatus()}>
              {book.status === 'ongoing' ? 'Mark completed' : 'Mark ongoing'}
            </button>
            <button onClick={() => setExportOpen(true)}>
              <Download size={15} />
              Export book
            </button>
            <button className="text-danger" onClick={() => setConfirm({ kind: 'book' })}>
              <Archive size={15} />
              Move to Trash
            </button>
          </div>
        </div>
      </section>

      {book.sourceLabel ||
      book.sourceUrl ||
      book.languageCode ||
      book.rating ||
      book.personalNotes ? (
        <section className="book-metadata" aria-label="Book details">
          {book.rating ? (
            <span>
              <Star aria-hidden="true" size={14} /> {book.rating}/5
            </span>
          ) : null}
          {book.languageCode ? <span>Language: {book.languageCode}</span> : null}
          {book.sourceUrl ? (
            <span>Source saved: {book.sourceLabel || 'Original conversation'}</span>
          ) : book.sourceLabel ? (
            <span>Source: {book.sourceLabel}</span>
          ) : null}
          {book.personalNotes ? <p>{book.personalNotes}</p> : null}
        </section>
      ) : null}

      <section className="content-section story-bible" aria-labelledby="story-bible-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Reference and continuity</p>
            <h2 id="story-bible-heading">Story bible & timeline</h2>
          </div>
          <Button icon={Plus} onClick={() => setStoryEntityForm({ ...EMPTY_STORY_ENTITY })}>
            Add entry
          </Button>
        </div>
        <div className="story-bible__filters" aria-label="Filter story-bible entries" role="group">
          {(
            [
              ['all', 'All'],
              ['character', 'Characters'],
              ['location', 'Locations'],
              ['lore', 'Lore'],
              ['event', 'Timeline'],
              ['custom', 'Other']
            ] as const
          ).map(([value, label]) => (
            <button
              aria-pressed={storyEntityType === value}
              className={storyEntityType === value ? 'is-active' : ''}
              key={value}
              onClick={() => setStoryEntityType(value)}
            >
              {value === 'character' ? <Users aria-hidden="true" size={14} /> : null}
              {value === 'location' ? <MapPinned aria-hidden="true" size={14} /> : null}
              {value === 'event' ? <CalendarDays aria-hidden="true" size={14} /> : null}
              {label}
            </button>
          ))}
        </div>
        {visibleStoryEntities.length ? (
          <div className="story-bible__grid">
            {visibleStoryEntities.map((entity) => (
              <article key={entity.id}>
                <span>
                  {entity.entityType === 'event'
                    ? entity.details.date || 'Undated event'
                    : entity.entityType}
                </span>
                <h3>{entity.title}</h3>
                <p>{entity.summary || 'No summary yet.'}</p>
                <div>
                  <button onClick={() => editStoryEntity(entity)}>Edit</button>
                  <button
                    className="text-danger"
                    disabled={busy}
                    onClick={() => void removeStoryEntity(entity)}
                  >
                    Remove
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-section compact">
            <Users aria-hidden="true" size={27} />
            <h3>
              {storyEntityType === 'event' ? 'No timeline events yet' : 'Your story bible is ready'}
            </h3>
            <p>Keep characters, places, lore, and ordered events beside the manuscript.</p>
          </div>
        )}
        {storyEntities.length >= 2 ? (
          <div className="story-relations">
            <h3>Relationships</h3>
            {storyRelations.length ? (
              <ul>
                {storyRelations.map((relation) => (
                  <li key={relation.id}>
                    <strong>{storyEntityNames.get(relation.fromEntityId)}</strong>
                    <span>{relation.relationshipType}</span>
                    <strong>{storyEntityNames.get(relation.toEntityId)}</strong>
                    <IconButton
                      icon={X}
                      label="Remove story relationship"
                      onClick={async () => {
                        try {
                          unwrap(await storyboundApi().storyBible.relations.remove(relation.id))
                          await load()
                        } catch (caught) {
                          setError(readableError(caught))
                        }
                      }}
                    />
                  </li>
                ))}
              </ul>
            ) : null}
            <form onSubmit={(event) => void createStoryRelation(event)}>
              <select
                aria-label="Relationship source"
                required
                value={relationFrom}
                onChange={(event) => setRelationFrom(event.target.value)}
              >
                <option value="">From…</option>
                {storyEntities.map((entity) => (
                  <option key={entity.id} value={entity.id}>
                    {entity.title}
                  </option>
                ))}
              </select>
              <input
                aria-label="Relationship type"
                maxLength={120}
                value={relationType}
                onChange={(event) => setRelationType(event.target.value)}
              />
              <select
                aria-label="Relationship target"
                required
                value={relationTo}
                onChange={(event) => setRelationTo(event.target.value)}
              >
                <option value="">To…</option>
                {storyEntities.map((entity) => (
                  <option key={entity.id} value={entity.id}>
                    {entity.title}
                  </option>
                ))}
              </select>
              <Button
                disabled={busy || !relationFrom || !relationTo || relationFrom === relationTo}
                type="submit"
              >
                Add relationship
              </Button>
            </form>
          </div>
        ) : null}
      </section>

      <section className="content-section" aria-labelledby="chapters-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Contents</p>
            <h2 id="chapters-heading">Chapters</h2>
          </div>
          <Button icon={Plus} onClick={() => navigate(routes.editor(book.id))}>
            Add chapter
          </Button>
        </div>
        {book.chapters.length ? (
          <ol className="chapter-list">
            {book.chapters.map((chapter, index) => (
              <li key={chapter.id}>
                <span className="chapter-number">{String(index + 1).padStart(2, '0')}</span>
                <button
                  className="chapter-list__title"
                  onClick={() => navigate(routes.reader(book.id, chapter.id))}
                >
                  <strong>{chapter.title}</strong>
                  <span>
                    {formatNumber(chapter.wordCount)} words · Edited {formatDate(chapter.updatedAt)}{' '}
                    · {chapter.isRead ? 'Read' : 'Unread'}
                  </span>
                </button>
                <div className="chapter-list__actions">
                  <IconButton
                    disabled={index === 0}
                    icon={ArrowUp}
                    label={`Move ${chapter.title} up`}
                    onClick={() => void reorder(index, -1)}
                  />
                  <IconButton
                    disabled={index === book.chapters.length - 1}
                    icon={ArrowDown}
                    label={`Move ${chapter.title} down`}
                    onClick={() => void reorder(index, 1)}
                  />
                  <IconButton
                    icon={PencilLine}
                    label={`Rename ${chapter.title}`}
                    onClick={() => {
                      setRename(chapter)
                      setRenameValue(chapter.title)
                    }}
                  />
                  <IconButton
                    icon={Edit3}
                    label={`Edit ${chapter.title}`}
                    onClick={() => navigate(routes.editor(book.id, chapter.id))}
                  />
                  <IconButton
                    icon={Copy}
                    label={`Duplicate ${chapter.title}`}
                    onClick={() => void duplicateChapter(chapter)}
                  />
                  <IconButton
                    icon={Trash2}
                    label={`Delete ${chapter.title}`}
                    onClick={() => setConfirm({ kind: 'chapter', chapter })}
                  />
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <div className="empty-section">
            <BookOpen size={28} />
            <h3>This book is waiting for its first chapter</h3>
            <p>Paste in the beginning now, or return when the story is ready.</p>
            <Button icon={Plus} variant="primary" onClick={() => navigate(routes.editor(book.id))}>
              Add first chapter
            </Button>
          </div>
        )}
      </section>

      {bookmarks.length ? (
        <section className="content-section" aria-labelledby="bookmarks-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Saved places</p>
              <h2 id="bookmarks-heading">Bookmarks</h2>
            </div>
            <Bookmark aria-hidden="true" />
          </div>
          <ul className="bookmark-list">
            {bookmarks.map((item) => (
              <li key={item.id}>
                <button
                  onClick={() => navigate(routes.reader(book.id, item.chapterId, item.location))}
                >
                  <strong>{item.chapterTitle}</strong>
                  <span>
                    {item.note || `Around ${Math.round(item.location * 100)}% through the chapter`}
                  </span>
                </button>
                <IconButton
                  icon={Trash2}
                  label={`Remove bookmark in ${item.chapterTitle}`}
                  onClick={async () => {
                    try {
                      unwrap(await storyboundApi().bookmarks.remove(item.id))
                      setBookmarks((current) =>
                        current.filter((bookmark) => bookmark.id !== item.id)
                      )
                      notify('Bookmark removed.')
                    } catch (caught) {
                      setError(readableError(caught))
                    }
                  }}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {chapterTrash.length ? (
        <section className="content-section" aria-labelledby="chapter-trash-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Recoverable</p>
              <h2 id="chapter-trash-heading">Chapter trash</h2>
            </div>
            <Trash2 aria-hidden="true" />
          </div>
          <ul className="chapter-trash-list">
            {chapterTrash.map((chapter) => (
              <li key={chapter.id}>
                <span>
                  <strong>{chapter.title}</strong>
                  <small>
                    Deleted {formatDate(chapter.deletedAt)} · {formatNumber(chapter.wordCount)}{' '}
                    words
                  </small>
                </span>
                <Button
                  disabled={busy}
                  icon={RotateCcw}
                  onClick={() => void restoreTrashedChapter(chapter)}
                >
                  Restore
                </Button>
                <IconButton
                  icon={Trash2}
                  label={`Permanently delete ${chapter.title}`}
                  onClick={() => setConfirm({ kind: 'chapterPermanent', chapter })}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {storyEntityForm ? (
        <Modal
          description="Keep reference notes local and link an entry to a chapter when useful."
          onClose={() => setStoryEntityForm(null)}
          size="large"
          title={storyEntityForm.id ? 'Edit story-bible entry' : 'Add story-bible entry'}
        >
          <form className="form-stack" onSubmit={(event) => void saveStoryEntity(event)}>
            <div className="form-grid form-grid--two">
              <label className="field">
                <span>Entry type</span>
                <select
                  value={storyEntityForm.entityType}
                  onChange={(event) =>
                    setStoryEntityForm({
                      ...storyEntityForm,
                      entityType: event.target.value as StoryEntityType
                    })
                  }
                >
                  <option value="character">Character</option>
                  <option value="location">Location</option>
                  <option value="lore">Lore</option>
                  <option value="event">Timeline event</option>
                  <option value="custom">Other</option>
                </select>
              </label>
              <label className="field">
                <span>Title</span>
                <input
                  required
                  maxLength={240}
                  value={storyEntityForm.title}
                  onChange={(event) =>
                    setStoryEntityForm({ ...storyEntityForm, title: event.target.value })
                  }
                />
              </label>
            </div>
            {storyEntityForm.entityType === 'event' ? (
              <div className="form-grid form-grid--two">
                <label className="field">
                  <span>Date or era</span>
                  <input
                    maxLength={120}
                    placeholder="Year 12 · Midwinter"
                    value={storyEntityForm.date}
                    onChange={(event) =>
                      setStoryEntityForm({ ...storyEntityForm, date: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  <span>Timeline order</span>
                  <input
                    min="0"
                    step="1"
                    type="number"
                    value={storyEntityForm.order}
                    onChange={(event) =>
                      setStoryEntityForm({ ...storyEntityForm, order: event.target.value })
                    }
                  />
                </label>
              </div>
            ) : null}
            <label className="field">
              <span>Summary</span>
              <textarea
                maxLength={20000}
                rows={3}
                value={storyEntityForm.summary}
                onChange={(event) =>
                  setStoryEntityForm({ ...storyEntityForm, summary: event.target.value })
                }
              />
            </label>
            <label className="field">
              <span>Reference notes</span>
              <textarea
                maxLength={200000}
                rows={8}
                value={storyEntityForm.bodyMarkdown}
                onChange={(event) =>
                  setStoryEntityForm({ ...storyEntityForm, bodyMarkdown: event.target.value })
                }
              />
            </label>
            <div className="form-grid form-grid--two">
              <label className="field">
                <span>Link to chapter</span>
                <select
                  value={storyEntityForm.chapterId}
                  onChange={(event) =>
                    setStoryEntityForm({ ...storyEntityForm, chapterId: event.target.value })
                  }
                >
                  <option value="">No chapter link</option>
                  {book.chapters.map((chapter) => (
                    <option key={chapter.id} value={chapter.id}>
                      {chapter.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Chapter-link note</span>
                <input
                  disabled={!storyEntityForm.chapterId}
                  maxLength={2000}
                  value={storyEntityForm.chapterNote}
                  onChange={(event) =>
                    setStoryEntityForm({ ...storyEntityForm, chapterNote: event.target.value })
                  }
                />
              </label>
            </div>
            <div className="modal__actions">
              <Button onClick={() => setStoryEntityForm(null)}>Cancel</Button>
              <Button
                disabled={busy || !storyEntityForm.title.trim()}
                type="submit"
                variant="primary"
              >
                Save entry
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}

      {metadata ? (
        <Modal
          onClose={() => setMetadata(null)}
          size="large"
          title="Edit book details"
          description="Organize the story with useful context. None of these fields are sent anywhere."
        >
          <form className="form-stack" onSubmit={(event) => void saveMetadata(event)}>
            <div className="form-grid form-grid--two">
              <label className="field">
                <span>Title</span>
                <input
                  required
                  maxLength={240}
                  value={metadata.title ?? ''}
                  onChange={(event) => setMetadata({ ...metadata, title: event.target.value })}
                />
              </label>
              <label className="field">
                <span>Subtitle</span>
                <input
                  maxLength={240}
                  value={metadata.subtitle ?? ''}
                  onChange={(event) => setMetadata({ ...metadata, subtitle: event.target.value })}
                />
              </label>
              <label className="field">
                <span>Author</span>
                <input
                  maxLength={240}
                  value={metadata.authorName ?? ''}
                  onChange={(event) => setMetadata({ ...metadata, authorName: event.target.value })}
                />
              </label>
              <label className="field">
                <span>Series</span>
                <input
                  maxLength={240}
                  placeholder="The Lantern Cycle"
                  value={metadata.seriesName ?? ''}
                  onChange={(event) => setMetadata({ ...metadata, seriesName: event.target.value })}
                />
              </label>
              <label className="field">
                <span>Series number</span>
                <input
                  min="0.1"
                  step="0.1"
                  type="number"
                  value={metadata.seriesPosition ?? ''}
                  onChange={(event) =>
                    setMetadata({
                      ...metadata,
                      seriesPosition: event.target.value ? Number(event.target.value) : null
                    })
                  }
                />
              </label>
              <label className="field">
                <span>Language code</span>
                <input
                  maxLength={35}
                  placeholder="en-GB"
                  value={metadata.languageCode ?? ''}
                  onChange={(event) =>
                    setMetadata({ ...metadata, languageCode: event.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>Source label</span>
                <input
                  maxLength={240}
                  placeholder="ChatGPT conversation"
                  value={metadata.sourceLabel ?? ''}
                  onChange={(event) =>
                    setMetadata({ ...metadata, sourceLabel: event.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>Source URL</span>
                <input
                  maxLength={2000}
                  type="url"
                  value={metadata.sourceUrl ?? ''}
                  onChange={(event) => setMetadata({ ...metadata, sourceUrl: event.target.value })}
                />
              </label>
              <label className="field">
                <span>Rating</span>
                <select
                  value={metadata.rating ?? ''}
                  onChange={(event) =>
                    setMetadata({
                      ...metadata,
                      rating: event.target.value ? Number(event.target.value) : null
                    })
                  }
                >
                  <option value="">Not rated</option>
                  {[1, 2, 3, 4, 5].map((rating) => (
                    <option key={rating} value={rating}>
                      {rating} / 5
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="field">
              <span>Blurb</span>
              <textarea
                maxLength={20000}
                rows={4}
                value={metadata.blurb ?? ''}
                onChange={(event) => setMetadata({ ...metadata, blurb: event.target.value })}
              />
            </label>
            <label className="field">
              <span>Personal notes</span>
              <textarea
                maxLength={100000}
                rows={5}
                value={metadata.personalNotes ?? ''}
                onChange={(event) =>
                  setMetadata({ ...metadata, personalNotes: event.target.value })
                }
              />
            </label>
            {tags.length ? (
              <fieldset className="metadata-choices">
                <legend>Tags</legend>
                {tags.map((tag) => (
                  <label key={tag.id}>
                    <input
                      checked={metadataTagIds.includes(tag.id)}
                      type="checkbox"
                      onChange={() =>
                        setMetadataTagIds((current) =>
                          current.includes(tag.id)
                            ? current.filter((id) => id !== tag.id)
                            : [...current, tag.id]
                        )
                      }
                    />{' '}
                    {tag.name}
                  </label>
                ))}
              </fieldset>
            ) : null}
            {collections.length ? (
              <fieldset className="metadata-choices">
                <legend>Collections</legend>
                {collections.map((collection) => (
                  <label key={collection.id}>
                    <input
                      checked={metadataCollectionIds.includes(collection.id)}
                      type="checkbox"
                      onChange={() =>
                        setMetadataCollectionIds((current) =>
                          current.includes(collection.id)
                            ? current.filter((id) => id !== collection.id)
                            : [...current, collection.id]
                        )
                      }
                    />{' '}
                    {collection.name}
                  </label>
                ))}
              </fieldset>
            ) : null}
            <div className="modal__actions">
              <Button onClick={() => setMetadata(null)}>Cancel</Button>
              <Button disabled={busy || !metadata.title?.trim()} type="submit" variant="primary">
                Save details
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}

      {exportOpen ? (
        <Modal
          description="Choose a reading or archive format. Every option is created locally."
          onClose={() => setExportOpen(false)}
          size="medium"
          title="Export book"
        >
          <div className="export-format-list">
            <button disabled={busy} onClick={() => void exportStandard('markdown')}>
              <strong>Markdown</strong>
              <span>One portable, editable text document with every chapter.</span>
            </button>
            <button disabled={busy} onClick={() => void exportStandard('epub')}>
              <strong>EPUB</strong>
              <span>A reflowable ebook for Kindle, Apple Books, Kobo, and other readers.</span>
            </button>
            <button disabled={busy} onClick={() => void exportStandard('pdf')}>
              <strong>PDF</strong>
              <span>A paginated A5 reading copy suitable for printing or sharing privately.</span>
            </button>
            <button disabled={busy} onClick={() => void exportCompanion()}>
              <strong>Offline companion</strong>
              <span>
                One self-contained mobile-friendly HTML reader with local resume and no network
                dependency.
              </span>
            </button>
            <button disabled={busy} onClick={() => void exportBook()}>
              <strong>Storybound package</strong>
              <span>An editable Storybound copy with reading state, bookmarks, and cover.</span>
            </button>
          </div>
          <div className="modal__actions">
            <Button disabled={busy} onClick={() => setExportOpen(false)}>
              Close
            </Button>
          </div>
        </Modal>
      ) : null}

      {coverStudio ? (
        <Modal
          description={
            book.coverImageUrl
              ? 'Move the focal point to keep the important part of your image inside the 2:3 cover.'
              : 'Choose a restrained generated palette. It remains deterministic and fully local.'
          }
          onClose={() => setCoverStudio(null)}
          size="medium"
          title="Cover studio"
        >
          <div className="cover-studio">
            <div className="cover-studio__preview">
              <BookCover
                bookId={book.id}
                coverImageUrl={book.coverImageUrl}
                coverPositionX={coverStudio.x}
                coverPositionY={coverStudio.y}
                coverStyle={coverStudio.style}
                size="hero"
                title={book.title}
              />
            </div>
            <div className="form-stack">
              <label className="field">
                <span>Generated cover palette</span>
                <select
                  value={coverStudio.style}
                  onChange={(event) =>
                    setCoverStudio({ ...coverStudio, style: event.target.value as CoverStyle })
                  }
                >
                  <option value="classic">Classic — unique to this book</option>
                  <option value="moonlit">Moonlit</option>
                  <option value="forest">Forest</option>
                  <option value="ember">Ember</option>
                  <option value="ocean">Ocean</option>
                  <option value="rose">Rose</option>
                </select>
              </label>
              {book.coverImageUrl ? (
                <>
                  <label className="field">
                    <span>Horizontal focus · {coverStudio.x}%</span>
                    <input
                      max={100}
                      min={0}
                      type="range"
                      value={coverStudio.x}
                      onChange={(event) =>
                        setCoverStudio({ ...coverStudio, x: Number(event.target.value) })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Vertical focus · {coverStudio.y}%</span>
                    <input
                      max={100}
                      min={0}
                      type="range"
                      value={coverStudio.y}
                      onChange={(event) =>
                        setCoverStudio({ ...coverStudio, y: Number(event.target.value) })
                      }
                    />
                  </label>
                  <Button onClick={() => setCoverStudio({ ...coverStudio, x: 50, y: 50 })}>
                    Centre image
                  </Button>
                </>
              ) : null}
            </div>
          </div>
          <div className="modal__actions">
            <Button onClick={() => setCoverStudio(null)}>Cancel</Button>
            <Button disabled={busy} onClick={() => void saveCoverStudio()} variant="primary">
              Save cover
            </Button>
          </div>
        </Modal>
      ) : null}

      {rename ? (
        <Modal onClose={() => setRename(null)} size="small" title="Rename chapter">
          <form className="form-stack" onSubmit={(event) => void renameChapter(event)}>
            <label className="field">
              <span>Chapter title</span>
              <input
                required
                maxLength={240}
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
              />
            </label>
            <div className="modal__actions">
              <Button onClick={() => setRename(null)}>Cancel</Button>
              <Button disabled={busy} type="submit" variant="primary">
                Save title
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}
      {confirm ? (
        <ConfirmDialog
          busy={busy}
          confirmLabel={
            confirm.kind === 'chapterPermanent'
              ? 'Delete permanently'
              : confirm.kind === 'book'
                ? 'Move to Trash'
                : 'Move to chapter trash'
          }
          dangerous
          description={
            confirm.kind === 'book'
              ? 'The book will remain recoverable from Trash.'
              : confirm.kind === 'chapterPermanent'
                ? 'This permanently removes the chapter and its version history. This cannot be undone.'
                : 'The chapter will be hidden from the book and remain recoverable here.'
          }
          onClose={() => setConfirm(null)}
          onConfirm={executeDelete}
          title={
            confirm.kind === 'book'
              ? `Move “${book.title}” to Trash?`
              : confirm.kind === 'chapterPermanent'
                ? `Permanently delete “${confirm.chapter?.title}”?`
                : `Move “${confirm.chapter?.title}” to chapter trash?`
          }
        />
      ) : null}
    </div>
  )
}
