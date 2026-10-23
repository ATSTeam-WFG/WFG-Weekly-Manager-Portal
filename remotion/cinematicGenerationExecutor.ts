import type { CinematicAsset } from '../src/lib/videoStoryboard.ts'
import type { ScenePlan } from './cinematicPlan.ts'

// THE GENERATION EXECUTOR — implements the approved paid-generation
// contract as a pure, injectable state machine:
//
//   approved storyboard -> frozen cinematic plan -> explicit admin
//   generation approval -> generate every unique generationAssetId
//   exactly once -> poll status -> download/cache successful MP4 ->
//   map editorial usages to generated assets -> populate
//   scene.cinematicAssets[] -> (later, separately) Remotion render.
//
// Planning (cinematicPlan.ts) and execution (this file) are deliberately
// separate: this module never recomputes or reads a storyboard/plan on
// its own — it is handed an already-frozen ScenePlan[] and only ever
// acts on the GenerationJob[] derived from it once, up front.
//
// PAID-POST SAFETY (the core invariant this whole file exists to
// enforce): for a given assetId, `requestGeneration` performs AT MOST
// ONE in-flight submit at a time, and will not re-submit an asset that
// is already queued/generating/complete. A failed asset stays failed
// until `retryAsset` is called — a second, explicit, caller-chosen
// action — never automatically. Status polling (`client.poll`) is
// invoked only from inside the single in-flight generation flow this
// module itself started; nothing here ever calls `client.poll` in a way
// that could trigger a new `client.submit`.

// 'review' is distinct from 'failed': it means the persisted record for
// this asset cannot be trusted automatically (a checkpoint mismatch, or a
// durable-state file that failed to load/parse) — never auto-submitted,
// and NOT offered an automatic retry path either, unlike 'failed'. A
// human must look at it before anything happens to this asset again.
export type GenerationAssetStatus = 'idle' | 'queued' | 'generating' | 'complete' | 'failed' | 'review'

export interface GenerationAssetState {
  assetId: string
  status: GenerationAssetStatus
  generationId?: string
  assetPath?: string
  durationSeconds?: number
  errorMessage?: string
  // The remote URL Luma returned for a completed generation — persisted
  // so a "completed remotely, but local file missing" record can be
  // recovered by polling+downloading again, never by resubmitting.
  videoUrl?: string
}

export interface GenerationJob {
  assetId: string
  sceneId: string
  prompt: string
  // Every PlannedShot id that resolves to this one generation asset —
  // the shot that requiresGeneration plus any shot(s) that reuse it.
  usageShotIds: string[]
}

export interface GenerationStatusResult {
  state: 'processing' | 'completed' | 'failed'
  videoUrl?: string
  errorMessage?: string
}

export interface DownloadedAsset {
  assetPath: string
  durationSeconds: number
}

// Injected, never implemented inline here — keeps this module testable
// with a mock/dry-run client and lets the real Ray 3.2 HTTP calls live
// in one place (remotion/lumaRayGenerationClient.ts).
export interface LumaGenerationClient {
  submit(prompt: string): Promise<{ generationId: string }>
  poll(generationId: string): Promise<GenerationStatusResult>
  download(videoUrl: string, assetId: string): Promise<DownloadedAsset>
}

export interface GenerationAssetCache {
  get(assetId: string): DownloadedAsset | undefined
  set(assetId: string, asset: DownloadedAsset): void
}

export function createInMemoryGenerationAssetCache(): GenerationAssetCache {
  const store = new Map<string, DownloadedAsset>()
  return {
    get: (assetId) => store.get(assetId),
    set: (assetId, asset) => store.set(assetId, asset),
  }
}

// DURABLE STATE — survives a dev-server restart. Optional: when no
// `store` is passed to createCinematicGenerationExecutor, behavior is
// byte-identical to before (pure in-memory, no persistence). The
// interface itself has no filesystem dependency — the real JSON-file
// implementation lives in dev/local-cinematic-generation-plugin.ts
// (Node-only), never imported here, since this module is also bundled
// into the browser (see buildGenerationJobs' use in
// VideoCreationCinematicPlan.tsx).
export interface PersistedHistoryEntry {
  generationId?: string
  status: GenerationAssetStatus
  errorMessage?: string
  at: string
}

export interface PersistedAssetRecord {
  assetId: string
  sceneId: string
  prompt: string
  status: GenerationAssetStatus
  generationId?: string
  submittedAt?: string
  updatedAt: string
  assetPath?: string
  durationSeconds?: number
  errorMessage?: string
  checkpointHash?: string
  videoUrl?: string
  // Incremented once per actual paid POST for this assetId (1 = the
  // first submit, 2 = the first retryAsset, ...). A separate counter from
  // history.length, which also records non-submit transitions (e.g.
  // 'failed'), so attempt always means "how many times has this asset
  // genuinely been POSTed to Luma."
  attempt: number
  history: PersistedHistoryEntry[]
}

export interface DurableGenerationStore {
  loadAll(): Record<string, PersistedAssetRecord>
  save(record: PersistedAssetRecord): void
}

// A pure, in-memory DurableGenerationStore — used by tests to simulate
// "restart" (construct a second executor against the SAME store
// instance) without touching any real filesystem.
export function createInMemoryDurableGenerationStore(): DurableGenerationStore {
  const records = new Map<string, PersistedAssetRecord>()
  return {
    loadAll: () => Object.fromEntries(records),
    save: (record) => records.set(record.assetId, record),
  }
}

// Builds exactly one GenerationJob per unique generationAssetId found
// across every scene's shots — a shot that reuses an earlier shot's
// asset (requiresGeneration: false) is folded into that same job's
// usageShotIds, never given a job of its own, so a reused editorial
// usage can never create a duplicate generation request.
export function buildGenerationJobs(scenePlans: ScenePlan[]): GenerationJob[] {
  const jobsByAssetId = new Map<string, GenerationJob>()

  for (const plan of scenePlans) {
    for (const shot of plan.shots) {
      if (!shot.generationAssetId) continue
      const existing = jobsByAssetId.get(shot.generationAssetId)
      if (existing) {
        existing.usageShotIds.push(shot.id)
        continue
      }
      jobsByAssetId.set(shot.generationAssetId, {
        assetId: shot.generationAssetId,
        sceneId: plan.sceneId,
        // The generating shot's own prompt is authoritative for the
        // asset — a reused shot that happens to be encountered first in
        // iteration order never supplies the prompt (see the backfill
        // pass below).
        prompt: shot.requiresGeneration ? (shot.visualPrompt ?? '') : '',
        usageShotIds: [shot.id],
      })
    }
  }

  // Backfill: if the generating shot for an asset was discovered AFTER
  // a reused shot referencing the same id (shot ordering within a scene
  // always has the generator first today, but this makes the function
  // correct regardless of ordering), make sure the job's prompt is the
  // generating shot's prompt, not a reused shot's placeholder.
  for (const plan of scenePlans) {
    for (const shot of plan.shots) {
      if (shot.requiresGeneration && shot.generationAssetId) {
        const job = jobsByAssetId.get(shot.generationAssetId)
        if (job && !job.prompt) job.prompt = shot.visualPrompt ?? ''
      }
    }
  }

  return [...jobsByAssetId.values()]
}

// Thrown ONLY from the one persist() call that immediately follows a
// successful paid client.submit() — i.e. the moment a real generationId
// exists but could not be written to durable storage. Distinguishing this
// from an ordinary generation failure (Luma itself failing/erroring) is
// the entire point: an ordinary failure is safe to leave 'failed' (the
// admin can explicitly retry), but a persistence failure right after a
// paid POST means the executor can no longer guarantee it won't forget
// about — and therefore accidentally resubmit — a real paid resource, so
// the whole batch must stop instead.
class PersistenceHaltError extends Error {}

export interface CinematicGenerationExecutor {
  getState(assetId: string): GenerationAssetState
  getAllStates(): GenerationAssetState[]
  // True once any persistence or durable-state failure has required
  // halting — see PersistenceHaltError above and the corrupt-state-file
  // handling in the seeding loop below. Once true, generateAll/
  // requestGeneration/retryAsset all become no-ops; the only recovery is
  // fixing the underlying issue and restarting (a fresh executor
  // instance), never an automatic in-process retry.
  isHalted(): boolean
  getHaltReason(): string | undefined
  // Starts generation for every job not already idle-attempted/cached —
  // the one action the admin's "Generate Cinematic Footage" button
  // calls. Safe to call more than once (e.g. an accidental double
  // click): already-queued/generating/complete/failed assets are
  // no-ops here, exactly like requestGeneration.
  generateAll(): Promise<void>
  // Starts generation for exactly one asset. No-op if that asset is
  // already queued, generating, complete, or (previously) failed —
  // a failed asset only ever restarts via retryAsset.
  requestGeneration(assetId: string): void
  // The ONLY way a failed asset generates again — a second, explicit,
  // caller-chosen action, never automatic.
  retryAsset(assetId: string): void
  // Every usage (generating shot + any shots reusing its asset) mapped
  // to a CinematicAsset, for every asset that has completed so far.
  // Keyed by sceneId so callers can merge straight into
  // storyboard.scenes[i].cinematicAssets.
  buildCinematicAssetsByScene(): Record<string, CinematicAsset[]>
}

export interface CreateGenerationExecutorOptions {
  client: LumaGenerationClient
  cache: GenerationAssetCache
  jobs: GenerationJob[]
  pollIntervalMs?: number
  // Optional durable persistence — see DurableGenerationStore above.
  // Omitted entirely in every existing call site's tests: behavior is
  // unchanged (pure in-memory) when not provided.
  store?: DurableGenerationStore
  checkpointHash?: string
  now?: () => string
}

// A single fixed per-usage screen-time estimate for the resulting
// CinematicAsset — matches cinematicPlan.ts's own CINEMATIC_SHOT
// constants. Real frame-accurate duration still comes from the
// downloaded clip's own length (DownloadedAsset.durationSeconds); this
// is only the trim window default applied on top of it.
const GENERATING_USAGE_TRIM_SECONDS = 4
const REUSED_USAGE_TRIM_OFFSET_SECONDS = 1

export function createCinematicGenerationExecutor(options: CreateGenerationExecutorOptions): CinematicGenerationExecutor {
  const { client, cache, jobs, pollIntervalMs = 2000, store, checkpointHash, now = () => new Date().toISOString() } = options
  const jobsByAssetId = new Map(jobs.map((job) => [job.assetId, job]))
  const states = new Map<string, GenerationAssetState>()
  const history = new Map<string, PersistedHistoryEntry[]>()
  const attempts = new Map<string, number>()
  // In-flight guard — the actual double-submit lock. An assetId is
  // present here for the entire duration of one submit/resume->poll
  // ->download flow; requestGeneration/retryAsset are no-ops while it's
  // present.
  const inFlight = new Set<string>()
  // Set exactly once, by either a corrupt/unreadable durable-state file at
  // startup or a persist() failure right after a paid POST (see
  // PersistenceHaltError) — see isHalted()/getHaltReason() above.
  let halted = false
  let haltReason: string | undefined

  function log(line: string) {
    // Never logs the prompt or any secret — only assetId/generationId/
    // status/error, per the required SUBMIT/POLL/COMPLETE/FAIL/
    // DOWNLOAD/RETRY lines.
    console.log(`[cinematic-generation] ${line}`)
  }

  // `critical: true` is used for exactly one call site: the persist
  // immediately after a successful client.submit(). A throw there means a
  // real paid generationId exists but could not be written to durable
  // storage — this propagates as PersistenceHaltError instead of being
  // silently absorbed, so the caller can halt the whole batch rather than
  // relabel it as an ordinary generation failure (which would allow a
  // future explicit retry to blindly resubmit a resource we never lost,
  // just failed to record).
  function persist(assetId: string, extra: Partial<Pick<PersistedAssetRecord, 'submittedAt'>> = {}, critical = false) {
    if (!store) return
    const job = jobsByAssetId.get(assetId)
    const state = states.get(assetId)
    if (!job || !state) return
    let existing: PersistedAssetRecord | undefined
    try {
      existing = store.loadAll()[assetId]
      store.save({
        assetId,
        sceneId: job.sceneId,
        prompt: job.prompt,
        status: state.status,
        generationId: state.generationId,
        submittedAt: extra.submittedAt ?? existing?.submittedAt,
        updatedAt: now(),
        assetPath: state.assetPath,
        durationSeconds: state.durationSeconds,
        errorMessage: state.errorMessage,
        checkpointHash,
        videoUrl: state.videoUrl,
        attempt: attempts.get(assetId) ?? existing?.attempt ?? 0,
        history: history.get(assetId) ?? existing?.history ?? [],
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error'
      if (!critical) {
        console.error(`[cinematic-generation] non-critical persist failed for ${assetId}: ${message}`)
        return
      }
      throw new PersistenceHaltError(`Could not persist generationId for ${assetId} immediately after a successful paid generation: ${message}`)
    }
  }

  function pushHistory(assetId: string, entry: Omit<PersistedHistoryEntry, 'at'>) {
    const list = history.get(assetId) ?? []
    list.push({ ...entry, at: now() })
    history.set(assetId, list)
  }

  function setState(
    assetId: string,
    patch: Partial<GenerationAssetState>,
    persistedExtra?: Partial<Pick<PersistedAssetRecord, 'submittedAt'>>,
    critical = false,
  ) {
    const current = states.get(assetId) ?? { assetId, status: 'idle' }
    const next = { ...current, ...patch }
    states.set(assetId, next)
    if (patch.status) pushHistory(assetId, { generationId: next.generationId, status: next.status, errorMessage: next.errorMessage })
    persist(assetId, persistedExtra, critical)
  }

  // Seed initial state: cache (already-downloaded asset) takes priority,
  // then any durable record from a prior process, then 'idle'. A
  // restored 'generating' record (a submit happened, but this process
  // never learned the outcome) is resumed via poll-only below — NEVER
  // re-submitted. The whole durable-state file is read exactly ONCE here
  // (not once per job) — both for efficiency and so a corrupt/unreadable
  // file is one failure to handle, not N.
  let persistedAll: Record<string, PersistedAssetRecord> = {}
  if (store) {
    try {
      persistedAll = store.loadAll()
    } catch (err) {
      // A corrupt/unreadable durable-state file is NOT treated as "no
      // state" (which would silently let every job seed as 'idle' and be
      // freely (re)submitted by generateAll — exactly the accidental
      // duplicate-paid-work risk this file exists to prevent). Instead,
      // halt immediately: every job becomes 'review', and nothing can
      // submit until the file is fixed and the process restarted.
      halted = true
      haltReason = `Durable generation state file could not be read: ${err instanceof Error ? err.message : 'unknown error'}. No asset in this session can be (re)submitted until this is resolved.`
      log(`HALT (all assets) ${haltReason}`)
    }
  }

  const toResume: Array<{ assetId: string; generationId: string }> = []
  for (const job of jobs) {
    if (halted) {
      states.set(job.assetId, { assetId: job.assetId, status: 'review', errorMessage: haltReason })
      continue
    }

    const cached = cache.get(job.assetId)
    if (cached) {
      states.set(job.assetId, { assetId: job.assetId, status: 'complete', ...cached })
      continue
    }

    const persisted = persistedAll[job.assetId]
    if (persisted?.history) history.set(job.assetId, persisted.history)
    if (persisted?.attempt) attempts.set(job.assetId, persisted.attempt)

    // A persisted record stamped with a DIFFERENT checkpointHash than the
    // one this executor was constructed with means the storyboard/plan
    // changed since that record was written — it no longer reliably
    // identifies what the generationId/assetPath actually correspond to.
    // Never resumed, never auto-retried: surfaced for manual review only.
    const checkpointMismatch =
      persisted?.checkpointHash !== undefined && checkpointHash !== undefined && persisted.checkpointHash !== checkpointHash

    if (checkpointMismatch) {
      states.set(job.assetId, {
        assetId: job.assetId,
        status: 'review',
        generationId: persisted!.generationId,
        errorMessage: `Persisted state was recorded under a different checkpoint (expected ${checkpointHash}, found ${persisted!.checkpointHash}) — requires manual review before any action.`,
      })
    } else if (persisted?.status === 'complete' && persisted.assetPath && persisted.durationSeconds !== undefined) {
      states.set(job.assetId, {
        assetId: job.assetId,
        status: 'complete',
        generationId: persisted.generationId,
        assetPath: persisted.assetPath,
        durationSeconds: persisted.durationSeconds,
        videoUrl: persisted.videoUrl,
      })
      cache.set(job.assetId, { assetPath: persisted.assetPath, durationSeconds: persisted.durationSeconds })
    } else if (persisted?.status === 'complete' && persisted.generationId) {
      // Luma finished this generation in a prior process, but the local
      // file is missing (e.g. output/ was cleared) — resume via
      // poll-only, which re-fetches the same completed result and
      // downloads it again. NEVER a new submit for an asset Luma has
      // already generated.
      states.set(job.assetId, { assetId: job.assetId, status: 'generating', generationId: persisted.generationId })
      toResume.push({ assetId: job.assetId, generationId: persisted.generationId })
    } else if ((persisted?.status === 'queued' || persisted?.status === 'generating') && persisted.generationId) {
      states.set(job.assetId, { assetId: job.assetId, status: 'generating', generationId: persisted.generationId })
      toResume.push({ assetId: job.assetId, generationId: persisted.generationId })
    } else if (persisted?.status === 'failed') {
      states.set(job.assetId, { assetId: job.assetId, status: 'failed', generationId: persisted.generationId, errorMessage: persisted.errorMessage })
    } else if (persisted?.status === 'review') {
      // A previously-flagged review item stays in review across restarts
      // too — it is never silently reset to idle (which would make it
      // freely submittable again) merely because this is a new process.
      states.set(job.assetId, { assetId: job.assetId, status: 'review', generationId: persisted.generationId, errorMessage: persisted.errorMessage })
    } else {
      states.set(job.assetId, { assetId: job.assetId, status: 'idle' })
    }
  }

  async function pollToCompletion(assetId: string, generationId: string): Promise<void> {
    let result: GenerationStatusResult = { state: 'processing' }
    while (result.state === 'processing') {
      // GET-only polling — safe to repeat; never resubmits.
      result = await client.poll(generationId)
      log(`POLL ${assetId} ${generationId} ${result.state}`)
      if (result.state === 'processing') {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
      }
    }

    if (result.state === 'failed' || !result.videoUrl) {
      log(`FAIL ${assetId} ${generationId} ${result.errorMessage ?? 'unknown error'}`)
      setState(assetId, { status: 'failed', errorMessage: result.errorMessage ?? 'Generation failed.' })
      return
    }

    log(`COMPLETE ${assetId} ${generationId}`)
    // Luma already has a finished output for this generationId — download
    // and cache it rather than ever submitting a new generation.
    const downloaded = await client.download(result.videoUrl, assetId)
    log(`DOWNLOAD ${assetId} ${downloaded.assetPath}`)
    cache.set(assetId, downloaded)
    setState(assetId, { status: 'complete', assetPath: downloaded.assetPath, durationSeconds: downloaded.durationSeconds, videoUrl: result.videoUrl })
  }

  // Resumes polling for an asset that already has a generationId from a
  // prior process — NEVER calls client.submit(). This is the one and
  // only way an interrupted "generating" asset reconnects.
  async function resumePollingFlow(assetId: string, generationId: string): Promise<void> {
    if (inFlight.has(assetId)) return
    inFlight.add(assetId)
    try {
      await pollToCompletion(assetId, generationId)
    } catch (err) {
      log(`FAIL ${assetId} ${generationId} ${err instanceof Error ? err.message : 'unknown error'}`)
      setState(assetId, { status: 'failed', errorMessage: err instanceof Error ? err.message : 'Generation failed.' })
    } finally {
      inFlight.delete(assetId)
    }
  }

  // Exactly one POST, then the CRITICAL persist of its generationId —
  // split out from the rest of the flow (polling/download) so
  // generateAll() can await just this part per asset, sequentially,
  // without waiting for each asset's full 5-second+ generation to finish
  // before submitting the next one. Returns null if the submit itself
  // failed (asset set to 'failed') OR if persisting the generationId
  // failed (asset set to 'review', executor halted) — either way, the
  // caller must not proceed to polling.
  async function submitAndPersist(assetId: string, job: GenerationJob): Promise<{ generationId: string } | null> {
    setState(assetId, { status: 'queued', errorMessage: undefined, generationId: undefined })
    try {
      // Exactly one POST per explicit generation attempt — never called
      // again for this assetId until a separate, explicit retryAsset.
      const submittedAt = now()
      const { generationId } = await client.submit(job.prompt)
      log(`SUBMIT ${assetId} ${generationId} attempt=${(attempts.get(assetId) ?? 0) + 1}`)
      attempts.set(assetId, (attempts.get(assetId) ?? 0) + 1)
      // critical=true: a throw here means the paid generationId above
      // could not be written to durable storage — see PersistenceHaltError.
      setState(assetId, { status: 'generating', generationId }, { submittedAt }, true)
      return { generationId }
    } catch (err) {
      if (err instanceof PersistenceHaltError) {
        halted = true
        haltReason = err.message
        log(`HALT ${assetId} ${err.message}`)
        // states.set directly, NOT setState — setState would call persist()
        // again, which is the exact operation that just failed.
        states.set(assetId, { ...(states.get(assetId) ?? { assetId, status: 'idle' }), status: 'review', errorMessage: err.message })
        return null
      }
      log(`FAIL ${assetId} ${states.get(assetId)?.generationId ?? '(no generationId)'} ${err instanceof Error ? err.message : 'unknown error'}`)
      setState(assetId, { status: 'failed', errorMessage: err instanceof Error ? err.message : 'Generation failed.' })
      return null
    }
  }

  async function runGenerationFlow(assetId: string): Promise<void> {
    const job = jobsByAssetId.get(assetId)
    if (!job) return

    inFlight.add(assetId)
    try {
      const result = await submitAndPersist(assetId, job)
      if (!result) return // already 'failed' or 'review' — see submitAndPersist
      await pollToCompletion(assetId, result.generationId)
    } catch (err) {
      log(`FAIL ${assetId} ${states.get(assetId)?.generationId ?? '(no generationId)'} ${err instanceof Error ? err.message : 'unknown error'}`)
      setState(assetId, { status: 'failed', errorMessage: err instanceof Error ? err.message : 'Generation failed.' })
    } finally {
      inFlight.delete(assetId)
    }
  }

  // Kick off GET-only resumption for every asset restored mid-flight —
  // automatic, but never a POST, so it's safe to do unconditionally at
  // startup (requirement: "on restart, restore the durable session").
  for (const { assetId, generationId } of toResume) {
    void resumePollingFlow(assetId, generationId)
  }

  function requestGeneration(assetId: string) {
    if (halted) return // persistence/durable-state failure — no submission until resolved and restarted
    const job = jobsByAssetId.get(assetId)
    if (!job) return
    if (inFlight.has(assetId)) return // double-click / double-submit guard
    const current = states.get(assetId)?.status ?? 'idle'
    if (current === 'queued' || current === 'generating' || current === 'complete') return
    if (current === 'failed') return // failed assets only restart via retryAsset
    if (current === 'review') return // review assets are never auto-submitted or auto-retried
    void runGenerationFlow(assetId)
  }

  function retryAsset(assetId: string) {
    if (halted) return
    const job = jobsByAssetId.get(assetId)
    if (!job) return
    if (inFlight.has(assetId)) return
    const current = states.get(assetId)
    if (!current || current.status !== 'failed') return // retry only ever targets a failed asset — 'review' is never auto/explicitly retried this way
    log(`RETRY ${assetId} ${current.generationId ?? '(no previous generationId)'}`)
    void runGenerationFlow(assetId)
  }

  // Submits jobs ONE AT A TIME, awaiting each job's submit+critical-persist
  // step before moving to the next — never firing every job's client.submit
  // concurrently. This is what makes "a persistence failure stops the
  // batch" actually true: if job N's persist fails, `halted` is set before
  // job N+1 is ever considered, so no further paid POST can slip out while
  // the earlier failure is still being discovered. Each job's own
  // poll-to-completion/download continues in the background afterward
  // (not awaited here), so this doesn't serialize the slow part —  only
  // the submissions themselves.
  async function generateAll(): Promise<void> {
    for (const job of jobs) {
      if (halted) {
        log(`HALT generateAll stopped before ${job.assetId}: ${haltReason}`)
        break
      }
      if (inFlight.has(job.assetId)) continue
      const current = states.get(job.assetId)?.status ?? 'idle'
      if (current === 'queued' || current === 'generating' || current === 'complete' || current === 'failed' || current === 'review') continue

      inFlight.add(job.assetId)
      const result = await submitAndPersist(job.assetId, job)
      if (!result) {
        inFlight.delete(job.assetId)
        continue // 'failed' or 'review' (and halted, if that's why) — the top-of-loop check handles stopping the rest
      }
      void (async () => {
        try {
          await pollToCompletion(job.assetId, result.generationId)
        } catch (err) {
          log(`FAIL ${job.assetId} ${result.generationId} ${err instanceof Error ? err.message : 'unknown error'}`)
          setState(job.assetId, { status: 'failed', errorMessage: err instanceof Error ? err.message : 'Generation failed.' })
        } finally {
          inFlight.delete(job.assetId)
        }
      })()
    }
  }

  function getState(assetId: string): GenerationAssetState {
    return states.get(assetId) ?? { assetId, status: 'idle' }
  }

  function getAllStates(): GenerationAssetState[] {
    return jobs.map((job) => getState(job.assetId))
  }

  function buildCinematicAssetsByScene(): Record<string, CinematicAsset[]> {
    const bySceneId: Record<string, CinematicAsset[]> = {}

    for (const job of jobs) {
      const state = getState(job.assetId)
      if (state.status !== 'complete' || !state.assetPath || state.durationSeconds === undefined) continue

      const usages = job.usageShotIds
      usages.forEach((_, usageIndex) => {
        const isFirstUsage = usageIndex === 0
        const asset: CinematicAsset = {
          assetPath: state.assetPath!,
          durationSeconds: state.durationSeconds!,
          trimStartSeconds: isFirstUsage ? 0 : REUSED_USAGE_TRIM_OFFSET_SECONDS,
          trimEndSeconds: isFirstUsage
            ? Math.min(GENERATING_USAGE_TRIM_SECONDS, state.durationSeconds!)
            : Math.min(REUSED_USAGE_TRIM_OFFSET_SECONDS + GENERATING_USAGE_TRIM_SECONDS, state.durationSeconds!),
          // A valid CSS transform-origin pair, matching how
          // src/lib/videoStoryboard.ts's CinematicAsset.cropOrigin is
          // documented ("65% 70%") — never the bare keyword 'center'
          // paired with an invalid second value.
          cropOrigin: isFirstUsage ? '50% 50%' : '62% 45%',
          cropScale: isFirstUsage ? 1 : 1.4,
        }
        bySceneId[job.sceneId] = [...(bySceneId[job.sceneId] ?? []), asset]
      })
    }

    return bySceneId
  }

  return {
    getState,
    getAllStates,
    generateAll,
    requestGeneration,
    retryAsset,
    buildCinematicAssetsByScene,
    isHalted: () => halted,
    getHaltReason: () => haltReason,
  }
}
