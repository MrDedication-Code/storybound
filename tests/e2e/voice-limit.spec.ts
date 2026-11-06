import { expect, test } from '@playwright/test'
import { closeStorybound, launchStorybound, type RunningStorybound } from './electron'

test('when Google’s daily allowance runs out, the free voice carries on', async () => {
  let running: RunningStorybound | undefined

  try {
    running = await launchStorybound(test.info().outputPath('user-data'))
    const { app, page } = running
    const created = await page.evaluate(() =>
      window.api.books.create({
        title: 'The Salt Road',
        initialChapterTitle: 'Chapter 1',
        initialChapterContent: 'She read the chart again. '.repeat(400)
      })
    )
    if (!created.ok) throw new Error(created.error)

    // Listening is handed a Google voice that is out of allowance, and a free voice that works.
    await app.evaluate(({ ipcMain }) => {
      const state = { limited: false, free: 0, google: 0 }
      Object.assign(globalThis, { voiceTest: state })
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
            limitedUntil: state.limited ? new Date(Date.now() + 3_600_000).toISOString() : null
          },
          kokoro: { ...voices, installed: true }
        }
      }))
      ipcMain.removeHandler('storybound:narration:synthesize')
      ipcMain.handle('storybound:narration:synthesize', (_event, input: { engine: string }) => {
        if (input.engine === 'gemini') {
          state.google += 1
          state.limited = true
          return {
            ok: false,
            code: 'VOICE_LIMIT_REACHED',
            error: 'You have used today’s allowance for the Google voice. It comes back at 8:00 AM.'
          }
        }
        state.free += 1
        const samples = 2400
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

    await page.evaluate(
      ([book, chapter]) => {
        location.hash = `#/read/${book}/${chapter}`
      },
      [created.data.id, created.data.chapters[0].id]
    )
    await page.getByRole('button', { name: 'Listen', exact: true }).click()
    const controls = page.getByRole('region', { name: 'Listening controls' })
    await controls
      .getByRole('button', { name: /Play|Read aloud|Start/ })
      .first()
      .click()

    await expect(page.getByText(/free voice will read until then/)).toBeVisible({ timeout: 15_000 })
    await expect
      .poll(() =>
        app.evaluate(
          () => (globalThis as unknown as { voiceTest: { free: number } }).voiceTest.free
        )
      )
      .toBeGreaterThan(0)
    const asked = await app.evaluate(
      () => (globalThis as unknown as { voiceTest: { google: number } }).voiceTest.google
    )
    expect(asked).toBeLessThanOrEqual(2)
  } finally {
    if (running) await closeStorybound(running)
  }
})
