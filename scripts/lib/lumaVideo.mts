import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Luma Ray 3.2 (Agents API) text-to-video. The low-level HTTP pieces here
// (resolveLumaRequest/submitLumaGeneration/pollUntilDone/downloadVideo)
// are reused by remotion/lumaRayGenerationClient.ts, the real client the
// cinematic generation executor drives from the admin's explicit
// "Generate Cinematic Footage" action — never imported by
// render-storyboard.mts or any test/build/lint step, so nothing in the
// Remotion render pipeline itself or in CI can ever trigger a paid call.
//
// COST SAFETY: the CLI entrypoint below (main()) still defaults to DRY
// RUN — it only builds and prints the request payloads; a real (paid)
// generation via the CLI happens ONLY with --generate. The executor
// (remotion/cinematicGenerationExecutor.ts) applies its own, separate
// paid-POST safety contract on top of these functions: one submit per
// explicit admin action, no automatic retry. The POST that starts a
// generation is never retried automatically by anything in this file;
// only the GET status-poll is (polling is free/unbilled).
// LUMA_AGENTS_API_KEY is read from process.env only — never logged,
// never returned, never written to disk.

const PROJECT_ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))
const ASSET_DIR = path.join(PROJECT_ROOT, 'remotion', 'public', 'luma-assets')

const LUMA_AGENTS_API_BASE = 'https://agents.lumalabs.ai/v1'
const MODEL = 'ray-3.2'

export interface LumaShot {
  sceneId: string
  prompt: string
}

export interface LumaGenerationSettings {
  resolution: '720p' | '1080p'
  duration: '5s' | '10s'
  aspectRatio: '16:9'
}

export const POC_GENERATION_SETTINGS: LumaGenerationSettings = {
  resolution: '720p',
  duration: '5s',
  aspectRatio: '16:9',
}

function buildRequestBody(shot: LumaShot, settings: LumaGenerationSettings) {
  return {
    model: MODEL,
    type: 'video',
    prompt: shot.prompt,
    aspect_ratio: settings.aspectRatio,
    video: { resolution: settings.resolution, duration: settings.duration },
  }
}

function assetFileName(assetId: string): string {
  return `${assetId}.mp4`
}

// Absolute path to where a given asset id's clip would be cached, for
// callers (e.g. the cinematic generation executor's real client) that
// need to check/compute the path without duplicating ASSET_DIR here.
export function assetCachePath(assetId: string): string {
  return path.join(ASSET_DIR, assetFileName(assetId))
}

// Pure — never touches the network or filesystem. Used by dry-run mode and
// by the real generation path alike, so the request actually sent is always
// identical to the one already reviewed/approved.
export function resolveLumaRequest(shot: LumaShot, settings: LumaGenerationSettings = POC_GENERATION_SETTINGS) {
  return { url: `${LUMA_AGENTS_API_BASE}/generations`, body: buildRequestBody(shot, settings) }
}

interface LumaGenerationStatus {
  state: 'queued' | 'dreaming' | 'completed' | 'failed' | string
  output?: Array<{ url?: string }>
  failure_reason?: string
}

// Exported for reuse by the cinematic generation executor's real client
// (remotion/lumaRayGenerationClient.ts) — the SAME poll behavior the
// original POC CLI path uses, never a second/divergent implementation.
export async function pollUntilDone(generationId: string, apiKey: string, { initialDelayMs = 30_000, timeoutMs = 10 * 60_000 } = {}): Promise<LumaGenerationStatus> {
  await new Promise((resolve) => setTimeout(resolve, initialDelayMs))
  const deadline = Date.now() + timeoutMs
  // GET polling only — safe to retry; never the generation-starting POST.
  while (Date.now() < deadline) {
    const res = await fetch(`${LUMA_AGENTS_API_BASE}/generations/${generationId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    const status = (await res.json()) as LumaGenerationStatus
    if (status.state === 'completed' || status.state === 'failed') return status
    await new Promise((resolve) => setTimeout(resolve, 10_000))
  }
  return { state: 'failed', failure_reason: 'POC poll timeout exceeded' }
}

// Exported for reuse by the cinematic generation executor's real client.
export async function downloadVideo(url: string, assetId: string): Promise<string> {
  mkdirSync(ASSET_DIR, { recursive: true })
  const res = await fetch(url)
  const buffer = Buffer.from(await res.arrayBuffer())
  const outputPath = path.join(ASSET_DIR, assetFileName(assetId))
  writeFileSync(outputPath, buffer)
  return `luma-assets/${assetFileName(assetId)}`
}

// Exported for reuse — the exact same POST the batch CLI path below
// sends, extracted so the executor's real client can submit one
// generation at a time instead of only via the batch
// generateLumaClips() loop. Still never retried automatically by this
// function itself — that guarantee lives in the caller (the executor).
export async function submitLumaGeneration(shot: LumaShot, apiKey: string, settings: LumaGenerationSettings = POC_GENERATION_SETTINGS): Promise<{ id?: string; error?: string }> {
  const { url, body } = resolveLumaRequest(shot, settings)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  })
  return (await res.json()) as { id?: string; error?: string }
}

// Generates (or reuses an already-downloaded) clip for each shot. Never
// regenerates a scene whose file already exists on disk — a rerun after a
// partial failure only submits paid requests for the shots still missing.
// Returns sceneId -> relative asset path for every shot that now has a
// downloaded clip (freshly generated or already-cached); a shot that failed
// generation is simply absent from the result, never retried automatically.
export async function generateLumaClips(shots: LumaShot[], settings: LumaGenerationSettings = POC_GENERATION_SETTINGS): Promise<Record<string, string>> {
  const apiKey = process.env.LUMA_AGENTS_API_KEY
  if (!apiKey) throw new Error('LUMA_AGENTS_API_KEY is not set.')

  const results: Record<string, string> = {}
  for (const shot of shots) {
    const existingPath = path.join(ASSET_DIR, assetFileName(shot.sceneId))
    if (existsSync(existingPath)) {
      console.log(`[luma-video] reusing already-downloaded clip for "${shot.sceneId}"`)
      results[shot.sceneId] = `luma-assets/${assetFileName(shot.sceneId)}`
      continue
    }

    const { url, body } = resolveLumaRequest(shot, settings)
    console.log(`[luma-video] submitting ONE generation for "${shot.sceneId}" (${settings.resolution}, ${settings.duration}, ${settings.aspectRatio})...`)
    const createRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    })
    const created = (await createRes.json()) as { id?: string; error?: string }
    if (!created.id) {
      console.error(`[luma-video] "${shot.sceneId}" generation request was not accepted:`, created.error ?? createRes.status)
      continue
    }

    console.log(`[luma-video] polling "${shot.sceneId}" (generation ${created.id})...`)
    const status = await pollUntilDone(created.id, apiKey)
    if (status.state !== 'completed' || !status.output?.[0]?.url) {
      console.error(`[luma-video] "${shot.sceneId}" did not complete successfully:`, status.state, status.failure_reason ?? '')
      continue
    }

    results[shot.sceneId] = await downloadVideo(status.output[0].url, shot.sceneId)
    console.log(`[luma-video] "${shot.sceneId}" downloaded -> ${results[shot.sceneId]}`)
  }
  return results
}

async function main() {
  const shotsPath = process.argv[2]
  const generate = process.argv.includes('--generate')
  if (!shotsPath) {
    console.error('Usage: node --experimental-strip-types scripts/lib/lumaVideo.mts <shots.json> [--generate]')
    process.exitCode = 1
    return
  }
  const shots: LumaShot[] = JSON.parse(await import('node:fs').then((fs) => fs.readFileSync(shotsPath, 'utf8')))

  if (!generate) {
    console.log('[luma-video] DRY RUN — no paid request will be sent. Pass --generate to actually submit these.')
    for (const shot of shots) {
      const { url, body } = resolveLumaRequest(shot)
      console.log(`\n[luma-video] ${shot.sceneId} -> POST ${url}`)
      console.log(JSON.stringify(body, null, 2))
    }
    return
  }

  const results = await generateLumaClips(shots)
  console.log('\n[luma-video] done.', results)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main()
}
