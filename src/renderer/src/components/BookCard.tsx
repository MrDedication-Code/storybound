import { BookOpen, CheckCircle2, Clock3, Edit3, Heart, Pin } from 'lucide-react'
import type { BookSummary } from '@shared/types'
import { formatNumber } from '../lib/format'
import { IconButton } from './ui'
import { BookCover } from './BookCover'

interface BookCardProps {
  book: BookSummary
  isLastRead?: boolean
  onOpen: () => void
  onRead: () => void
  onEdit: () => void
  onFavourite?: () => void
  onPin?: () => void
  onSelect?: () => void
  selected?: boolean
}

export function BookCard({
  book,
  isLastRead = false,
  onOpen,
  onRead,
  onEdit,
  onFavourite,
  onPin,
  onSelect,
  selected = false
}: BookCardProps): React.JSX.Element {
  return (
    <article
      className={`book-card ${selected ? 'book-card--selected' : ''}`}
      data-testid="book-card"
    >
      {onSelect ? (
        <label className="book-card__select">
          <input
            aria-label={`Select ${book.title}`}
            checked={selected}
            type="checkbox"
            onChange={onSelect}
          />
        </label>
      ) : null}
      <button
        className="book-card__open"
        aria-label={`Open ${book.title} details`}
        onClick={onOpen}
      >
        <BookCover
          bookId={book.id}
          coverImageUrl={book.coverImageUrl}
          coverPositionX={book.coverPositionX}
          coverPositionY={book.coverPositionY}
          coverStyle={book.coverStyle}
          title={book.title}
        />
      </button>
      <div className="book-card__quick-actions" aria-label={`Quick actions for ${book.title}`}>
        {onFavourite ? (
          <IconButton
            aria-pressed={book.isFavourite}
            icon={Heart}
            label={`${book.isFavourite ? 'Remove' : 'Add'} ${book.title} ${book.isFavourite ? 'from' : 'to'} favourites`}
            onClick={onFavourite}
          />
        ) : null}
        {onPin ? (
          <IconButton
            aria-pressed={book.isPinned}
            icon={Pin}
            label={`${book.isPinned ? 'Unpin' : 'Pin'} ${book.title}`}
            onClick={onPin}
          />
        ) : null}
        <IconButton icon={BookOpen} label={`Read ${book.title}`} onClick={onRead} />
        <IconButton icon={Edit3} label={`Edit ${book.title}`} onClick={onEdit} />
      </div>
      <button className="book-card__details" onClick={onOpen}>
        <span className={`status-pill status-pill--${book.status}`}>
          {book.status === 'completed' ? (
            <CheckCircle2 aria-hidden="true" size={13} />
          ) : (
            <Clock3 aria-hidden="true" size={13} />
          )}
          {book.status === 'completed' ? 'Completed' : 'Ongoing'}
        </span>
        <strong>{book.title}</strong>
        {book.seriesName ? (
          <span className="book-card__series">
            {book.seriesName}
            {book.seriesPosition ? ` · ${book.seriesPosition}` : ''}
          </span>
        ) : null}
        <span>
          {book.chapterCount} {book.chapterCount === 1 ? 'chapter' : 'chapters'} ·{' '}
          {formatNumber(book.totalWordCount)} words
        </span>
        <span
          className="progress-track"
          aria-label={`${Math.round(book.progressPercentage)}% read`}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={Math.round(book.progressPercentage)}
          role="progressbar"
        >
          <span style={{ width: `${book.progressPercentage}%` }} />
        </span>
        <span className="book-card__progress">
          {isLastRead ? <em>Recently read</em> : <span />}
          {Math.round(book.progressPercentage)}%
        </span>
      </button>
    </article>
  )
}
