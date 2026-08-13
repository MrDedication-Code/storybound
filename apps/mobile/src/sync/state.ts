import type { SyncConnectionPhase } from '@storybound/contracts'

export interface ConnectionStateInput {
  configured: boolean
  signedIn: boolean
  unlocked: boolean
  syncing: boolean
  hasError: boolean
}

export function connectionPhase(input: ConnectionStateInput): SyncConnectionPhase {
  if (!input.configured) return 'local-only'
  if (input.syncing) return 'syncing'
  if (input.hasError && !input.signedIn) return 'error'
  if (!input.signedIn) return 'signed-out'
  if (!input.unlocked) return 'locked'
  if (input.hasError) return 'error'
  return 'idle'
}
