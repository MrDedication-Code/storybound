export const MAX_DIRECT_IMPORT_CHARACTERS = 2_000_000
export const MAX_DIRECT_IMPORT_CHAPTERS = 1_000
export const MAX_DIRECT_IMPORT_PREVIEW_ITEMS = 400

export type DirectImportFormatHint = 'auto' | 'txt' | 'markdown' | 'chat'
export type DirectImportFormat = Exclude<DirectImportFormatHint, 'auto'>

export type DirectImportWarningCode =
  | 'empty-input'
  | 'input-truncated'
  | 'chat-roles-not-found'
  | 'chat-content-excluded'
  | 'chat-preamble-excluded'
  | 'chat-ui-chatter-excluded'
  | 'chapter-limit-reached'
  | 'preview-limit-reached'
  | 'title-truncated'

export interface DirectImportWarning {
  code: DirectImportWarningCode
  message: string
  line?: number
}

export type DirectImportPreviewKind =
  'content' | 'book-title' | 'chapter-heading' | 'role-label' | 'ui-chatter' | 'truncation'

export type DirectImportPreviewDisposition =
  'included' | 'included-and-used-as-title' | 'excluded' | 'used-as-title' | 'used-as-chapter-title'

export interface DirectImportPreviewItem {
  kind: DirectImportPreviewKind
  disposition: DirectImportPreviewDisposition
  startLine: number
  endLine: number
  excerpt: string
  reason: string
}

export interface DirectImportChapter {
  title: string
  content: string
  sourceStartLine: number
  sourceEndLine: number
}

export interface DirectImportPreview {
  originalCharacterCount: number
  processedCharacterCount: number
  sourceLineCount: number
  truncated: boolean
  items: DirectImportPreviewItem[]
}

export interface DirectImportInput {
  content: string
  format?: DirectImportFormatHint
  fileName?: string
}

export interface DirectImportResult {
  format: DirectImportFormat
  title: string
  chapters: DirectImportChapter[]
  warnings: DirectImportWarning[]
  preview: DirectImportPreview
}

interface SourceLine {
  text: string
  sourceLine: number | null
}

interface RoleLabel {
  role: 'assistant' | 'user'
  remainder: string
}

interface ChatSegment {
  role: RoleLabel['role'] | 'preamble'
  labelLine: number | null
  lines: SourceLine[]
}

interface Heading {
  title: string
  titleTruncated: boolean
  markdownLevel: 1 | 2 | null
}

const ASSISTANT_ROLES = new Set(['assistant', 'chatgpt', 'claude', 'gemini'])
const ROLE_NAME_PATTERN = '(assistant|chatgpt|claude|gemini|user|you|human)'
const SEMANTIC_CHAPTER_PATTERN =
  /^(?:chapter\s+(?:\d+|[ivxlcdm]+|[\p{L}]+)(?:\s*(?::|[.\u2013\u2014-])\s*.+)?|(?:prologue|epilogue|interlude)(?:\s*(?::|[.\u2013\u2014-])\s*.+)?)$/iu
const GENERIC_FILE_NAMES = new Set([
  'chat',
  'conversation',
  'document',
  'export',
  'story',
  'transcript',
  'untitled'
])
const UI_CHATTER_PATTERN =
  /^(?:copy|edit|share|retry|regenerate(?: response)?|good response|bad response|read aloud|message (?:chatgpt|claude|gemini)|chatgpt can make mistakes(?:\. check important info\.?)?)$/iu

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, '\n')
}

function boundedSlice(value: string): string {
  let result = value.slice(0, MAX_DIRECT_IMPORT_CHARACTERS)
  const lastCodeUnit = result.charCodeAt(result.length - 1)
  if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) result = result.slice(0, -1)
  return result
}

function cleanInlineMarkdown(value: string): string {
  return value
    .replace(/^#{1,6}\s*/, '')
    .replace(/\s+#+\s*$/, '')
    .replace(/^(?:\*\*|__)(.*)(?:\*\*|__)$/, '$1')
    .replace(/^['\u201c\u201d"]+|['\u201c\u201d"]+$/g, '')
}

function sanitizeTitle(value: string): { title: string; truncated: boolean } {
  const withoutControlCharacters = [...cleanInlineMarkdown(value).normalize('NFC')]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint <= 0x1f || codePoint === 0x7f ? ' ' : character
    })
    .join('')
  const cleaned = withoutControlCharacters.replace(/\s+/g, ' ').trim()
  const codePoints = [...cleaned]
  if (codePoints.length <= 160) return { title: cleaned, truncated: false }
  return { title: codePoints.slice(0, 159).join('').trimEnd() + '\u2026', truncated: true }
}

function titleFromFileName(
  fileName: string | undefined
): { title: string; truncated: boolean } | null {
  if (!fileName) return null
  const baseName =
    fileName
      .split(/[\\/]/)
      .at(-1)
      ?.replace(/\.(?:txt|md|markdown)$/iu, '') ?? ''
  const sanitized = sanitizeTitle(baseName)
  if (!sanitized.title || GENERIC_FILE_NAMES.has(sanitized.title.toLowerCase())) return null
  return sanitized
}

function parseRoleLabel(line: string): RoleLabel | null {
  const trimmed = line.trim()
  const colonLabel = trimmed.match(
    new RegExp(`^(?:\\*\\*|__)?${ROLE_NAME_PATTERN}(?:\\s+said)?\\s*:(?:\\*\\*|__)?\\s*(.*)$`, 'iu')
  )
  const markdownLabel = trimmed.match(
    new RegExp(`^(?:#{1,3}\\s+|(?:\\*\\*|__))${ROLE_NAME_PATTERN}(?:\\*\\*|__)?\\s*$`, 'iu')
  )
  const match = colonLabel ?? markdownLabel
  if (!match) return null
  const roleName = match[1].toLowerCase()
  return {
    role: ASSISTANT_ROLES.has(roleName) ? 'assistant' : 'user',
    remainder: colonLabel?.[2] ?? ''
  }
}

function countRoleLabels(lines: readonly string[]): { total: number; assistants: number } {
  let total = 0
  let assistants = 0
  for (const line of lines) {
    const label = parseRoleLabel(line)
    if (!label) continue
    total += 1
    if (label.role === 'assistant') assistants += 1
  }
  return { total, assistants }
}

function detectFormat(lines: readonly string[]): DirectImportFormat {
  const roles = countRoleLabels(lines)
  if (roles.total >= 2 && roles.assistants >= 1) return 'chat'
  if (lines.some((line) => /^(?:#{1,6}\s+|```|>\s+|[-*+]\s+|\d+\.\s+)/u.test(line))) {
    return 'markdown'
  }
  return 'txt'
}

function excerpt(value: string): string {
  const singleLine = value.replace(/\s+/g, ' ').trim()
  return [...singleLine].slice(0, 120).join('')
}

function parseHeading(value: string): Heading | null {
  const markdown = value.match(/^\s*(#{1,2})\s+(.+?)\s*#*\s*$/u)
  if (markdown) {
    const sanitized = sanitizeTitle(markdown[2])
    return sanitized.title
      ? {
          title: sanitized.title,
          titleTruncated: sanitized.truncated,
          markdownLevel: markdown[1].length as 1 | 2
        }
      : null
  }

  const candidate = value.trim()
  if (!SEMANTIC_CHAPTER_PATTERN.test(candidate)) return null
  const sanitized = sanitizeTitle(candidate)
  return {
    title: sanitized.title,
    titleTruncated: sanitized.truncated,
    markdownLevel: null
  }
}

function sourceRange(lines: readonly SourceLine[], fallbackLine: number): [number, number] {
  const sourceLines = lines
    .map((line) => line.sourceLine)
    .filter((line): line is number => line !== null)
  if (sourceLines.length === 0) return [fallbackLine, fallbackLine]
  return [Math.min(...sourceLines), Math.max(...sourceLines)]
}

function trimBlankLines(lines: readonly SourceLine[]): SourceLine[] {
  let start = 0
  let end = lines.length
  while (start < end && !lines[start].text.trim()) start += 1
  while (end > start && !lines[end - 1].text.trim()) end -= 1
  return lines.slice(start, end)
}

export function parseDirectImport(input: DirectImportInput): DirectImportResult {
  const formatHint = input.format ?? 'auto'
  const originalContent = typeof input.content === 'string' ? input.content : ''
  const truncated = originalContent.length > MAX_DIRECT_IMPORT_CHARACTERS
  const normalized = normalizeNewlines(truncated ? boundedSlice(originalContent) : originalContent)
  const rawLines = normalized.split('\n')
  const format = formatHint === 'auto' ? detectFormat(rawLines) : formatHint
  const warnings: DirectImportWarning[] = []
  const previewItems: DirectImportPreviewItem[] = []
  let previewLimitWarningAdded = false

  const addWarning = (warning: DirectImportWarning): void => {
    if (!warnings.some((item) => item.code === warning.code && item.line === warning.line)) {
      warnings.push(warning)
    }
  }
  const addPreview = (item: DirectImportPreviewItem): void => {
    if (previewItems.length < MAX_DIRECT_IMPORT_PREVIEW_ITEMS) {
      previewItems.push(item)
      return
    }
    if (!previewLimitWarningAdded) {
      previewLimitWarningAdded = true
      addWarning({
        code: 'preview-limit-reached',
        message: `Only the first ${MAX_DIRECT_IMPORT_PREVIEW_ITEMS} preview decisions are shown.`
      })
    }
  }

  if (truncated) {
    addWarning({
      code: 'input-truncated',
      message: `The import exceeded ${MAX_DIRECT_IMPORT_CHARACTERS.toLocaleString('en-US')} characters and was truncated for safety.`
    })
    addPreview({
      kind: 'truncation',
      disposition: 'excluded',
      startLine: rawLines.length,
      endLine: rawLines.length,
      excerpt: '',
      reason: 'Content beyond the safe import limit was not processed.'
    })
  }

  if (!normalized.trim()) {
    addWarning({ code: 'empty-input', message: 'The imported text is empty.' })
  }

  let selectedLines: SourceLine[]
  if (format !== 'chat') {
    selectedLines = rawLines.map((text, index) => ({ text, sourceLine: index + 1 }))
    addPreview({
      kind: 'content',
      disposition: 'included',
      startLine: 1,
      endLine: rawLines.length,
      excerpt: excerpt(normalized),
      reason: 'Source content is included in the import.'
    })
  } else {
    const segments: ChatSegment[] = []
    let current: ChatSegment = { role: 'preamble', labelLine: null, lines: [] }
    for (let index = 0; index < rawLines.length; index += 1) {
      const lineNumber = index + 1
      const label = parseRoleLabel(rawLines[index])
      if (!label) {
        current.lines.push({ text: rawLines[index], sourceLine: lineNumber })
        continue
      }
      segments.push(current)
      current = { role: label.role, labelLine: lineNumber, lines: [] }
      addPreview({
        kind: 'role-label',
        disposition: 'excluded',
        startLine: lineNumber,
        endLine: lineNumber,
        excerpt: excerpt(rawLines[index]),
        reason: 'Conversation role labels are not story content.'
      })
      if (label.remainder) current.lines.push({ text: label.remainder, sourceLine: lineNumber })
    }
    segments.push(current)

    const assistantSegments = segments.filter(
      (segment) => segment.role === 'assistant' && trimBlankLines(segment.lines).length > 0
    )
    const useAssistantOnly = assistantSegments.length > 0
    if (!useAssistantOnly) {
      addWarning({
        code: 'chat-roles-not-found',
        message:
          'No assistant-authored blocks were found, so all non-label content is included for review.'
      })
    }

    selectedLines = []
    let excludedChatContent = 0
    let excludedPreamble = 0
    let excludedUiLines = 0
    for (const segment of segments) {
      const trimmedLines = trimBlankLines(segment.lines)
      if (trimmedLines.length === 0) continue
      const includeSegment = !useAssistantOnly || segment.role === 'assistant'
      if (!includeSegment) {
        const [startLine, endLine] = sourceRange(trimmedLines, segment.labelLine ?? 1)
        addPreview({
          kind: 'content',
          disposition: 'excluded',
          startLine,
          endLine,
          excerpt: excerpt(trimmedLines.map((line) => line.text).join('\n')),
          reason:
            segment.role === 'preamble'
              ? 'Unlabelled text before the conversation is excluded but remains visible in this preview.'
              : 'User-authored conversation content is excluded in favour of assistant-authored story text.'
        })
        if (segment.role === 'preamble') excludedPreamble += 1
        else excludedChatContent += 1
        continue
      }

      const retained: SourceLine[] = []
      for (const line of trimmedLines) {
        if (UI_CHATTER_PATTERN.test(line.text.trim())) {
          excludedUiLines += 1
          addPreview({
            kind: 'ui-chatter',
            disposition: 'excluded',
            startLine: line.sourceLine ?? 1,
            endLine: line.sourceLine ?? 1,
            excerpt: excerpt(line.text),
            reason: 'This is a recognised conversation-interface control or disclaimer.'
          })
        } else {
          retained.push(line)
        }
      }
      const contentLines = trimBlankLines(retained)
      if (contentLines.length === 0) continue
      if (selectedLines.length > 0 && selectedLines.at(-1)?.text.trim()) {
        selectedLines.push({ text: '', sourceLine: null })
      }
      selectedLines.push(...contentLines)
      const [startLine, endLine] = sourceRange(contentLines, segment.labelLine ?? 1)
      addPreview({
        kind: 'content',
        disposition: 'included',
        startLine,
        endLine,
        excerpt: excerpt(contentLines.map((line) => line.text).join('\n')),
        reason:
          segment.role === 'assistant'
            ? 'Assistant-authored content is included as story text.'
            : 'No assistant block was detected, so this content is retained for review.'
      })
    }

    if (excludedChatContent > 0) {
      addWarning({
        code: 'chat-content-excluded',
        message: `${excludedChatContent} user-authored conversation block${excludedChatContent === 1 ? ' was' : 's were'} excluded; review the preview before importing.`
      })
    }
    if (excludedPreamble > 0) {
      addWarning({
        code: 'chat-preamble-excluded',
        message: `${excludedPreamble} unlabelled preamble block${excludedPreamble === 1 ? ' was' : 's were'} excluded; it remains visible in the preview.`
      })
    }
    if (excludedUiLines > 0) {
      addWarning({
        code: 'chat-ui-chatter-excluded',
        message: `${excludedUiLines} recognised conversation-interface line${excludedUiLines === 1 ? ' was' : 's were'} excluded.`
      })
    }
  }

  const firstContentIndex = selectedLines.findIndex((line) => line.text.trim())
  const firstHeading =
    firstContentIndex >= 0 ? parseHeading(selectedLines[firstContentIndex].text) : null
  const hasLaterHeading = selectedLines
    .slice(Math.max(0, firstContentIndex + 1))
    .some((line) => parseHeading(line.text) !== null)
  const firstHeadingIsBookTitle =
    firstHeading?.markdownLevel === 1 &&
    !SEMANTIC_CHAPTER_PATTERN.test(firstHeading.title) &&
    (hasLaterHeading || selectedLines.length > firstContentIndex + 1)

  let titleCandidate: string | null = null
  let titleWasTruncated = false
  if (firstHeadingIsBookTitle && firstHeading && firstContentIndex >= 0) {
    titleCandidate = firstHeading.title
    titleWasTruncated = firstHeading.titleTruncated
    const titleLine = selectedLines[firstContentIndex].sourceLine ?? 1
    addPreview({
      kind: 'book-title',
      disposition: 'used-as-title',
      startLine: titleLine,
      endLine: titleLine,
      excerpt: excerpt(selectedLines[firstContentIndex].text),
      reason: 'The first level-one Markdown heading is used as the book title.'
    })
    selectedLines = selectedLines.filter((_, index) => index !== firstContentIndex)
  }

  const fileTitle = titleFromFileName(input.fileName)
  if (!titleCandidate && fileTitle) {
    titleCandidate = fileTitle.title
    titleWasTruncated = fileTitle.truncated
  }
  if (!titleCandidate) {
    const firstLine = selectedLines.find((line) => line.text.trim())
    const plainTitle = firstLine ? sanitizeTitle(firstLine.text) : { title: '', truncated: false }
    const plainCandidate = plainTitle.title
    if (
      plainCandidate &&
      !parseHeading(firstLine?.text ?? '') &&
      [...plainCandidate].length <= 100 &&
      !/[.!?]\s*$/u.test(plainCandidate)
    ) {
      titleCandidate = plainCandidate
      titleWasTruncated = plainTitle.truncated
      addPreview({
        kind: 'book-title',
        disposition: 'included-and-used-as-title',
        startLine: firstLine?.sourceLine ?? 1,
        endLine: firstLine?.sourceLine ?? 1,
        excerpt: excerpt(firstLine?.text ?? ''),
        reason: 'A short opening line is used as the title and remains in the story content.'
      })
    }
  }
  titleCandidate ??= 'Untitled import'
  const sanitizedTitle = sanitizeTitle(titleCandidate)
  if (titleWasTruncated || sanitizedTitle.truncated) {
    addWarning({
      code: 'title-truncated',
      message: 'The inferred title was shortened to at most 160 characters.'
    })
  }

  const chapters: DirectImportChapter[] = []
  let activeTitle = 'Chapter 1'
  let activeLines: SourceLine[] = []
  let activeHeadingLine = selectedLines.find((line) => line.sourceLine !== null)?.sourceLine ?? 1
  let headingsUsed = 0

  const commitChapter = (): void => {
    const contentLines = trimBlankLines(activeLines)
    const rangeLines = contentLines.length > 0 ? contentLines : activeLines
    const [sourceStartLine, sourceEndLine] = sourceRange(rangeLines, activeHeadingLine)
    chapters.push({
      title: activeTitle,
      content: contentLines.map((line) => line.text).join('\n'),
      sourceStartLine: Math.min(activeHeadingLine, sourceStartLine),
      sourceEndLine: Math.max(activeHeadingLine, sourceEndLine)
    })
  }

  for (const line of selectedLines) {
    const heading = parseHeading(line.text)
    if (!heading || headingsUsed >= MAX_DIRECT_IMPORT_CHAPTERS) {
      if (heading && headingsUsed === MAX_DIRECT_IMPORT_CHAPTERS) {
        addWarning({
          code: 'chapter-limit-reached',
          message: `Only the first ${MAX_DIRECT_IMPORT_CHAPTERS.toLocaleString('en-US')} headings were converted to chapters; later headings remain in the final chapter.`
        })
      }
      activeLines.push(line)
      continue
    }

    if (activeLines.some((candidate) => candidate.text.trim()) || headingsUsed > 0) commitChapter()
    activeTitle = heading.title
    activeLines = []
    activeHeadingLine = line.sourceLine ?? activeHeadingLine
    headingsUsed += 1
    addPreview({
      kind: 'chapter-heading',
      disposition: 'used-as-chapter-title',
      startLine: activeHeadingLine,
      endLine: activeHeadingLine,
      excerpt: excerpt(line.text),
      reason: 'This recognised heading starts a new chapter.'
    })
  }

  if (activeLines.some((line) => line.text.trim()) || headingsUsed > 0 || chapters.length === 0) {
    commitChapter()
  }

  return {
    format,
    title: sanitizedTitle.title || 'Untitled import',
    chapters,
    warnings,
    preview: {
      originalCharacterCount: originalContent.length,
      processedCharacterCount: normalized.length,
      sourceLineCount: rawLines.length,
      truncated,
      items: previewItems
    }
  }
}
