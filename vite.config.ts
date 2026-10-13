import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { localApiPlugin } from './dev/local-api-plugin.js'
import { localVideoRenderPlugin } from './dev/local-video-render-plugin.js'
import { localCinematicGenerationPlugin } from './dev/local-cinematic-generation-plugin.js'
import { localAvatarAssetPlugin } from './dev/local-avatar-asset-plugin.js'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load .env / .env.local ourselves (with no prefix filter) so server-only
  // secrets like ANTHROPIC_API_KEY are available to the local API middleware
  // below via process.env — exactly how Vercel's real runtime injects them.
  // This runs only in this Node-side config file; it never reaches
  // import.meta.env or the browser bundle.
  const env = loadEnv(mode, process.cwd(), '')

  if (env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY
  if (env.NEXT_PUBLIC_SUPABASE_URL) process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
  if (env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  }
  // Scheduler authentication (Feature 6B) — none of these are set in this
  // repo's real .env.local yet; copied through the same way so the local API
  // middleware can see them once they eventually are.
  if (env.CRON_SECRET) process.env.CRON_SECRET = env.CRON_SECRET
  if (env.AUTOMATION_BOT_EMAIL) process.env.AUTOMATION_BOT_EMAIL = env.AUTOMATION_BOT_EMAIL
  if (env.AUTOMATION_BOT_PASSWORD) process.env.AUTOMATION_BOT_PASSWORD = env.AUTOMATION_BOT_PASSWORD
  // Onboarding (approved_employees roster sync + invite flow) — server-only,
  // read exclusively by api/_lib/supabaseServiceClient.ts and
  // api/onboarding/request-access.ts respectively. Not set in this repo's
  // real .env.local yet; copied through the same way so the local API
  // middleware can see them once they are.
  if (env.SUPABASE_SECRET_KEY) process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY
  if (env.ONBOARDING_REDIRECT_URL) process.env.ONBOARDING_REDIRECT_URL = env.ONBOARDING_REDIRECT_URL
  // Shared-temporary-password account creation (Admin User Management) —
  // server-only, read exclusively by api/_lib/supabaseServiceClient.ts's
  // createEmployeeAccount. Not set in this repo's real .env.local yet;
  // copied through the same way so the local API middleware can see it once
  // it is.
  if (env.EMPLOYEE_TEMP_PASSWORD) process.env.EMPLOYEE_TEMP_PASSWORD = env.EMPLOYEE_TEMP_PASSWORD
  // Cinematic generation executor (dev/local-cinematic-generation-plugin.ts)
  // — read only by that plugin's own real-client path, which itself only
  // ever runs when LUMA_LIVE_GENERATION is explicitly 'true'. Neither
  // value is ever exposed to browser code.
  if (env.LUMA_AGENTS_API_KEY) process.env.LUMA_AGENTS_API_KEY = env.LUMA_AGENTS_API_KEY
  if (env.LUMA_LIVE_GENERATION) process.env.LUMA_LIVE_GENERATION = env.LUMA_LIVE_GENERATION
  // Video Creation presenter providers (api/_lib/videoProviderClients.ts) —
  // server-only, read exclusively there. VIDEO_PROVIDER_CALLS_ENABLED is the
  // deliberate kill switch and stays unset/false until an explicit,
  // authorized test; forwarding it here only makes the real .env.local value
  // visible to the local API middleware, it never flips it on by itself.
  if (env.HEYGEN_API_KEY) process.env.HEYGEN_API_KEY = env.HEYGEN_API_KEY
  if (env.ELEVENLABS_API_KEY) process.env.ELEVENLABS_API_KEY = env.ELEVENLABS_API_KEY
  if (env.VIDEO_PROVIDER_CALLS_ENABLED) process.env.VIDEO_PROVIDER_CALLS_ENABLED = env.VIDEO_PROVIDER_CALLS_ENABLED

  return {
    plugins: [react(), localApiPlugin(), localVideoRenderPlugin(), localCinematicGenerationPlugin(), localAvatarAssetPlugin()],
    // This project's Supabase variables use the NEXT_PUBLIC_ prefix (Next.js convention);
    // Vite only exposes VITE_-prefixed vars to client code by default, so we opt this prefix in too.
    envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
    server: {
      port: Number(process.env.PORT) || 5173,
    },
  }
})
