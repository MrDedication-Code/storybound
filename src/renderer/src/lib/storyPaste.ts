const BLOCK_TAGS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'DIV',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'HEADER',
  'MAIN',
  'NAV',
  'P',
  'SECTION'
])
const IGNORED_TAGS = new Set(['NOSCRIPT', 'SCRIPT', 'STYLE', 'SVG', 'TEMPLATE'])

export interface StoryPasteEdit {
  cursor: number
  insertedText: string
  value: string
}

function normalizeLineEndings(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/\u2028/g, '\n')
    .replace(/\u2029/g, '\n\n')
}

function serializeChildren(node: Node): string {
  return Array.from(node.childNodes, serializeHtmlNode).join('')
}

function serializeListItem(element: Element): string {
  const content = serializeChildren(element).trim()
  if (!content) return ''
  const parent = element.parentElement
  if (parent?.tagName === 'OL') {
    const index = Array.from(parent.children)
      .filter((child) => child.tagName === 'LI')
      .indexOf(element)
    const start = Number.parseInt(parent.getAttribute('start') ?? '1', 10)
    return `${Number.isFinite(start) ? start + index : index + 1}. ${content}\n`
  }
  return `- ${content}\n`
}

function serializeHtmlNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? ''
  if (!(node instanceof Element) || IGNORED_TAGS.has(node.tagName)) return ''

  const content = serializeChildren(node)
  if (BLOCK_TAGS.has(node.tagName)) return `\n\n${content}\n\n`
  if (/^H[1-6]$/u.test(node.tagName)) {
    return `\n\n${'#'.repeat(Number(node.tagName.slice(1)))} ${content.trim()}\n\n`
  }

  switch (node.tagName) {
    case 'BR':
      return '\n'
    case 'HR':
      return '\n\n* * *\n\n'
    case 'STRONG':
    case 'B':
      return content.trim() ? `**${content}**` : ''
    case 'EM':
    case 'I':
      return content.trim() ? `*${content}*` : ''
    case 'CODE':
      return content ? `\`${content}\`` : ''
    case 'PRE':
      return node.textContent?.trim() ? `\n\n\`\`\`\n${node.textContent.trim()}\n\`\`\`\n\n` : ''
    case 'BLOCKQUOTE': {
      const quote = tidyGeneratedText(content)
      return quote ? `\n\n${quote.replace(/^/gmu, '> ')}\n\n` : ''
    }
    case 'LI':
      return serializeListItem(node)
    case 'UL':
    case 'OL':
      return content.trim() ? `\n\n${content.trim()}\n\n` : ''
    default:
      return content
  }
}

function tidyGeneratedText(value: string): string {
  return normalizeLineEndings(value)
    .replace(/\u00a0/g, ' ')
    .replace(/[\t ]+\n/g, '\n')
    .replace(/\n[\t ]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function comparableText(value: string): string {
  return normalizeLineEndings(value)
    .normalize('NFC')
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/^\s{0,3}(?:#{1,6}|>|[-+*]|\d+[.)])\s+/gmu, '')
    .replace(/[*_~`]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

function textFromSemanticHtml(html: string): string | null {
  if (!html.trim() || typeof DOMParser === 'undefined') return null
  const document = new DOMParser().parseFromString(html, 'text/html')
  const markdown = tidyGeneratedText(serializeChildren(document.body))
  return markdown || null
}

/**
 * Prefer exact plain text unless clipboard HTML proves that its matching text had semantic blocks.
 * This recovers paragraph boundaries from rich chat output without guessing from punctuation.
 */
export function storyTextFromClipboard(clipboardData: Pick<DataTransfer, 'getData'>): string {
  const plainText = normalizeLineEndings(clipboardData.getData('text/plain'))
  const semanticText = textFromSemanticHtml(clipboardData.getData('text/html'))
  if (!semanticText) return plainText
  if (!plainText.trim()) return semanticText
  if (/\n[\t ]*\n/u.test(plainText)) return plainText
  if (!/\n[\t ]*\n/u.test(semanticText)) return plainText
  return comparableText(plainText) === comparableText(semanticText) ? semanticText : plainText
}

export function applyStoryPaste(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  clipboardData: Pick<DataTransfer, 'getData'>
): StoryPasteEdit {
  const insertedText = storyTextFromClipboard(clipboardData)
  const start = Math.min(Math.max(0, selectionStart), value.length)
  const end = Math.min(Math.max(start, selectionEnd), value.length)
  return {
    cursor: start + insertedText.length,
    insertedText,
    value: `${value.slice(0, start)}${insertedText}${value.slice(end)}`
  }
}

export function restorePasteCursor(textarea: HTMLTextAreaElement, cursor: number): void {
  window.setTimeout(() => {
    textarea.focus()
    textarea.setSelectionRange(cursor, cursor)
  }, 0)
}
