import type { SQLiteSyncStore } from '../data/sqlite/sqliteSyncStore'
import { loadMobileCloudConfig } from './config'
import { StoryboundMobileSyncController } from './mobileSyncController'
import { ChunkedSecureStorage } from './secureStore'
import { createStoryboundSupabaseClient } from './supabaseClient'
import type { MobileSyncRuntime } from './types'

export function createMobileSyncRuntime(store: SQLiteSyncStore): MobileSyncRuntime {
  let configurationError: string | null = null
  let config = null
  try {
    config = loadMobileCloudConfig()
  } catch (error) {
    configurationError =
      error instanceof Error ? error.message : 'The encrypted-sync configuration is invalid.'
  }

  if (!config) {
    return {
      controller: new StoryboundMobileSyncController(store, {
        client: null,
        configurationError
      }),
      dispose(): void {
        return undefined
      }
    }
  }

  try {
    const supabase = createStoryboundSupabaseClient(config)
    return {
      controller: new StoryboundMobileSyncController(store, {
        client: supabase.client,
        credentialStorage: new ChunkedSecureStorage('sync-vault')
      }),
      dispose: supabase.dispose
    }
  } catch (error) {
    return {
      controller: new StoryboundMobileSyncController(store, {
        client: null,
        configurationError:
          error instanceof Error ? error.message : 'Encrypted sync could not be initialized.'
      }),
      dispose(): void {
        return undefined
      }
    }
  }
}
