import { rmSync } from 'node:fs'
import { basename, dirname, extname, resolve } from 'node:path'

export const COVER_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

/** Resolves a managed cover filename inside the media folder, refusing anything that escapes it. */
export function managedCoverPath(mediaDirectory: string, filename: string): string | null {
  if (
    !filename ||
    filename.includes('/') ||
    filename.includes('\\') ||
    filename.includes('\u0000') ||
    basename(filename) !== filename ||
    !COVER_EXTENSIONS.has(extname(filename).toLocaleLowerCase())
  ) {
    return null
  }
  const root = resolve(mediaDirectory)
  const candidate = resolve(root, filename)
  return dirname(candidate) === root ? candidate : null
}

export function safeRemoveManagedCover(mediaDirectory: string, filename: string): void {
  const path = managedCoverPath(mediaDirectory, filename)
  if (!path) return
  try {
    rmSync(path, { force: true })
  } catch {
    // A missing or non-file cover falls back to the generated placeholder.
  }
}
