import { createClient, processLock, type SupabaseClient } from '@supabase/supabase-js'
import type { SupportedStorage } from '@supabase/supabase-js'
import type { StoryboundCloudConfig } from './config'

export function createStoryboundSupabaseClient(
  config: StoryboundCloudConfig,
  storage: SupportedStorage
): SupabaseClient {
  return createClient(config.url, config.publishableKey, {
    auth: {
      storage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
      lock: processLock
    },
    global: {
      headers: { 'X-Client-Info': 'storybound-desktop/0.1.0' }
    }
  })
}
