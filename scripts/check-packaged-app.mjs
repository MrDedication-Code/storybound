/* eslint-disable @typescript-eslint/explicit-function-return-type -- plain JavaScript */
/**
 * Opens a finished copy of Storybound and proves the parts that only break once it is packaged:
 * the window, the library database, and the free voice with its native engine.
 *
 * Usage: node scripts/check-packaged-app.mjs <path to the Storybound program>
 *
 * It uses a throwaway data folder, so a real library is never touched. The free voice is
 * downloaded into that folder each time.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from '@playwright/test'

const SENTENCE = 'Storybound is reading this sentence aloud.'
/** Far smaller than a real sentence of audio, so an empty or broken file cannot pass. */
const SMALLEST_AUDIO_BYTES = 20_000

function step(message) {
  console.log(`\n▶ ${message}`)
}

function unwrap(result, doing) {
  if (!result.ok) throw new Error(`${doing} failed: ${JSON.stringify(result.error)}`)
  return result.data
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

    step('Downloading the free voice')
    unwrap(await page.evaluate(() => window.api.narration.installKokoro()), 'Installing the voice')

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
