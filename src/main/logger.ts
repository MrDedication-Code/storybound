import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

function describe(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ''}`
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
