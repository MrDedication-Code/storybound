import type { ApiResult, StoryboundApi } from '@shared/types'

export class StoryboundError extends Error {
  readonly code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'StoryboundError'
    this.code = code
  }
}

export function storyboundApi(): StoryboundApi {
  return window.api as StoryboundApi
}

export function unwrap<T>(result: ApiResult<T>): T {
  if (!result.ok) throw new StoryboundError(result.error, result.code)
  return result.data
}

export function readableError(error: unknown): string {
  if (error instanceof StoryboundError || error instanceof Error) return error.message
  return 'Something went wrong. Your library data has not been changed.'
}
