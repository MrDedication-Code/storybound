import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { claudeDesktopConfigPaths } from '../../src/main/agentBridge/claudeDesktopPaths'

const folders: string[] = []

function localAppData(): string {
  const folder = mkdtempSync(join(tmpdir(), 'storybound-claude-paths-'))
  folders.push(folder)
  return folder
}

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

describe('finding Claude Desktop’s settings', () => {
  const ordinary = join('roaming', 'Claude', 'claude_desktop_config.json')

  it('uses the ordinary place on a Mac, and nothing on Linux', () => {
    expect(claudeDesktopConfigPaths('darwin', 'roaming', undefined)).toEqual([ordinary])
    expect(claudeDesktopConfigPaths('linux', 'roaming', undefined)).toEqual([])
  })

  it('uses the ordinary place on Windows when Claude is not a Store package', () => {
    expect(claudeDesktopConfigPaths('win32', 'roaming', localAppData())).toEqual([ordinary])
  })

  it('also updates the private folder of the Microsoft Store version', () => {
    const local = localAppData()
    const packageFolder = join(local, 'Packages', 'Claude_pzs8sxrjxfjjc')
    mkdirSync(join(packageFolder, 'LocalCache'), { recursive: true })
    mkdirSync(join(local, 'Packages', 'SomethingElse_123', 'LocalCache'), { recursive: true })

    expect(claudeDesktopConfigPaths('win32', 'roaming', local)).toEqual([
      join(packageFolder, 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json'),
      ordinary
    ])
  })
})
