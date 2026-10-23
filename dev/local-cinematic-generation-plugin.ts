import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { planShotsForStoryboard, summarizeGenerationNeeds } from '../remotion/cinematicPlan.ts'
import {
  buildGenerationJobs,
  createCinematicGenerationExecutor,
  createInMemoryGenerationAssetCache,
  type CinematicGenerationExecutor,
  type GenerationJob,
  type LumaGenerationClient,
  type DurableGenerationStore,
  type PersistedAssetRecord,
} from '../remotion/cinematicGenerationExecutor.ts'
import { submitLumaGeneration, pollUntilDone, downloadVideo, assetCachePath, POC_GENERATION_SETTINGS, type LumaShot } from '../scripts/lib/lumaVideo.mts'
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync, fsyncSync, renameSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import type { VideoStoryboard, VideoStoryboardScene } from '../src/lib/videoStoryboard.ts'

// Local-dev-only bridge for the cinematic generation executor — mirrors
// dev/local-video-render-plugin.ts's own conventions exactly: registered
// under /dev/* (never /api/*), only active during `vite dev`
// (apply: 'serve'), never deployable (Vercel only maps api/**/*.ts). The
// Luma API key, when used, is read from process.env here — never sent
// to, or readable by, browser code.
//
// PAID-POST SAFETY: this plugin defaults to a DRY-RUN client — it never
// calls the real Luma API unless the admin has explicitly set
// LUMA_LIVE_GENERATION=true in their own local environment (never a
// request-body flag the browser could set). Every HTTP call here maps
// 1:1 onto one executor method: POST /generate calls generateAll() (the
// ONE admin-button action that can ever submit paid work), GET /status
// only ever reads state, and POST /retry calls retryAsset() for exactly
// one asset. Nothing here is ever called from a React effect/render —
// see src/lib/cinematicGenerationService.ts and
// VideoCreationCinematicPlan.tsx for the browser side of that guarantee.

interface GenerationSession {
  jobs: GenerationJob[]
  executor: CinematicGenerationExecutor
}

let currentSession: GenerationSession | undefined

function jobSetKey(jobs: GenerationJob[]): string {
  return jobs
    .map((j) => j.assetId)
    .sort()
    .join('|')
}

function createDryRunClient(): LumaGenerationClient {
  return {
    async submit() {
      return { generationId: `dryrun-${Math.random().toString(36).slice(2, 10)}` }
    },
    async poll() {
      // A short, fixed delay so the per-asset Waiting/Generating/Complete
      // UI is visibly meaningful during a dry run, without ever reaching
      // the network.
      await new Promise((resolve) => setTimeout(resolve, 1200))
      return { state: 'completed', videoUrl: 'dry-run://no-network-call' }
    },
    async download(_videoUrl, assetId) {
      // Never touches scripts/lib/lumaVideo.mts's real asset directory —
      // a synthetic, clearly-marked path only, so it can never be
      // mistaken for a real cached clip.
      return { assetPath: `luma-assets/DRY-RUN-${assetId}.mp4`, durationSeconds: 5 }
    },
  }
}

function createRealLumaClient(): LumaGenerationClient {
  return {
    async submit(prompt) {
      const apiKey = process.env.LUMA_AGENTS_API_KEY
      if (!apiKey) throw new Error('LUMA_AGENTS_API_KEY is not set.')
      const shot: LumaShot = { sceneId: 'generation', prompt }
      const result = await submitLumaGeneration(shot, apiKey, POC_GENERATION_SETTINGS)
      if (!result.id) throw new Error(result.error ?? 'Luma did not accept the generation request.')
      return { generationId: result.id }
    },
    async poll(generationId) {
      const apiKey = process.env.LUMA_AGENTS_API_KEY
      if (!apiKey) throw new Error('LUMA_AGENTS_API_KEY is not set.')
      // pollUntilDone already loops internally (30s initial delay, 10s
      // interval, 10-minute timeout) until a terminal state — the SAME
      // proven behavior the original POC CLI path uses.
      const status = await pollUntilDone(generationId, apiKey)
      const videoUrl = status.output?.[0]?.url
      if (status.state === 'completed' && videoUrl) return { state: 'completed', videoUrl }
      return { state: 'failed', errorMessage: status.failure_reason ?? `Luma generation ended in state "${status.state}".` }
    },
    async download(videoUrl, assetId) {
      const assetPath = await downloadVideo(videoUrl, assetId)
      return { assetPath, durationSeconds: 5 } // matches POC_GENERATION_SETTINGS.duration ('5s')
    },
  }
}

function isLiveGenerationArmed(): boolean {
  // Deliberately read ONLY from this process's own environment — never
  // from any request body/header the browser could influence — so
  // nothing reachable from the UI can ever arm real spending.
  return process.env.LUMA_LIVE_GENERATION === 'true'
}

// DURABLE GENERATION STATE — survives a dev-server restart (the exact
// same restart hazard the checkpoint mechanism protects the storyboard
// from). A single gitignored JSON file under output/, separate from the
// checkpoint file and never touched/deleted by it. Written immediately
// after every state transition (see cinematicGenerationExecutor.ts's
// `persist()`): assetId, generationId, status, prompt/job identity,
// checkpointHash, and full history — enough to resume a mid-flight
// generation via GET-only polling instead of ever submitting again.
const GENERATION_STATE_PATH = path.join(process.cwd(), 'output', 'cinematic-generation-state.json')

// Throws (never silently returns {}) on a malformed/corrupt file — losing
// track of what's actually in it is exactly how an asset that's really
// 'generating'/'complete' could get treated as 'idle' and freely
// resubmitted. The caller (cinematicGenerationExecutor.ts's seeding logic)
// is responsible for turning this into a halted/'review' state rather than
// proceeding as if nothing were persisted.
function readGenerationStateFile(statePath: string): Record<string, PersistedAssetRecord> {
  if (!existsSync(statePath)) return {}
  return JSON.parse(readFileSync(statePath, 'utf8')) as Record<string, PersistedAssetRecord>
}

// Atomic write: write to a sibling temp file, then rename over the real
// path. A rename within the same directory is atomic on every filesystem
// this app runs on (macOS/Linux), so a process crash/kill mid-write can
// only ever leave the ORIGINAL file intact or the NEW file fully written
// — never a half-written statePath.
function writeGenerationStateFileAtomically(statePath: string, all: Record<string, PersistedAssetRecord>): void {
  mkdirSync(path.dirname(statePath), { recursive: true })
  const tmpPath = `${statePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const fd = openSync(tmpPath, 'w')
  try {
    writeFileSync(fd, JSON.stringify(all, null, 2))
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(tmpPath, statePath)
}

// Exported (with an optional path override) so its atomicity/corrupt-file
// behavior can be unit-tested directly against a temp file, without
// touching the real output/cinematic-generation-state.json or relying on
// process.cwd(). Defaults to GENERATION_STATE_PATH for every real caller
// in this plugin.
export function createJsonFileDurableGenerationStore(statePath: string = GENERATION_STATE_PATH): DurableGenerationStore {
  return {
    loadAll: () => readGenerationStateFile(statePath),
    save: (record) => {
      const all = readGenerationStateFile(statePath)
      all[record.assetId] = record
      writeGenerationStateFileAtomically(statePath, all)
    },
  }
}

function getOrCreateSession(scenes: VideoStoryboardScene[]): GenerationSession {
  const plans = planShotsForStoryboard(scenes)
  const jobs = buildGenerationJobs(plans)
  const key = jobSetKey(jobs)

  if (currentSession && jobSetKey(currentSession.jobs) === key) {
    return currentSession // same frozen plan — preserve in-progress/complete/failed state
  }

  const client = isLiveGenerationArmed() ? createRealLumaClient() : createDryRunClient()
  const cache = createInMemoryGenerationAssetCache()
  if (isLiveGenerationArmed()) {
    // Mirrors lumaVideo.mts's own existsSync reuse-check — an asset
    // already downloaded from an earlier approved run is never
    // regenerated.
    for (const job of jobs) {
      if (existsSync(assetCachePath(job.assetId))) {
        cache.set(job.assetId, { assetPath: `luma-assets/${job.assetId}.mp4`, durationSeconds: 5 })
      }
    }
  }

  const { hash: checkpointHash } = buildFingerprint({ scenes })
  const store = createJsonFileDurableGenerationStore()
  // Constructing the executor with `store` set restores any persisted
  // generating/failed/complete state for this exact job set and — for
  // anything still 'generating' — automatically resumes polling (GET
  // only, never a new submit). This is what makes a dev-server restart
  // safe: this function runs again at startup (see configureServer
  // below) before any admin action, so an interrupted generation
  // reconnects on its own.
  const executor = createCinematicGenerationExecutor({ client, cache, jobs, store, checkpointHash })
  currentSession = { jobs, executor }
  return currentSession
}

// TEMPORARY/LOCAL DEV CHECKPOINT ONLY — lets the exact approved
// storyboard + cinematic plan + generation package survive the one
// dev-server restart needed to arm LUMA_LIVE_GENERATION=true (env-file
// changes restart Vite's dev server, which clears both this plugin's
// in-memory session and the browser's in-memory React state). Not a
// general persistence feature: no Supabase, no DB, no production
// storage — a single gitignored JSON file under output/, the same
// directory convention dev/local-video-render-plugin.ts already uses
// for local-only render artifacts.
const CHECKPOINT_PATH = path.join(process.cwd(), 'output', 'cinematic-generation-checkpoint.json')

// Deterministic — pure function of the storyboard's own content via the
// SAME planner/job-builder/pricing already used everywhere else in this
// feature. Used identically when saving a checkpoint and when verifying
// one, so "recomputed hash matches stored hash" is a genuine integrity
// check, not just echoing a stored value back.
function buildFingerprint(storyboard: { scenes: VideoStoryboardScene[] }) {
  const plans = planShotsForStoryboard(storyboard.scenes)
  const jobs = buildGenerationJobs(plans)
  const summary = summarizeGenerationNeeds(plans)

  const canonical = {
    scenes: storyboard.scenes.map((s) => ({
      id: s.id,
      type: s.type,
      title: s.title ?? null,
      durationSeconds: s.durationSeconds ?? null,
      narrationText: s.narrationText ?? null,
    })),
    plan: plans.map((p) => ({
      sceneId: p.sceneId,
      treatment: p.treatment,
      shots: p.shots.map((s) => ({
        id: s.id,
        type: s.type,
        purpose: s.purpose,
        screenDurationSeconds: s.screenDurationSeconds,
        generationAssetId: s.generationAssetId ?? null,
        requiresGeneration: s.requiresGeneration,
      })),
    })),
    jobs: jobs.map((j) => ({ assetId: j.assetId, sceneId: j.sceneId, prompt: j.prompt, usageShotIds: j.usageShotIds })),
    summary,
    generationSettings: POC_GENERATION_SETTINGS,
  }

  const hash = createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
  return { canonical, hash, plans, jobs, summary }
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

export function localCinematicGenerationPlugin(): Plugin {
  return {
    name: 'local-cinematic-generation',
    apply: 'serve',
    configureServer(server) {
      // RESTORE ON STARTUP — if a checkpoint from a prior process exists,
      // rebuild the session immediately (read-only: this never calls
      // generateAll/submit, only seeds state from the durable store and
      // resumes any still-in-flight polls). Satisfies "on dev-server
      // restart, restore the durable session" without requiring the
      // admin to re-click anything first.
      if (existsSync(CHECKPOINT_PATH)) {
        try {
          const stored = JSON.parse(readFileSync(CHECKPOINT_PATH, 'utf8')) as { storyboard: VideoStoryboard }
          getOrCreateSession(stored.storyboard.scenes)
          console.log('[local-cinematic-generation] restored session from checkpoint on startup.')
        } catch (err) {
          console.error('[local-cinematic-generation] could not restore session on startup:', err instanceof Error ? err.message : err)
        }
      }

      // The ONE endpoint that can start paid work — called ONLY by the
      // admin's explicit "Generate Cinematic Footage" button click, never
      // from a render/effect/navigation. Fire-and-forget: responds as
      // soon as generation has been kicked off; the browser polls
      // /status for progress.
      server.middlewares.use('/dev/cinematic-generation/generate', async (req: IncomingMessage, res: ServerResponse, next) => {
        if (req.method !== 'POST') return next()
        try {
          const body = (await readJsonBody(req)) as { scenes?: VideoStoryboardScene[] }
          if (!Array.isArray(body.scenes)) return sendJson(res, 400, { ok: false, message: 'Missing scenes in request body.' })

          const session = getOrCreateSession(body.scenes)
          // Fire-and-forget: generateAll() now submits jobs one at a time
          // internally (see its own comment) so a persistence failure
          // partway through halts the rest of the batch — the HTTP
          // response still returns immediately; the browser polls
          // /status for progress exactly as before.
          void session.executor.generateAll()
          return sendJson(res, 200, { ok: true, live: isLiveGenerationArmed() })
        } catch (err) {
          console.error('[local-cinematic-generation] generate failed:', err instanceof Error ? err.message : err)
          return sendJson(res, 500, { ok: false, message: 'Could not start generation. Check the terminal running `npm run dev`.' })
        }
      })

      // Read-only — safe to call from a React effect/poll/refresh.
      server.middlewares.use('/dev/cinematic-generation/status', (req: IncomingMessage, res: ServerResponse, next) => {
        if (req.method !== 'GET') return next()
        if (!currentSession) return sendJson(res, 200, { started: false, states: [], cinematicAssetsByScene: {}, halted: false })
        return sendJson(res, 200, {
          started: true,
          states: currentSession.executor.getAllStates(),
          cinematicAssetsByScene: currentSession.executor.buildCinematicAssetsByScene(),
          halted: currentSession.executor.isHalted(),
          haltReason: currentSession.executor.getHaltReason(),
        })
      })

      // Targets exactly one failed asset — the only way a failed asset
      // generates again, and only via this separate, explicit call.
      server.middlewares.use('/dev/cinematic-generation/retry', async (req: IncomingMessage, res: ServerResponse, next) => {
        if (req.method !== 'POST') return next()
        try {
          const body = (await readJsonBody(req)) as { assetId?: string }
          if (!currentSession || typeof body.assetId !== 'string') return sendJson(res, 400, { ok: false, message: 'No active generation session or missing assetId.' })
          currentSession.executor.retryAsset(body.assetId)
          return sendJson(res, 200, { ok: true })
        } catch (err) {
          console.error('[local-cinematic-generation] retry failed:', err instanceof Error ? err.message : err)
          return sendJson(res, 500, { ok: false, message: 'Retry failed. Check the terminal running `npm run dev`.' })
        }
      })

      // Targets exactly one NOT-yet-attempted asset — for a single
      // controlled validation submission without ever calling generateAll
      // (which would submit every idle job at once). Mirrors /retry's
      // pattern exactly, but requestGeneration only ever acts on an
      // 'idle' asset (never 'failed'/'review'/already in-flight), whereas
      // /retry only ever acts on a 'failed' one — the two are
      // intentionally disjoint, never overlapping entry points.
      server.middlewares.use('/dev/cinematic-generation/generate-one', async (req: IncomingMessage, res: ServerResponse, next) => {
        if (req.method !== 'POST') return next()
        try {
          const body = (await readJsonBody(req)) as { assetId?: string }
          if (!currentSession || typeof body.assetId !== 'string') return sendJson(res, 400, { ok: false, message: 'No active generation session or missing assetId.' })
          currentSession.executor.requestGeneration(body.assetId)
          return sendJson(res, 200, { ok: true, live: isLiveGenerationArmed() })
        } catch (err) {
          console.error('[local-cinematic-generation] generate-one failed:', err instanceof Error ? err.message : err)
          return sendJson(res, 500, { ok: false, message: 'Could not start generation for this asset. Check the terminal running `npm run dev`.' })
        }
      })

      // TEMPORARY/LOCAL DEV CHECKPOINT — saves the exact approved
      // storyboard (plus its derived plan/jobs/summary/hash, for human
      // auditability) so it can survive the one restart needed to arm
      // LUMA_LIVE_GENERATION. Never calls Anthropic or Luma itself.
      server.middlewares.use('/dev/cinematic-generation/checkpoint', async (req: IncomingMessage, res: ServerResponse, next) => {
        if (req.method === 'POST') {
          try {
            const body = (await readJsonBody(req)) as { storyboard?: VideoStoryboard }
            if (!body.storyboard || !Array.isArray(body.storyboard.scenes)) {
              return sendJson(res, 400, { ok: false, message: 'Missing storyboard in request body.' })
            }
            const { canonical, hash, summary } = buildFingerprint(body.storyboard)
            mkdirSync(path.dirname(CHECKPOINT_PATH), { recursive: true })
            writeFileSync(CHECKPOINT_PATH, JSON.stringify({ storyboard: body.storyboard, canonical, hash, createdAt: new Date().toISOString() }))
            return sendJson(res, 200, { ok: true, hash, summary })
          } catch (err) {
            console.error('[local-cinematic-generation] checkpoint save failed:', err instanceof Error ? err.message : err)
            return sendJson(res, 500, { ok: false, message: 'Could not save checkpoint. Check the terminal running `npm run dev`.' })
          }
        }

        if (req.method === 'GET') {
          try {
            if (!existsSync(CHECKPOINT_PATH)) return sendJson(res, 200, { exists: false })
            const stored = JSON.parse(readFileSync(CHECKPOINT_PATH, 'utf8')) as { storyboard: VideoStoryboard; hash: string; createdAt: string }
            // Recomputed fresh from the stored storyboard — never just
            // echoes the stored hash back — so a mismatch here would mean
            // the storyboard/plan/prompts on disk no longer reproduce
            // what was actually approved.
            const recomputed = buildFingerprint(stored.storyboard)
            return sendJson(res, 200, {
              exists: true,
              storyboard: stored.storyboard,
              summary: recomputed.summary,
              hash: stored.hash,
              recomputedHash: recomputed.hash,
              matches: stored.hash === recomputed.hash,
              createdAt: stored.createdAt,
            })
          } catch (err) {
            console.error('[local-cinematic-generation] checkpoint read failed:', err instanceof Error ? err.message : err)
            return sendJson(res, 500, { ok: false, message: 'Could not read checkpoint. Check the terminal running `npm run dev`.' })
          }
        }

        return next()
      })
    },
  }
}
