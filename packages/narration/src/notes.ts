/**
 * Performance notes are directions for the narrating voice written into the manuscript as
 * `[[...]]`. At the start of a paragraph a note sets how the passage is read ("hushed, urgent");
 * anywhere else it is a momentary sound or beat ("sigh", "long pause"). Readers, exports, and
 * word counts never show them.
 */
export const PERFORMANCE_NOTE = /\[\[([^[\]\n]{1,120})\]\]/g

const LEADING_NOTES = /^(?:\s*\[\[([^[\]\n]{1,120})\]\])+/

/** Vocal sounds the Google voice performs; other inline notes are passed through as written. */
export const VOCAL_EXPRESSIONS = [
  'breath',
  'heavy breath',
  'exhales',
  'pant',
  'phew',
  'sigh',
  'yawn',
  'chuckle',
  'giggle',
  'laugh',
  'snicker',
  'snort',
  'gasp',
  'groan',
  'grunt',
  'growl',
  'hiss',
  'moan',
  'scream',
  'shout',
  'sob',
  'whimper',
  'cry',
  'cough',
  'sneeze',
  'tsk',
  'whispers',
  'short pause',
  'long pause'
] as const

/** How long a pause note lasts for voices that cannot perform it themselves. */
export function pauseSeconds(note: string): number | null {
  const value = note.trim().toLowerCase()
  if (value === 'long pause') return 1.4
  if (value === 'pause' || value === 'short pause' || value === 'beat') return 0.6
  return null
}

/** The text as a reader sees it: notes removed and the spacing they leave behind tidied. */
export function stripPerformanceNotes(text: string): string {
  if (!text.includes('[[')) return text
  return text
    .replace(PERFORMANCE_NOTE, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.;:!?…])/g, '$1')
    .replace(/^[ \t]+/gm, '')
}

export interface ParagraphDirection {
  /** How the whole passage is read, from the notes it starts with; null when there are none. */
  style: string | null
  /** The paragraph without its leading notes. Inline notes are still in it. */
  body: string
  /** Where `body` starts within the paragraph. */
  bodyOffset: number
}

export function readParagraphDirection(paragraph: string): ParagraphDirection {
  const leading = paragraph.match(LEADING_NOTES)
  if (!leading) return { style: null, body: paragraph, bodyOffset: 0 }
  const notes = [...leading[0].matchAll(PERFORMANCE_NOTE)].map((match) => match[1].trim())
  const rest = paragraph.slice(leading[0].length)
  const trimmed = rest.length - rest.trimStart().length
  return {
    style: notes.filter(Boolean).join(', ') || null,
    body: rest.trimStart(),
    bodyOffset: leading[0].length + trimmed
  }
}
