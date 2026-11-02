import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

function describe(error: unknown, depth = 0): string {
  if (error instanceof Error) {
    const text = `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ''}`
    // Server and network failures are wrapped in a friendly error; keep the original locally.
    const cause = (error as { cause?: unknown }).cause
    return cause === undefined || depth >= 3
      ? text
      : `${text}\nCaused by: ${describe(cause, depth + 1)}`
  }
  if (error && typeof error === 'object') {
    try {
      return JSON.stringify(error).slice(0, 2000)
    } catch {
      return String(error)
    }
  }
  return String(error)
}

export class AppLogger {
  readonly filePath: string

  constructor(logDirectory: string) {
    mkdirSync(logDirectory, { recursive: true })
    this.filePath = join(logDirectory, 'storybound.log')
  }

  info(scope: string, message: string): void {
    this.write('INFO', scope, message)
  }

  error(scope: string, error: unknown): void {
    this.write('ERROR', scope, describe(error))
  }

  private write(level: 'INFO' | 'ERROR', scope: string, message: string): void {
    try {
      const cleanMessage = message.replaceAll('\u0000', '')
      appendFileSync(
        this.filePath,
        `[${new Date().toISOString()}] ${level} ${scope}: ${cleanMessage}\n`,
        'utf8'
      )
    } catch {
      // Logging must never prevent the user from opening or saving their library.
    }
  }
}
