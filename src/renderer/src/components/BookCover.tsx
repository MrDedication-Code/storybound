import { BookOpen } from 'lucide-react'
import type { CoverStyle } from '@shared/types'
import { coverPalette, initials } from '../lib/format'

interface BookCoverProps {
  bookId: string
  title: string
  coverImageUrl: string | null
  coverStyle?: CoverStyle
  coverPositionX?: number
  coverPositionY?: number
  size?: 'card' | 'hero' | 'compact'
}

export function BookCover({
  bookId,
  title,
  coverImageUrl,
  coverStyle = 'classic',
  coverPositionX = 50,
  coverPositionY = 50,
  size = 'card'
}: BookCoverProps): React.JSX.Element {
  const palette = coverPalette(bookId, coverStyle)
  return (
    <div
      aria-label={`Cover of ${title}`}
      className={`book-cover book-cover--${size}`}
      role="img"
      style={
        {
          '--cover-from': palette.from,
          '--cover-to': palette.to,
          '--cover-ink': palette.ink
        } as React.CSSProperties
      }
    >
      {coverImageUrl ? (
        <img
          alt=""
          draggable={false}
          src={coverImageUrl}
          style={{ objectPosition: `${coverPositionX}% ${coverPositionY}%` }}
        />
      ) : (
        <>
          <span className="book-cover__rule" />
          <BookOpen aria-hidden="true" className="book-cover__mark" size={20} strokeWidth={1.35} />
          <span className="book-cover__title">{title}</span>
          <span className="book-cover__monogram">{initials(title)}</span>
          <span className="book-cover__imprint">STORYBOUND</span>
        </>
      )}
    </div>
  )
}
