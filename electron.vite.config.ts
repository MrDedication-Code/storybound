import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin, loadEnv } from 'electron-vite'
import react from '@vitejs/plugin-react'

// The Supabase URL and publishable key are public configuration, not secrets: the
// publishable key only authorizes anonymous/RLS-scoped requests. Baking them into the
// built main bundle lets a packaged app ship with cloud sync configured. `.env.local`
// (or a real `STORYBOUND_SUPABASE_*` shell export, which still wins in dev since an
// undefined `define` leaves `process.env.*` untouched) is the source; never put a
// `service_role` or other secret key in these variables.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['MAIN_VITE_', 'STORYBOUND_SUPABASE_'])
  const cloudDefine: Record<string, string> = {}
  if (env.STORYBOUND_SUPABASE_URL) {
    cloudDefine['process.env.STORYBOUND_SUPABASE_URL'] = JSON.stringify(env.STORYBOUND_SUPABASE_URL)
  }
  if (env.STORYBOUND_SUPABASE_PUBLISHABLE_KEY) {
    cloudDefine['process.env.STORYBOUND_SUPABASE_PUBLISHABLE_KEY'] = JSON.stringify(
      env.STORYBOUND_SUPABASE_PUBLISHABLE_KEY
    )
  }

  return {
    main: {
      define: cloudDefine,
      plugins: [externalizeDepsPlugin({ exclude: ['@storybound/contracts', '@storybound/sync'] })]
    },
    preload: {
      plugins: [externalizeDepsPlugin({ exclude: ['@storybound/contracts', '@storybound/sync'] })]
    },
    renderer: {
      resolve: {
        alias: {
          '@renderer': resolve('src/renderer/src'),
          '@shared': resolve('src/shared')
        }
      },
      plugins: [react()]
    }
  }
})
