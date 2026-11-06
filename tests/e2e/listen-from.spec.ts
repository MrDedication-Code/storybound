import { expect, test } from '@playwright/test'
import { closeStorybound, launchStorybound, type RunningStorybound } from './electron'

const SHOTS = process.env.STORYBOUND_SHOTS

const paragraphs = Array.from(
  { length: 40 },
  (_, index) =>
    `Paragraph ${index + 1} began at the salt road. ${'The ledger stayed closed on the table. '.repeat(9)}`
)

test('the reader shows where listening starts, and any paragraph can be chosen', async () => {
  let running: RunningStorybound | undefined

  try {
    running = await launchStorybound(test.info().outputPath('user-data'))
    const { app, page } = running
    const created = await page.evaluate(
      (content) =>
        window.api.books.create({
          title: 'The Salt Road',
          initialChapterTitle: 'Chapter 1',
          initialChapterContent: content
        }),
      paragraphs.join('\n\n')
    )
    if (!created.ok) throw new Error(created.error)

    // A Google voice that records what it is asked to read.
    await app.evaluate(({ ipcMain }) => {
      const asked: string[] = []
      Object.assign(globalThis, { voiceTest: asked })
      const voices = { voiceId: 'am_george', voices: [], progress: null, downloadBytes: 1 }
      ipcMain.removeHandler('storybound:narration:status')
      ipcMain.handle('storybound:narration:status', () => ({
        ok: true,
        data: {
          engine: 'gemini',
          speed: 1,
          gemini: {
            hasKey: true,
            consented: true,
            voiceId: 'riko',
            voiceName: 'Riko',
            style: 'Calm',
            model: 'test',
            limitedUntil: null
          },
          kokoro: { ...voices, installed: false }
        }
      }))
      ipcMain.removeHandler('storybound:narration:synthesize')
      ipcMain.handle('storybound:narration:synthesize', (_event, input: { text: string }) => {
        asked.push(input.text)
        // A few seconds of silence, so a passage is still playing when the test looks.
        const samples = 24_000 * 20
        const wav = new Uint8Array(44 + samples * 2)
        const view = new DataView(wav.buffer)
        const text = (at: number, value: string): void => {
          for (let index = 0; index < value.length; index += 1) {
            view.setUint8(at + index, value.charCodeAt(index))
          }
        }
        text(0, 'RIFF')
        view.setUint32(4, 36 + samples * 2, true)
        text(8, 'WAVEfmt ')
        view.setUint32(16, 16, true)
        view.setUint16(20, 1, true)
        view.setUint16(22, 1, true)
        view.setUint32(24, 24_000, true)
        view.setUint32(28, 48_000, true)
        view.setUint16(32, 2, true)
        view.setUint16(34, 16, true)
        text(36, 'data')
        view.setUint32(40, samples * 2, true)
        return { ok: true, data: wav }
      })
    })
    const asked = (): Promise<string[]> =>
      app.evaluate(() => (globalThis as unknown as { voiceTest: string[] }).voiceTest)
    const shot = async (name: string): Promise<void> => {
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` })
    }

    await page.evaluate(
      ([book, chapter]) => {
        location.hash = `#/read/${book}/${chapter}`
      },
      [created.data.id, created.data.chapters[0].id]
    )
    await page.getByRole('button', { name: 'Listen', exact: true }).click()
    const controls = page.getByRole('region', { name: 'Listening controls' })
    const marked = page.locator('p.is-listen-start')

    // Before anything plays, it says where it will start.
    await expect(controls.getByText('Starts from')).toBeVisible()
    await expect(controls.getByText(/Paragraph 1 began/)).toBeVisible()
    await expect(marked).toContainText('Paragraph 1 began')
    await shot('1-ready')

    // Scrolling moves the place, and the marked paragraph stays on the page.
    await page.getByTestId('reader-scroll').evaluate((element) => {
      element.scrollTo({
        top: (element.scrollHeight - element.clientHeight) / 2,
        behavior: 'instant'
      })
    })
    await expect(marked).not.toContainText('Paragraph 1 began')
    await expect(marked).toBeInViewport()
    const shown = (await marked.textContent())?.slice(0, 40) ?? ''
    await expect(
      controls.getByRole('button', { name: new RegExp(shown.slice(0, 20)) })
    ).toBeVisible()
    await shot('2-scrolled')

    // Playing starts at exactly that paragraph, not the top of a long passage.
    await controls.getByRole('button', { name: 'Play' }).click()
    await expect.poll(async () => (await asked()).length).toBeGreaterThan(0)
    expect((await asked())[0].startsWith(shown.slice(0, 20))).toBe(true)
    await expect(controls.getByText('Reading from')).toBeVisible()
    await expect(page.locator('p.is-being-read').first()).toContainText(shown.slice(0, 20))
    await shot('3-reading')

    // Any other paragraph can be chosen while it plays.
    const chosen = page.locator('p', { hasText: 'Paragraph 24 began' })
    await chosen.scrollIntoViewIfNeeded()
    await chosen.hover()
    await shot('4-hover')
    await chosen.getByRole('button', { name: 'Listen from here' }).click()
    await expect
      .poll(async () => (await asked()).some((text) => text.startsWith('Paragraph 24 began')))
      .toBe(true)
    await expect(controls.getByRole('button', { name: /Paragraph 24 began/ })).toBeVisible()

    // Paused, the place stays put while the page is scrolled, and resuming goes on from it.
    await controls.getByRole('button', { name: 'Pause' }).click()
    await expect(controls.getByText('Paused in')).toBeVisible()
    await page.getByTestId('reader-scroll').evaluate((element) => {
      element.scrollTo({ top: 0, behavior: 'instant' })
    })
    await expect(controls.getByRole('button', { name: /Paragraph 24 began/ })).toBeVisible()
    await shot('5-paused')

    // The opening words bring the place back into view.
    await controls.getByRole('button', { name: /Paragraph 24 began/ }).click()
    await expect(page.locator('p', { hasText: 'Paragraph 24 began' })).toBeInViewport()

    // Start of chapter reads the title and the first paragraph.
    await controls.getByRole('button', { name: 'Start of chapter' }).click()
    await expect
      .poll(async () => (await asked()).some((text) => text.startsWith('Chapter 1')))
      .toBe(true)
    await expect(controls.getByRole('button', { name: /Paragraph 1 began/ })).toBeVisible()
  } finally {
    if (running) await closeStorybound(running)
  }
})
