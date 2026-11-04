import { useSyncExternalStore } from 'react'
import { listeningSession, type ListeningSnapshot } from './index'

/** What is being read aloud right now, kept up to date as passages change. */
export function useListening(): ListeningSnapshot {
  const session = listeningSession()
  return useSyncExternalStore(
    (onChange) => session.subscribe(onChange),
    () => session.current
  )
}
