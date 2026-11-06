import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { closeStorybound, launchStorybound, type RunningStorybound } from './electron'

/**
 * Runs the real app against a local Supabase: build with STORYBOUND_SUPABASE_URL pointing at it,
 * and set STORYBOUND_TEST_DB_CONTAINER and STORYBOUND_TEST_MAIL_URL. Skipped otherwise.
 */
const container = process.env.STORYBOUND_TEST_DB_CONTAINER
const mailUrl = process.env.STORYBOUND_TEST_MAIL_URL
const SHOTS = process.env.STORYBOUND_SHOTS
const password = `Storybound-${randomUUID()}`

type Page = RunningStorybound['page']

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` })
}

async function createAccount(page: Page, email: string): Promise<void> {
  await page.getByRole('button', { name: 'Bookstore', exact: true }).click()
  await page.getByRole('button', { name: 'Create an account' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('heading', { name: 'Before you come in' })).toBeVisible()
  await shot(page, 'store-2-join')
  await page.getByLabel('I am 18 or over').check()
  await page.getByLabel('I agree to the Bookstore rules').check()
  await page.getByRole('button', { name: 'Enter the Bookstore' }).click()
}

function grantAdmin(email: string): void {
  execFileSync('docker', [
    'exec',
    container!,
    'psql',
    '-U',
    'postgres',
    '-c',
    `insert into public.storybound_admins (owner_id)
     select id from auth.users where email = '${email}'`
  ])
}

async function resetCode(email: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const list = (await (await fetch(`${mailUrl}/api/v1/search?query=to:${email}`)).json()) as {
      messages: Array<{ ID: string }>
    }
    if (list.messages[0]) {
      const message = (await (
        await fetch(`${mailUrl}/api/v1/message/${list.messages[0].ID}`)
      ).json()) as { Text: string }
      const code = message.Text.match(/\b\d{6,10}\b/)
      if (code) return code[0]
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('No reset email arrived.')
}

test.skip(!container || !mailUrl, 'needs a local Supabase')

test('a book goes from an author, through review, to a reader', async () => {
  test.setTimeout(120_000)
  const stamp = randomUUID().slice(0, 8)
  const title = `The Salt Road ${stamp}`
  const authorEmail = `author-${stamp}@example.test`
  const adminEmail = `admin-${stamp}@example.test`
  const readerEmail = `reader-${stamp}@example.test`
  let running: RunningStorybound | undefined

  try {
    // The author publishes.
    running = await launchStorybound(test.info().outputPath('author'))
    let { page } = running
    await page.getByRole('button', { name: 'Bookstore', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await shot(page, 'store-1-sign-in')
    await createAccount(page, authorEmail)
    await expect(page.getByLabel('Search the Bookstore')).toBeVisible()
    const created = await page.evaluate(
      (bookTitle) =>
        window.api.books.create({
          title: bookTitle,
          initialChapterTitle: 'Chapter 1',
          initialChapterContent: 'The ledger stayed closed on the table.\n\nNobody spoke.'
        }),
      title
    )
    if (!created.ok) throw new Error(created.error)
    await page.evaluate((id) => {
      location.hash = `#/book/${id}`
    }, created.data.id)
    await page.getByRole('button', { name: 'Publish to the Bookstore' }).click()
    await page.getByLabel('Pen name').fill(`A. Writer ${stamp}`)
    await page.getByLabel('Blurb').fill('A ledger, a salt road, and one missing cent.')
    await page.getByLabel('Violence').check()
    await page.getByLabel(/I have the right to publish this book/).check()
    await shot(page, 'store-3-publish')
    await page.getByRole('button', { name: 'Send for review' }).click()
    await expect(page.getByText('Waiting for review.')).toBeVisible()
    await closeStorybound(running)

    // The reviewer approves.
    running = await launchStorybound(test.info().outputPath('admin'))
    page = running.page
    await createAccount(page, adminEmail)
    grantAdmin(adminEmail)
    await page.evaluate(() => {
      location.hash = '#/bookstore/review'
    })
    const waiting = page.getByRole('listitem').filter({ hasText: title })
    await waiting.getByRole('button', { name: 'Read', exact: true }).click()
    await expect(page.getByText('The ledger stayed closed on the table.')).toBeVisible()
    await shot(page, 'store-4-review')
    await page.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect(waiting).toHaveCount(0)
    await closeStorybound(running)

    // The reader finds it and adds it.
    running = await launchStorybound(test.info().outputPath('reader'))
    page = running.page
    await createAccount(page, readerEmail)
    await page.getByLabel('Search the Bookstore').fill(stamp)
    await page.keyboard.press('Enter')
    await shot(page, 'store-5-browse')
    await page.getByRole('button', { name: new RegExp(title) }).click()
    await expect(page.getByRole('heading', { name: title })).toBeVisible()
    await expect(page.getByText(/Content warnings: Violence/)).toBeVisible()
    await shot(page, 'store-6-book')
    await page.getByRole('button', { name: 'Add to library' }).click()
    const dialog = page.getByRole('dialog')
    await dialog
      .getByRole('button', { name: 'Unwrap' })
      .click({ timeout: 20_000 })
      .catch(() => null)
    await dialog.getByRole('button', { name: 'Add to library' }).click({ timeout: 20_000 })
    await expect(page.getByRole('heading', { name: title }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Publish to the Bookstore' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Edit book' })).toHaveCount(0)
    await shot(page, 'store-7-in-library')

    // Forgetting a password works from the same place.
    await page.evaluate(() => window.api.sync.signOut())
    await page.evaluate(() => {
      location.hash = '#/bookstore'
    })
    await page.getByRole('button', { name: 'Forgot your password?' }).click()
    await page.getByLabel('Email').fill(readerEmail)
    await page.getByRole('button', { name: 'Email me a code' }).click()
    await page.getByLabel('Code from the email').fill(await resetCode(readerEmail))
    await page.getByLabel('New password').fill(`${password}-new`)
    await page.getByRole('button', { name: 'Save new password' }).click()
    await expect(page.getByLabel('Search the Bookstore')).toBeVisible()

    // Deleting the account signs out, and the book stays in the library.
    await page.evaluate(() => {
      location.hash = '#/settings'
    })
    await page.getByRole('button', { name: 'Delete account' }).click()
    await page.getByRole('button', { name: 'Delete my account' }).click()
    await expect(page.getByText('Your account was deleted.').first()).toBeVisible()
    await page.evaluate(() => {
      location.hash = '#/library'
    })
    await expect(page.getByText(title).first()).toBeVisible()
  } finally {
    if (running) await closeStorybound(running).catch(() => undefined)
  }
})
