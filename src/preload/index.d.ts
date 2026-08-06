import type { StoryboundApi } from '../shared/types'

declare global {
  interface Window {
    api: StoryboundApi
  }
}

export {}
