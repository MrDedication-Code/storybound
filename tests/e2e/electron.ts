import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

export interface RunningStorybound {
  app: ElectronApplication
  page: Page
}

interface LaunchStoryboundOptions {
  dismissOnboarding?: boolean
}

export async function launchStorybound(
  userDataPath: string,
  { dismissOnboarding = true }: LaunchStoryboundOptions = {}
): Promise<RunningStorybound> {
  await mkdir(userDataPath, { recursive: true })

  const app = await electron.launch({
    args: ['.'],
    cwd: resolve('.'),
    env: {
      ...process.env,
      STORYBOUND_USER_DATA: userDataPath,
      STORYBOUND_E2E: '1'
    }
  })

  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  if (dismissOnboarding) {
    const onboarding = page.getByRole('dialog', { name: 'Getting started' })
    if (await onboarding.isVisible().catch(() => false)) {
      await onboarding.getByRole('button', { name: 'Close', exact: true }).click()
      await onboarding.waitFor({ state: 'hidden' })
    }
  }

  return { app, page }
}

export async function closeStorybound(running: RunningStorybound): Promise<void> {
  await running.app.close()
}

export async function routeNextSaveDialog(
  app: ElectronApplication,
  destination: string
): Promise<void> {
  await app.evaluate(({ dialog }, filePath) => {
    const showSaveDialog = dialog.showSaveDialog
    dialog.showSaveDialog = async () => {
      dialog.showSaveDialog = showSaveDialog
      return { canceled: false, filePath }
    }
  }, destination)
}

export async function routeNextOpenDialog(
  app: ElectronApplication,
  selectedPath: string
): Promise<void> {
  await app.evaluate(({ dialog }, filePath) => {
    const showOpenDialog = dialog.showOpenDialog
    dialog.showOpenDialog = async () => {
      dialog.showOpenDialog = showOpenDialog
      return { canceled: false, filePaths: [filePath] }
    }
  }, selectedPath)
}
