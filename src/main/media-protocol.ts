import { existsSync } from 'node:fs'
import { basename, extname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'
import type { AppLogger } from './logger'

const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

export function registerMediaProtocol(mediaDirectory: string, logger: AppLogger): void {
  protocol.handle('storybound-media', async (request) => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'covers') return new Response('Not found', { status: 404 })
      const filename = decodeURIComponent(url.pathname.slice(1))
      if (
        !filename ||
        basename(filename) !== filename ||
        !ALLOWED_EXTENSIONS.has(extname(filename).toLocaleLowerCase())
      ) {
        return new Response('Not found', { status: 404 })
      }
      const root = resolve(mediaDirectory)
      const path = resolve(join(root, filename))
      if (!path.startsWith(`${root}${sep}`) || !existsSync(path)) {
        return new Response('Not found', { status: 404 })
      }
      return net.fetch(pathToFileURL(path).toString())
    } catch (error) {
      logger.error('media-protocol', error)
      return new Response('Not found', { status: 404 })
    }
  })
}
