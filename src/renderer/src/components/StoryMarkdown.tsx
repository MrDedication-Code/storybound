import { useEffect, useRef } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkBreaks from 'remark-breaks'

const STORY_REMARK_PLUGINS = [remarkBreaks]

const SAFE_COMPONENTS: Components = {
  a: ({ children, href }) => (
    <span
      className="story-link"
      title={href ? 'Links in story text are displayed without navigation.' : undefined}
    >
      {children}
    </span>
  )
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

export function StoryMarkdown({
  children,
  highlight = '',
  highlights = EMPTY_HIGHLIGHTS
}: {
  children: string
  highlight?: string
  highlights?: readonly StoryHighlight[]
}): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)

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
      <ReactMarkdown components={SAFE_COMPONENTS} remarkPlugins={STORY_REMARK_PLUGINS}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
