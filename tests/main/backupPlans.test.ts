import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { StoryboundStore } from '../../src/main/store'

const temporaryDirectories: string[] = []
const openStores: StoryboundStore[] = []

async function createStore(): Promise<{ store: StoryboundStore; root: string }> {
  const root = mkdtempSync(join(tmpdir(), 'storybound-backup-plan-test-'))
  temporaryDirectories.push(root)
  const store = await StoryboundStore.open(root)
  openStores.push(store)
  return { store, root }
}

afterEach(() => {
  for (const store of openStores.splice(0)) store.close()
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('scheduled backup plans', () => {
  it('creates verified backups, records runs, and enforces configured retention', async () => {
    const { store, root } = await createStore()
    store.createBook({
      title: 'The Scheduled Library',
      initialChapterTitle: 'Opening',
      initialChapterContent: 'Words worth keeping.'
    })
    const destination = join(root, 'scheduled')
    mkdirSync(destination)
    const plan = store.createBackupPlan(destination, {
      cadence: 'daily',
      retentionCount: 1
    })

    expect(plan).toMatchObject({ cadence: 'daily', retentionCount: 1, enabled: true })
    const first = await store.runBackupPlan(plan.id, '0.1.0-test')
    expect(first.status).toBe('succeeded')
    expect(first.verifiedAt).not.toBeNull()
    expect(existsSync(first.outputPath!)).toBe(true)

    await new Promise<void>((resolve) => setTimeout(resolve, 2))
    const second = await store.runBackupPlan(plan.id, '0.1.0-test')
    expect(second.status).toBe('succeeded')
    expect(existsSync(second.outputPath!)).toBe(true)
    expect(
      readdirSync(destination).filter((name) => name.endsWith('.storybound-backup'))
    ).toHaveLength(1)
    expect(store.listBackupPlans()[0].lastRun?.id).toBe(second.id)
  })

  it('can pause and remove a schedule without deleting completed backup files', async () => {
    const { store, root } = await createStore()
    store.createBook({ title: 'Keep the Backup' })
    const destination = join(root, 'scheduled')
    mkdirSync(destination)
    const plan = store.createBackupPlan(destination, {
      cadence: 'weekly',
      retentionCount: 3
    })
    const run = await store.runBackupPlan(plan.id, '0.1.0-test')

    const paused = store.updateBackupPlan({
      id: plan.id,
      cadence: 'monthly',
      retentionCount: 2,
      enabled: false
    })
    expect(paused).toMatchObject({ cadence: 'monthly', retentionCount: 2, enabled: false })
    expect(paused.nextRunAt).toBeNull()

    store.removeBackupPlan(plan.id)
    expect(store.listBackupPlans()).toEqual([])
    expect(existsSync(run.outputPath!)).toBe(true)
  })
})
