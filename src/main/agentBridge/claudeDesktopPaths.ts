import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const CONFIG_FILE_NAME = 'claude_desktop_config.json'

/**
 * Where Claude Desktop keeps its settings, most likely first. The Windows installer from the
 * Microsoft Store keeps them in a private package folder, and that build ignores the ordinary
 * location, so on Windows every copy of Claude that is found is updated.
 */
export function claudeDesktopConfigPaths(
  platform: NodeJS.Platform,
  appDataPath: string,
  localAppDataPath: string | undefined
): string[] {
  if (platform === 'linux') return []
  const ordinary = join(appDataPath, 'Claude', CONFIG_FILE_NAME)
  if (platform !== 'win32' || !localAppDataPath) return [ordinary]

  const packages = join(localAppDataPath, 'Packages')
  let names: string[]
  try {
    names = readdirSync(packages)
  } catch {
    return [ordinary]
  }
  const packaged = names
    .filter((name) => /^(?:Anthropic\.)?Claude_/i.test(name))
    .map((name) => join(packages, name, 'LocalCache', 'Roaming', 'Claude', CONFIG_FILE_NAME))
    .filter((path) => existsSync(join(path, '..', '..', '..')))
  return [...packaged, ordinary]
}
