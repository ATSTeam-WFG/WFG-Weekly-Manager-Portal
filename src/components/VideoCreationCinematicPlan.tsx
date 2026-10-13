import { useEffect, useRef, useState } from 'react'
import { planShotsForStoryboard, summarizeGenerationNeeds, type PlannedShot } from '../../remotion/cinematicPlan.ts'
import { buildGenerationJobs, type GenerationJob } from '../../remotion/cinematicGenerationExecutor.ts'
import { estimateStoryboardDurationSeconds, formatDurationLabel, MAX_FINAL_VIDEO_SECONDS, isWithinFinalDurationLimit, type VideoStoryboard } from '../lib/videoStoryboard'
import {
  startCinematicGeneration,
  getCinematicGenerationStatus,
  retryCinematicGenerationAsset,
  CinematicGenerationServiceError,
  type GenerationAssetState,
} from '../lib/cinematicGenerationService'

interface VideoCreationCinematicPlanProps {
  storyboard: VideoStoryboard
  onStoryboardChange: (next: VideoStoryboard) => void
  onBack: () => void
  onContinue: () => void
}

const SHOT_TYPE_LABEL: Record<PlannedShot['type'], string> = {
  cinematic: 'CINEMATIC',
  motion_graphic: 'MOTION',
  branded: 'BRANDED',
}

const ASSET_STATUS_LABEL: Record<GenerationAssetState['status'], string> = {
  idle: 'Waiting',
  queued: 'Waiting',
  generating: 'Generating',
  complete: 'Complete',
  failed: 'Failed',
  review: 'Needs Review',
}

const STATUS_POLL_INTERVAL_MS = 1500

// Cinematic Plan — shows the ACTUAL proposed per-scene shot plan (not a
// generic "2 shots" placeholder): which cinematic/motion-graphic/branded
// shots each scene would need, their purposes, estimated screen time, and
// a storyboard-level generation-cost estimate — all automatically derived
// from this week's real storyboard (see remotion/cinematicPlan.ts), never
// hard-coded per topic.
//
// GENERATION: the explicit "Generate Cinematic Footage" approval lives
// here, below the plan/cost summary. Clicking it is the ONLY thing in
// this entire component that can start a paid Luma call (via
// dev/local-cinematic-generation-plugin.ts, dry-run by default) — status
// is polled read-only (GET) on an interval and on mount, so a page
// refresh or re-navigating back to this step can never itself (re)start
// generation. Once an asset completes, its editorial usages are mapped
// to a CinematicAsset and merged into the storyboard via
// onStoryboardChange — never fabricated here, only what the server
// reports.
export default function VideoCreationCinematicPlan({ storyboard, onStoryboardChange, onBack, onContinue }: VideoCreationCinematicPlanProps) {
  const scenePlans = planShotsForStoryboard(storyboard.scenes)
  const generationEstimate = summarizeGenerationNeeds(scenePlans)
  const estimatedSeconds = estimateStoryboardDurationSeconds(storyboard)
  const withinLimit = isWithinFinalDurationLimit(estimatedSeconds)
  const jobs: GenerationJob[] = buildGenerationJobs(scenePlans)

  const [generationStarted, setGenerationStarted] = useState(false)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [assetStates, setAssetStates] = useState<Record<string, GenerationAssetState>>({})
  const [halted, setHalted] = useState(false)
  const [haltReason, setHaltReason] = useState<string | undefined>(undefined)
  const lastAppliedAssetsKey = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function poll() {
      try {
        const status = await getCinematicGenerationStatus()
        if (cancelled) return
        if (status.started) setGenerationStarted(true)
        setHalted(status.halted)
        setHaltReason(status.haltReason)
        const byAssetId: Record<string, GenerationAssetState> = {}
        for (const state of status.states) byAssetId[state.assetId] = state
        setAssetStates(byAssetId)

        const assetsKey = JSON.stringify(status.cinematicAssetsByScene)
        if (Object.keys(status.cinematicAssetsByScene).length > 0 && lastAppliedAssetsKey.current !== assetsKey) {
          lastAppliedAssetsKey.current = assetsKey
          const nextScenes = storyboard.scenes.map((scene) =>
            status.cinematicAssetsByScene[scene.id] ? { ...scene, cinematicAssets: status.cinematicAssetsByScene[scene.id] } : scene,
          )
          onStoryboardChange({ ...storyboard, scenes: nextScenes })
        }
      } catch {
        // A transient read failure (e.g. dev server briefly restarting) —
        // the next poll tick will simply try again; nothing to surface as
        // a blocking error for a read-only status check.
      }
    }

    void poll()
    const interval = setInterval(() => void poll(), STATUS_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleGenerate = async () => {
    setStarting(true)
    setStartError(null)
    try {
      await startCinematicGeneration(storyboard.scenes)
      setGenerationStarted(true)
    } catch (err) {
      setStartError(err instanceof CinematicGenerationServiceError ? err.message : 'Could not start cinematic generation.')
    } finally {
      setStarting(false)
    }
  }

  const handleRetry = async (assetId: string) => {
    try {
      await retryCinematicGenerationAsset(assetId)
    } catch {
      // The next status poll will still show "Failed" if the retry
      // couldn't even be accepted — no separate error UI needed for a
      // single-asset retry click.
    }
  }

  const completeCount = jobs.filter((job) => assetStates[job.assetId]?.status === 'complete').length
  const failedCount = jobs.filter((job) => assetStates[job.assetId]?.status === 'failed').length
  const allComplete = jobs.length > 0 && completeCount === jobs.length

  return (
    <div className="vc-cinematic-plan">
      <p className="vc-template-hint">
        Automatically derived from this week&apos;s storyboard. Generating real cinematic footage is a separate, explicit, paid step below — nothing
        on this screen generates footage on its own.
      </p>

      <div className="vc-cinematic-plan-list">
        {scenePlans.map((plan) => (
          <div key={plan.sceneId} className="vc-cinematic-plan-row">
            <div className="vc-cinematic-plan-row-title">{plan.title}</div>
            <div className="vc-cinematic-plan-row-summary">
              {plan.shots.length} visual beat{plan.shots.length === 1 ? '' : 's'} &middot; ~{plan.totalScreenSeconds}s
            </div>
            <div className="vc-cinematic-plan-shots">
              {plan.shots.map((shot, index) => (
                <div key={shot.id} className="vc-cinematic-plan-shot-row">
                  <span className="vc-cinematic-plan-shot-index">{String(index + 1).padStart(2, '0')}</span>
                  <span className="vc-cinematic-plan-shot-type">{SHOT_TYPE_LABEL[shot.type]}</span>
                  <span className="vc-cinematic-plan-shot-purpose">&middot; {shot.purpose}</span>
                  <span className="vc-cinematic-plan-shot-duration">&middot; {shot.screenDurationSeconds}s</span>
                  {shot.reuseNote && <span className="vc-cinematic-plan-shot-reuse">&middot; shares footage with shot 01</span>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="vc-cinematic-plan-generation-summary">
        <div>Total visual beats: {generationEstimate.totalVisualBeats}</div>
        <div>
          Cinematic usages: {generationEstimate.cinematicUsages} &middot; Motion graphic beats: {generationEstimate.motionBeats} &middot; Branded
          beats: {generationEstimate.brandedBeats}
        </div>
        <div>Unique generation assets required: {generationEstimate.uniqueGenerationAssets}</div>
        <div>Generated seconds: {generationEstimate.totalGeneratedSeconds}s</div>
        <div>Estimated generation cost: ${generationEstimate.estimatedCostUsd.toFixed(2)}</div>
      </div>

      <div className="vc-cinematic-generation">
        {!generationStarted ? (
          <>
            <p className="vc-template-hint vc-cinematic-generation-warning">
              Clicking below starts real, paid cinematic footage generation — {generationEstimate.uniqueGenerationAssets} clips, &#x2248;
              {generationEstimate.totalGeneratedSeconds}s, estimated ${generationEstimate.estimatedCostUsd.toFixed(2)}.
            </p>
            <button type="button" className="btn btn-primary" onClick={() => void handleGenerate()} disabled={starting || jobs.length === 0}>
              {starting ? 'Starting generation…' : 'Generate Cinematic Footage'}
            </button>
            {startError && <p className="vc-template-error">{startError}</p>}
          </>
        ) : (
          <>
            {halted && (
              <p className="vc-template-error">
                Generation halted: {haltReason ?? 'a durable-state error occurred.'} No further generation can be started until this is resolved and
                the dev server is restarted.
              </p>
            )}
            <div className="vc-cinematic-generation-progress">
              {completeCount} of {jobs.length} cinematic clips complete
              {failedCount > 0 && ` · ${failedCount} failed`}
            </div>
            <div className="vc-cinematic-generation-assets">
              {jobs.map((job) => {
                const state = assetStates[job.assetId]
                const status = state?.status ?? 'idle'
                return (
                  <div key={job.assetId} className="vc-cinematic-generation-asset-row">
                    <span className={`vc-cinematic-generation-status vc-cinematic-generation-status-${status}`}>{ASSET_STATUS_LABEL[status]}</span>
                    <span className="vc-cinematic-generation-asset-id">{job.assetId}</span>
                    {status === 'failed' && (
                      <button type="button" className="btn btn-secondary btn-small" onClick={() => void handleRetry(job.assetId)}>
                        Retry
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
            {allComplete && <p className="vc-template-hint">All cinematic footage generated and attached to the storyboard.</p>}
          </>
        )}
      </div>

      <div className={`vc-cinematic-plan-duration ${withinLimit ? '' : 'vc-cinematic-plan-duration-over'}`}>
        Estimated duration: {formatDurationLabel(estimatedSeconds)} (limit: {formatDurationLabel(MAX_FINAL_VIDEO_SECONDS)})
        {!withinLimit && ' — exceeds the hard limit; shorten narration or remove a scene before continuing.'}
      </div>

      <div className="vc-storyboard-actions">
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          Back to Presenter &amp; Voice
        </button>
        <button type="button" className="btn btn-primary" onClick={onContinue} disabled={!withinLimit}>
          Continue to Preview
        </button>
      </div>
    </div>
  )
}
