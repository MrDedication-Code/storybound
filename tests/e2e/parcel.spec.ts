import { expect, test } from '@playwright/test'
import { closeStorybound, launchStorybound, type RunningStorybound } from './electron'

const PARCEL = {
  id: '55555555-5555-4555-8555-555555555555',
  kind: 'book',
  senderName: 'Jack',
  senderAddress: 'K7QM-2XPD-9RTA-HF4W',
  mode: 'read-only',
  title: 'The Salt Road',
  authorName: 'Jack Westcott',
  chapterCount: 2,
  newChapterCount: 2,
  sentAt: '2026-11-05T12:00:00.000Z',
  expiresAt: '2026-12-05T12:00:00.000Z'
}

test('a parcel arrives, unwraps into a book, and can be collected', async () => {
  let running: RunningStorybound | undefined

  try {
    running = await launchStorybound(test.info().outputPath('user-data'))
    const { app, page } = running
    const created = await page.evaluate(() => window.api.books.create({ title: 'The Salt Road' }))
    if (!created.ok) throw new Error(created.error)
    const bookId = created.data.id

    // A real parcel needs a server, so the app is handed one as if the server had just sent it.
    await app.evaluate(
      ({ ipcMain }, { parcel, id }) => {
        let accepted = false
        const reply = (data: unknown) => () => ({ ok: true, data })
        ipcMain.removeHandler('storybound:sharing:list-parcels')
        ipcMain.handle('storybound:sharing:list-parcels', () => ({
          ok: true,
          data: accepted ? [] : [parcel]
        }))
        ipcMain.removeHandler('storybound:sharing:open-parcel')
        ipcMain.handle(
          'storybound:sharing:open-parcel',
          reply({
            ...parcel,
            bookId: id,
            subtitle: 'A novel',
            seriesName: '',
            seriesPosition: null,
            blurb: 'Nobody crosses the Salt Road twice.',
            coverStyle: 'ember',
            coverDataUrl: null,
            coverPositionX: 50,
            coverPositionY: 50,
            wordCount: 60_000,
            hasBible: false
          })
        )
        ipcMain.removeHandler('storybound:sharing:accept-parcel')
        ipcMain.handle('storybound:sharing:accept-parcel', () => {
          accepted = true
          return {
            ok: true,
            data: {
              bookId: id,
              title: parcel.title,
              added: 2,
              revised: 0,
              keptYours: 0,
              removed: 0,
              stale: false
            }
          }
        })
      },
      { parcel: PARCEL, id: bookId }
    )
    await page.reload()

    await page.getByRole('button', { name: /Jack sent you a book/ }).click()
    const stage = page.getByRole('dialog', { name: 'A book from Jack' })
    await expect(stage).toBeVisible()

    // A computer with no 3D goes straight to a flat cover, and must still be able to collect.
    const unwrap = stage.getByRole('button', { name: 'Unwrap' })
    const collect = stage.getByRole('button', { name: 'Collect' })
    await expect(unwrap.or(collect).first()).toBeEnabled({ timeout: 30_000 })
    if (await unwrap.isVisible()) {
      await expect(stage.locator('canvas')).toBeVisible()
      await unwrap.click()
      await expect(collect).toBeVisible({ timeout: 30_000 })
    }
    await expect(stage.getByRole('heading', { name: 'The Salt Road' })).toBeVisible()
    await collect.click()

    await expect(stage).toBeHidden({ timeout: 30_000 })
    await expect(page.getByRole('heading', { name: 'The Salt Road', level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: /sent you a book/ })).toHaveCount(0)
  } finally {
    if (running) await closeStorybound(running)
  }
})
