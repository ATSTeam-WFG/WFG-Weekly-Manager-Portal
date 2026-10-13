import type { VideoStoryboard } from './videoStoryboard'
import type { NarrationVoiceOption } from './narrationVoices'

// Talks ONLY to the local-development render bridge
// (dev/local-video-render-plugin.ts), registered under /dev/* — never
// /api/* — and only active while `npm run dev` is running (that plugin is
// `apply: 'serve'` only, exactly like dev/local-api-plugin.ts). This
// module has no meaning in, and is never reachable from, a real deployed
// build: there is no production rendering path for this to accidentally
// call. Sends the CURRENT in-memory storyboard exactly as edited — never
// re-fetches or re-derives it — so the render always matches what the
// admin is looking at.

export interface LocalRenderResult {
  fileName: string
}

export class VideoLocalRenderError extends Error {}

export async function renderStoryboardLocally(storyboard: VideoStoryboard, voice?: NarrationVoiceOption): Promise<LocalRenderResult> {
  let response: Response
  try {
    response = await fetch('/dev/render-storyboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storyboard, voice }),
    })
  } catch {
    throw new VideoLocalRenderError('Could not reach the local render server. Is `npm run dev` still running?')
  }

  const body = await response.json().catch(() => null)

  if (!response.ok || !body?.ok) {
    throw new VideoLocalRenderError(body?.message ?? 'The local render failed. Check the terminal running `npm run dev` for details.')
  }

  return { fileName: body.fileName as string }
}

// Served by the same dev-only bridge's GET route — never a production
// storage URL.
export function renderedVideoUrl(fileName: string): string {
  return `/dev/rendered-video/${encodeURIComponent(fileName)}`
}

export interface PrepareAvatarAssetResult {
  assetPath: string
}

// Talks to dev/local-avatar-asset-plugin.ts (Phase 2 Step 2A) — a
// SEPARATE local-dev-only bridge from the one above, which downloads a
// REAL, already-authorized generate_avatar_video/generate_narration
// result (storagePath, from videoPresenterAdminApi.ts's own
// requestVideoGenerationAuthorization — that call is what actually checks
// consent/authorization, server-side, before this ever runs) out of our
// private Supabase bucket and into remotion/public/avatar-video/, so the
// local render pipeline can find it as a plain file. Never touches
// Supabase itself from the browser; the storagePath is just an opaque
// string the admin's own already-authorized request already produced.
export async function prepareAvatarAssetLocally(sceneId: string, storagePath: string): Promise<PrepareAvatarAssetResult> {
  let response: Response
  try {
    response = await fetch('/dev/prepare-avatar-asset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sceneId, storagePath }),
    })
  } catch {
    throw new VideoLocalRenderError('Could not reach the local render server. Is `npm run dev` still running?')
  }

  const body = await response.json().catch(() => null)

  if (!response.ok || !body?.ok) {
    throw new VideoLocalRenderError(body?.message ?? 'Could not prepare the avatar asset locally. Check the terminal running `npm run dev` for details.')
  }

  return { assetPath: body.assetPath as string }
}
