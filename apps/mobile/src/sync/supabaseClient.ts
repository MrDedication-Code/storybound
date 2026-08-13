import { AppState } from 'react-native'
import { createClient, processLock, type SupabaseClient } from '@supabase/supabase-js'
import type { MobileCloudConfig } from './config'
import { ChunkedSecureStorage } from './secureStore'

export interface StoryboundSupabaseClient {
  client: SupabaseClient
  dispose(): void
}

export function createStoryboundSupabaseClient(
  config: MobileCloudConfig,
  storage = new ChunkedSecureStorage('supabase-auth')
): StoryboundSupabaseClient {
  const client = createClient(config.url, config.publishableKey, {
    auth: {
      storage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
      lock: processLock
    },
    global: {
      headers: { 'X-Client-Info': 'storybound-mobile/0.1.0' }
    }
  })

  const updateRefresh = (state: string): void => {
    if (state === 'active') client.auth.startAutoRefresh()
    else client.auth.stopAutoRefresh()
  }
  updateRefresh(AppState.currentState)
  const subscription = AppState.addEventListener('change', updateRefresh)

  return {
    client,
    dispose(): void {
      subscription.remove()
      client.auth.stopAutoRefresh()
    }
  }
}
