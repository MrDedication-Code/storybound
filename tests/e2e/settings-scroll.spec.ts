import { expect, test } from '@playwright/test'
import { closeStorybound, launchStorybound, type RunningStorybound } from './electron'

test('keeps compact Settings scrollable with section state and a hash-safe return to top', async () => {
  let running: RunningStorybound | undefined

  try {
    running = await launchStorybound(test.info().outputPath('user-data'))
    const { app, page } = running
    const minimumSize = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getMinimumSize()
    )
    expect(minimumSize).toEqual([640, 560])
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 560))
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(820)

    const settingsScroll = page.locator('#main-content')

    await page.getByRole('button', { name: 'Open navigation' }).click()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
    await expect
      .poll(() => settingsScroll.evaluate((element) => element.scrollHeight > element.clientHeight))
      .toBe(true)

    await page.getByRole('button', { name: 'About', exact: true }).click()
    await expect(page.getByRole('button', { name: 'About', exact: true })).toHaveAttribute(
      'aria-current',
      'location'
    )
    await expect
      .poll(() => settingsScroll.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(500)
    await page.waitForTimeout(400)
    const anchoredPosition = await settingsScroll.evaluate((element) => element.scrollTop)

    await settingsScroll.hover()
    await page.mouse.wheel(0, -500)
    await expect
      .poll(() => settingsScroll.evaluate((element) => element.scrollTop))
      .toBeLessThan(anchoredPosition)
    await expect(page.getByRole('button', { name: 'About', exact: true })).not.toHaveAttribute(
      'aria-current',
      'location'
    )

    await page.getByRole('button', { name: 'About', exact: true }).click()
    const routeBeforeReturn = await page.evaluate(() => window.location.hash)
    await page.getByRole('button', { name: 'Back to top' }).click()
    await expect.poll(() => settingsScroll.evaluate((element) => element.scrollTop)).toBeLessThan(5)
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeFocused()
    await expect(page.getByRole('button', { name: 'Appearance', exact: true })).toHaveAttribute(
      'aria-current',
      'location'
    )
    expect(await page.evaluate(() => window.location.hash)).toBe(routeBeforeReturn)
  } finally {
    if (running) await closeStorybound(running)
  }
})
