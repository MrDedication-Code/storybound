import { createHash } from 'node:crypto'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { buildOfflineCompanionHtml, type CompanionExportBook } from '../../src/main/companionExport'

function fixture(): CompanionExportBook {
  return {
    title: 'The River & the Moon',
    subtitle: 'An offline tale',
    author: 'A. Writer',
    blurb: 'A quiet story.\n\nMade for reading anywhere.',
    coverDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    chapters: [
      { id: 'chapter-2', title: 'Second in name', content: 'This is supplied first.' },
      { id: 'chapter-1', title: 'First in name', content: 'This is supplied second.' }
    ]
  }
}

function runCompanion(html: string): JSDOM {
  return new JSDOM(html, {
    pretendToBeVisual: true,
    runScripts: 'dangerously',
    url: 'file:///tmp/storybound-companion.html',
    beforeParse(window) {
      Object.defineProperty(window, 'scrollTo', { configurable: true, value: vi.fn() })
    }
  })
}

describe('offline companion export', () => {
  it('preserves the supplied chapter order and builds an interactive offline reader', () => {
    const dom = runCompanion(buildOfflineCompanionHtml(fixture()))
    const document = dom.window.document

    expect(document.title).toBe('The River & the Moon · Storybound companion')
    expect([...document.querySelectorAll('.toc-button')].map((node) => node.textContent)).toEqual([
      'Second in name',
      'First in name'
    ])
    expect(document.querySelector('#chapter-title')?.textContent).toBe('Second in name')
    expect(document.querySelector('#chapter-content')?.textContent).toContain(
      'This is supplied first.'
    )

    const next = document.querySelector<HTMLButtonElement>('#next-chapter')
    next?.click()
    expect(document.querySelector('#chapter-title')?.textContent).toBe('First in name')
    expect(document.querySelector('#chapter-content')?.textContent).toContain(
      'This is supplied second.'
    )

    expect(
      [...document.querySelectorAll('.print-chapter h2')].map((node) => node.textContent)
    ).toEqual(['Second in name', 'First in name'])
    expect(document.querySelector('#theme-select')).not.toBeNull()
    expect(document.querySelector('#font-select')).not.toBeNull()
    expect(document.querySelector('#reading-progress')).not.toBeNull()
    dom.window.close()
  })

  it('keeps hostile metadata and prose inert and rejects unsafe cover URLs', () => {
    const book = fixture()
    book.title = '</title><script src="https://evil.invalid/app.js">owned</script>'
    book.blurb = '<img src=x onerror="alert(1)">'
    book.chapters[0].title = '<svg onload="alert(2)">Chapter</svg>'
    book.chapters[0].content = '<script>alert(3)</script>\n\n<img src=x onerror=alert(4)>'

    const html = buildOfflineCompanionHtml(book)
    const dom = runCompanion(html)
    const document = dom.window.document

    expect(document.title).toBe(
      '</title><script src="https://evil.invalid/app.js">owned</script> · Storybound companion'
    )
    expect(document.scripts).toHaveLength(1)
    expect(document.querySelector('#chapter-content script')).toBeNull()
    expect(document.querySelector('#chapter-content img')).toBeNull()
    expect(document.querySelector('#book-blurb img')).toBeNull()
    expect(document.querySelector('#chapter-content')?.textContent).toContain(
      '<script>alert(3)</script>'
    )
    expect(html).not.toContain('<script src=')
    expect(html).not.toContain('onerror=alert(4)')
    dom.window.close()

    expect(() =>
      buildOfflineCompanionHtml({ ...fixture(), coverDataUrl: 'https://evil.invalid/cover.png' })
    ).toThrow('Cover data URL must be a base64')
    expect(() =>
      buildOfflineCompanionHtml({
        ...fixture(),
        coverDataUrl: 'data:image/svg+xml;base64,PHN2Zz4='
      })
    ).toThrow('Cover data URL must be a base64')
  })

  it('uses hash-authorized inline assets and a CSP that blocks network access', () => {
    const html = buildOfflineCompanionHtml(fixture())
    const dom = new JSDOM(html)
    const policy = dom.window.document
      .querySelector('meta[http-equiv="Content-Security-Policy"]')
      ?.getAttribute('content')
    const style = dom.window.document.querySelector('style')?.textContent ?? ''
    const script = dom.window.document.querySelector('script')?.textContent ?? ''
    const styleHash = createHash('sha256').update(style, 'utf8').digest('base64')
    const scriptHash = createHash('sha256').update(script, 'utf8').digest('base64')

    expect(html).toMatch(/^<!doctype html>/)
    expect(policy).toContain("default-src 'none'")
    expect(policy).toContain("connect-src 'none'")
    expect(policy).toContain("object-src 'none'")
    expect(policy).toContain('img-src data:')
    expect(policy).toContain(`style-src 'sha256-${styleHash}'`)
    expect(policy).toContain(`script-src 'sha256-${scriptHash}'`)
    expect(html).not.toMatch(/<(?:script|link)[^>]+(?:src|href)=/i)
    expect(html).not.toMatch(/(?:src|href)=["'](?:https?:|\/\/)/i)
    expect(style).not.toContain('url(')
    expect(script).not.toContain('fetch(')
    expect(script).not.toContain('XMLHttpRequest')
  })

  it('rejects ambiguous or malformed chapter descriptors', () => {
    expect(() =>
      buildOfflineCompanionHtml({
        ...fixture(),
        chapters: [
          { id: 'same', title: 'One', content: '' },
          { id: 'same', title: 'Two', content: '' }
        ]
      })
    ).toThrow('duplicated')

    expect(() =>
      buildOfflineCompanionHtml({
        ...fixture(),
        chapters: [{ id: ' ', title: 'No identity', content: '' }]
      })
    ).toThrow('must have an id')
  })
})
