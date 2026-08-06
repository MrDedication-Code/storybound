import AdmZip from 'adm-zip'
import { describe, expect, it } from 'vitest'
import {
  buildBookEpub3,
  buildBookMarkdown,
  buildBookPrintHtml,
  EPUB_MEDIA_TYPE,
  type StandardExportInput
} from '../../src/main/standardExport'
import type { BookDetail, Chapter } from '../../src/shared/types'

const timestamp = '2026-08-05T10:00:00.000Z'

function chapter(id: string, title: string, position: number, content: string): Chapter {
  return {
    id,
    bookId: 'book-1',
    title,
    position,
    createdAt: timestamp,
    updatedAt: timestamp,
    wordCount: content.trim() ? content.trim().split(/\s+/).length : 0,
    isRead: false,
    content
  }
}

function fixture(): StandardExportInput {
  const first = chapter(
    'chapter-1',
    'First & <Dawn>',
    0,
    'Light & shadow.\n\nA <script>alert(1)</script>.'
  )
  const second = chapter('chapter-2', 'Second "Night"', 1, 'Stars rise.\nAcross the water.')
  const book: BookDetail = {
    id: 'book-1',
    libraryId: 'library-1',
    title: 'A <River> & Stars',
    subtitle: 'Tales *from* [home]',
    seriesName: '',
    seriesPosition: null,
    authorName: 'A. Writer & Co.',
    blurb: 'A safe <journey> through two nights.',
    status: 'completed',
    languageCode: 'en-GB',
    sourceLabel: 'Private archive',
    sourceUrl: '',
    personalNotes: 'Keep the ending <quiet>.',
    rating: 4,
    isFavourite: true,
    isPinned: false,
    coverImageUrl: null,
    coverStyle: 'classic',
    coverPositionX: 50,
    coverPositionY: 50,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastOpenedAt: null,
    completedAt: timestamp,
    totalWordCount: first.wordCount + second.wordCount,
    chapterCount: 2,
    progressPercentage: 0,
    hasFinishedCurrentContent: false,
    isArchived: false,
    chapters: [first, second],
    tagIds: [],
    collectionIds: []
  }

  return { book, chapters: [second, first] }
}

function entryText(zip: AdmZip, path: string): string {
  const entry = zip.getEntry(path)
  if (!entry) throw new Error(`Missing ${path}`)
  return entry.getData().toString('utf8')
}

describe('standard book exports', () => {
  it('builds Markdown in canonical chapter order with readable metadata', () => {
    const markdown = buildBookMarkdown(fixture())

    expect(markdown).toContain('# A &lt;River&gt; &amp; Stars')
    expect(markdown).toContain('*Tales \\*from\\* \\[home\\]*')
    expect(markdown).toContain('**Author:** A\\. Writer &amp; Co\\.')
    expect(markdown).toContain('**Status:** Completed')
    expect(markdown).toContain('## Description\n\nA safe <journey> through two nights.')
    expect(markdown.indexOf('## First')).toBeLessThan(markdown.indexOf('## Second'))
    expect(markdown).toContain('A <script>alert(1)</script>.')
    expect(markdown.endsWith('\n')).toBe(true)
  })

  it('builds a deterministic, self-contained EPUB 3 archive with an uncompressed leading mimetype', () => {
    const input = fixture()
    const buffer = buildBookEpub3(input)
    expect(buildBookEpub3(input).equals(buffer)).toBe(true)

    expect(buffer.readUInt32LE(0)).toBe(0x04034b50)
    expect(buffer.readUInt16LE(8)).toBe(0)
    const firstNameLength = buffer.readUInt16LE(26)
    expect(buffer.subarray(30, 30 + firstNameLength).toString('utf8')).toBe('mimetype')

    const zip = new AdmZip(buffer)
    expect(zip.getEntries().map((entry) => entry.entryName)).toEqual([
      'mimetype',
      'META-INF/container.xml',
      'EPUB/package.opf',
      'EPUB/nav.xhtml',
      'EPUB/toc.ncx',
      'EPUB/styles/book.css',
      'EPUB/text/title.xhtml',
      'EPUB/text/chapter-001.xhtml',
      'EPUB/text/chapter-002.xhtml'
    ])
    expect(entryText(zip, 'mimetype')).toBe(EPUB_MEDIA_TYPE)
    expect(entryText(zip, 'META-INF/container.xml')).toContain('full-path="EPUB/package.opf"')

    const packageXml = entryText(zip, 'EPUB/package.opf')
    expect(packageXml).toContain('version="3.0"')
    expect(packageXml).toContain('properties="nav"')
    expect(packageXml).toContain('href="toc.ncx" media-type="application/x-dtbncx+xml"')
    expect(packageXml).toContain('<dc:title>A &lt;River&gt; &amp; Stars</dc:title>')
    expect(packageXml).toContain('<dc:creator>A. Writer &amp; Co.</dc:creator>')
    expect(packageXml).toContain('<meta property="dcterms:modified">2026-08-05T10:00:00Z</meta>')
    expect(packageXml.indexOf('href="text/chapter-001.xhtml"')).toBeLessThan(
      packageXml.indexOf('href="text/chapter-002.xhtml"')
    )
    expect(packageXml.indexOf('idref="chapter-1"')).toBeLessThan(
      packageXml.indexOf('idref="chapter-2"')
    )

    const navigation = entryText(zip, 'EPUB/nav.xhtml')
    expect(navigation).toContain('epub:type="toc"')
    expect(navigation.indexOf('First &amp; &lt;Dawn&gt;')).toBeLessThan(
      navigation.indexOf('Second &quot;Night&quot;')
    )
    const toc = entryText(zip, 'EPUB/toc.ncx')
    expect(toc).toContain('src="text/chapter-001.xhtml"')
    expect(toc).toContain('playOrder="2"')

    const firstChapter = entryText(zip, 'EPUB/text/chapter-001.xhtml')
    expect(firstChapter).toContain('<h1>First &amp; &lt;Dawn&gt;</h1>')
    expect(firstChapter).toContain('A &lt;script&gt;alert(1)&lt;/script&gt;.')
    expect(firstChapter).not.toContain('<script>')
    expect(packageXml).not.toContain('http://example.com')
  })

  it('builds a self-contained, print-ready HTML document with safe content and page breaks', () => {
    const html = buildBookPrintHtml(fixture())

    expect(html).toMatch(/^<!doctype html>/)
    expect(html).toContain('<html lang="en-GB">')
    expect(html).toContain('<title>A &lt;River&gt; &amp; Stars</title>')
    expect(html).toContain('@page { margin: 22mm 20mm 24mm; size: auto; }')
    expect(html).toContain('.chapter { break-before: page; }')
    expect(html.indexOf('First &amp; &lt;Dawn&gt;')).toBeLessThan(
      html.indexOf('Second &quot;Night&quot;')
    )
    expect(html).toContain('A &lt;script&gt;alert(1)&lt;/script&gt;.')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<link rel="stylesheet"')
    expect(html).not.toContain('<img')
  })

  it('exports a valid title-only EPUB when a book has no chapters', () => {
    const input = fixture()
    input.book.chapters = []
    input.book.chapterCount = 0
    input.chapters = []

    const zip = new AdmZip(buildBookEpub3(input))
    expect(zip.getEntry('EPUB/text/title.xhtml')).not.toBeNull()
    expect(zip.getEntries().some((entry) => /chapter-\d+\.xhtml$/.test(entry.entryName))).toBe(
      false
    )
    expect(entryText(zip, 'EPUB/nav.xhtml')).toContain('<ol>')
  })

  it('rejects missing, duplicate, unrelated, and unexpected chapter payloads', () => {
    const missing = fixture()
    missing.chapters = [missing.chapters[0]]
    expect(() => buildBookMarkdown(missing)).toThrow('missing its export content')

    const duplicate = fixture()
    duplicate.chapters = [duplicate.chapters[0], duplicate.chapters[0], duplicate.chapters[1]]
    expect(() => buildBookEpub3(duplicate)).toThrow('supplied more than once')

    const unrelated = fixture()
    unrelated.chapters = [{ ...unrelated.chapters[0], bookId: 'another-book' }]
    expect(() => buildBookPrintHtml(unrelated)).toThrow('does not belong to this book')

    const unexpected = fixture()
    unexpected.chapters = [
      ...unexpected.chapters,
      chapter('unexpected-chapter', 'Unexpected', 3, 'Extra')
    ]
    expect(() => buildBookMarkdown(unexpected)).toThrow('is not part of this book')

    const duplicateIds = fixture()
    duplicateIds.book.chapters = [
      duplicateIds.book.chapters[0],
      { ...duplicateIds.book.chapters[0] }
    ]
    expect(() => buildBookMarkdown(duplicateIds)).toThrow('duplicate chapter identifiers')
  })

  it('removes characters that XML 1.0 cannot represent', () => {
    const input = fixture()
    input.book.title = 'Clean\u0000 title\ud800'
    input.chapters[0].content = 'Before\u0007after'

    const zip = new AdmZip(buildBookEpub3(input))
    expect(entryText(zip, 'EPUB/package.opf')).toContain('<dc:title>Clean title�</dc:title>')
    expect(entryText(zip, 'EPUB/text/chapter-002.xhtml')).toContain('Beforeafter')
  })
})
