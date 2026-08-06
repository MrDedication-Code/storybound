import { MAX_DIRECT_IMPORT_CHARACTERS, parseDirectImport } from '../../src/shared/directImport'

describe('parseDirectImport', () => {
  it('splits plain text on semantic chapter headings and preserves paragraph Markdown', () => {
    const result = parseDirectImport({
      content: [
        'Prologue',
        '',
        'A quiet beginning.',
        '',
        'Chapter Twenty-One: The Crossing',
        '',
        '**Mara** crossed the bridge.',
        '',
        '- She did not look back.',
        '',
        'Interlude \u2014 A Letter',
        '',
        '> Come home.',
        '',
        'Epilogue',
        '',
        'The end.'
      ].join('\n'),
      format: 'txt',
      fileName: '/exports/The Long Road.txt'
    })

    expect(result.format).toBe('txt')
    expect(result.title).toBe('The Long Road')
    expect(result.chapters.map((chapter) => chapter.title)).toEqual([
      'Prologue',
      'Chapter Twenty-One: The Crossing',
      'Interlude \u2014 A Letter',
      'Epilogue'
    ])
    expect(result.chapters[1].content).toBe(
      '**Mara** crossed the bridge.\n\n- She did not look back.'
    )
    expect(result.chapters[2].content).toBe('> Come home.')
  })

  it('uses a leading H1 as the book title and H1/H2 headings as chapter titles', () => {
    const result = parseDirectImport({
      content: [
        '# Glass Moons',
        '',
        '## Chapter One',
        '',
        'First paragraph.\n\nSecond *emphasised* paragraph.',
        '',
        '# The Observatory',
        '',
        'A final scene.'
      ].join('\n'),
      format: 'markdown'
    })

    expect(result.title).toBe('Glass Moons')
    expect(result.chapters).toEqual([
      expect.objectContaining({
        title: 'Chapter One',
        content: 'First paragraph.\n\nSecond *emphasised* paragraph.'
      }),
      expect.objectContaining({ title: 'The Observatory', content: 'A final scene.' })
    ])
    expect(result.preview.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'book-title', disposition: 'used-as-title' }),
        expect.objectContaining({
          kind: 'chapter-heading',
          disposition: 'used-as-chapter-title'
        })
      ])
    )
  })

  it('extracts assistant story blocks from copied conversations and explains exclusions', () => {
    const result = parseDirectImport({
      content: [
        'Story workshop',
        '',
        'You said:',
        'Write a story about a lighthouse.',
        '',
        '**ChatGPT:**',
        '## Chapter One',
        '',
        'The lamp woke at dusk.',
        'Copy',
        '',
        'Human:',
        'Continue with a storm.',
        '',
        'Claude:',
        '## Chapter Two',
        '',
        'Rain erased the horizon.',
        'Read aloud'
      ].join('\n'),
      format: 'auto',
      fileName: 'conversation.txt'
    })

    expect(result.format).toBe('chat')
    expect(result.chapters.map((chapter) => chapter.title)).toEqual(['Chapter One', 'Chapter Two'])
    expect(result.chapters.map((chapter) => chapter.content)).toEqual([
      'The lamp woke at dusk.',
      'Rain erased the horizon.'
    ])
    expect(result.chapters.some((chapter) => chapter.content.includes('lighthouse'))).toBe(false)
    expect(result.chapters.some((chapter) => chapter.content.includes('Copy'))).toBe(false)
    expect(result.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining([
        'chat-content-excluded',
        'chat-preamble-excluded',
        'chat-ui-chatter-excluded'
      ])
    )
    expect(result.preview.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          disposition: 'excluded',
          excerpt: expect.stringContaining('lighthouse')
        }),
        expect.objectContaining({ kind: 'ui-chatter', excerpt: 'Copy' })
      ])
    )
  })

  it('retains ambiguous content when chat is requested but assistant roles are absent', () => {
    const result = parseDirectImport({
      format: 'chat',
      content: ['Human: A story pasted in the prompt.', '', 'It continues here.'].join('\n')
    })

    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'chat-roles-not-found' })])
    )
    expect(result.chapters[0].content).toContain('A story pasted in the prompt.')
    expect(result.preview.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ disposition: 'included' })])
    )
  })

  it('recognises Gemini-style role labels during automatic format detection', () => {
    const result = parseDirectImport({
      content: ['You:', 'Please continue.', '', 'Gemini:', 'Epilogue', '', 'Dawn arrived.'].join(
        '\n'
      )
    })

    expect(result.format).toBe('chat')
    expect(result.chapters).toEqual([
      expect.objectContaining({ title: 'Epilogue', content: 'Dawn arrived.' })
    ])
  })

  it('sanitizes inferred titles without silently removing a plain-text title line', () => {
    const result = parseDirectImport({
      content: '  \u0000The   Clockwork Sea\u0007  \n\nOpening text.'
    })

    expect(result.title).toBe('The Clockwork Sea')
    expect(result.chapters[0].content).toContain('The   Clockwork Sea')
    expect(result.preview.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ disposition: 'included-and-used-as-title' })
      ])
    )
  })

  it('bounds oversized imports, reports truncation, and stays deterministic', () => {
    const input = {
      content: `Chapter One\n\n${'x'.repeat(MAX_DIRECT_IMPORT_CHARACTERS + 50)}`,
      fileName: 'Bounded.md'
    }

    const first = parseDirectImport(input)
    const second = parseDirectImport(input)

    expect(first).toEqual(second)
    expect(first.preview.truncated).toBe(true)
    expect(first.preview.processedCharacterCount).toBeLessThanOrEqual(MAX_DIRECT_IMPORT_CHARACTERS)
    expect(first.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'input-truncated' })])
    )
    expect(first.preview.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'truncation' })])
    )
  })

  it('bounds long filenames used as titles and reports the title decision', () => {
    const result = parseDirectImport({
      content: 'Opening text.',
      fileName: `${'Long title '.repeat(30)}.txt`
    })

    expect([...result.title].length).toBeLessThanOrEqual(160)
    expect(result.title.endsWith('\u2026')).toBe(true)
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'title-truncated' })])
    )
  })

  it('returns a stable empty preview rather than throwing for empty text', () => {
    const result = parseDirectImport({ content: '', format: 'txt' })

    expect(result.title).toBe('Untitled import')
    expect(result.chapters).toEqual([
      { title: 'Chapter 1', content: '', sourceStartLine: 1, sourceEndLine: 1 }
    ])
    expect(result.warnings).toEqual([expect.objectContaining({ code: 'empty-input' })])
  })
})
