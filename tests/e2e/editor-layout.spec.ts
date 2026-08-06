import { expect, test, type Page } from '@playwright/test'
import { closeStorybound, launchStorybound, type RunningStorybound } from './electron'

const CHAPTER_TEXT = Array.from(
  { length: 24 },
  (_, index) =>
    `Paragraph ${index + 1}. The writing area should stay comfortable while this draft grows into a full chapter.`
).join('\n\n')

interface Rectangle {
  bottom: number
  height: number
  top: number
}

interface EditorGeometry {
  editorDocument: Rectangle
  editorFooter: Rectangle
  navigation: Rectangle
  preview: Rectangle | null
  previewScroll: { clientHeight: number; scrollHeight: number } | null
  textarea: Rectangle | null
  workspace: Rectangle
}

async function createDraft(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Create your first book' }).click()
  const dialog = page.getByRole('dialog', { name: 'Create a new book' })

  await dialog.getByLabel(/^Book title/).fill('The Expanding Draft')
  await dialog.getByLabel(/^Blurb/).fill('A layout regression test.')
  await dialog.getByLabel(/^Chapter title/).fill('Room to Write')
  await dialog.getByLabel(/^Chapter text/).fill(CHAPTER_TEXT)
  await dialog.getByRole('button', { name: 'Create book' }).click()

  await expect(page).toHaveURL(/#\/edit\//)
  await expect(page.getByLabel('Chapter text', { exact: true })).toBeVisible()
}

async function resizeWindow(
  running: RunningStorybound,
  width: number,
  height: number
): Promise<void> {
  await running.app.evaluate(
    ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size.width, size.height),
    { height, width }
  )
  await expect.poll(() => running.page.evaluate(() => window.innerWidth)).toBe(width)
}

async function readGeometry(page: Page): Promise<EditorGeometry> {
  return page.evaluate(() => {
    const rectangle = (selector: string): Rectangle => {
      const element = document.querySelector(selector)
      if (!element) throw new Error(`Missing editor element: ${selector}`)
      const bounds = element.getBoundingClientRect()
      return { bottom: bounds.bottom, height: bounds.height, top: bounds.top }
    }
    const preview = document.querySelector('.markdown-preview')
    const textarea = document.querySelector('.chapter-editor')

    return {
      editorDocument: rectangle('.editor-document'),
      editorFooter: rectangle('.editor-footer'),
      navigation: rectangle('.editor-navigation'),
      preview: preview ? rectangle('.markdown-preview') : null,
      previewScroll: preview
        ? { clientHeight: preview.clientHeight, scrollHeight: preview.scrollHeight }
        : null,
      textarea: textarea ? rectangle('.chapter-editor') : null,
      workspace: rectangle('.editor-workspace')
    }
  })
}

function expectEdgesToMeet(first: number, second: number): void {
  expect(Math.abs(first - second)).toBeLessThanOrEqual(2)
}

function expectWritingAreaExpanded(geometry: EditorGeometry, minimumRatio: number): void {
  expect(geometry.textarea).not.toBeNull()
  expect(geometry.textarea!.height / geometry.workspace.height).toBeGreaterThan(minimumRatio)
  expectEdgesToMeet(geometry.editorDocument.bottom, geometry.navigation.top)
  expectEdgesToMeet(geometry.editorFooter.bottom, geometry.navigation.top)
  expectEdgesToMeet(geometry.navigation.bottom, geometry.workspace.bottom)
}

for (const windowSize of [
  { height: 820, label: 'default', width: 1280 },
  { height: 640, label: 'minimum', width: 900 }
]) {
  test(`keeps the writing area expanded at the ${windowSize.label} window size`, async () => {
    let running: RunningStorybound | undefined

    try {
      running = await launchStorybound(test.info().outputPath('user-data'))
      await resizeWindow(running, windowSize.width, windowSize.height)
      await createDraft(running.page)

      const textarea = running.page.getByLabel('Chapter text', { exact: true })
      await textarea.focus()
      await expect
        .poll(() =>
          textarea.evaluate((element) => {
            const style = getComputedStyle(element)
            return `${style.outlineStyle} ${style.outlineWidth}`
          })
        )
        .toBe('solid 2px')

      const editing = await readGeometry(running.page)
      expectWritingAreaExpanded(editing, 0.35)

      await running.page.getByRole('button', { name: 'Find in chapter' }).click()
      await expect(running.page.getByPlaceholder('Find in this chapter…')).toBeFocused()
      const finding = await readGeometry(running.page)
      expectWritingAreaExpanded(finding, 0.3)

      await running.page.getByRole('button', { name: 'Close find' }).click()
      await running.page.getByRole('button', { name: 'Preview', exact: true }).click()
      const previewing = await readGeometry(running.page)

      expect(previewing.preview).not.toBeNull()
      expect(previewing.previewScroll!.scrollHeight).toBeGreaterThan(
        previewing.previewScroll!.clientHeight
      )
      expectEdgesToMeet(previewing.editorDocument.bottom, previewing.navigation.top)
      expectEdgesToMeet(previewing.editorFooter.bottom, previewing.navigation.top)
      expectEdgesToMeet(previewing.navigation.bottom, previewing.workspace.bottom)
      expect(
        Math.abs(previewing.editorDocument.height - editing.editorDocument.height)
      ).toBeLessThanOrEqual(2)

      await running.page.getByRole('button', { name: 'Edit', exact: true }).click()
      const editingAgain = await readGeometry(running.page)
      expectWritingAreaExpanded(editingAgain, 0.35)
      expect(
        Math.abs(editingAgain.editorDocument.height - editing.editorDocument.height)
      ).toBeLessThanOrEqual(2)
      expect(
        Math.abs(editingAgain.textarea!.height - editing.textarea!.height)
      ).toBeLessThanOrEqual(2)
    } finally {
      if (running) await closeStorybound(running)
    }
  })
}
