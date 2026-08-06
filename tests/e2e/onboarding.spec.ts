import { expect, test } from '@playwright/test'
import { closeStorybound, launchStorybound, type RunningStorybound } from './electron'

test('shows Getting started once for a new profile and keeps it available afterward', async () => {
  const userDataPath = test.info().outputPath('user-data')
  let running: RunningStorybound | undefined

  try {
    running = await launchStorybound(userDataPath, { dismissOnboarding: false })
    const onboarding = running.page.getByRole('dialog', { name: 'Getting started' })
    await expect(onboarding).toBeVisible()
    await expect(onboarding.getByText('Collect a story')).toBeVisible()
    await expect
      .poll(() =>
        running!.page.evaluate(async () => {
          const result = await window.api.settings.get()
          return result.ok && result.data.hasSeenGettingStarted
        })
      )
      .toBe(true)
    await onboarding.getByRole('button', { name: 'Close', exact: true }).click()

    await closeStorybound(running)
    running = await launchStorybound(userDataPath, { dismissOnboarding: false })
    await expect(running.page.getByRole('dialog', { name: 'Getting started' })).toHaveCount(0)

    await running.page.getByRole('button', { name: 'Getting started' }).click()
    await expect(running.page.getByRole('dialog', { name: 'Getting started' })).toBeVisible()
  } finally {
    if (running) await closeStorybound(running)
  }
})
