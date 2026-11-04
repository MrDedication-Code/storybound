import { createExpoBackend } from './expoBackend'
import { ListeningSession } from './listeningSession'

let session: ListeningSession | null = null

/**
 * The one listening session for the app. It is kept at module level, not in a screen, so the
 * book keeps playing while screens change and the phone is locked.
 */
export function listeningSession(): ListeningSession {
  session ??= new ListeningSession(createExpoBackend())
  return session
}

export type { ListeningSnapshot, ListeningStatus } from './listeningSession'
