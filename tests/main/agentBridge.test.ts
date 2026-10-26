import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultAgentBridgeConfig,
  readAgentBridgeConfig,
  writeAgentBridgeConfig
} from '../../src/main/agentBridge/config'
import { parseInboxFile, scanInbox } from '../../src/main/agentBridge/inbox'
import {
  initializeResult,
  listToolsResult,
  StoryboundMcpServer,
  SUPPORTED_PROTOCOL_VERSIONS
} from '../../src/main/agentBridge/mcpServer'
import { AGENT_TOOLS, normalizeChapterContent } from '../../src/main/agentBridge/tools'
import { StoryboundStore } from '../../src/main/store'

const temporaryDirectories: string[] = []
const openStores: StoryboundStore[] = []
const openServers: StoryboundMcpServer[] = []

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'storybound-agent-test-'))
  temporaryDirectories.push(directory)
  return directory
}

async function createStore(): Promise<StoryboundStore> {
  const store = await StoryboundStore.open(temporaryDirectory())
  openStores.push(store)
  return store
}

function callTool(store: StoryboundStore, name: string, input: unknown): Record<string, unknown> {
  const tool = AGENT_TOOLS.find((candidate) => candidate.name === name)!
  return JSON.parse(tool.run(store, input).text) as Record<string, unknown>
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => server.stop()))
  for (const store of openStores.splice(0)) store.close()
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('agent tools', () => {
  it('creates a book, appends chapters in order, and ignores a retried duplicate', async () => {
    const store = await createStore()
    const created = callTool(store, 'create_book', {
      title: 'The Lighthouse Keeper',
      blurb: 'A storm, a keeper, a secret.',
      seriesName: 'Coastline',
      seriesPosition: 1
    })
    const bookId = created.bookId as string
    expect(created).toMatchObject({ created: true, seriesName: 'Coastline', seriesPosition: 1 })

    const first = callTool(store, 'add_chapter', {
      bookId,
      title: 'Chapter 1: The Storm',
      content: '# Chapter 1: The Storm\n\nThe wind came in off the water.'
    })
    const second = callTool(store, 'add_chapter', {
      bookId,
      title: 'Chapter 2: The Light',
      content: 'The lamp would not stay lit.'
    })
    const retried = callTool(store, 'add_chapter', {
      bookId,
      title: 'Chapter 2: The Light',
      content: 'The lamp would not stay lit.'
    })

    expect(first).toMatchObject({ added: true, number: 1 })
    expect(second).toMatchObject({ added: true, number: 2 })
    expect(retried).toMatchObject({ added: false, alreadyPresent: true, number: 2 })
    const book = store.getBook(bookId)
    expect(book.chapters.map((chapter) => chapter.title)).toEqual([
      'Chapter 1: The Storm',
      'Chapter 2: The Light'
    ])
    expect(store.getChapter(first.chapterId as string).content).toBe(
      'The wind came in off the water.'
    )
  })

  it('refuses a duplicate book title unless explicitly allowed', async () => {
    const store = await createStore()
    callTool(store, 'create_book', { title: 'Vector 218' })
    expect(() => callTool(store, 'create_book', { title: '  vector   218 ' })).toThrow(
      /already exists/
    )
    expect(
      callTool(store, 'create_book', { title: 'Vector 218', allowDuplicateTitle: true })
    ).toMatchObject({ created: true })
  })

  it('keeps the previous chapter text as a revision when revising', async () => {
    const store = await createStore()
    const { bookId } = callTool(store, 'create_book', { title: 'Revisions' })
    const { chapterId } = callTool(store, 'add_chapter', {
      bookId,
      title: 'Opening',
      content: 'First draft.'
    })
    callTool(store, 'update_chapter', { chapterId, content: 'Second draft.' })

    expect(store.getChapter(chapterId as string).content).toBe('Second draft.')
    const revisions = store.listChapterRevisions(chapterId as string)
    expect(revisions).toHaveLength(1)
    expect(store.getChapterRevision(revisions[0].id).content).toBe('First draft.')
  })

  it('reports which argument is invalid', async () => {
    const store = await createStore()
    expect(() =>
      callTool(store, 'add_chapter', { bookId: 'not-an-id', title: 'x', content: '' })
    ).toThrow(/^bookId:/)
  })

  it('strips only a leading heading that repeats the chapter title', () => {
    expect(normalizeChapterContent('The Road', '## The Road\r\n\r\nWe walked.\n\n')).toBe(
      'We walked.'
    )
    expect(normalizeChapterContent('The Road', '# A Different Heading\n\nText')).toBe(
      '# A Different Heading\n\nText'
    )
  })
})

describe('MCP server', () => {
  interface StartedServer {
    port: number
    post: (body: unknown, headers?: Record<string, string>) => Promise<Response>
    onChange: ReturnType<typeof vi.fn>
  }

  async function startServer(store: StoryboundStore, onChange = vi.fn()): Promise<StartedServer> {
    const server = new StoryboundMcpServer({
      store,
      version: '9.9.9',
      getToken: () => 'test-token-0123456789abcdefghijklmnop',
      onChange,
      onToolCall: vi.fn()
    })
    openServers.push(server)
    const port = await server.start(0)
    const post = (body: unknown, headers: Record<string, string> = {}): Promise<Response> =>
      fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token-0123456789abcdefghijklmnop',
          ...headers
        },
        body: JSON.stringify(body)
      })
    return { port, post, onChange }
  }

  it('requires the access token and refuses browser origins', async () => {
    const { post } = await startServer(await createStore())
    expect(
      (await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Authorization: '' })).status
    ).toBe(401)
    expect(
      (await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Origin: 'https://evil.example' }))
        .status
    ).toBe(403)
    expect((await post({ jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(200)
  })

  it('negotiates, lists tools, and saves chapters through tools/call', async () => {
    const store = await createStore()
    const { post, onChange } = await startServer(store)

    const init = await (
      await post({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {} }
      })
    ).json()
    expect(init.result.protocolVersion).toBe('2025-06-18')
    expect(init.result.serverInfo).toMatchObject({ name: 'storybound', version: '9.9.9' })

    expect((await post({ jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202)

    const list = await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()
    const names = list.result.tools.map((tool: { name: string }) => tool.name)
    expect(names).toEqual(
      expect.arrayContaining(['list_books', 'create_book', 'add_chapter', 'update_chapter'])
    )
    const addChapter = list.result.tools.find(
      (tool: { name: string }) => tool.name === 'add_chapter'
    )
    expect(addChapter.inputSchema).toMatchObject({
      type: 'object',
      required: expect.arrayContaining(['bookId', 'title', 'content'])
    })
    expect(addChapter.inputSchema.$schema).toBeUndefined()

    const created = await (
      await post({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'create_book', arguments: { title: 'Over HTTP' } }
      })
    ).json()
    const bookId = JSON.parse(created.result.content[0].text).bookId
    const added = await (
      await post({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'add_chapter',
          arguments: { bookId, title: 'Chapter 1', content: 'Hello.' }
        }
      })
    ).json()
    expect(added.result.isError).toBeUndefined()
    expect(store.getBook(bookId).chapters).toHaveLength(1)
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ bookId, message: expect.stringContaining('Chapter 1') })
    )

    const failed = await (
      await post({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'get_book', arguments: { bookId: crypto.randomUUID() } }
      })
    ).json()
    expect(failed.result.isError).toBe(true)

    const unknown = await (await post({ jsonrpc: '2.0', id: 6, method: 'resources/list' })).json()
    expect(unknown.error.code).toBe(-32601)
  })

  it('only accepts POST', async () => {
    const { port } = await startServer(await createStore())
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      headers: { Authorization: 'Bearer test-token-0123456789abcdefghijklmnop' }
    })
    expect(response.status).toBe(405)
  })
})

describe('inbox', () => {
  function settle(path: string): void {
    const past = new Date(Date.now() - 60_000)
    utimesSync(path, past, past)
  }

  it('reads front matter, falls back to a folder book and a heading title', () => {
    expect(
      parseInboxFile(
        'ignored.md',
        null,
        '---\nbook: "The Lighthouse Keeper"\nchapter: Chapter 1\nstatus: Completed\nseries position: 2\n---\n\nText.'
      )
    ).toMatchObject({
      bookTitle: 'The Lighthouse Keeper',
      chapterTitle: 'Chapter 1',
      content: 'Text.',
      status: 'completed',
      seriesPosition: 2,
      replace: false
    })
    expect(parseInboxFile('03 Three.md', 'Folder Book', '# The Third\n\nBody')).toMatchObject({
      bookTitle: 'Folder Book',
      chapterTitle: 'The Third',
      content: 'Body'
    })
    expect(parseInboxFile('04 Four.txt', 'Folder Book', 'Body only')).toMatchObject({
      chapterTitle: '04 Four'
    })
    expect(() => parseInboxFile('loose.md', null, 'No book anywhere')).toThrow(/No book title/)
  })

  it('imports settled files in order, files them away, and never duplicates', async () => {
    const store = await createStore()
    const inbox = temporaryDirectory()
    const events = { onChange: vi.fn(), onActivity: vi.fn() }
    const write = (name: string, text: string): string => {
      const path = join(inbox, name)
      writeFileSync(path, text)
      settle(path)
      return path
    }
    write('02 Second.md', '---\nbook: Inbox Novel\nchapter: Two\n---\nSecond.')
    write('01 First.md', '---\nbook: Inbox Novel\nchapter: One\nblurb: Imported\n---\nFirst.')
    write('bad.md', 'No header and not in a book folder')
    writeFileSync(join(inbox, 'still-writing.md'), '---\nbook: Inbox Novel\n---\nPartial')
    writeFileSync(join(inbox, 'notes.pdf'), 'ignored')

    const result = scanInbox(store, inbox, events)
    expect(result).toEqual({ imported: 2, failed: 1, skipped: 1 })
    const [book] = store.listBooks()
    expect(book.title).toBe('Inbox Novel')
    expect(book.blurb).toBe('Imported')
    expect(store.getBook(book.id).chapters.map((chapter) => chapter.title)).toEqual(['One', 'Two'])

    const importedDay = readdirSync(join(inbox, 'Imported'))[0]
    expect(readdirSync(join(inbox, 'Imported', importedDay)).sort()).toEqual([
      '01 First.md',
      '02 Second.md'
    ])
    expect(readFileSync(join(inbox, 'Failed', 'bad.md.error.txt'), 'utf8')).toContain(
      'No book title'
    )
    expect(existsSync(join(inbox, 'still-writing.md'))).toBe(true)
    expect(existsSync(join(inbox, 'notes.pdf'))).toBe(true)

    write('again.md', '---\nbook: Inbox Novel\nchapter: Two\n---\nSecond.')
    expect(scanInbox(store, inbox, events).imported).toBe(1)
    expect(store.getBook(book.id).chapters).toHaveLength(2)

    write('revise.md', '---\nbook: Inbox Novel\nchapter: Two\nmode: replace\n---\nRevised.')
    scanInbox(store, inbox, events)
    const two = store.getBook(book.id).chapters[1]
    expect(store.getChapter(two.id).content).toBe('Revised.')
    expect(store.listChapterRevisions(two.id)).toHaveLength(1)
  })

  it('treats a sub-folder as the book', async () => {
    const store = await createStore()
    const inbox = temporaryDirectory()
    mkdirSync(join(inbox, 'Folder Story'))
    const path = join(inbox, 'Folder Story', '01.md')
    writeFileSync(path, '# Beginning\n\nOnce upon a time.')
    settle(path)
    scanInbox(store, inbox, { onChange: vi.fn(), onActivity: vi.fn() })
    const [book] = store.listBooks()
    expect(book.title).toBe('Folder Story')
    expect(store.getChapter(store.getBook(book.id).chapters[0].id).content).toBe(
      'Once upon a time.'
    )
  })
})

describe('bridge configuration', () => {
  it('falls back to safe defaults when the file is damaged', () => {
    const path = join(temporaryDirectory(), 'agent-bridge.json')
    writeFileSync(path, '{"version":1,"mcpEnabled":true}')
    const config = readAgentBridgeConfig(path)
    expect(config.mcpEnabled).toBe(false)
    expect(config.token.length).toBeGreaterThanOrEqual(32)
  })
})

describe('stdio bridge script', () => {
  const script = resolve(__dirname, '../../resources/mcp-bridge.cjs')

  function runBridge(configPath: string, messages: unknown[]): Promise<unknown[]> {
    return new Promise((resolvePromise, reject) => {
      const child = spawn(process.execPath, [script, '--config', configPath], {
        stdio: ['pipe', 'pipe', 'pipe']
      })
      let output = ''
      child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')))
      child.on('error', reject)
      child.on('close', () =>
        resolvePromise(
          output
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line))
        )
      )
      for (const message of messages) child.stdin.write(`${JSON.stringify(message)}\n`)
      child.stdin.end()
    })
  }

  it('relays JSON-RPC to the running app using the live port and token', async () => {
    const store = await createStore()
    const directory = temporaryDirectory()
    const configPath = join(directory, 'agent-bridge.json')
    const config = { ...defaultAgentBridgeConfig(), mcpEnabled: true }
    const server = new StoryboundMcpServer({
      store,
      version: '1.0.0',
      getToken: () => config.token,
      onChange: vi.fn(),
      onToolCall: vi.fn()
    })
    openServers.push(server)
    writeAgentBridgeConfig(configPath, { ...config, activePort: await server.start(0) })

    const replies = (await runBridge(configPath, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'create_book', arguments: { title: 'Bridged' } }
      }
    ])) as Array<{ id: number; result: Record<string, unknown> }>

    expect(replies.map((reply) => reply.id)).toEqual([1, 2])
    expect(replies[0].result.protocolVersion).toBe('2025-06-18')
    expect(store.listBooks().map((book) => book.title)).toEqual(['Bridged'])
  })

  it('answers the handshake from the cache and explains when the connection is off', async () => {
    const directory = temporaryDirectory()
    const configPath = join(directory, 'agent-bridge.json')
    writeAgentBridgeConfig(configPath, defaultAgentBridgeConfig())
    writeFileSync(
      join(directory, 'mcp-tools.json'),
      JSON.stringify({
        protocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
        initialize: initializeResult('1.0.0'),
        tools: listToolsResult()
      })
    )

    const replies = (await runBridge(configPath, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2099-01-01' } },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_books' } }
    ])) as Array<{ id: number; result: Record<string, unknown> }>

    expect(replies[0].result.protocolVersion).toBe(SUPPORTED_PROTOCOL_VERSIONS[0])
    expect((replies[1].result.tools as unknown[]).length).toBe(AGENT_TOOLS.length)
    expect(replies[2].result).toMatchObject({ isError: true })
    expect(JSON.stringify(replies[2].result)).toContain('switched off')
  })
})
