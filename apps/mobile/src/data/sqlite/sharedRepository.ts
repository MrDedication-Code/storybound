import { openMobileRepository, type OpenedMobileRepository } from './openRepository'

let opened: Promise<OpenedMobileRepository> | null = null

/**
 * The library database, opened once and shared by the app's screens and by Android Auto, which
 * can start the app's JavaScript without any screen. It stays open for the life of the app.
 */
export function sharedRepository(): Promise<OpenedMobileRepository> {
  if (!opened) {
    opened = openMobileRepository()
    opened.catch(() => {
      opened = null
    })
  }
  return opened
}
