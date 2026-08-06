import { expect, test } from '@playwright/test'
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  closeStorybound,
  launchStorybound,
  routeNextOpenDialog,
  routeNextSaveDialog,
  type RunningStorybound
} from './electron'

const BOOK_TITLE = 'The Lantern Coast'
const BOOK_BLURB = 'A voyage beyond the last familiar light.'
const FIRST_CHAPTER = 'First Light'
const SECOND_CHAPTER = 'The Crossing'
const FIRST_CHAPTER_TEXT = 'The harbour woke beneath a copper sky.'
const SECOND_CHAPTER_TEXT = Array.from(
  { length: 140 },
  (_, index) =>
    `Paragraph ${index + 1}. The lantern ship pressed farther into the silver tide while Mara kept watch for the hidden coast.`
).join('\n\n')

async function sizeOf(path: string): Promise<number> {
  try {
    return (await stat(path)).size
  } catch {
    return 0
  }
}

async function readerScrollRatio(running: RunningStorybound): Promise<number> {
  return running.page.getByTestId('reader-scroll').evaluate((element) => {
    const maximum = element.scrollHeight - element.clientHeight
    return maximum > 0 ? element.scrollTop / maximum : 0
  })
}

// Playwright requires an object-destructured first argument when testInfo is the second argument.
// eslint-disable-next-line no-empty-pattern
test('persists a covered two-chapter book, restores reading position, and round-trips export', async ({}, testInfo) => {
  test.slow()

  const userDataPath = testInfo.outputPath('user-data')
  const exportedBookPath = testInfo.outputPath('lantern-coast.storybound-book')
  const exportedPdfPath = testInfo.outputPath('lantern-coast.pdf')
  const companionPath = testInfo.outputPath('lantern-coast-companion.html')
  const encryptedVaultPath = testInfo.outputPath('lantern-coast.storybound-vault')
  const coverPath = resolve('build/icon.png')
  let running: RunningStorybound | undefined

  try {
    running = await launchStorybound(userDataPath)
    let { app, page } = running

    await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible()
    await expect(
      page.getByText('Turn your AI-generated stories into a personal library.')
    ).toBeVisible()

    await routeNextOpenDialog(app, coverPath)
    await page.getByRole('button', { name: 'Create your first book' }).click()
    const createDialog = page.getByRole('dialog', { name: 'Create a new book' })
    await createDialog.getByLabel(/^Book title/).fill(BOOK_TITLE)
    await createDialog.getByLabel(/^Blurb/).fill(BOOK_BLURB)
    await createDialog.getByLabel(/^Chapter title/).fill(FIRST_CHAPTER)
    await createDialog.getByLabel(/^Chapter text/).fill(FIRST_CHAPTER_TEXT)
    await createDialog.getByRole('checkbox', { name: /Choose a cover after creating/ }).check()
    await createDialog.getByRole('button', { name: 'Create book' }).click()

    await expect(page).toHaveURL(/#\/edit\//)
    await expect(page.getByLabel('Chapter title', { exact: true })).toHaveValue(FIRST_CHAPTER)
    await page.getByRole('button', { name: 'New chapter' }).click()
    await expect(page.getByLabel('Chapter title', { exact: true })).toHaveValue('Chapter 2')
    await page.getByLabel('Chapter title', { exact: true }).fill(SECOND_CHAPTER)
    await page.getByLabel('Chapter text', { exact: true }).fill(SECOND_CHAPTER_TEXT)
    // Close immediately after a paste into a brand-new chapter. The close handshake must flush it.
    await closeStorybound(running)
    running = await launchStorybound(userDataPath)
    ;({ app, page } = running)

    await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible()
    await page.getByRole('button', { name: `Open ${BOOK_TITLE} details` }).click()
    await expect(page.locator('.chapter-list__title strong')).toHaveText([
      FIRST_CHAPTER,
      SECOND_CHAPTER
    ])
    await expect(
      page.getByRole('img', { name: `Cover of ${BOOK_TITLE}` }).locator('img')
    ).toHaveCount(1)

    await page.locator('button.chapter-list__title', { hasText: SECOND_CHAPTER }).click()
    await expect(page.getByRole('heading', { level: 1, name: SECOND_CHAPTER })).toBeVisible()
    const readerScroll = page.getByTestId('reader-scroll')
    await expect
      .poll(() => readerScroll.evaluate((element) => element.scrollHeight > element.clientHeight))
      .toBe(true)
    await readerScroll.evaluate((element) => {
      const maximum = element.scrollHeight - element.clientHeight
      element.scrollTop = maximum * 0.58
      element.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    await expect
      .poll(async () => {
        const label = await page.locator('.reader-progress > span').first().textContent()
        return Number.parseInt(label ?? '0', 10)
      })
      .toBeGreaterThan(70)
    const savedScrollRatio = await readerScrollRatio(running)
    expect(savedScrollRatio).toBeGreaterThan(0.5)
    await page.waitForTimeout(750)

    await closeStorybound(running)
    running = await launchStorybound(userDataPath)
    ;({ app, page } = running)

    await page.getByRole('button', { name: `Open ${BOOK_TITLE} details` }).click()
    await page.getByRole('button', { name: 'Continue reading' }).click()
    await expect(page.getByRole('heading', { level: 1, name: SECOND_CHAPTER })).toBeVisible()
    await expect
      .poll(async () => Math.abs((await readerScrollRatio(running!)) - savedScrollRatio))
      .toBeLessThan(0.12)

    await page.getByRole('button', { name: 'Library', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible()
    await page.getByRole('button', { name: `Open ${BOOK_TITLE} details` }).click()
    await expect(page.getByRole('heading', { level: 1, name: BOOK_TITLE })).toBeVisible()

    await page.getByRole('button', { name: 'Cover studio' }).click()
    const coverStudio = page.getByRole('dialog', { name: 'Cover studio' })
    await coverStudio.getByLabel(/Horizontal focus/).fill('20')
    await coverStudio.getByLabel(/Vertical focus/).fill('75')
    await coverStudio.getByRole('button', { name: 'Save cover' }).click()
    await expect(coverStudio).toBeHidden()
    await expect(
      page.getByRole('img', { name: `Cover of ${BOOK_TITLE}` }).locator('img')
    ).toHaveCSS('object-position', '20% 75%')

    await page.getByRole('button', { name: 'Export book' }).click()
    const exportDialog = page.getByRole('dialog', { name: 'Export book' })
    await routeNextSaveDialog(app, exportedPdfPath)
    await exportDialog.getByRole('button', { name: /PDF/ }).click()
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: `Exported “${BOOK_TITLE}” as PDF.` })
        .first()
    ).toBeVisible()
    await expect.poll(() => sizeOf(exportedPdfPath)).toBeGreaterThan(0)
    expect((await readFile(exportedPdfPath)).subarray(0, 5).toString()).toBe('%PDF-')

    await page.getByRole('button', { name: 'Export book' }).click()
    await routeNextSaveDialog(app, companionPath)
    await page
      .getByRole('dialog', { name: 'Export book' })
      .getByRole('button', { name: /Offline companion/ })
      .click()
    await expect.poll(() => sizeOf(companionPath)).toBeGreaterThan(0)
    const companionHtml = await readFile(companionPath, 'utf8')
    expect(companionHtml).toContain('Content-Security-Policy')
    expect(companionHtml).toContain("connect-src 'none'")
    expect(companionHtml).toContain(BOOK_TITLE)
    expect(companionHtml).not.toMatch(/https?:\/\//)

    await page.getByRole('button', { name: 'Export book' }).click()
    await routeNextSaveDialog(app, exportedBookPath)
    await page
      .getByRole('dialog', { name: 'Export book' })
      .getByRole('button', { name: /Storybound package/ })
      .click()
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: `Exported “${BOOK_TITLE}”.` })
        .first()
    ).toBeVisible()
    await expect.poll(() => sizeOf(exportedBookPath)).toBeGreaterThan(0)

    await page.getByRole('button', { name: 'Move to Trash' }).click()
    const trashDialog = page.getByRole('dialog', { name: `Move “${BOOK_TITLE}” to Trash?` })
    await trashDialog.getByRole('button', { name: 'Move to Trash' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible()

    await page.getByRole('button', { name: 'Trash', exact: true }).click()
    const trashedBook = page.locator('.trash-list li', { hasText: BOOK_TITLE })
    await expect(trashedBook).toBeVisible()
    await trashedBook.getByRole('button', { name: 'Delete permanently' }).click()
    const deleteDialog = page.getByRole('dialog', {
      name: `Permanently delete “${BOOK_TITLE}”?`
    })
    await deleteDialog.getByRole('button', { name: 'Delete forever' }).click()
    await expect(page.getByRole('heading', { name: 'Trash is empty' })).toBeVisible()

    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()

    await routeNextOpenDialog(app, exportedBookPath)
    await page
      .getByTestId('settings-import')
      .getByRole('button', { name: 'Import package' })
      .click()
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: `Imported “${BOOK_TITLE}” as a separate copy.` })
        .first()
    ).toBeVisible()

    await routeNextSaveDialog(app, encryptedVaultPath)
    await page.getByRole('button', { name: 'Export vault' }).click()
    const vaultDialog = page.getByRole('dialog', { name: 'Export encrypted vault' })
    await vaultDialog.getByLabel('Vault passphrase').fill('harbour lantern vault 2026')
    await vaultDialog.getByLabel('Confirm passphrase').fill('harbour lantern vault 2026')
    await vaultDialog.getByRole('button', { name: 'Choose destination' }).click()
    await expect.poll(() => sizeOf(encryptedVaultPath)).toBeGreaterThan(0)
    expect((await readFile(encryptedVaultPath)).subarray(0, 8).toString('ascii')).toBe('SBVAULT\0')

    await page.getByRole('button', { name: 'Library', exact: true }).click()
    await page.getByRole('button', { name: `Open ${BOOK_TITLE} details` }).click()
    await expect(page.locator('.chapter-list__title strong')).toHaveText([
      FIRST_CHAPTER,
      SECOND_CHAPTER
    ])
    const importedCover = page.getByRole('img', { name: `Cover of ${BOOK_TITLE}` }).locator('img')
    await expect(importedCover).toHaveCount(1)
    await expect(importedCover).toHaveAttribute('src', /^storybound-media:/)
  } catch (error) {
    if (running && !running.page.isClosed()) {
      await testInfo.attach('failure-window', {
        body: await running.page.screenshot(),
        contentType: 'image/png'
      })
    }
    throw error
  } finally {
    if (running) {
      try {
        await closeStorybound(running)
      } catch {
        // The assertion failure may have followed an Electron process exit.
      }
    }
  }
})
