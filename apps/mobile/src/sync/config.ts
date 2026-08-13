export interface MobileCloudConfig {
  url: string
  publishableKey: string
}

export interface MobileCloudEnvironment {
  url?: string
  publishableKey?: string
}

export function parseMobileCloudConfig(
  environment: MobileCloudEnvironment
): MobileCloudConfig | null {
  const url = environment.url?.trim()
  const publishableKey = environment.publishableKey?.trim()
  if (!url && !publishableKey) return null
  if (!url || !publishableKey) {
    throw new Error(
      'Encrypted sync requires both EXPO_PUBLIC_STORYBOUND_SUPABASE_URL and EXPO_PUBLIC_STORYBOUND_SUPABASE_PUBLISHABLE_KEY.'
    )
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('EXPO_PUBLIC_STORYBOUND_SUPABASE_URL must be a valid URL.')
  }
  const local = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost'
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) {
    throw new Error('Encrypted sync requires HTTPS except for a local development server.')
  }
  if (publishableKey.length < 20 || publishableKey.length > 4096) {
    throw new Error('The Supabase publishable key has an invalid length.')
  }
  return { url: parsed.toString().replace(/\/$/, ''), publishableKey }
}

export function loadMobileCloudConfig(): MobileCloudConfig | null {
  return parseMobileCloudConfig({
    url: process.env.EXPO_PUBLIC_STORYBOUND_SUPABASE_URL,
    publishableKey: process.env.EXPO_PUBLIC_STORYBOUND_SUPABASE_PUBLISHABLE_KEY
  })
}
