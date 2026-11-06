import { Play } from 'lucide-react'
import { memo, useEffect, useMemo, useRef } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import {
  PERFORMANCE_NOTE,
  shownParagraphOffsets,
  stripPerformanceNotes
} from '@storybound/narration'

const STORY_REMARK_PLUGINS = [remarkBreaks]

// Marks a performance note turned into inline code, so it can be shown as a chip.
const NOTE_MARK = '\u2063'

const SAFE_COMPONENTS: Components = {
  code: ({ children, className }) => {
    const text = typeof children === 'string' ? children : ''
    if (text.startsWith(NOTE_MARK)) {
      return (
        <span className="performance-note" title="Performance note for the narrating voice">
          {text.slice(NOTE_MARK.length)}
        </span>
      )
    }
    return <code className={className}>{children}</code>
  },
  a: ({ children, href }) => (
    <span
      className="story-link"
      title={href ? 'Links in story text are displayed without navigation.' : undefined}
    >
      {children}
    </span>
  )
}

/**
 * Marks each paragraph with its place in the chapter's stored text and gives it a button for
 * listening from there. The reader shows the buttons only while its listening controls are open;
 * they are always rendered because rebuilding the paragraphs would lose the highlights on them.
 */
function listenableComponents(source: string): Components {
  const offsets = shownParagraphOffsets(source)
  return {
    ...SAFE_COMPONENTS,
    p: ({ children, node }) => {
      const shown = node?.position?.start.offset ?? 0
      const stored = offsets.findLast((item) => item.shown <= shown)?.stored
      if (stored === undefined) return <p>{children}</p>
      return (
        <p data-story-offset={stored}>
          {children}
          <button
            aria-label="Listen from here"
            className="listen-from"
            data-listen-from={stored}
            title="Listen from here"
            type="button"
          >
            <Play aria-hidden="true" size={13} />
          </button>
        </p>
      )
    }
  }
}

interface HighlightRegistry {
  delete(name: string): void
  set(name: string, highlight: unknown): void
}

type HighlightConstructor = new (...ranges: Range[]) => unknown
const SEARCH_HIGHLIGHT_NAME = 'storybound-search-hit'
const ANNOTATION_HIGHLIGHT_NAMES = {
  gold: 'storybound-annotation-gold',
  blue: 'storybound-annotation-blue',
  green: 'storybound-annotation-green',
  pink: 'storybound-annotation-pink',
  purple: 'storybound-annotation-purple',
  orange: 'storybound-annotation-orange'
} as const
const EMPTY_HIGHLIGHTS: readonly StoryHighlight[] = []

type AnnotationHighlightColor = keyof typeof ANNOTATION_HIGHLIGHT_NAMES

export interface StoryHighlight {
  id: string
  quote: string
  color: string
}

function getHighlightApi(): {
  HighlightClass: HighlightConstructor
  registry: HighlightRegistry
} | null {
  const cssApi = (globalThis as typeof globalThis & { CSS?: { highlights?: HighlightRegistry } })
    .CSS
  const HighlightClass = (window as Window & { Highlight?: HighlightConstructor }).Highlight
  const registry = cssApi?.highlights
  return registry && HighlightClass ? { HighlightClass, registry } : null
}

function resolveAnnotationColor(color: string): AnnotationHighlightColor {
  switch (color.trim().toLocaleLowerCase()) {
    case 'blue':
      return 'blue'
    case 'green':
      return 'green'
    case 'pink':
    case 'rose':
      return 'pink'
    case 'purple':
    case 'violet':
      return 'purple'
    case 'orange':
      return 'orange'
    case 'amber':
    case 'yellow':
    case 'gold':
    default:
      return 'gold'
  }
}

function findQuoteRanges(root: HTMLElement, quote: string): Range[] {
  const textNodes: Text[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) textNodes.push(node as Text)

  const fullText = textNodes.map((textNode) => textNode.data).join('')
  const ranges: Range[] = []
  let matchStart = fullText.indexOf(quote)
  while (matchStart >= 0) {
    const matchEnd = matchStart + quote.length
    let cursor = 0
    let startNode: Text | null = null
    let startOffset = 0
    let endNode: Text | null = null
    let endOffset = 0

    for (const textNode of textNodes) {
      const nextCursor = cursor + textNode.data.length
      if (!startNode && matchStart >= cursor && matchStart < nextCursor) {
        startNode = textNode
        startOffset = matchStart - cursor
      }
      if (matchEnd > cursor && matchEnd <= nextCursor) {
        endNode = textNode
        endOffset = matchEnd - cursor
        break
      }
      cursor = nextCursor
    }

    if (startNode && endNode) {
      const range = document.createRange()
      range.setStart(startNode, startOffset)
      range.setEnd(endNode, endOffset)
      ranges.push(range)
    }
    matchStart = fullText.indexOf(quote, matchStart + Math.max(1, quote.length))
  }
  return ranges
}

/**
 * Story text as a reader sees it. Performance notes ([[sigh]]) are for the narrating voice and
 * are hidden, unless `showNotes` is set, as in the editor's preview, where they show as chips.
 */
export const StoryMarkdown = memo(function StoryMarkdown({
  children: source,
  highlight = '',
  highlights = EMPTY_HIGHLIGHTS,
  listenable = false,
  showNotes = false
}: {
  children: string
  highlight?: string
  highlights?: readonly StoryHighlight[]
  /** Adds a "Listen from here" button to each paragraph, for the reader. */
  listenable?: boolean
  showNotes?: boolean
}): React.JSX.Element {
  const children = showNotes
    ? source.replace(
        PERFORMANCE_NOTE,
        (_note, text: string) => `\`${NOTE_MARK}${text.replace(/`/g, "'").trim()}\``
      )
    : stripPerformanceNotes(source)
  const rootRef = useRef<HTMLDivElement>(null)
  const components = useMemo(
    () => (listenable ? listenableComponents(source) : SAFE_COMPONENTS),
    [listenable, source]
  )

  useEffect(() => {
    const root = rootRef.current
    const term = highlight.trim()
    const api = getHighlightApi()
    if (!root || !term || !api) return
    const { HighlightClass, registry } = api

    const ranges: Range[] = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const needle = term.toLocaleLowerCase()
    let firstElement: HTMLElement | null = null
    let node: Node | null
    while ((node = walker.nextNode())) {
      const value = node.textContent ?? ''
      const haystack = value.toLocaleLowerCase()
      let offset = haystack.indexOf(needle)
      while (offset >= 0) {
        const range = document.createRange()
        range.setStart(node, offset)
        range.setEnd(node, offset + term.length)
        ranges.push(range)
        if (!firstElement) firstElement = node.parentElement
        offset = haystack.indexOf(needle, offset + Math.max(1, term.length))
      }
    }
    if (ranges.length === 0) return

    registry.set(SEARCH_HIGHLIGHT_NAME, new HighlightClass(...ranges))
    let innerFrame = 0
    const outerFrame = window.requestAnimationFrame(() => {
      innerFrame = window.requestAnimationFrame(() =>
        firstElement?.scrollIntoView({ block: 'center' })
      )
    })
    return () => {
      window.cancelAnimationFrame(outerFrame)
      if (innerFrame) window.cancelAnimationFrame(innerFrame)
      registry.delete(SEARCH_HIGHLIGHT_NAME)
    }
  }, [children, highlight])

  useEffect(() => {
    const root = rootRef.current
    const api = getHighlightApi()
    if (!root || highlights.length === 0 || !api) return
    const { HighlightClass, registry } = api
    const rangesByColor = new Map<AnnotationHighlightColor, Range[]>()

    for (const item of highlights) {
      if (!item.quote.trim()) continue
      const color = resolveAnnotationColor(item.color)
      const ranges = findQuoteRanges(root, item.quote)
      if (ranges.length === 0) continue
      const currentRanges = rangesByColor.get(color)
      if (currentRanges) currentRanges.push(...ranges)
      else rangesByColor.set(color, ranges)
    }

    const registeredNames: string[] = []
    for (const [color, ranges] of rangesByColor) {
      const name = ANNOTATION_HIGHLIGHT_NAMES[color]
      registry.set(name, new HighlightClass(...ranges))
      registeredNames.push(name)
    }

    return () => {
      for (const name of registeredNames) registry.delete(name)
    }
  }, [children, highlights])

  return (
    <div className="story-markdown" ref={rootRef}>
      <ReactMarkdown components={components} remarkPlugins={STORY_REMARK_PLUGINS}>
        {children}
      </ReactMarkdown>
    </div>
  )
})
