import { expect, test, type Locator } from '@playwright/test'
import { closeStorybound, launchStorybound, type RunningStorybound } from './electron'

const PLAIN_STORY =
  'The room went still.\n“Are you certain?” Mara asked.\n“Completely,” Ivo said.\nThe lamp flickered.'
const HTML_STORY =
  '<p>The room went still.<br>“Are you certain?” Mara asked.<br>“Completely,” Ivo said.</p><p>The lamp flickered.</p>'
const STORED_STORY =
  'The room went still.\n“Are you certain?” Mara asked.\n“Completely,” Ivo said.\n\nThe lamp flickered.'

async function pasteStory(textarea: Locator): Promise<void> {
  await textarea.evaluate(
    (element, source) => {
      const clipboardData = new DataTransfer()
      clipboardData.setData('text/plain', source.plain)
      clipboardData.setData('text/html', source.html)
      element.dispatchEvent(
        new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData })
      )
    },
    { html: HTML_STORY, plain: PLAIN_STORY }
  )
}

async function renderedStructure(markdown: Locator): Promise<{
  breakCount: number
  breakMargin: number
  lineTops: number[]
  paragraphCount: number
}> {
  return markdown.evaluate((root) => {
    const firstParagraph = root.querySelector('p')
    const breaks = Array.from(firstParagraph?.querySelectorAll('br') ?? [])
    const lineTops = Array.from(firstParagraph?.childNodes ?? [])
      .filter((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())
      .map((node) => {
        const range = document.createRange()
        range.selectNodeContents(node)
        return range.getBoundingClientRect().top
      })
    return {
      breakCount: root.querySelectorAll('br').length,
      breakMargin: breaks[0] ? Number.parseFloat(getComputedStyle(breaks[0]).marginBottom) : 0,
      lineTops,
      paragraphCount: root.querySelectorAll('p').length
    }
  })
}

test('preserves rich paste paragraphs from editor through storage and reader layout', async () => {
  let running: RunningStorybound | undefined

  try {
    running = await launchStorybound(test.info().outputPath('user-data'))
    const { page } = running

    await page.getByRole('button', { name: 'Create your first book' }).click()
    const createDialog = page.getByRole('dialog', { name: 'Create a new book' })
    await createDialog.getByLabel(/^Book title/).fill('The Spoken Room')
    await createDialog.getByLabel(/^Chapter title/).fill('A Question')
    await createDialog.getByRole('button', { name: 'Create book' }).click()

    const editor = page.getByLabel('Chapter text', { exact: true })
    await expect(editor).toBeVisible()
    await pasteStory(editor)
    await expect(editor).toHaveValue(STORED_STORY)

    await page.getByRole('button', { name: 'Preview', exact: true }).click()
    const preview = page.locator('.markdown-preview .story-markdown')
    await expect(preview.locator('p')).toHaveCount(2)
    await expect(preview.locator('br')).toHaveCount(2)
    const previewStructure = await renderedStructure(preview)
    expect(previewStructure.breakMargin).toBeGreaterThan(0)
    expect(previewStructure.lineTops[0]).toBeLessThan(previewStructure.lineTops[1])
    expect(previewStructure.lineTops[1]).toBeLessThan(previewStructure.lineTops[2])

    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.locator('.save-status')).toContainText('Saved')
    const chapterId = await page.evaluate(() => window.location.hash.split('/')[3])
    await expect
      .poll(() =>
        page.evaluate(async (id) => {
          const result = await window.api.chapters.get(id)
          return result.ok ? result.data.content : result.error
        }, chapterId)
      )
      .toBe(STORED_STORY)

    await page.getByRole('button', { name: 'Book details', exact: true }).click()
    await page.locator('button.chapter-list__title', { hasText: 'A Question' }).click()
    const reader = page.locator('.reader-page .story-markdown')
    await expect(reader.locator('p')).toHaveCount(2)
    await expect(reader.locator('br')).toHaveCount(2)
    const readerStructure = await renderedStructure(reader)
    expect(readerStructure.breakMargin).toBeGreaterThan(0)
    expect(readerStructure.lineTops[0]).toBeLessThan(readerStructure.lineTops[1])
    expect(readerStructure.lineTops[1]).toBeLessThan(readerStructure.lineTops[2])
  } finally {
    if (running) await closeStorybound(running)
  }
})
