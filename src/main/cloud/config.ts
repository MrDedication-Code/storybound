export interface StoryboundCloudConfig {
  url: string
  publishableKey: string
}

// The two `process.env.*` reads below are written as literal member expressions (not a
// captured `process.env` object) so electron.vite.config.ts's build-time `define` can
// replace them for a packaged app; a shell-exported value still wins in dev when no
// `define` replacement was baked in.
export function loadStoryboundCloudConfig(
  environment: NodeJS.ProcessEnv = {
    STORYBOUND_SUPABASE_URL: process.env.STORYBOUND_SUPABASE_URL,
    STORYBOUND_SUPABASE_PUBLISHABLE_KEY: process.env.STORYBOUND_SUPABASE_PUBLISHABLE_KEY
  }
): StoryboundCloudConfig | null {
  const url = environment.STORYBOUND_SUPABASE_URL?.trim()
  const publishableKey = environment.STORYBOUND_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!url && !publishableKey) return null
  if (!url || !publishableKey) {
    throw new Error(
      'Cloud sync requires both STORYBOUND_SUPABASE_URL and STORYBOUND_SUPABASE_PUBLISHABLE_KEY.'
    )
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('STORYBOUND_SUPABASE_URL must be a valid URL.')
  }
  const local = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost'
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) {
    throw new Error('Cloud sync requires HTTPS except for a local development server.')
  }
  if (publishableKey.length < 20 || publishableKey.length > 4096) {
    throw new Error('The Supabase publishable key has an invalid length.')
  }
  return { url: parsed.toString().replace(/\/$/, ''), publishableKey }
}
