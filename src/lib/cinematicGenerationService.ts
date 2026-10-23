import type { VideoStoryboardScene, CinematicAsset } from './videoStoryboard'

// Talks ONLY to the local-development cinematic-generation bridge
// (dev/local-cinematic-generation-plugin.ts), registered under /dev/* —
// never /api/* — and only active while `npm run dev` is running, exactly
// like videoLocalRenderService.ts's own convention. No Luma API key, and
// no paid call, ever reaches or originates from browser code: this
// module only ever POSTs the already-frozen plan's scenes and GETs
// status.
//
// PAID-POST SAFETY, browser side: `startGeneration` must be called ONLY
// from an explicit admin button click handler — never from a
// component's render or a useEffect. `getGenerationStatus` is read-only
// and safe to poll/call on mount/refresh. `retryGenerationAsset` targets
// exactly one assetId.

// Kept in sync by hand with remotion/cinematicGenerationExecutor.ts's own
// GenerationAssetStatus — 'review' means a persisted record could not be
// trusted automatically (checkpoint mismatch, or an unreadable durable
// state file) and needs a human to look at it; it is never auto-submitted
// or auto-retried.
export type GenerationAssetStatus = 'idle' | 'queued' | 'generating' | 'complete' | 'failed' | 'review'

export interface GenerationAssetState {
  assetId: string
  status: GenerationAssetStatus
  errorMessage?: string
}

export interface GenerationStatusResponse {
  started: boolean
  states: GenerationAssetState[]
  cinematicAssetsByScene: Record<string, CinematicAsset[]>
  // True once a persistence or durable-state failure has halted the
  // session — see the executor's isHalted()/getHaltReason(). While true,
  // the server-side generateAll/requestGeneration/retryAsset are all
  // no-ops; recovery is fixing the issue and restarting the dev server.
  halted: boolean
  haltReason?: string
}

export class CinematicGenerationServiceError extends Error {}

export async function startCinematicGeneration(scenes: VideoStoryboardScene[]): Promise<void> {
  let response: Response
  try {
    response = await fetch('/dev/cinematic-generation/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenes }),
    })
  } catch {
    throw new CinematicGenerationServiceError('Could not reach the local generation server. Is `npm run dev` still running?')
  }
  const body = await response.json().catch(() => null)
  if (!response.ok || !body?.ok) {
    throw new CinematicGenerationServiceError(body?.message ?? 'Could not start cinematic generation.')
  }
}

export async function getCinematicGenerationStatus(): Promise<GenerationStatusResponse> {
  const response = await fetch('/dev/cinematic-generation/status')
  if (!response.ok) throw new CinematicGenerationServiceError('Could not read generation status.')
  return (await response.json()) as GenerationStatusResponse
}

export async function retryCinematicGenerationAsset(assetId: string): Promise<void> {
  const response = await fetch('/dev/cinematic-generation/retry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetId }),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok || !body?.ok) {
    throw new CinematicGenerationServiceError(body?.message ?? 'Retry failed.')
  }
}

// TEMPORARY/LOCAL DEV CHECKPOINT ONLY — lets an already-approved
// storyboard + cinematic plan survive the one dev-server restart needed
// to arm LUMA_LIVE_GENERATION, without regenerating through Anthropic.
// See dev/local-cinematic-generation-plugin.ts for the server side.
export interface CinematicGenerationCheckpoint {
  exists: boolean
  storyboard?: import('./videoStoryboard').VideoStoryboard
  hash?: string
  recomputedHash?: string
  matches?: boolean
  createdAt?: string
}

export async function getCinematicGenerationCheckpoint(): Promise<CinematicGenerationCheckpoint> {
  const response = await fetch('/dev/cinematic-generation/checkpoint')
  if (!response.ok) throw new CinematicGenerationServiceError('Could not read the cinematic generation checkpoint.')
  return (await response.json()) as CinematicGenerationCheckpoint
}
