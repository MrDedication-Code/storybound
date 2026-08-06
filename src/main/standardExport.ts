import AdmZip from 'adm-zip'
import type { BookDetail, Chapter } from '../shared/types'

export const EPUB_MEDIA_TYPE = 'application/epub+zip'

export interface StandardExportInput {
  book: BookDetail
  chapters: readonly Chapter[]
}

interface PreparedExport {
  book: BookDetail
  chapters: Chapter[]
}

const ZIP_TIMESTAMP = new Date('1980-01-01T00:00:00.000Z')

function cleanXmlText(value: string): string {
  let result = ''
  for (const character of String(value ?? '')) {
    const codePoint = character.codePointAt(0) as number
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
      result += '\ufffd'
    } else if (
      codePoint === 0x09 ||
      codePoint === 0x0a ||
      codePoint === 0x0d ||
      (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
      (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
      (codePoint >= 0x10000 && codePoint <= 0x10ffff)
    ) {
      result += character
    }
  }
  return result
}

function escapeXml(value: string): string {
  return cleanXmlText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function escapeMarkdownInline(value: string): string {
  return cleanXmlText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([\\`*_{}[\]()#+.!|~-])/g, '\\$1')
    .replace(/[\r\n]+/g, ' ')
    .trim()
}

function requireCompleteChapters(input: StandardExportInput): PreparedExport {
  const expectedIds = input.book.chapters.map((chapter) => chapter.id)
  const expectedIdSet = new Set(expectedIds)
  if (expectedIdSet.size !== expectedIds.length) {
    throw new Error('The book contains duplicate chapter identifiers and cannot be exported.')
  }

  const chapterById = new Map<string, Chapter>()
  for (const chapter of input.chapters) {
    if (chapter.bookId !== input.book.id) {
      throw new Error(`Chapter "${chapter.title}" does not belong to this book.`)
    }
    if (!expectedIdSet.has(chapter.id)) {
      throw new Error(`Chapter "${chapter.title}" is not part of this book.`)
    }
    if (chapterById.has(chapter.id)) {
      throw new Error(`Chapter "${chapter.title}" was supplied more than once.`)
    }
    chapterById.set(chapter.id, chapter)
  }

  const missingChapter = input.book.chapters.find((chapter) => !chapterById.has(chapter.id))
  if (missingChapter) {
    throw new Error(`Chapter "${missingChapter.title}" is missing its export content.`)
  }

  return {
    book: input.book,
    chapters: expectedIds.map((id) => chapterById.get(id) as Chapter)
  }
}

function epubModifiedDate(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.valueOf())) return '1980-01-01T00:00:00Z'
  return parsed.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function languageCode(value: string): string {
  const normalized = value.trim()
  return normalized || 'und'
}

function chapterFileNames(count: number): string[] {
  const width = Math.max(3, String(count).length)
  return Array.from(
    { length: count },
    (_, index) => `text/chapter-${String(index + 1).padStart(width, '0')}.xhtml`
  )
}

function proseToXhtml(content: string): string {
  const normalized = cleanXmlText(content).replace(/\r\n?/g, '\n')
  if (!normalized.trim()) return '<p class="empty-chapter">&#160;</p>'

  return normalized
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeXml(block).replace(/\n/g, '<br />\n')}</p>`)
    .join('\n')
}

function metadataLines(book: BookDetail): string[] {
  const lines = [`**Author:** ${escapeMarkdownInline(book.authorName || 'Unknown author')}`]
  if (book.languageCode) lines.push(`**Language:** ${escapeMarkdownInline(book.languageCode)}`)
  lines.push(`**Status:** ${book.status === 'completed' ? 'Completed' : 'Ongoing'}`)
  if (book.sourceLabel) lines.push(`**Source:** ${escapeMarkdownInline(book.sourceLabel)}`)
  if (book.rating !== null) lines.push(`**Rating:** ${book.rating}/5`)
  return lines
}

/** Build a readable, standalone Markdown document without mutating the input. */
export function buildBookMarkdown(input: StandardExportInput): string {
  const { book, chapters } = requireCompleteChapters(input)
  const sections = [`# ${escapeMarkdownInline(book.title || 'Untitled book')}`]

  if (book.subtitle) sections.push(`*${escapeMarkdownInline(book.subtitle)}*`)
  sections.push(metadataLines(book).join('\n'))
  if (book.blurb) sections.push(`## Description\n\n${book.blurb.trim()}`)
  if (book.personalNotes) sections.push(`## Notes\n\n${book.personalNotes.trim()}`)

  for (const chapter of chapters) {
    sections.push(
      `## ${escapeMarkdownInline(chapter.title || 'Untitled chapter')}\n\n${chapter.content}`
    )
  }

  return `${sections.join('\n\n')}\n`
}

function titlePageXhtml(book: BookDetail): string {
  const subtitle = book.subtitle ? `<p class="subtitle">${escapeXml(book.subtitle)}</p>` : ''
  const author = book.authorName
    ? `<p class="author">By ${escapeXml(book.authorName)}</p>`
    : '<p class="author">Unknown author</p>'
  const blurb = book.blurb ? `<div class="blurb">${proseToXhtml(book.blurb)}</div>` : ''

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${escapeXml(languageCode(book.languageCode))}" lang="${escapeXml(languageCode(book.languageCode))}">
<head>
  <meta charset="UTF-8" />
  <title>${escapeXml(book.title || 'Untitled book')}</title>
  <link rel="stylesheet" type="text/css" href="../styles/book.css" />
</head>
<body class="title-page">
  <main>
    <h1>${escapeXml(book.title || 'Untitled book')}</h1>
    ${subtitle}
    ${author}
    ${blurb}
  </main>
</body>
</html>`
}

function chapterXhtml(book: BookDetail, chapter: Chapter): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${escapeXml(languageCode(book.languageCode))}" lang="${escapeXml(languageCode(book.languageCode))}">
<head>
  <meta charset="UTF-8" />
  <title>${escapeXml(chapter.title || 'Untitled chapter')}</title>
  <link rel="stylesheet" type="text/css" href="../styles/book.css" />
</head>
<body>
  <main class="chapter">
    <h1>${escapeXml(chapter.title || 'Untitled chapter')}</h1>
    <div class="chapter-body">
      ${proseToXhtml(chapter.content)}
    </div>
  </main>
</body>
</html>`
}

function navigationXhtml(
  book: BookDetail,
  chapters: readonly Chapter[],
  files: readonly string[]
): string {
  const items = chapters
    .map(
      (chapter, index) =>
        `      <li><a href="${escapeXml(files[index])}">${escapeXml(chapter.title || 'Untitled chapter')}</a></li>`
    )
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(languageCode(book.languageCode))}" lang="${escapeXml(languageCode(book.languageCode))}">
<head>
  <meta charset="UTF-8" />
  <title>Contents</title>
  <link rel="stylesheet" type="text/css" href="styles/book.css" />
</head>
<body>
  <nav epub:type="toc" id="toc" role="doc-toc">
    <h1>Contents</h1>
    <ol>
${items}
    </ol>
  </nav>
  <nav epub:type="landmarks" hidden="hidden">
    <ol>
      <li><a epub:type="titlepage" href="text/title.xhtml">Title page</a></li>
    </ol>
  </nav>
</body>
</html>`
}

function legacyTableOfContents(
  book: BookDetail,
  chapters: readonly Chapter[],
  files: readonly string[]
): string {
  const points = chapters
    .map(
      (chapter, index) => `    <navPoint id="chapter-${index + 1}" playOrder="${index + 1}">
      <navLabel><text>${escapeXml(chapter.title || 'Untitled chapter')}</text></navLabel>
      <content src="${escapeXml(files[index])}" />
    </navPoint>`
    )
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${escapeXml(`urn:storybound:book:${book.id}`)}" />
    <meta name="dtb:depth" content="1" />
    <meta name="dtb:totalPageCount" content="0" />
    <meta name="dtb:maxPageNumber" content="0" />
  </head>
  <docTitle><text>${escapeXml(book.title || 'Untitled book')}</text></docTitle>
  <navMap>
${points}
  </navMap>
</ncx>`
}

function packageDocument(
  book: BookDetail,
  chapters: readonly Chapter[],
  files: readonly string[]
): string {
  const chapterItems = files
    .map(
      (file, index) =>
        `    <item id="chapter-${index + 1}" href="${escapeXml(file)}" media-type="application/xhtml+xml" />`
    )
    .join('\n')
  const chapterSpine = chapters
    .map((_, index) => `    <itemref idref="chapter-${index + 1}" />`)
    .join('\n')
  const creator = book.authorName
    ? `\n    <dc:creator>${escapeXml(book.authorName)}</dc:creator>`
    : ''
  const description = book.blurb
    ? `\n    <dc:description>${escapeXml(book.blurb)}</dc:description>`
    : ''

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${escapeXml(languageCode(book.languageCode))}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${escapeXml(`urn:storybound:book:${book.id}`)}</dc:identifier>
    <dc:title>${escapeXml(book.title || 'Untitled book')}</dc:title>${creator}
    <dc:language>${escapeXml(languageCode(book.languageCode))}</dc:language>${description}
    <meta property="dcterms:modified">${epubModifiedDate(book.updatedAt)}</meta>
  </metadata>
  <manifest>
    <item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />
    <item id="styles" href="styles/book.css" media-type="text/css" />
    <item id="title-page" href="text/title.xhtml" media-type="application/xhtml+xml" />
${chapterItems}
  </manifest>
  <spine toc="ncx">
    <itemref idref="title-page" linear="no" />
${chapterSpine}
  </spine>
</package>`
}

const EPUB_CSS = `body {
  color: #251f1a;
  font-family: Georgia, "Times New Roman", serif;
  line-height: 1.65;
  margin: 5%;
}
h1 {
  font-weight: normal;
  line-height: 1.2;
  margin: 2em 0 1.5em;
  text-align: center;
}
p { margin: 0 0 1em; }
.title-page { text-align: center; }
.title-page main { margin-top: 20%; }
.subtitle { font-style: italic; }
.author { margin-top: 2em; }
.blurb { margin: 4em auto 0; max-width: 34em; text-align: left; }
.chapter-body { margin: 0 auto; max-width: 40em; }
.empty-chapter { min-height: 1em; }
nav ol { padding-left: 1.5em; }
nav li { margin: 0.5em 0; }
`

function addDeterministicEntry(
  zip: AdmZip,
  path: string,
  content: string,
  uncompressed = false
): void {
  const entry = zip.addFile(path, Buffer.from(content, 'utf8'))
  entry.header.time = ZIP_TIMESTAMP
  if (uncompressed) entry.header.method = 0
}

/** Build a self-contained EPUB 3 archive. The returned buffer can be written directly to an .epub file. */
export function buildBookEpub3(input: StandardExportInput): Buffer {
  const { book, chapters } = requireCompleteChapters(input)
  const files = chapterFileNames(chapters.length)
  const zip = new AdmZip(undefined, { noSort: true })

  addDeterministicEntry(zip, 'mimetype', EPUB_MEDIA_TYPE, true)
  addDeterministicEntry(
    zip,
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>`
  )
  addDeterministicEntry(zip, 'EPUB/package.opf', packageDocument(book, chapters, files))
  addDeterministicEntry(zip, 'EPUB/nav.xhtml', navigationXhtml(book, chapters, files))
  addDeterministicEntry(zip, 'EPUB/toc.ncx', legacyTableOfContents(book, chapters, files))
  addDeterministicEntry(zip, 'EPUB/styles/book.css', EPUB_CSS)
  addDeterministicEntry(zip, 'EPUB/text/title.xhtml', titlePageXhtml(book))
  chapters.forEach((chapter, index) => {
    addDeterministicEntry(zip, `EPUB/${files[index]}`, chapterXhtml(book, chapter))
  })

  return zip.toBuffer()
}

function printMetadata(book: BookDetail): string {
  const items = [
    book.authorName ? `<p class="author">By ${escapeXml(book.authorName)}</p>` : '',
    book.languageCode ? `<p>${escapeXml(book.languageCode)}</p>` : '',
    `<p>${book.status === 'completed' ? 'Completed' : 'Ongoing'}</p>`,
    book.sourceLabel ? `<p>${escapeXml(book.sourceLabel)}</p>` : ''
  ]
  return items.filter(Boolean).join('\n      ')
}

/** Build a self-contained HTML document intended for Electron's webContents.printToPDF(). */
export function buildBookPrintHtml(input: StandardExportInput): string {
  const { book, chapters } = requireCompleteChapters(input)
  const subtitle = book.subtitle ? `<p class="subtitle">${escapeXml(book.subtitle)}</p>` : ''
  const description = book.blurb
    ? `<section class="front-matter"><h2>Description</h2>${proseToXhtml(book.blurb)}</section>`
    : ''
  const notes = book.personalNotes
    ? `<section class="front-matter"><h2>Notes</h2>${proseToXhtml(book.personalNotes)}</section>`
    : ''
  const chapterSections = chapters
    .map(
      (chapter) => `<section class="chapter">
      <h1>${escapeXml(chapter.title || 'Untitled chapter')}</h1>
      <div class="chapter-body">
        ${proseToXhtml(chapter.content)}
      </div>
    </section>`
    )
    .join('\n')

  return `<!doctype html>
<html lang="${escapeXml(languageCode(book.languageCode))}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeXml(book.title || 'Untitled book')}</title>
  <style>
    @page { margin: 22mm 20mm 24mm; size: auto; }
    * { box-sizing: border-box; }
    html { color: #251f1a; font-family: Georgia, "Times New Roman", serif; }
    body { font-size: 11pt; line-height: 1.62; margin: 0; }
    h1, h2 { break-after: avoid; font-weight: 500; line-height: 1.2; }
    p { margin: 0 0 0.85em; orphans: 3; widows: 3; }
    .title-page { align-items: center; break-after: page; display: flex; flex-direction: column; justify-content: center; min-height: 160mm; text-align: center; }
    .title-page h1 { font-size: 30pt; margin: 0; max-width: 150mm; }
    .subtitle { font-size: 15pt; font-style: italic; margin-top: 7mm; }
    .author { font-size: 13pt; margin-top: 12mm; }
    .book-meta { color: #665b52; margin-top: 12mm; }
    .book-meta p { margin-bottom: 1mm; }
    .front-matter { break-after: page; margin: 0 auto; max-width: 145mm; }
    .front-matter h2 { font-size: 18pt; margin: 0 0 10mm; }
    .chapter { break-before: page; }
    .chapter h1 { font-size: 21pt; margin: 18mm 0 14mm; text-align: center; }
    .chapter-body { margin: 0 auto; max-width: 145mm; }
    .chapter-body p + p { text-indent: 1.4em; }
    .empty-chapter { min-height: 1em; }
  </style>
</head>
<body>
  <main>
    <section class="title-page">
      <h1>${escapeXml(book.title || 'Untitled book')}</h1>
      ${subtitle}
      <div class="book-meta">
      ${printMetadata(book)}
      </div>
    </section>
    ${description}
    ${notes}
    ${chapterSections}
  </main>
</body>
</html>`
}
