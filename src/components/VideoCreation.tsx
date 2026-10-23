import { useEffect, useState } from 'react'
import { getReportingWeekByOffset } from '../utils/week'
import VideoCreationSource from './VideoCreationSource'
import VideoCreationStoryboard from './VideoCreationStoryboard'
import VideoCreationPresenter, { type PresenterVoiceSelection } from './VideoCreationPresenter'
import VideoCreationCinematicPlan from './VideoCreationCinematicPlan'
import VideoCreationTemplate from './VideoCreationTemplate'
import VideoCreationGenerate from './VideoCreationGenerate'
import VideoCreationPreview from './VideoCreationPreview'
import { expectedFixedNarrationText, hasReadyTalkingPresenter, type VideoStoryboard, type VideoStoryboardSourceType } from '../lib/videoStoryboard'
import { DEFAULT_NARRATION_VOICE } from '../lib/narrationVoices'
import { getCinematicGenerationCheckpoint } from '../lib/cinematicGenerationService'
import { listMyPresenterProfiles, listPresenterClipJobs } from '../lib/videoConsentService'
import { prepareAvatarAssetLocally } from '../lib/videoLocalRenderService'
import './VideoCreation.css'

// Re-attaches avatarVideoAssetPath onto a storyboard's opening/closing
// scenes whenever a durably-recorded, already-successful HeyGen clip
// exists for this presenter profile and scene — e.g. after the wizard is
// reopened, or right before Source/Resume replace the active storyboard
// (see handleCreateVideo/handleResumeFromCheckpoint below). READ-ONLY
// against video_presenter_clip_jobs and a local Storage download only —
// never calls claim_heygen_clip_narration/video or any record_*/resolve_*
// RPC, so it can never start, retry, reset, or pay for a new generation;
// the clip job's own row in Supabase is never touched either way.
//
// Compatibility is keyed by (presenter_profile_id, scene_id) PLUS the
// scene's current narrationText matching the fixed text that scene is
// guaranteed to have been generated against (expectedFixedNarrationText —
// see its own doc comment in videoStoryboard.ts for why this is a safe
// reference without needing to store the exact text a given clip job was
// actually generated for, which would need a schema change). A scene whose
// narrationText has since been edited away from that fixed text is NEVER
// auto-restored — this can't be proven safe without a stored reference, so
// the conservative choice is to surface a warning instead of guessing.
// Best-effort otherwise: any failure (profile not found, download error)
// leaves the storyboard unchanged rather than blocking navigation.
async function restoreReadyPresenterClips(storyboard: VideoStoryboard, ownerId: string): Promise<{ storyboard: VideoStoryboard; warnings: string[] }> {
  const warnings: string[] = []
  try {
    const profiles = await listMyPresenterProfiles(ownerId)
    const profile = profiles[0]
    if (!profile) return { storyboard, warnings }

    const jobs = await listPresenterClipJobs(profile.id)
    let changed = false
    const nextScenes = await Promise.all(
      storyboard.scenes.map(async (scene) => {
        if ((scene.type !== 'opening' && scene.type !== 'closing') || scene.avatarVideoAssetPath) return scene
        const job = jobs.find((j) => j.sceneId === scene.id)
        if (!job || job.videoStatus !== 'ready' || !job.generatedStoragePath) return scene

        const expectedText = expectedFixedNarrationText(scene.type)
        if (scene.narrationText !== expectedText) {
          warnings.push(
            `A previously generated ${scene.type} presenter clip exists, but this scene's narration text has changed since then, so it was NOT automatically reused (the clip's audio would no longer match). Restore the original wording, or prepare a new clip from Presenter & Voice.`,
          )
          return scene
        }

        try {
          const local = await prepareAvatarAssetLocally(scene.id, job.generatedStoragePath)
          changed = true
          return { ...scene, avatarVideoAssetPath: local.assetPath }
        } catch {
          // Local download failed (e.g. dev server not running this asset
          // bridge) — leave this scene without a clip; the user can still
          // retry from Presenter & Voice, and nothing paid was attempted.
          return scene
        }
      }),
    )

    return { storyboard: changed ? { ...storyboard, scenes: nextScenes } : storyboard, warnings }
  } catch {
    // Restoration is best-effort only — never blocks normal wizard use.
    return { storyboard, warnings }
  }
}

const WORKFLOW_STEPS = ['Source', 'Executive Story', 'Presenter & Voice', 'Cinematic Plan', 'Preview', 'Generate Final Video', 'Final Preview & Download']

type VideoCreationStep = 'source' | 'story' | 'presenter' | 'plan' | 'preview' | 'generate' | 'final'

const STEP_INDEX: Record<VideoCreationStep, number> = {
  source: 0,
  story: 1,
  presenter: 2,
  plan: 3,
  preview: 4,
  generate: 5,
  final: 6,
}

// Source -> Executive Story -> Presenter & Voice -> Cinematic Plan ->
// Preview -> Generate Final Video -> Final Preview & Download. This
// entire flow stays inside Video Creation: none of it navigates to
// another admin destination or touches App.tsx's navigation state, so
// it's independent from — and cannot interfere with — the Leadership
// Report unsaved-changes guard or any other destination's own state.
//
// Nothing here persists anything to Supabase: storyboard/presenter/voice
// selection exist only in this component's own memory, and the rendered
// video is a LOCAL development-only file (see
// dev/local-video-render-plugin.ts) — never uploaded anywhere. Navigating
// away from Video Creation (to any other destination) simply unmounts
// this tree and discards all of it, which is intentional for this phase.
//
// PAID GENERATION NEVER HAPPENS MERELY BY ENTERING A STEP: the only
// paid-generation entry point anywhere in this workflow is the Cinematic
// Plan step's own explicit "Generate Cinematic Footage" button (see
// VideoCreationCinematicPlan.tsx / dev/local-cinematic-generation-plugin.ts) —
// never a render/effect/navigation. Neither Preview nor Generate Final
// Video triggers it; both only run the existing local Remotion render,
// now against whatever cinematicAssets[] that explicit step has already
// attached to the storyboard (via onStoryboardChange below).
interface VideoCreationProps {
  currentProfileId: string
}

export default function VideoCreation({ currentProfileId }: VideoCreationProps) {
  const [step, setStep] = useState<VideoCreationStep>('source')
  const [sourceType, setSourceType] = useState<VideoStoryboardSourceType | null>(null)
  const [weekOffset, setWeekOffset] = useState(0)
  const [storyboard, setStoryboard] = useState<VideoStoryboard | null>(null)
  const [presenterVoice, setPresenterVoice] = useState<PresenterVoiceSelection>({ narrationVoice: DEFAULT_NARRATION_VOICE })
  const [renderedFileName, setRenderedFileName] = useState<string | null>(null)
  const [checkpoint, setCheckpoint] = useState<{ storyboard: VideoStoryboard; createdAt: string } | null>(null)

  const week = getReportingWeekByOffset(weekOffset)

  // TEMPORARY/LOCAL DEV CHECKPOINT ONLY (see
  // dev/local-cinematic-generation-plugin.ts) — read-only, GET-only check
  // for an already-approved storyboard saved before a required dev-server
  // restart. Never calls Anthropic; only offers a way to reload the exact
  // same storyboard the admin already approved, bypassing Source/Create
  // Video entirely. Safe to call on mount: it cannot start generation or
  // mutate anything.
  useEffect(() => {
    let cancelled = false
    void getCinematicGenerationCheckpoint()
      .then((result) => {
        if (!cancelled && result.exists && result.storyboard && result.matches) {
          setCheckpoint({ storyboard: result.storyboard, createdAt: result.createdAt ?? '' })
        }
      })
      .catch(() => {
        // No checkpoint, or the dev server doesn't have this endpoint yet
        // — the normal Source flow still works either way.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleCreateVideo = async (nextStoryboard: VideoStoryboard) => {
    // Warn before discarding prepared presenter clips — this only confirms
    // the REPLACEMENT; the new storyboard was already built by the time
    // this runs (VideoCreationSource's own handleCreateVideo), so
    // cancelling here simply keeps the current storyboard and step
    // unchanged rather than undoing any generation already performed.
    if (storyboard && hasReadyTalkingPresenter(storyboard)) {
      const confirmed = window.confirm(
        'Creating a new video from Source will replace the current storyboard, including its prepared opening/closing presenter clips. Continue?',
      )
      if (!confirmed) return
    }
    const { storyboard: restored, warnings } = await restoreReadyPresenterClips(nextStoryboard, currentProfileId)
    if (warnings.length > 0) window.alert(warnings.join('\n\n'))
    setStoryboard(restored)
    setStep('story')
  }

  const handleResumeFromCheckpoint = async () => {
    if (!checkpoint) return
    if (storyboard && hasReadyTalkingPresenter(storyboard)) {
      const confirmed = window.confirm(
        'Resuming the checkpointed storyboard will replace the current storyboard, including its prepared opening/closing presenter clips. Continue?',
      )
      if (!confirmed) return
    }
    // Restoring here too (not just handleCreateVideo) means the resume
    // path can never silently skip past an already-prepared presenter
    // requirement — if a ready clip exists for this profile/scene, it
    // reattaches here exactly like it would on any other entry point.
    const { storyboard: restored, warnings } = await restoreReadyPresenterClips(checkpoint.storyboard, currentProfileId)
    if (warnings.length > 0) window.alert(warnings.join('\n\n'))
    setStoryboard(restored)
    setStep('plan')
  }

  const handleBackToSource = () => {
    setStep('source')
  }

  const handleContinueToPresenter = () => {
    setStep('presenter')
  }

  const handleBackToStory = () => {
    setStep('story')
  }

  const handleContinueToPlan = () => {
    setStep('plan')
  }

  const handleBackToPresenter = () => {
    setStep('presenter')
  }

  const handleContinueToPreview = () => {
    setStep('preview')
  }

  const handleBackToPlan = () => {
    setStep('plan')
  }

  const handleContinueToGenerate = () => {
    setStep('generate')
  }

  const handleBackToPreview = () => {
    setStep('preview')
  }

  const handleRendered = (fileName: string) => {
    setRenderedFileName(fileName)
    setStep('final')
  }

  const handleBackToGenerate = () => {
    setStep('generate')
  }
  const [finalVideoVersion, setFinalVideoVersion] = useState<'avatar' | 'no-avatar'>('avatar')

const finalVideoFileName =
  finalVideoVersion === 'avatar'
    ? 'wfg-v3-final-with-avatar-fixed.mp4'
    : 'wfg-v3-final-approved-candidate.mp4'

const finalVideoUrl = `/dev/rendered-video/${finalVideoFileName}`

  const activeStepIndex = STEP_INDEX[step]

  return (
    <div className="video-creation-page">
      <div className="vc-header">
        <h1>Video Creation</h1>
        <p className="vc-header-subtitle">
          Turn WFG reports into polished, branded presentation videos.
        </p>
      </div>

      <section className="vc-final-videos" aria-label="Final V3 videos">
        <div className="vc-final-heading">
          <div>
            <span className="vc-final-eyebrow">WFG VIDEO LIBRARY</span>
            <h2>Final V3 Videos</h2>
            <p>Watch or download your approved presentation videos.</p>
          </div>
          <span className="vc-final-status">Ready to Watch</span>
        </div>

        <div className="vc-final-selector" role="group" aria-label="Choose video version">
          <button
            type="button"
            className={`vc-final-option ${finalVideoVersion === 'avatar' ? 'is-selected' : ''}`}
            aria-pressed={finalVideoVersion === 'avatar'}
            onClick={() => setFinalVideoVersion('avatar')}
          >
            With Avatar
          </button>
          <button
            type="button"
            className={`vc-final-option ${finalVideoVersion === 'no-avatar' ? 'is-selected' : ''}`}
            aria-pressed={finalVideoVersion === 'no-avatar'}
            onClick={() => setFinalVideoVersion('no-avatar')}
          >
            Without Avatar
          </button>
        </div>

        <div className="vc-final-player-wrap">
          <video
            key={finalVideoVersion}
            className="vc-final-player"
            src={finalVideoUrl}
            controls
            playsInline
            preload="metadata"
          />
        </div>

        <div className="vc-final-footer">
          <p>
            {finalVideoVersion === 'avatar'
              ? 'With Avatar — approved presentation'
              : 'Without Avatar — approved presentation'}
          </p>
          <a
            className="btn btn-primary"
            href={finalVideoUrl}
            download={finalVideoFileName}
          >
            Download Selected Video
          </a>
        </div>
      </section>

      <div className="vc-workflow" aria-label="Video creation workflow">
        {WORKFLOW_STEPS.map((label, index) => (
          <div className="vc-workflow-step-wrap" key={label}>
            <span className={`vc-workflow-step ${index === activeStepIndex ? 'vc-workflow-step-active' : ''}`}>{label}</span>
            {index < WORKFLOW_STEPS.length - 1 && (
              <span className="vc-workflow-arrow" aria-hidden="true">
                &rarr;
              </span>
            )}
          </div>
        ))}
      </div>

      {step === 'source' ? (
        <>
          {checkpoint && (
            <div className="vc-checkpoint-resume">
              <p className="vc-template-hint">
                A saved cinematic-generation checkpoint exists (created {checkpoint.createdAt || 'earlier'}) — dev-only, survives a server restart.
              </p>
              <button type="button" className="btn btn-secondary" onClick={handleResumeFromCheckpoint}>
                Resume checkpointed generation
              </button>
            </div>
          )}
          <VideoCreationSource
            sourceType={sourceType}
            onSelectSourceType={setSourceType}
            week={week}
            isCurrentWeek={weekOffset === 0}
            onPreviousWeek={() => setWeekOffset((offset) => offset - 1)}
            onNextWeek={() => setWeekOffset((offset) => Math.min(0, offset + 1))}
            onCreateVideo={handleCreateVideo}
          />
        </>
      ) : step === 'story' ? (
        storyboard && (
          <VideoCreationStoryboard
            storyboard={storyboard}
            onChange={setStoryboard}
            onBackToSource={handleBackToSource}
            onContinueToPresenter={handleContinueToPresenter}
          />
        )
      ) : step === 'presenter' ? (
        storyboard && (
          <VideoCreationPresenter
            selection={presenterVoice}
            onChange={setPresenterVoice}
            onBack={handleBackToStory}
            onContinue={handleContinueToPlan}
            currentProfileId={currentProfileId}
            storyboard={storyboard}
            onStoryboardChange={setStoryboard}
          />
        )
      ) : step === 'plan' ? (
        storyboard && (
          <VideoCreationCinematicPlan storyboard={storyboard} onStoryboardChange={setStoryboard} onBack={handleBackToPresenter} onContinue={handleContinueToPreview} />
        )
      ) : step === 'preview' ? (
        storyboard && (
          <VideoCreationTemplate
            storyboard={storyboard}
            narrationVoice={presenterVoice.narrationVoice}
            onBackToCinematicPlan={handleBackToPlan}
            onContinueToGenerate={handleContinueToGenerate}
          />
        )
      ) : step === 'generate' ? (
        storyboard && (
          <VideoCreationGenerate
            storyboard={storyboard}
            narrationVoice={presenterVoice.narrationVoice}
            periodStartDate={week.weekStartDate}
            onBack={handleBackToPreview}
            onRendered={handleRendered}
            onGoToPresenter={handleBackToPresenter}
          />
        )
      ) : (
        renderedFileName &&
        storyboard && <VideoCreationPreview fileName={renderedFileName} storyboard={storyboard} onBackToTemplate={handleBackToGenerate} />
      )}
    </div>
  )
}
