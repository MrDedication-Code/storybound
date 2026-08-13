import type { ApiResult } from '../shared/types'

export type StoryboundErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DATABASE_ERROR'
  | 'NETWORK_ERROR'
  | 'FILE_ERROR'
  | 'IMPORT_ERROR'
  | 'INTEGRITY_ERROR'
  | 'SECURITY_ERROR'
  | 'UNKNOWN_ERROR'

export class StoryboundError extends Error {
  readonly code: StoryboundErrorCode
  readonly cause?: unknown

  constructor(code: StoryboundErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = 'StoryboundError'
    this.code = code
    this.cause = cause
  }
}

export function toStoryboundError(error: unknown): StoryboundError {
  if (error instanceof StoryboundError) return error

  if (error instanceof Error) {
    if ('code' in error && typeof error.code === 'string') {
      if (error.code.startsWith('SQLITE_CONSTRAINT')) {
        return new StoryboundError(
          'CONFLICT',
          'That change conflicts with data already in your library.',
          error
        )
      }

      if (error.code.startsWith('SQLITE_')) {
        return new StoryboundError(
          'DATABASE_ERROR',
          'Storybound could not save that change. Your existing library has not been altered.',
          error
        )
      }
    }

    return new StoryboundError('UNKNOWN_ERROR', 'Something unexpected went wrong.', error)
  }

  return new StoryboundError('UNKNOWN_ERROR', 'Something unexpected went wrong.', error)
}

export function apiFailure(error: unknown): ApiResult<never> {
  const safeError = toStoryboundError(error)
  return { ok: false, error: safeError.message, code: safeError.code }
}
