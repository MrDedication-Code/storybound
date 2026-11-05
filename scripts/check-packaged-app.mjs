/* eslint-disable @typescript-eslint/explicit-function-return-type -- plain JavaScript */
/**
 * Opens a finished copy of Storybound and proves the parts that only break once it is packaged:
 * the window, the library database, sync being built in, the connection Claude Desktop uses, and
 * the free voice with its native engine.
 *
 * Usage: node scripts/check-packaged-app.mjs <path to the Storybound program>
 *
 * It uses a throwaway data folder, so a real library is never touched. The free voice is
 * downloaded into that folder each time.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { _electron as electron } from '@playwright/test'

const SENTENCE = 'Storybound is reading this sentence aloud.'
/** Far smaller than a real sentence of audio, so an empty or broken file cannot pass. */
const SMALLEST_AUDIO_BYTES = 20_000
/** Files that finished are kept between tries, so a dropped connection only costs the one file. */
const DOWNLOAD_TRIES = 4

function step(message) {
  console.log(`\n▶ ${message}`)
}

function unwrap(result, doing) {
  if (!result.ok) throw new Error(`${doing} failed: ${JSON.stringify(result.error)}`)
  return result.data
}

/** Talks to Storybound the way Claude Desktop does, using the entry Storybound gives Claude. */
async function connectLikeClaude(entry) {
  const bridge = spawn(entry.command, entry.args, {
    env: { ...process.env, ...entry.env },
    stdio: ['pipe', 'pipe', 'inherit']
  })
  const waiting = new Map()
  let nextId = 1
  createInterface({ input: bridge.stdout }).on('line', (line) => {
    const message = JSON.parse(line)
    waiting.get(message.id)?.(message)
    waiting.delete(message.id)
  })
  const request = (method, params) =>
    new Promise((resolveRequest, reject) => {
      const id = nextId++
      const timer = setTimeout(() => reject(new Error(`No answer to ${method}`)), 30_000)
      waiting.set(id, (message) => {
        clearTimeout(timer)
        if (message.error) reject(new Error(`${method}: ${message.error.message}`))
        else resolveRequest(message.result)
      })
      bridge.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  return { request, close: () => bridge.kill() }
}

async function checkClaudeConnection(page, bookId) {
  const status = unwrap(
    await page.evaluate(() => window.api.agentBridge.update({ mcpEnabled: true })),
    'Turning on the Claude connection'
  )
  const entry = JSON.parse(status.claudeDesktopConfig).mcpServers.storybound
  const claude = await connectLikeClaude(entry)
  try {
    await claude.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'storybound-check', version: '1' }
    })
    const { tools } = await claude.request('tools/list', {})
    const addChapter = tools.find((tool) => tool.name === 'add_chapter')
    if (!tools.some((tool) => tool.name === 'get_writing_guide')) {
      throw new Error('Claude cannot see the writing guide.')
    }
    if (!addChapter?.description.includes('[[')) {
      throw new Error('Claude is not told about performance notes.')
    }
    const guide = await claude.request('tools/call', { name: 'get_writing_guide', arguments: {} })
    if (!guide.content[0].text.includes('BIBLE.md')) throw new Error('The guide came back empty.')
    const added = await claude.request('tools/call', {
      name: 'add_chapter',
      arguments: {
        bookId,
        title: 'Chapter 2: Saved by Claude',
        content: '[[hushed, urgent]] A line. [[sigh]] And another.'
      }
    })
    if (added.isError) throw new Error(`Claude could not save: ${added.content[0].text}`)
  } finally {
    claude.close()
  }
  const book = unwrap(
    await page.evaluate((id) => window.api.books.get(id), bookId),
    'Reading the book back'
  )
  if (book.chapters.length !== 2) throw new Error('The chapter from Claude did not arrive.')
}

async function downloadVoice(page) {
  for (let attempt = 1; ; attempt += 1) {
    const result = await page.evaluate(() => window.api.narration.installKokoro())
    if (result.ok) return
    if (attempt === DOWNLOAD_TRIES) unwrap(result, 'Downloading the voice')
    console.log(`Try ${attempt} failed (${JSON.stringify(result.error)}), trying again`)
  }
}

async function check(executablePath) {
  const dataFolder = await mkdtemp(join(tmpdir(), 'storybound-check-'))
  let app
  try {
    step('Opening the app')
    app = await electron.launch({
      executablePath,
      env: { ...process.env, STORYBOUND_USER_DATA: dataFolder },
      timeout: 120_000
    })
    app.process().stderr?.on('data', (chunk) => process.stderr.write(chunk))
    const page = await app.firstWindow({ timeout: 120_000 })
    await page.waitForLoadState('domcontentloaded')
    await page.waitForFunction(() => Boolean(window.api), undefined, { timeout: 60_000 })

    const info = unwrap(await page.evaluate(() => window.api.app.info()), 'Reading app details')
    console.log(`Storybound ${info.version}, data in ${info.dataPath}`)
    if (resolve(info.dataPath) !== resolve(dataFolder)) {
      throw new Error('The app ignored the throwaway data folder.')
    }

    step('Saving a book to the library')
    const book = unwrap(
      await page.evaluate(
        () =>
          window.api.books.create({
            title: 'Packaged app check',
            initialChapterTitle: 'One',
            initialChapterContent: 'A first line.'
          }),
        undefined
      ),
      'Creating a book'
    )
    const saved = unwrap(
      await page.evaluate((id) => window.api.books.get(id), book.id),
      'Reading the book back'
    )
    if (saved.title !== 'Packaged app check') throw new Error('The book did not save.')

    step('Checking sync is built in')
    const sync = unwrap(await page.evaluate(() => window.api.sync.status()), 'Reading sync status')
    if (!sync.configured) throw new Error('This build has no sync: it would say "local-only".')

    step('Connecting the way Claude Desktop does, and saving a chapter')
    await checkClaudeConnection(page, book.id)

    step('Downloading the free voice')
    await downloadVoice(page)

    step('Reading a sentence aloud with the free voice')
    const audio = unwrap(
      await page.evaluate(async (text) => {
        const result = await window.api.narration.synthesize({
          text,
          style: null,
          engine: 'kokoro'
        })
        if (!result.ok) return result
        const bytes = new Uint8Array(result.data)
        return {
          ok: true,
          data: { size: bytes.length, header: String.fromCharCode(...bytes.subarray(0, 4)) }
        }
      }, SENTENCE),
      'Speaking with the free voice'
    )
    console.log(`Made ${audio.size} bytes of audio`)
    if (audio.header !== 'RIFF' || audio.size < SMALLEST_AUDIO_BYTES) {
      throw new Error('The free voice did not produce real audio.')
    }

    step('Closing the app')
    await app.close()
    app = undefined
    console.log('\nEverything worked.')
  } finally {
    await app?.close().catch(() => undefined)
    await rm(dataFolder, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined)
  }
}

const program = process.argv[2]
if (!program) {
  console.error('Usage: node scripts/check-packaged-app.mjs <path to the Storybound program>')
  process.exit(2)
}

try {
  await check(resolve(program))
  process.exit(0)
} catch (error) {
  console.error(error)
  process.exit(1)
}
