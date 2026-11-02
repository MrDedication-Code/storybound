import { nativeImage } from 'electron'
import { StoryboundError } from '../errors'
import type { EncodedCover } from '../sync/entities'

// Large enough to stay sharp on a phone's library shelf and book page, small enough that a
// cover is a few hundred kilobytes in the sync log rather than several megabytes.
const MAX_WIDTH = 900
const MAX_HEIGHT = 1350
const JPEG_QUALITY = 82

/** Shrinks a cover image to a sync-sized JPEG. */
export function encodeCoverForSync(path: string): EncodedCover {
  const image = nativeImage.createFromPath(path)
  if (image.isEmpty()) {
    throw new StoryboundError('FILE_ERROR', 'The cover image could not be read for sync.')
  }
  const { width, height } = image.getSize()
  const scale = Math.min(1, MAX_WIDTH / width, MAX_HEIGHT / height)
  const sized =
    scale < 1
      ? image.resize({
          width: Math.round(width * scale),
          height: Math.round(height * scale),
          quality: 'best'
        })
      : image
  return { mimeType: 'image/jpeg', data: sized.toJPEG(JPEG_QUALITY) }
}
