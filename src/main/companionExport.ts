import { createHash } from 'node:crypto'

export interface CompanionExportChapter {
  id: string
  title: string
  content: string
}

export interface CompanionExportBook {
  title: string
  subtitle?: string
  author?: string
  blurb?: string
  coverDataUrl?: string
  chapters: readonly CompanionExportChapter[]
}

interface PreparedCompanionBook {
  title: string
  subtitle: string
  author: string
  blurb: string
  coverDataUrl: string
  storageKey: string
  chapters: CompanionExportChapter[]
}

const COMPANION_STYLES = String.raw`
:root {
  color-scheme: light;
  --background: #f7f4ed;
  --surface: #fffdf8;
  --surface-strong: #eee8dc;
  --text: #27241f;
  --muted: #6e675d;
  --line: #d8d0c3;
  --accent: #755b3b;
  --accent-contrast: #fffaf2;
  --reader-font: Georgia, 'Times New Roman', serif;
  --reader-size: 1.1rem;
  --reader-line-height: 1.78;
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  min-width: 280px;
  background: var(--background);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
body[data-theme='sepia'] {
  --background: #eee2ca;
  --surface: #f8efd9;
  --surface-strong: #e4d4b5;
  --text: #3e3021;
  --muted: #76634c;
  --line: #cdbb9b;
  --accent: #76532d;
  --accent-contrast: #fff8e8;
}
body[data-theme='dark'] {
  color-scheme: dark;
  --background: #171614;
  --surface: #22201d;
  --surface-strong: #302d28;
  --text: #eee8de;
  --muted: #aaa196;
  --line: #444039;
  --accent: #c8a877;
  --accent-contrast: #19140e;
}
body[data-font='sans'] { --reader-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
body[data-size='small'] { --reader-size: 0.98rem; }
body[data-size='large'] { --reader-size: 1.25rem; }

.reading-progress {
  position: fixed;
  inset: 0 0 auto;
  z-index: 20;
  width: 100%;
  height: 4px;
  border: 0;
  appearance: none;
  background: var(--surface-strong);
}
.reading-progress::-webkit-progress-bar { background: var(--surface-strong); }
.reading-progress::-webkit-progress-value { background: var(--accent); }
.reading-progress::-moz-progress-bar { background: var(--accent); }

.app-shell {
  display: grid;
  grid-template-columns: minmax(210px, 280px) minmax(0, 1fr);
  min-height: 100vh;
}
.sidebar {
  position: sticky;
  top: 0;
  height: 100vh;
  overflow: auto;
  padding: 1.5rem 1rem;
  border-right: 1px solid var(--line);
  background: var(--surface);
}
.book-mark { display: grid; gap: 0.75rem; margin-bottom: 1.25rem; }
.cover {
  width: min(150px, 70%);
  aspect-ratio: 2 / 3;
  object-fit: cover;
  border-radius: 0.45rem;
  box-shadow: 0 8px 22px rgb(0 0 0 / 16%);
}
.sidebar h1 { margin: 0; font-family: Georgia, serif; font-size: 1.35rem; line-height: 1.2; }
.subtitle, .author, .muted { color: var(--muted); }
.subtitle, .author { margin: 0; line-height: 1.4; }
.toc-heading { margin: 1.4rem 0 0.55rem; font-size: 0.78rem; letter-spacing: 0.08em; text-transform: uppercase; }
.toc { display: grid; gap: 0.25rem; }
.toc-button {
  width: 100%;
  border: 0;
  border-radius: 0.4rem;
  padding: 0.55rem 0.65rem;
  background: transparent;
  color: var(--text);
  text-align: left;
  font: inherit;
  cursor: pointer;
}
.toc-button:hover, .toc-button:focus-visible { background: var(--surface-strong); outline: none; }
.toc-button[aria-current='true'] { background: var(--surface-strong); color: var(--accent); font-weight: 650; }

.reader-shell { min-width: 0; }
.toolbar {
  position: sticky;
  top: 4px;
  z-index: 10;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.55rem;
  padding: 0.7rem 1rem;
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--background) 92%, transparent);
  backdrop-filter: blur(12px);
}
.control-group { display: inline-flex; align-items: center; gap: 0.3rem; }
.toolbar label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
button, select {
  min-height: 2.35rem;
  border: 1px solid var(--line);
  border-radius: 0.45rem;
  padding: 0.4rem 0.65rem;
  background: var(--surface);
  color: var(--text);
  font: inherit;
}
button { cursor: pointer; }
button:hover:not(:disabled), button:focus-visible, select:focus-visible { border-color: var(--accent); outline: 2px solid transparent; }
button:disabled { cursor: default; opacity: 0.45; }

.reader {
  width: min(100% - 2rem, 760px);
  margin: 0 auto;
  padding: clamp(2rem, 7vw, 5rem) 0 4rem;
}
.chapter-kicker { margin: 0 0 0.6rem; color: var(--muted); font-size: 0.82rem; letter-spacing: 0.08em; text-transform: uppercase; }
.chapter-title { margin: 0 0 2.25rem; font-family: var(--reader-font); font-size: clamp(2rem, 7vw, 3.5rem); line-height: 1.1; }
.chapter-content { font-family: var(--reader-font); font-size: var(--reader-size); line-height: var(--reader-line-height); }
.chapter-content p { margin: 0 0 1.25em; }
.chapter-content p:first-child::first-letter { font-size: 1.2em; }
.empty { color: var(--muted); font-style: italic; }
.chapter-navigation { display: flex; justify-content: space-between; gap: 1rem; margin-top: 3.25rem; padding-top: 1.25rem; border-top: 1px solid var(--line); }
.blurb { margin: 1rem 0 0; color: var(--muted); font-family: var(--reader-font); line-height: 1.6; }
.print-book { display: none; }

@media (max-width: 760px) {
  .app-shell { display: block; }
  .sidebar {
    position: static;
    width: 100%;
    height: auto;
    max-height: none;
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }
  .book-mark { grid-template-columns: auto minmax(0, 1fr); align-items: center; }
  .cover { width: 72px; }
  .toc { grid-template-columns: repeat(auto-fit, minmax(145px, 1fr)); }
  .toolbar { justify-content: flex-start; overflow-x: auto; flex-wrap: nowrap; }
  .reader { width: min(100% - 2rem, 680px); padding-top: 2.5rem; }
}

@media (max-width: 430px) {
  .sidebar { padding: 1rem; }
  .toolbar { padding-inline: 0.75rem; }
  .reader { width: calc(100% - 1.5rem); }
  .chapter-navigation button { flex: 1; }
}

@media print {
  @page { margin: 20mm 18mm 22mm; }
  :root { --text: #111; }
  body { background: #fff; color: #111; }
  .reading-progress, .app-shell { display: none !important; }
  .print-book { display: block; font-family: Georgia, 'Times New Roman', serif; font-size: 11pt; line-height: 1.6; }
  .print-title { min-height: 75vh; display: grid; align-content: center; text-align: center; break-after: page; }
  .print-title h1 { margin: 0; font-size: 30pt; }
  .print-chapter { break-before: page; }
  .print-chapter h2 { font-size: 22pt; }
  .print-chapter p { orphans: 3; widows: 3; }
}
`

const COMPANION_RUNTIME_TEMPLATE = String.raw`(() => {
  'use strict'

  const encodedPayload = __STORYBOUND_PAYLOAD__
  const decodePayload = (encoded) => {
    const binary = atob(encoded)
    let percentEncoded = ''
    for (let index = 0; index < binary.length; index += 1) {
      percentEncoded += '%' + binary.charCodeAt(index).toString(16).padStart(2, '0')
    }
    return JSON.parse(decodeURIComponent(percentEncoded))
  }

  const data = decodePayload(encodedPayload)
  const chapterCount = data.chapters.length
  const body = document.body
  const titleNode = document.getElementById('book-title')
  const subtitleNode = document.getElementById('book-subtitle')
  const authorNode = document.getElementById('book-author')
  const blurbNode = document.getElementById('book-blurb')
  const coverNode = document.getElementById('book-cover')
  const tocNode = document.getElementById('chapter-toc')
  const chapterKickerNode = document.getElementById('chapter-kicker')
  const chapterTitleNode = document.getElementById('chapter-title')
  const chapterContentNode = document.getElementById('chapter-content')
  const previousButton = document.getElementById('previous-chapter')
  const nextButton = document.getElementById('next-chapter')
  const themeSelect = document.getElementById('theme-select')
  const fontSelect = document.getElementById('font-select')
  const smallerButton = document.getElementById('smaller-text')
  const largerButton = document.getElementById('larger-text')
  const progressNode = document.getElementById('reading-progress')
  const printBookNode = document.getElementById('print-book')
  const sizeOrder = ['small', 'normal', 'large']
  let currentIndex = 0
  let saveTimer = 0

  const renderProse = (container, content, emptyMessage) => {
    container.replaceChildren()
    const normalized = String(content || '').replace(/\r\n?/g, '\n').trim()
    if (!normalized) {
      const empty = document.createElement('p')
      empty.className = 'empty'
      empty.textContent = emptyMessage
      container.append(empty)
      return
    }

    for (const block of normalized.split(/\n{2,}/)) {
      const paragraph = document.createElement('p')
      const lines = block.split('\n')
      lines.forEach((line, lineIndex) => {
        if (lineIndex > 0) paragraph.append(document.createElement('br'))
        paragraph.append(document.createTextNode(line))
      })
      container.append(paragraph)
    }
  }

  const readState = () => {
    try {
      const value = localStorage.getItem(data.storageKey)
      if (!value) return {}
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  const scrollFraction = () => {
    const available = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
    return available > 0 ? Math.min(1, Math.max(0, window.scrollY / available)) : 0
  }

  const updateProgress = () => {
    const withinChapter = scrollFraction()
    const overall = chapterCount > 0 ? ((currentIndex + withinChapter) / chapterCount) * 100 : 0
    const rounded = Math.round(overall)
    progressNode.value = overall
    progressNode.setAttribute('aria-valuenow', String(rounded))
    progressNode.setAttribute('aria-valuetext', rounded + '% read')
  }

  const saveState = () => {
    if (chapterCount === 0) return
    const value = {
      chapterId: data.chapters[currentIndex].id,
      scrollFraction: scrollFraction(),
      theme: body.dataset.theme,
      font: body.dataset.font,
      size: body.dataset.size
    }
    try {
      localStorage.setItem(data.storageKey, JSON.stringify(value))
    } catch {
      // Some file:// viewers disable storage. Reading still works without resume.
    }
  }

  const queueSave = () => {
    window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(saveState, 160)
  }

  const scrollToFraction = (fraction) => {
    const safeFraction = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0
    const scroll = () => {
      const available = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
      window.scrollTo(0, available * safeFraction)
      updateProgress()
    }
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(scroll)
    else window.setTimeout(scroll, 0)
  }

  const renderChapter = (index, resumeFraction) => {
    if (chapterCount === 0) {
      chapterKickerNode.textContent = 'No chapters'
      chapterTitleNode.textContent = data.title
      renderProse(chapterContentNode, '', 'This companion does not contain any chapters yet.')
      previousButton.disabled = true
      nextButton.disabled = true
      updateProgress()
      return
    }

    currentIndex = Math.min(chapterCount - 1, Math.max(0, index))
    const chapter = data.chapters[currentIndex]
    chapterKickerNode.textContent = 'Chapter ' + (currentIndex + 1) + ' of ' + chapterCount
    chapterTitleNode.textContent = chapter.title || 'Untitled chapter'
    renderProse(chapterContentNode, chapter.content, 'This chapter is empty.')
    previousButton.disabled = currentIndex === 0
    nextButton.disabled = currentIndex === chapterCount - 1
    previousButton.setAttribute('aria-label', currentIndex > 0 ? 'Previous: ' + data.chapters[currentIndex - 1].title : 'No previous chapter')
    nextButton.setAttribute('aria-label', currentIndex < chapterCount - 1 ? 'Next: ' + data.chapters[currentIndex + 1].title : 'No next chapter')

    tocNode.querySelectorAll('.toc-button').forEach((button, buttonIndex) => {
      if (buttonIndex === currentIndex) button.setAttribute('aria-current', 'true')
      else button.removeAttribute('aria-current')
    })
    scrollToFraction(resumeFraction || 0)
    queueSave()
  }

  const goToChapter = (index) => {
    saveState()
    renderChapter(index, 0)
  }

  const createToc = () => {
    data.chapters.forEach((chapter, index) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'toc-button'
      button.textContent = chapter.title || 'Untitled chapter'
      button.addEventListener('click', () => goToChapter(index))
      tocNode.append(button)
    })
    if (chapterCount === 0) {
      const empty = document.createElement('p')
      empty.className = 'muted'
      empty.textContent = 'No chapters'
      tocNode.append(empty)
    }
  }

  const createPrintBook = () => {
    const titlePage = document.createElement('section')
    titlePage.className = 'print-title'
    const title = document.createElement('h1')
    title.textContent = data.title
    titlePage.append(title)
    if (data.subtitle) {
      const subtitle = document.createElement('p')
      subtitle.textContent = data.subtitle
      titlePage.append(subtitle)
    }
    if (data.author) {
      const author = document.createElement('p')
      author.textContent = 'By ' + data.author
      titlePage.append(author)
    }
    printBookNode.append(titlePage)

    data.chapters.forEach((chapter) => {
      const section = document.createElement('section')
      section.className = 'print-chapter'
      const heading = document.createElement('h2')
      heading.textContent = chapter.title || 'Untitled chapter'
      section.append(heading)
      const content = document.createElement('div')
      renderProse(content, chapter.content, 'This chapter is empty.')
      section.append(content)
      printBookNode.append(section)
    })
  }

  titleNode.textContent = data.title
  if (data.subtitle) subtitleNode.textContent = data.subtitle
  else subtitleNode.hidden = true
  if (data.author) authorNode.textContent = 'By ' + data.author
  else authorNode.hidden = true
  if (data.blurb) renderProse(blurbNode, data.blurb, '')
  else blurbNode.hidden = true
  if (data.coverDataUrl) {
    coverNode.src = data.coverDataUrl
    coverNode.alt = 'Cover of ' + data.title
  } else coverNode.hidden = true

  const state = readState()
  body.dataset.theme = ['light', 'sepia', 'dark'].includes(state.theme) ? state.theme : 'light'
  body.dataset.font = ['serif', 'sans'].includes(state.font) ? state.font : 'serif'
  body.dataset.size = sizeOrder.includes(state.size) ? state.size : 'normal'
  themeSelect.value = body.dataset.theme
  fontSelect.value = body.dataset.font

  createToc()
  createPrintBook()
  const resumeIndex = data.chapters.findIndex((chapter) => chapter.id === state.chapterId)
  renderChapter(resumeIndex >= 0 ? resumeIndex : 0, resumeIndex >= 0 ? Number(state.scrollFraction) : 0)

  previousButton.addEventListener('click', () => goToChapter(currentIndex - 1))
  nextButton.addEventListener('click', () => goToChapter(currentIndex + 1))
  themeSelect.addEventListener('change', () => {
    body.dataset.theme = themeSelect.value
    queueSave()
  })
  fontSelect.addEventListener('change', () => {
    body.dataset.font = fontSelect.value
    queueSave()
  })
  smallerButton.addEventListener('click', () => {
    const index = Math.max(0, sizeOrder.indexOf(body.dataset.size) - 1)
    body.dataset.size = sizeOrder[index]
    queueSave()
  })
  largerButton.addEventListener('click', () => {
    const index = Math.min(sizeOrder.length - 1, sizeOrder.indexOf(body.dataset.size) + 1)
    body.dataset.size = sizeOrder[index]
    queueSave()
  })
  window.addEventListener('scroll', () => {
    updateProgress()
    queueSave()
  }, { passive: true })
  window.addEventListener('beforeunload', saveState)
})()`

function normalizeText(value: unknown, field: string, optional = false): string {
  if (value === undefined && optional) return ''
  if (typeof value !== 'string') throw new TypeError(`${field} must be a string.`)
  return value.replace(/\r\n?/g, '\n')
}

function prepareBook(input: CompanionExportBook): PreparedCompanionBook {
  if (!input || typeof input !== 'object') {
    throw new TypeError('A book descriptor is required.')
  }
  if (!Array.isArray(input.chapters)) {
    throw new TypeError('Book chapters must be an array.')
  }

  const seenChapterIds = new Set<string>()
  const chapters = input.chapters.map((chapter, index) => {
    if (!chapter || typeof chapter !== 'object') {
      throw new TypeError(`Chapter ${index + 1} must be an object.`)
    }
    const id = normalizeText(chapter.id, `Chapter ${index + 1} id`).trim()
    if (!id) throw new Error(`Chapter ${index + 1} must have an id.`)
    if (seenChapterIds.has(id)) throw new Error(`Chapter id "${id}" is duplicated.`)
    seenChapterIds.add(id)
    return {
      id,
      title: normalizeText(chapter.title, `Chapter ${index + 1} title`),
      content: normalizeText(chapter.content, `Chapter ${index + 1} content`)
    }
  })

  const coverDataUrl = normalizeText(input.coverDataUrl, 'Cover data URL', true)
  if (
    coverDataUrl &&
    !/^data:image\/(?:png|jpeg|webp|gif|avif);base64,[a-z0-9+/]*={0,2}$/i.test(coverDataUrl)
  ) {
    throw new Error('Cover data URL must be a base64 PNG, JPEG, WebP, GIF, or AVIF image.')
  }

  const title = normalizeText(input.title, 'Book title').trim() || 'Untitled book'
  const storageFingerprint = JSON.stringify({
    title,
    chapters: chapters.map((chapter) => chapter.id)
  })

  return {
    title,
    subtitle: normalizeText(input.subtitle, 'Book subtitle', true).trim(),
    author: normalizeText(input.author, 'Book author', true).trim(),
    blurb: normalizeText(input.blurb, 'Book blurb', true).trim(),
    coverDataUrl,
    storageKey: `storybound-companion-${createHash('sha256').update(storageFingerprint).digest('hex').slice(0, 20)}`,
    chapters
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function cspHash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64')
}

/**
 * Build a single-file, offline reader suitable for opening directly from file://.
 * User-authored text is transported as base64 JSON and inserted into the document with text nodes.
 */
export function buildOfflineCompanionHtml(input: CompanionExportBook): string {
  const book = prepareBook(input)
  const payload = Buffer.from(JSON.stringify(book), 'utf8').toString('base64')
  const runtime = COMPANION_RUNTIME_TEMPLATE.replace(
    '__STORYBOUND_PAYLOAD__',
    JSON.stringify(payload)
  )
  const policy = [
    "default-src 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
    "connect-src 'none'",
    "font-src 'none'",
    "media-src 'none'",
    "manifest-src 'none'",
    "worker-src 'none'",
    'img-src data:',
    `style-src 'sha256-${cspHash(COMPANION_STYLES)}'`,
    `script-src 'sha256-${cspHash(runtime)}'`
  ].join('; ')

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="color-scheme" content="light dark">
  <meta http-equiv="Content-Security-Policy" content="${policy}">
  <title>${escapeHtml(book.title)} · Storybound companion</title>
  <style>${COMPANION_STYLES}</style>
</head>
<body data-theme="light" data-font="serif" data-size="normal">
  <progress id="reading-progress" class="reading-progress" max="100" value="0" role="progressbar" aria-label="Reading progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"></progress>
  <div class="app-shell">
    <aside class="sidebar" aria-label="Book contents">
      <div class="book-mark">
        <img id="book-cover" class="cover" alt="" hidden>
        <div>
          <h1 id="book-title"></h1>
          <p id="book-subtitle" class="subtitle"></p>
          <p id="book-author" class="author"></p>
        </div>
      </div>
      <div id="book-blurb" class="blurb"></div>
      <h2 class="toc-heading">Contents</h2>
      <nav id="chapter-toc" class="toc" aria-label="Chapters"></nav>
    </aside>
    <div class="reader-shell">
      <header class="toolbar" aria-label="Reading settings">
        <div class="control-group">
          <label for="theme-select">Theme</label>
          <select id="theme-select" aria-label="Theme">
            <option value="light">Light</option>
            <option value="sepia">Sepia</option>
            <option value="dark">Dark</option>
          </select>
        </div>
        <div class="control-group">
          <label for="font-select">Font</label>
          <select id="font-select" aria-label="Font">
            <option value="serif">Serif</option>
            <option value="sans">Sans</option>
          </select>
        </div>
        <div class="control-group" aria-label="Text size">
          <button id="smaller-text" type="button" aria-label="Make text smaller">A−</button>
          <button id="larger-text" type="button" aria-label="Make text larger">A+</button>
        </div>
      </header>
      <main class="reader" tabindex="-1">
        <p id="chapter-kicker" class="chapter-kicker"></p>
        <h2 id="chapter-title" class="chapter-title"></h2>
        <article id="chapter-content" class="chapter-content"></article>
        <nav class="chapter-navigation" aria-label="Chapter navigation">
          <button id="previous-chapter" type="button">← Previous</button>
          <button id="next-chapter" type="button">Next →</button>
        </nav>
      </main>
    </div>
  </div>
  <main id="print-book" class="print-book"></main>
  <script>${runtime}</script>
</body>
</html>`
}
