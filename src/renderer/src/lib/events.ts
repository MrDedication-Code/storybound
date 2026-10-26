import type { ContentChangedDetail } from '@shared/types'

export interface PrepareCloseDetail {
  tasks: Promise<boolean>[]
}

/** Subscribes to books and chapters changed outside the window (Claude or the inbox folder). */
export function onContentChanged(handler: (detail: ContentChangedDetail) => void): () => void {
  const listener = (event: Event): void =>
    handler((event as CustomEvent<ContentChangedDetail>).detail)
  window.addEventListener('storybound:content-changed', listener)
  return () => window.removeEventListener('storybound:content-changed', listener)
}
