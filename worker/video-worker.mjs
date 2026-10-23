#!/usr/bin/env node

// WFG video rendering worker.
//
// --dry-run (unchanged from the original foundation): no network, no
// database, no rendering — just prints the planned pipeline stages and
// exits. Safe to run anywhere, including CI.
//
// --execute [--once]: the REAL worker. Authenticates as a dedicated admin
// account (never the service_role key — see adminAuth.ts's own
// authenticateSchedulerBot for the identical pattern already used for
// cron automation in this app), claims one job via the existing
// claim_video_render_job() RPC, renders it through the EXISTING,
// unmodified scripts/render-storyboard.mts (same renderer already proven
// locally and in a Linux Docker container — never reimplemented here),
// uploads the result to the private video-render-outputs bucket, and
// marks the job complete or failed. `--once` processes at most one job
// then exits (for a single container run); without it, the process polls
// continuously until stopped.
//
// Never starts without real credentials. Never touches avatar/HeyGen
// providers — VIDEO_PROVIDER_CALLS_ENABLED is never read or set here, and
// every claimed storyboard is independently re-validated (the same
// validator the API route already runs) before rendering, rejecting any
// avatar/cinematic/FLUX-asset field as defense in depth.

import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { existsSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)

const stages = [
  'claim',
  'validate',
  'generate-visuals',
  'synthesize-narration',
  'render-mp4',
  'upload-private',
  'complete'
]

const POLL_INTERVAL_MS = 15_000
const RENDER_TIMEOUT_MS = 20 * 60 * 1000

function dryRun() {
  const renderer = path.join(root, 'scripts', 'render-storyboard.mts')

  if (!existsSync(renderer)) {
    throw new Error('Existing video renderer not found.')
  }

  console.log('WFG GPU Worker — LOCAL DRY RUN')
  console.log('Renderer: found')
  console.log('Database access: disabled')
  console.log('Network access: disabled')
  console.log('GPU execution: disabled')
  console.log('Paid services: disabled')
  console.log('')

  for (const stage of stages) {
    console.log(`[planned] ${stage}`)
  }

  console.log('')
  console.log('PASS: Worker foundation validated.')
  console.log('No video job was executed.')
}

async function authenticate() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  const email = process.env.VIDEO_RENDER_WORKER_EMAIL
  const password = process.env.VIDEO_RENDER_WORKER_PASSWORD

  if (!supabaseUrl || !supabasePublishableKey || !email || !password) {
    throw new Error(
      'Missing required worker credentials: NEXT_PUBLIC_SUPABASE_URL, ' +
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, VIDEO_RENDER_WORKER_EMAIL, VIDEO_RENDER_WORKER_PASSWORD.'
    )
  }

  // Dynamic import so --dry-run never requires @supabase/supabase-js to be
  // reachable or configured.
  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(supabaseUrl, supabasePublishableKey, {
    auth: { persistSession: false },
  })

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error || !data.session) {
    throw new Error(`Worker sign-in failed: ${error?.message ?? 'no session returned'}`)
  }

  return supabase
}

function validateClaimedStoryboard(storyboard) {
  // Mirrors api/_lib/videoRenderStoryboardValidation.ts's own
  // forbiddenAssetFields check — the worker never trusts that the
  // database only ever contains what the API route validated; it
  // independently refuses to render anything carrying an avatar,
  // cinematic, or FLUX-pregenerated-asset field.
  const forbiddenAssetFields = [
    'fluxAssetPath', 'fluxHeroAssetPath', 'fluxMotifAssetPath',
    'cinematicAssets', 'avatarVideoAssetPath', 'avatarVideoDurationSeconds',
  ]
  const scenes = Array.isArray(storyboard?.scenes) ? storyboard.scenes : []
  for (const scene of scenes) {
    for (const field of forbiddenAssetFields) {
      if (scene && typeof scene === 'object' && field in scene) {
        throw new Error(`INVALID_STORYBOARD: forbidden field "${field}" present on a claimed job's storyboard.`)
      }
    }
  }
}

async function renderOne(supabase) {
  const { data: claims, error: claimError } = await supabase.rpc('claim_video_render_job')
  if (claimError) {
    throw new Error(`claim_video_render_job failed: ${claimError.message}`)
  }

  const claim = Array.isArray(claims) ? claims[0] : claims
  if (!claim || !claim.job_id) {
    return false // nothing queued
  }

  const { job_id: jobId, claim_token: claimToken, job_storyboard: storyboard, job_voice_option: voiceOption } = claim
  console.log(`[worker] claimed job ${jobId}`)

  const tmpDir = mkdtempSync(path.join(tmpdir(), 'wfg-video-render-'))
  const storyboardPath = path.join(tmpDir, 'storyboard.json')
  const outputPath = path.join(tmpDir, `${randomUUID()}.mp4`)

  try {
    validateClaimedStoryboard(storyboard)
    writeFileSync(storyboardPath, JSON.stringify(storyboard), { mode: 0o600 })

    console.log('[worker] rendering via scripts/render-storyboard.mts (unmodified)...')
    const args = [
      '--experimental-strip-types',
      path.join(root, 'scripts', 'render-storyboard.mts'),
      storyboardPath,
      outputPath,
    ]
    if (typeof voiceOption === 'string' && voiceOption) args.push(voiceOption)

    const result = spawnSync(process.execPath, args, {
      cwd: root,
      stdio: 'inherit',
      timeout: RENDER_TIMEOUT_MS,
    })

    if (result.error || result.status !== 0 || !existsSync(outputPath)) {
      await supabase.rpc('fail_video_render_job', {
        p_job_id: jobId,
        p_claim_token: claimToken,
        p_error_code: 'RENDER_FAILED',
      })
      console.error('[worker] render failed; job marked for retry/failed.')
      return true
    }

    const bytes = readFileSync(outputPath)
    const storagePath = `${jobId}.mp4`

    console.log('[worker] uploading to private video-render-outputs bucket...')
    const { error: uploadError } = await supabase.storage
      .from('video-render-outputs')
      .upload(storagePath, bytes, { contentType: 'video/mp4', upsert: false })

    if (uploadError) {
      await supabase.rpc('fail_video_render_job', {
        p_job_id: jobId,
        p_claim_token: claimToken,
        p_error_code: 'UPLOAD_FAILED',
      })
      console.error('[worker] upload failed; job marked for retry/failed.')
      return true
    }

    const { data: completed, error: completeError } = await supabase.rpc('complete_video_render_job', {
      p_job_id: jobId,
      p_claim_token: claimToken,
      p_output_path: storagePath,
    })

    if (completeError || completed !== true) {
      console.error('[worker] complete_video_render_job did not confirm completion (claim may have expired).')
    } else {
      console.log(`[worker] job ${jobId} completed -> ${storagePath}`)
    }

    return true
  } catch (err) {
    console.error('[worker] unexpected error:', err instanceof Error ? err.message : err)
    try {
      await supabase.rpc('fail_video_render_job', {
        p_job_id: jobId,
        p_claim_token: claimToken,
        p_error_code: 'RENDER_FAILED',
      })
    } catch {
      // best-effort only — never mask the original error by throwing here
    }
    return true
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

async function execute({ once }) {
  const supabase = await authenticate()
  console.log('[worker] authenticated. Polling for queued render jobs...')

  for (;;) {
    const didWork = await renderOne(supabase)
    if (once) return
    if (!didWork) await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
}

function main() {
  if (process.argv.includes('--dry-run')) {
    return dryRun()
  }

  if (!process.argv.includes('--execute')) {
    console.error(
      'Worker execution is disabled. Use --dry-run, or --execute (with real credentials) to run for real.'
    )
    process.exitCode = 1
    return
  }

  execute({ once: process.argv.includes('--once') }).catch((err) => {
    console.error('[worker] fatal:', err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
}

main()
