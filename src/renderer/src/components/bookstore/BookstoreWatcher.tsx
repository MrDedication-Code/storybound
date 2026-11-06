import { useEffect } from 'react'
import { storyboundApi } from '../../lib/api'

const CHECK_MILLISECONDS = 6 * 60 * 60_000

/** Keeps Bookstore books up to date. Being offline, or signed out, is no reason to interrupt. */
export function BookstoreWatcher({ notify }: { notify: (message: string) => void }): null {
  useEffect(() => {
    const check = async (): Promise<void> => {
      const result = await storyboundApi().bookstore.checkBooks()
      if (!result.ok) return
      for (const book of result.data.updated) notify(`“${book.title}” has been updated.`)
      for (const book of result.data.removed) {
        notify(
          `“${book.title}” was removed from the Bookstore and moved to Trash.${book.reason ? ` ${book.reason}` : ''}`
        )
      }
      const changed = [...result.data.updated, ...result.data.removed][0]
      if (changed) {
        window.dispatchEvent(
          new CustomEvent('storybound:content-changed', {
            detail: { bookId: changed.bookId, chapterId: null, message: '' }
          })
        )
      }
    }
    const first = window.setTimeout(() => void check(), 15_000)
    const timer = window.setInterval(() => void check(), CHECK_MILLISECONDS)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(timer)
    }
  }, [notify])
  return null
}
