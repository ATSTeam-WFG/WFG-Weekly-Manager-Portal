// Run with: node --test remotion/cinematicGenerationExecutor.test.ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildGenerationJobs,
  createCinematicGenerationExecutor,
  createInMemoryGenerationAssetCache,
  createInMemoryDurableGenerationStore,
  type LumaGenerationClient,
  type GenerationStatusResult,
  type DownloadedAsset,
} from './cinematicGenerationExecutor.ts'
import { planShotsForStoryboard } from './cinematicPlan.ts'
import type { VideoStoryboardScene } from '../src/lib/videoStoryboard.ts'

function scene(overrides: Partial<VideoStoryboardScene> & Pick<VideoStoryboardScene, 'id' | 'title' | 'type'>): VideoStoryboardScene {
  return overrides
}

// A realistic mixed storyboard: one scene with 2 cinematic shots sharing
// one asset (reuse), one scene with 3 cinematic shots (2 assets) — 3
// unique generation assets total across 5 editorial cinematic usages.
function testStoryboard(): VideoStoryboardScene[] {
  return [
    scene({ id: 's0', title: 'bare', type: 'highlights' }), // 2 cinematic shots -> 1 asset (reuse)
    scene({
      id: 's1',
      title: 'rich',
      type: 'multi-metric',
      metrics: [{ label: 'a', value: '$1' }, { label: 'b', value: '$2' }],
      bullets: ['c'],
    }), // 3 cinematic shots -> 2 assets
  ]
}

interface MockClientHooks {
  submitCount: Map<string, number>
  pollCount: Map<string, number>
  downloadCount: Map<string, number>
  // assetId -> outcome override; defaults to 'completed'
  outcomes: Map<string, 'completed' | 'failed'>
}

function createMockClient(hooks: MockClientHooks): LumaGenerationClient {
  return {
    async submit(prompt: string) {
      // generationId derived from the prompt's position isn't available
      // here, so tests identify calls via the hooks counters keyed by a
      // generationId the mock itself assigns deterministically per call.
      const generationId = `gen-${hooks.submitCount.size}-${Math.random().toString(36).slice(2, 6)}`
      hooks.submitCount.set(generationId, (hooks.submitCount.get(generationId) ?? 0) + 1)
      ;(hooks as unknown as { lastPromptByGenerationId: Map<string, string> }).lastPromptByGenerationId ??= new Map()
      ;(hooks as unknown as { lastPromptByGenerationId: Map<string, string> }).lastPromptByGenerationId.set(generationId, prompt)
      return { generationId }
    },
    async poll(generationId: string): Promise<GenerationStatusResult> {
      hooks.pollCount.set(generationId, (hooks.pollCount.get(generationId) ?? 0) + 1)
      const outcome = hooks.outcomes.get(generationId) ?? 'completed'
      if (outcome === 'failed') return { state: 'failed', errorMessage: 'mock failure' }
      return { state: 'completed', videoUrl: `https://mock/${generationId}.mp4` }
    },
    async download(_videoUrl: string, assetId: string): Promise<DownloadedAsset> {
      hooks.downloadCount.set(assetId, (hooks.downloadCount.get(assetId) ?? 0) + 1)
      return { assetPath: `luma-assets/${assetId}.mp4`, durationSeconds: 5 }
    },
  }
}

function newHooks(): MockClientHooks {
  return { submitCount: new Map(), pollCount: new Map(), downloadCount: new Map(), outcomes: new Map() }
}

async function flushMicrotasks(times = 10) {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

describe('buildGenerationJobs — one job per unique generationAssetId, reused usages folded in, never duplicated', () => {
  test('a 2-cinematic-shot (reuse) scene produces exactly 1 job with 2 usageShotIds', () => {
    const plans = planShotsForStoryboard([scene({ id: 's0', title: 'bare', type: 'highlights' })])
    const jobs = buildGenerationJobs(plans)
    assert.equal(jobs.length, 1)
    assert.equal(jobs[0].usageShotIds.length, 2)
  })

  test('the full test storyboard (2 scenes) produces exactly 3 unique jobs for 5 cinematic usages', () => {
    const plans = planShotsForStoryboard(testStoryboard())
    const jobs = buildGenerationJobs(plans)
    const totalCinematicUsages = plans.flatMap((p) => p.shots).filter((s) => s.type === 'cinematic').length
    assert.equal(totalCinematicUsages, 5)
    assert.equal(jobs.length, 3)
  })

  test('every job\'s prompt is the GENERATING shot\'s visualPrompt, never empty, regardless of shot iteration order', () => {
    const plans = planShotsForStoryboard(testStoryboard())
    const jobs = buildGenerationJobs(plans)
    for (const job of jobs) assert.ok(job.prompt.length > 0, `job ${job.assetId} must have a non-empty prompt`)
  })
})

describe('unique asset IDs generate exactly once; shared editorial usages never generate twice', () => {
  test('requestGeneration on a reused asset only ever submits once total, even though 2 editorial shots reference it', async () => {
    const plans = planShotsForStoryboard([scene({ id: 's0', title: 'bare', type: 'highlights' })])
    const jobs = buildGenerationJobs(plans)
    assert.equal(jobs.length, 1) // the single shared asset for both the generating + reused shot
    const hooks = newHooks()
    const executor = createCinematicGenerationExecutor({ client: createMockClient(hooks), cache: createInMemoryGenerationAssetCache(), jobs, pollIntervalMs: 1 })

    executor.generateAll()
    await flushMicrotasks(20)

    assert.equal(hooks.submitCount.size, 1, 'exactly one generation submitted for the one shared asset')
    assert.equal(executor.getState(jobs[0].assetId).status, 'complete')
  })
})

describe('double-click / double-submit protection', () => {
  test('calling requestGeneration twice in immediate succession for the same assetId submits only once', async () => {
    const plans = planShotsForStoryboard(testStoryboard())
    const jobs = buildGenerationJobs(plans)
    const hooks = newHooks()
    const executor = createCinematicGenerationExecutor({ client: createMockClient(hooks), cache: createInMemoryGenerationAssetCache(), jobs, pollIntervalMs: 1 })

    const assetId = jobs[0].assetId
    executor.requestGeneration(assetId)
    executor.requestGeneration(assetId) // the "double click"
    await flushMicrotasks(20)

    assert.equal(hooks.submitCount.size, 1)
  })

  test('calling generateAll twice (e.g. an accidental repeat button press) never re-submits a job already queued/generating/complete', async () => {
    const plans = planShotsForStoryboard(testStoryboard())
    const jobs = buildGenerationJobs(plans)
    const hooks = newHooks()
    const executor = createCinematicGenerationExecutor({ client: createMockClient(hooks), cache: createInMemoryGenerationAssetCache(), jobs, pollIntervalMs: 1 })

    executor.generateAll()
    executor.generateAll()
    await flushMicrotasks(20)

    assert.equal(hooks.submitCount.size, jobs.length, 'exactly one submit per unique job, never more')
  })
})

describe('failed generation is never automatically retried', () => {
  test('a failed asset stays failed after polling settles, and requestGeneration on it again is a no-op', async () => {
    const plans = planShotsForStoryboard([scene({ id: 's0', title: 'bare', type: 'highlights' })])
    const jobs = buildGenerationJobs(plans)
    const hooks = newHooks()
    const client = createMockClient(hooks)
    // Force this asset's generation to fail.
    const originalSubmit = client.submit.bind(client)
    client.submit = async (prompt) => {
      const { generationId } = await originalSubmit(prompt)
      hooks.outcomes.set(generationId, 'failed')
      return { generationId }
    }
    const executor = createCinematicGenerationExecutor({ client, cache: createInMemoryGenerationAssetCache(), jobs, pollIntervalMs: 1 })

    executor.requestGeneration(jobs[0].assetId)
    await flushMicrotasks(20)
    assert.equal(executor.getState(jobs[0].assetId).status, 'failed')
    assert.equal(hooks.submitCount.size, 1)

    // A second explicit call to requestGeneration (not retryAsset) must NOT resubmit.
    executor.requestGeneration(jobs[0].assetId)
    await flushMicrotasks(20)
    assert.equal(hooks.submitCount.size, 1, 'requestGeneration must never auto-retry a failed asset')
  })

  test('explicit retryAsset targets only the failed asset and leaves every other asset untouched', async () => {
    const plans = planShotsForStoryboard(testStoryboard())
    const jobs = buildGenerationJobs(plans)
    const hooks = newHooks()
    const client = createMockClient(hooks)
    const failingAssetId = jobs[0].assetId
    const realSubmit = client.submit.bind(client)
    let failNextSubmitForFirstJob = true
    client.submit = async (prompt) => {
      const { generationId } = await realSubmit(prompt)
      if (prompt === jobs[0].prompt && failNextSubmitForFirstJob) {
        hooks.outcomes.set(generationId, 'failed')
        failNextSubmitForFirstJob = false
      }
      return { generationId }
    }
    const executor = createCinematicGenerationExecutor({ client, cache: createInMemoryGenerationAssetCache(), jobs, pollIntervalMs: 1 })

    executor.generateAll()
    await flushMicrotasks(30)

    assert.equal(executor.getState(failingAssetId).status, 'failed')
    const otherAssetIds = jobs.slice(1).map((j) => j.assetId)
    for (const id of otherAssetIds) assert.equal(executor.getState(id).status, 'complete')

    const submitCountBeforeRetry = hooks.submitCount.size
    executor.retryAsset(failingAssetId)
    await flushMicrotasks(20)

    assert.equal(executor.getState(failingAssetId).status, 'complete')
    assert.equal(hooks.submitCount.size, submitCountBeforeRetry + 1, 'retry submits exactly one new generation')
    for (const id of otherAssetIds) assert.equal(executor.getState(id).status, 'complete', 'retrying one asset must never disturb another')
  })
})

describe('status polling never itself submits a new generation', () => {
  test('poll is called repeatedly while processing, but submit is called exactly once for that asset', async () => {
    const plans = planShotsForStoryboard([scene({ id: 's0', title: 'bare', type: 'highlights' })])
    const jobs = buildGenerationJobs(plans)
    const hooks = newHooks()
    let pollsBeforeDone = 3
    const client: LumaGenerationClient = {
      async submit(prompt) {
        return createMockClient(hooks).submit(prompt)
      },
      async poll(generationId) {
        hooks.pollCount.set(generationId, (hooks.pollCount.get(generationId) ?? 0) + 1)
        if (pollsBeforeDone > 0) {
          pollsBeforeDone -= 1
          return { state: 'processing' }
        }
        return { state: 'completed', videoUrl: `https://mock/${generationId}.mp4` }
      },
      async download(_url, assetId) {
        return { assetPath: `luma-assets/${assetId}.mp4`, durationSeconds: 5 }
      },
    }
    const executor = createCinematicGenerationExecutor({ client, cache: createInMemoryGenerationAssetCache(), jobs, pollIntervalMs: 1 })

    executor.requestGeneration(jobs[0].assetId)
    await flushMicrotasks(5)
    await new Promise((resolve) => setTimeout(resolve, 20))

    assert.equal(hooks.submitCount.size, 1, 'exactly one submit regardless of how many polls it took')
    assert.equal(executor.getState(jobs[0].assetId).status, 'complete')
  })
})

describe('cached success is never regenerated', () => {
  test('an asset already present in the cache at executor creation starts as complete and generateAll never submits for it', async () => {
    const plans = planShotsForStoryboard([scene({ id: 's0', title: 'bare', type: 'highlights' })])
    const jobs = buildGenerationJobs(plans)
    const hooks = newHooks()
    const cache = createInMemoryGenerationAssetCache()
    cache.set(jobs[0].assetId, { assetPath: 'luma-assets/already-cached.mp4', durationSeconds: 5 })
    const executor = createCinematicGenerationExecutor({ client: createMockClient(hooks), cache, jobs, pollIntervalMs: 1 })

    assert.equal(executor.getState(jobs[0].assetId).status, 'complete')
    executor.generateAll()
    await flushMicrotasks(20)

    assert.equal(hooks.submitCount.size, 0, 'a cached asset must never trigger a new paid submission')
  })
})

describe('cinematicAssets[] mapping', () => {
  test('a completed reuse-pair asset maps to 2 usages for its scene, the first with a wider trim/crop than the reused one', async () => {
    const plans = planShotsForStoryboard([scene({ id: 's0', title: 'bare', type: 'highlights' })])
    const jobs = buildGenerationJobs(plans)
    const hooks = newHooks()
    const executor = createCinematicGenerationExecutor({ client: createMockClient(hooks), cache: createInMemoryGenerationAssetCache(), jobs, pollIntervalMs: 1 })

    executor.generateAll()
    await flushMicrotasks(20)

    const byScene = executor.buildCinematicAssetsByScene()
    assert.ok(byScene['s0'])
    assert.equal(byScene['s0'].length, 2)
    const [first, second] = byScene['s0']
    assert.equal(first.trimStartSeconds, 0)
    assert.notEqual(second.trimStartSeconds, first.trimStartSeconds)
    assert.notEqual(second.cropOrigin, first.cropOrigin)
    assert.equal(first.assetPath, second.assetPath, 'both usages reference the same underlying generated clip')
  })

  test('only complete assets appear in the mapping — a failed or still-generating asset contributes nothing yet', async () => {
    const plans = planShotsForStoryboard(testStoryboard())
    const jobs = buildGenerationJobs(plans)
    const hooks = newHooks()
    const executor = createCinematicGenerationExecutor({ client: createMockClient(hooks), cache: createInMemoryGenerationAssetCache(), jobs, pollIntervalMs: 1 })

    // Don't generate anything — everything is still 'idle'.
    const byScene = executor.buildCinematicAssetsByScene()
    assert.deepEqual(byScene, {})
  })

  test('once all jobs for a storyboard complete, every scene with cinematic shots has a populated cinematicAssets array', async () => {
    const plans = planShotsForStoryboard(testStoryboard())
    const jobs = buildGenerationJobs(plans)
    const hooks = newHooks()
    const executor = createCinematicGenerationExecutor({ client: createMockClient(hooks), cache: createInMemoryGenerationAssetCache(), jobs, pollIntervalMs: 1 })

    executor.generateAll()
    await flushMicrotasks(30)

    const byScene = executor.buildCinematicAssetsByScene()
    assert.ok(byScene['s0'] && byScene['s0'].length === 2)
    assert.ok(byScene['s1'] && byScene['s1'].length === 3)
  })
})

describe('deterministic prompt variety reaches the executor unchanged', () => {
  test('the job prompts built from the plan are exactly the plan\'s own visualPrompt values — the executor never rewrites or re-derives them', () => {
    const plans = planShotsForStoryboard(testStoryboard())
    const jobs = buildGenerationJobs(plans)
    for (const job of jobs) {
      const sourceShot = plans.flatMap((p) => p.shots).find((s) => s.requiresGeneration && s.generationAssetId === job.assetId)
      assert.equal(job.prompt, sourceShot?.visualPrompt)
    }
  })
})

describe('no report facts leak into a submitted prompt', () => {
  test('a rich scene\'s metric value/label never appears in any job prompt built from it', () => {
    const plans = planShotsForStoryboard([
      scene({ id: 's0', title: 'x', type: 'multi-metric', metrics: [{ label: 'Revenue', value: '$42M' }], bullets: ['b'] }),
    ])
    const jobs = buildGenerationJobs(plans)
    for (const job of jobs) {
      assert.equal(job.prompt.includes('Revenue'), false)
      assert.equal(job.prompt.includes('42'), false)
    }
  })
})

describe('durable restart simulation — a second executor instance over the SAME store/cache simulates a dev-server restart', () => {
  test('a submit creates a persisted generationId; a simulated restart resumes via poll only, never a second submit; the resumed asset completes and is cached', async () => {
    const plans = planShotsForStoryboard([scene({ id: 's0', title: 'bare', type: 'highlights' })])
    const jobs = buildGenerationJobs(plans)
    const assetId = jobs[0].assetId

    const submitCalls: string[] = []
    let pollCallCount = 0
    const client: LumaGenerationClient = {
      async submit(prompt) {
        submitCalls.push(prompt)
        return { generationId: 'gen-restart-1' }
      },
      async poll() {
        pollCallCount += 1
        // First poll ever (executor A) simulates the process dying mid-
        // flight: a promise that never resolves. Every later poll
        // (executor B's resume, after the simulated restart) resolves
        // normally — exactly as Luma's own backend would behave,
        // indifferent to which of our processes is asking.
        if (pollCallCount === 1) return new Promise<GenerationStatusResult>(() => {})
        return { state: 'completed', videoUrl: 'https://mock/restart.mp4' }
      },
      async download(_url, id) {
        return { assetPath: `luma-assets/${id}.mp4`, durationSeconds: 5 }
      },
    }

    const store = createInMemoryDurableGenerationStore()
    const cache = createInMemoryGenerationAssetCache()

    const executorA = createCinematicGenerationExecutor({ client, cache, jobs, store, pollIntervalMs: 1 })
    executorA.requestGeneration(assetId)
    await flushMicrotasks(20)

    assert.equal(submitCalls.length, 1, 'exactly one submit before the simulated restart')
    assert.equal(executorA.getState(assetId).status, 'generating')
    assert.equal(store.loadAll()[assetId]?.generationId, 'gen-restart-1', 'the generationId must be durably persisted immediately after submit')
    assert.equal(store.loadAll()[assetId]?.status, 'generating')

    // SIMULATED RESTART: a brand-new executor instance (fresh in-memory
    // states/inFlight — just like a fresh Node process) over the SAME
    // durable store and cache.
    const executorB = createCinematicGenerationExecutor({ client, cache, jobs, store, pollIntervalMs: 1 })

    // Immediately on construction, it must already know about the
    // in-flight generation — restored, not rediscovered via a new submit.
    assert.equal(executorB.getState(assetId).status, 'generating')
    assert.equal(executorB.getState(assetId).generationId, 'gen-restart-1')
    assert.equal(submitCalls.length, 1, 'restoring from the store must never itself submit')

    await flushMicrotasks(20)

    assert.equal(executorB.getState(assetId).status, 'complete', 'the resumed poll-only flow completes the asset')
    assert.equal(submitCalls.length, 1, 'completion after restart still required exactly one submit, ever')
    assert.ok(cache.get(assetId), 'the completed asset is cached for any further restart')
  })

  test('a completed asset (cached + persisted) is never regenerated by generateAll after a restart', async () => {
    const plans = planShotsForStoryboard([scene({ id: 's0', title: 'bare', type: 'highlights' })])
    const jobs = buildGenerationJobs(plans)
    const assetId = jobs[0].assetId

    const submitCalls: string[] = []
    const client: LumaGenerationClient = {
      async submit(prompt) {
        submitCalls.push(prompt)
        return { generationId: 'gen-done-1' }
      },
      async poll() {
        return { state: 'completed', videoUrl: 'https://mock/done.mp4' }
      },
      async download(_url, id) {
        return { assetPath: `luma-assets/${id}.mp4`, durationSeconds: 5 }
      },
    }

    const store = createInMemoryDurableGenerationStore()
    const cache = createInMemoryGenerationAssetCache()

    const executorA = createCinematicGenerationExecutor({ client, cache, jobs, store, pollIntervalMs: 1 })
    executorA.requestGeneration(assetId)
    await flushMicrotasks(20)
    assert.equal(executorA.getState(assetId).status, 'complete')
    assert.equal(submitCalls.length, 1)

    // Simulated restart — asset is already complete via the cache alone.
    const executorB = createCinematicGenerationExecutor({ client, cache, jobs, store, pollIntervalMs: 1 })
    assert.equal(executorB.getState(assetId).status, 'complete')
    executorB.generateAll()
    await flushMicrotasks(10)
    assert.equal(submitCalls.length, 1, 'a completed asset must never be regenerated after a restart')
  })

  test('a failed asset is restored as failed and is NOT auto-retried after a restart — only an explicit retryAsset submits again, and history preserves the previous generationId/error', async () => {
    const plans = planShotsForStoryboard([scene({ id: 's1', title: 'bare2', type: 'status' })])
    const jobs = buildGenerationJobs(plans)
    const assetId = jobs[0].assetId

    const submitCalls: string[] = []
    const client: LumaGenerationClient = {
      async submit(prompt) {
        submitCalls.push(prompt)
        return { generationId: `gen-fail-${submitCalls.length}` }
      },
      async poll() {
        return { state: 'failed', errorMessage: 'mock rejection' }
      },
      async download() {
        throw new Error('download must never be called for a failed generation')
      },
    }

    const store = createInMemoryDurableGenerationStore()
    const cache = createInMemoryGenerationAssetCache()

    const executorA = createCinematicGenerationExecutor({ client, cache, jobs, store, pollIntervalMs: 1 })
    executorA.requestGeneration(assetId)
    await flushMicrotasks(20)
    assert.equal(executorA.getState(assetId).status, 'failed')
    assert.equal(submitCalls.length, 1)

    // Simulated restart.
    const executorB = createCinematicGenerationExecutor({ client, cache, jobs, store, pollIntervalMs: 1 })
    assert.equal(executorB.getState(assetId).status, 'failed', 'a failed asset must restore as failed, not idle')

    executorB.generateAll()
    await flushMicrotasks(10)
    assert.equal(submitCalls.length, 1, 'generateAll must never auto-retry a failed asset after a restart')

    executorB.retryAsset(assetId)
    await flushMicrotasks(20)
    assert.equal(submitCalls.length, 2, 'explicit retryAsset is the only path to a second submit')
    assert.equal(executorB.getState(assetId).generationId, 'gen-fail-2')

    const record = store.loadAll()[assetId]
    assert.ok(record)
    assert.equal(record.generationId, 'gen-fail-2', 'the record reflects the latest attempt')
    assert.ok(
      record.history.some((h) => h.generationId === 'gen-fail-1' && h.status === 'failed'),
      'history must preserve the previous generationId/error from before the retry',
    )
  })
})

describe('videoUrl is persisted on completion', () => {
  test('a completed asset\'s durable record includes the exact videoUrl the mock client returned', async () => {
    const plans = planShotsForStoryboard([scene({ id: 's0', title: 'bare', type: 'highlights' })])
    const jobs = buildGenerationJobs(plans)
    const assetId = jobs[0].assetId
    const hooks = newHooks()
    const client = createMockClient(hooks)
    const store = createInMemoryDurableGenerationStore()
    const cache = createInMemoryGenerationAssetCache()

    const executor = createCinematicGenerationExecutor({ client, cache, jobs, store, pollIntervalMs: 1 })
    executor.requestGeneration(assetId)
    await flushMicrotasks(20)

    assert.equal(executor.getState(assetId).status, 'complete')
    const record = store.loadAll()[assetId]
    assert.ok(record?.videoUrl?.startsWith('https://mock/'), 'the persisted record must carry the remote videoUrl Luma returned')
    assert.equal(executor.getState(assetId).videoUrl, record!.videoUrl)
  })
})

describe('F. completed-remotely-but-missing-local-file is recovered via poll+download only, never a new POST', () => {
  test('a persisted "complete" record with no local assetPath resumes as generating and downloads again without submitting', async () => {
    const plans = planShotsForStoryboard([scene({ id: 's0', title: 'bare', type: 'highlights' })])
    const jobs = buildGenerationJobs(plans)
    const assetId = jobs[0].assetId

    const submitCalls: string[] = []
    let downloadCalls = 0
    const client: LumaGenerationClient = {
      async submit(prompt) {
        submitCalls.push(prompt)
        throw new Error('must never submit — the remote generation already completed in a prior process')
      },
      async poll() {
        return { state: 'completed', videoUrl: 'https://mock/already-done.mp4' }
      },
      async download(_url, id) {
        downloadCalls += 1
        return { assetPath: `luma-assets/${id}.mp4`, durationSeconds: 5 }
      },
    }

    const store = createInMemoryDurableGenerationStore()
    store.save({
      assetId,
      sceneId: jobs[0].sceneId,
      prompt: jobs[0].prompt,
      status: 'complete',
      generationId: 'gen-already-done',
      updatedAt: new Date().toISOString(),
      // No assetPath/durationSeconds — the local file is missing even
      // though Luma itself already finished this generation.
      attempt: 1,
      history: [],
    })
    const cache = createInMemoryGenerationAssetCache()

    const executor = createCinematicGenerationExecutor({ client, cache, jobs, store, pollIntervalMs: 1 })
    // Resuming is automatic (kicked off at construction, like any other
    // mid-flight resume) — no explicit call needed, matching the existing
    // 'generating' resume path.
    assert.equal(executor.getState(assetId).status, 'generating', 'must resume via poll, not sit idle')
    await flushMicrotasks(20)

    assert.equal(submitCalls.length, 0, 'a remotely-complete asset must never be resubmitted merely because the local file is missing')
    assert.equal(downloadCalls, 1)
    assert.equal(executor.getState(assetId).status, 'complete')
    assert.equal(executor.getState(assetId).assetPath, `luma-assets/${assetId}.mp4`)
  })
})

describe('K. checkpoint mismatch fails safely and never POSTs', () => {
  test('a persisted record stamped with a DIFFERENT checkpointHash is surfaced as review, never resumed/auto-retried/auto-submitted', async () => {
    const plans = planShotsForStoryboard([scene({ id: 's0', title: 'bare', type: 'highlights' })])
    const jobs = buildGenerationJobs(plans)
    const assetId = jobs[0].assetId

    const submitCalls: string[] = []
    const client: LumaGenerationClient = {
      async submit(prompt) {
        submitCalls.push(prompt)
        return { generationId: 'gen-should-never-happen' }
      },
      async poll() {
        throw new Error('must never poll a checkpoint-mismatched record either — it is not trusted at all')
      },
      async download() {
        throw new Error('must never download for a checkpoint-mismatched record')
      },
    }

    const store = createInMemoryDurableGenerationStore()
    store.save({
      assetId,
      sceneId: jobs[0].sceneId,
      prompt: jobs[0].prompt,
      status: 'generating',
      generationId: 'gen-old-checkpoint',
      updatedAt: new Date().toISOString(),
      checkpointHash: 'OLD_HASH_1111',
      attempt: 1,
      history: [],
    })
    const cache = createInMemoryGenerationAssetCache()

    const executor = createCinematicGenerationExecutor({
      client,
      cache,
      jobs,
      store,
      pollIntervalMs: 1,
      checkpointHash: 'NEW_HASH_2222',
    })

    assert.equal(executor.getState(assetId).status, 'review', 'a checkpoint mismatch must never resume as generating')
    await flushMicrotasks(10)
    assert.equal(submitCalls.length, 0)

    // 'review' is never auto-submitted via generateAll either.
    await executor.generateAll()
    await flushMicrotasks(10)
    assert.equal(submitCalls.length, 0, 'generateAll must never submit for a review-status asset')

    // Nor via a direct requestGeneration call.
    executor.requestGeneration(assetId)
    await flushMicrotasks(10)
    assert.equal(submitCalls.length, 0, 'requestGeneration must never submit for a review-status asset')
  })
})

describe('review status is never auto-retried', () => {
  test('retryAsset is a no-op for a review-status asset — only a failed asset can be explicitly retried', async () => {
    const plans = planShotsForStoryboard([scene({ id: 's0', title: 'bare', type: 'highlights' })])
    const jobs = buildGenerationJobs(plans)
    const assetId = jobs[0].assetId
    const submitCalls: string[] = []
    const client: LumaGenerationClient = {
      async submit(prompt) {
        submitCalls.push(prompt)
        return { generationId: 'should-not-happen' }
      },
      async poll() {
        return { state: 'completed', videoUrl: 'https://mock/x.mp4' }
      },
      async download(_url, id) {
        return { assetPath: `luma-assets/${id}.mp4`, durationSeconds: 5 }
      },
    }
    const store = createInMemoryDurableGenerationStore()
    store.save({
      assetId,
      sceneId: jobs[0].sceneId,
      prompt: jobs[0].prompt,
      status: 'generating',
      generationId: 'gen-mismatched',
      updatedAt: new Date().toISOString(),
      checkpointHash: 'OLD',
      attempt: 1,
      history: [],
    })
    const cache = createInMemoryGenerationAssetCache()
    const executor = createCinematicGenerationExecutor({ client, cache, jobs, store, pollIntervalMs: 1, checkpointHash: 'NEW' })

    assert.equal(executor.getState(assetId).status, 'review')
    executor.retryAsset(assetId)
    await flushMicrotasks(10)
    assert.equal(submitCalls.length, 0, 'retryAsset must refuse a review-status asset, not just a complete/generating one')
  })
})

describe('I/L. a persistence failure immediately after a successful POST halts the entire batch — no further assets are ever submitted', () => {
  test('generateAll submits job 1, its persist fails, the executor halts, and job 2/3 are NEVER submitted', async () => {
    const plans = planShotsForStoryboard([
      scene({ id: 's0', title: 'one', type: 'highlights' }),
      scene({ id: 's1', title: 'two', type: 'highlights' }),
      scene({ id: 's2', title: 'three', type: 'highlights' }),
    ])
    const jobs = buildGenerationJobs(plans)
    assert.equal(jobs.length, 3, 'sanity: 3 independent jobs to submit in sequence')

    const submitCalls: string[] = []
    const client: LumaGenerationClient = {
      async submit(prompt) {
        submitCalls.push(prompt)
        return { generationId: `gen-${submitCalls.length}` }
      },
      async poll() {
        return new Promise<GenerationStatusResult>(() => {}) // never resolves — irrelevant to this test
      },
      async download() {
        throw new Error('must never download in this test')
      },
    }

    // A store whose save() always throws — simulates a disk failure that
    // starts from the very first write.
    const failingStore = {
      loadAll: () => ({}) as Record<string, import('./cinematicGenerationExecutor.ts').PersistedAssetRecord>,
      save: () => {
        throw new Error('simulated disk failure')
      },
    }

    const cache = createInMemoryGenerationAssetCache()
    const executor = createCinematicGenerationExecutor({ client, cache, jobs, store: failingStore, pollIntervalMs: 1 })

    assert.equal(executor.isHalted(), false, 'not halted before any submission')
    await executor.generateAll()
    await flushMicrotasks(20)

    assert.equal(submitCalls.length, 1, 'exactly one paid POST must happen before the batch halts — not 0, not 3')
    assert.equal(executor.isHalted(), true)
    assert.ok(executor.getHaltReason()?.includes('simulated disk failure'))
    assert.equal(executor.getState(jobs[0].assetId).status, 'review', 'the asset whose persist failed is surfaced as review, not failed')
    assert.equal(executor.getState(jobs[0].assetId).generationId, 'gen-1', 'the real paid generationId is preserved in memory even though it could not be persisted')
    assert.equal(executor.getState(jobs[1].assetId).status, 'idle', 'job 2 must never have been attempted')
    assert.equal(executor.getState(jobs[2].assetId).status, 'idle', 'job 3 must never have been attempted')

    // Halted also blocks every other entry point, not just generateAll.
    executor.requestGeneration(jobs[1].assetId)
    executor.retryAsset(jobs[0].assetId)
    await flushMicrotasks(10)
    assert.equal(submitCalls.length, 1, 'once halted, no further submission is possible through any method')
  })
})

describe('J. a corrupt/unreadable durable-state file halts the whole session at construction — never POSTs', () => {
  test('a store whose loadAll() throws marks every job as review and generateAll never submits', async () => {
    const plans = planShotsForStoryboard([
      scene({ id: 's0', title: 'one', type: 'highlights' }),
      scene({ id: 's1', title: 'two', type: 'highlights' }),
    ])
    const jobs = buildGenerationJobs(plans)

    const submitCalls: string[] = []
    const client: LumaGenerationClient = {
      async submit(prompt) {
        submitCalls.push(prompt)
        return { generationId: 'should-not-happen' }
      },
      async poll() {
        throw new Error('must never poll either')
      },
      async download() {
        throw new Error('must never download either')
      },
    }
    const corruptStore = {
      loadAll: (): Record<string, import('./cinematicGenerationExecutor.ts').PersistedAssetRecord> => {
        throw new Error('Unexpected token in JSON at position 0')
      },
      save: () => {
        throw new Error('must not be reachable — nothing should attempt to save once construction has halted')
      },
    }
    const cache = createInMemoryGenerationAssetCache()

    const executor = createCinematicGenerationExecutor({ client, cache, jobs, store: corruptStore, pollIntervalMs: 1 })

    assert.equal(executor.isHalted(), true, 'an unreadable state file must halt at construction, before any job is ever considered')
    assert.ok(executor.getHaltReason()?.includes('Unexpected token'))
    for (const job of jobs) {
      assert.equal(executor.getState(job.assetId).status, 'review', `${job.assetId} must be review, never idle (idle would be freely submittable)`)
    }

    await executor.generateAll()
    await flushMicrotasks(10)
    assert.equal(submitCalls.length, 0, 'a corrupt state file must never allow any POST, for any asset')
  })
})
