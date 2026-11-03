/** Text and cursor together, so every tool can say where the cursor ends up. */
export interface TextEdit {
  value: string
  selection: { start: number; end: number }
}

function at(value: string, start: number, end = start): TextEdit {
  return { value, selection: { start, end } }
}

function ordered(edit: TextEdit): { start: number; end: number } {
  const { start, end } = edit.selection
  return start <= end ? { start, end } : { start: end, end: start }
}

/** Replaces the selection (or inserts at the cursor) and puts the cursor after the new text. */
export function insertText(edit: TextEdit, text: string): TextEdit {
  const { start, end } = ordered(edit)
  const value = edit.value.slice(0, start) + text + edit.value.slice(end)
  return at(value, start + text.length)
}

/**
 * Wraps the selection in Markdown emphasis, or removes it when the selection is already wrapped.
 * With nothing selected, the markers go in with the cursor between them, ready to type.
 */
export function toggleEmphasis(edit: TextEdit, marker: '**' | '*'): TextEdit {
  const { start, end } = ordered(edit)
  const { value } = edit
  const size = marker.length
  const before = value.slice(Math.max(0, start - size), start)
  const after = value.slice(end, end + size)
  // `*` must not mistake one half of `**` for its own marker.
  const isolated = marker === '**' || (value[start - size - 1] !== '*' && value[end + size] !== '*')
  if (before === marker && after === marker && isolated) {
    const unwrapped =
      value.slice(0, start - size) + value.slice(start, end) + value.slice(end + size)
    return at(unwrapped, start - size, end - size)
  }
  const selected = value.slice(start, end)
  if (selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= size * 2) {
    const inner = selected.slice(size, selected.length - size)
    return at(value.slice(0, start) + inner + value.slice(end), start, start + inner.length)
  }
  const wrapped = value.slice(0, start) + marker + selected + marker + value.slice(end)
  return at(wrapped, start + size, end + size)
}

/** Turns the line with the cursor into a heading, or back into plain text. */
export function toggleHeading(edit: TextEdit): TextEdit {
  const { start, end } = ordered(edit)
  const { value } = edit
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  const existing = value.slice(lineStart).match(/^#{1,6}\s+/u)?.[0]
  if (existing) {
    const shift = existing.length
    return at(
      value.slice(0, lineStart) + value.slice(lineStart + shift),
      Math.max(lineStart, start - shift),
      Math.max(lineStart, end - shift)
    )
  }
  return at(value.slice(0, lineStart) + '## ' + value.slice(lineStart), start + 3, end + 3)
}

/** Puts curly dialogue quotes around the selection, or a pair with the cursor inside. */
export function wrapDialogue(edit: TextEdit): TextEdit {
  const { start, end } = ordered(edit)
  const { value } = edit
  const selected = value.slice(start, end)
  return at(value.slice(0, start) + '“' + selected + '”' + value.slice(end), start + 1, end + 1)
}

/** A scene break on its own line with a blank line either side, as the reader expects. */
export function insertSceneBreak(edit: TextEdit): TextEdit {
  const { start, end } = ordered(edit)
  const before = edit.value.slice(0, start).replace(/\s+$/u, '')
  const after = edit.value.slice(end).replace(/^\s+/u, '')
  const prefix = before ? `${before}\n\n` : ''
  const value = `${prefix}* * *\n\n${after}`
  return at(value, prefix.length + '* * *\n\n'.length)
}

const OPENS_QUOTE = /[\s([{“‘—–-]/u

/**
 * Typewriter punctuation becomes typeset punctuation as it is typed: straight quotes curl the
 * right way, -- becomes an em dash, and ... an ellipsis. Only a single typed character is
 * changed, so pasted text and keyboard suggestions are left alone.
 */
export function smartenTyping(previous: string, next: string): TextEdit | null {
  if (next.length !== previous.length + 1) return null
  let index = 0
  while (index < previous.length && previous[index] === next[index]) index += 1
  if (next.slice(index + 1) !== previous.slice(index)) return null
  const typed = next[index]
  const before = next.slice(0, index)
  const rest = next.slice(index + 1)
  const opening = index === 0 || OPENS_QUOTE.test(next[index - 1])

  if (typed === '"') return at(before + (opening ? '“' : '”') + rest, index + 1)
  if (typed === "'") return at(before + (opening ? '‘' : '’') + rest, index + 1)
  if (typed === '-' && before.endsWith('-')) return at(before.slice(0, -1) + '—' + rest, index)
  if (typed === '.' && before.endsWith('..')) {
    return at(before.slice(0, -2) + '…' + rest, index - 1)
  }
  return null
}

export interface TextMatch {
  start: number
  end: number
}

function escapeForSearch(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

export function findMatches(value: string, query: string, matchCase = false): TextMatch[] {
  if (!query) return []
  const pattern = new RegExp(escapeForSearch(query), matchCase ? 'gu' : 'giu')
  return [...value.matchAll(pattern)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length
  }))
}

export function replaceAllMatches(
  value: string,
  query: string,
  replacement: string,
  matchCase = false
): { value: string; count: number } {
  const count = findMatches(value, query, matchCase).length
  if (!count) return { value, count }
  const pattern = new RegExp(escapeForSearch(query), matchCase ? 'gu' : 'giu')
  return { value: value.replace(pattern, () => replacement), count }
}

/** A title for the second half of a split: its opening heading if it has one. */
export function suggestSplitTitle(after: string, fallback: string): string {
  const heading = after.trimStart().match(/^#{1,6}\s+(.+)$/mu)
  if (heading && after.trimStart().startsWith('#')) return heading[1].trim().slice(0, 240)
  return fallback
}

/**
 * Undo and redo for the editor. Typing within a short pause joins one step, so undo takes back
 * a phrase rather than a letter; every tool is a step of its own.
 */
export class EditHistory {
  private past: TextEdit[] = []
  private future: TextEdit[] = []
  private lastTypingAt = 0

  constructor(
    private current: TextEdit,
    private readonly limit = 200,
    private readonly typingPauseMs = 900
  ) {}

  record(next: TextEdit, kind: 'typing' | 'tool', now = Date.now()): void {
    if (next.value === this.current.value) {
      this.current = next
      return
    }
    const joinsTyping = kind === 'typing' && now - this.lastTypingAt < this.typingPauseMs
    if (!joinsTyping) {
      this.past.push(this.current)
      if (this.past.length > this.limit) this.past.shift()
    }
    this.lastTypingAt = kind === 'typing' ? now : 0
    this.current = next
    this.future = []
  }

  /** Remembers where the cursor is without making a new step. */
  moveCursor(selection: TextEdit['selection']): void {
    this.current = { ...this.current, selection }
  }

  undo(): TextEdit | null {
    const previous = this.past.pop()
    if (!previous) return null
    this.future.push(this.current)
    this.current = previous
    this.lastTypingAt = 0
    return previous
  }

  redo(): TextEdit | null {
    const next = this.future.pop()
    if (!next) return null
    this.past.push(this.current)
    this.current = next
    this.lastTypingAt = 0
    return next
  }

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }
}
