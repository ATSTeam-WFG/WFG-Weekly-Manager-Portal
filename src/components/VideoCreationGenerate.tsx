import { useEffect, useRef, useState } from 'react'
import { estimateStoryboardDurationSeconds, formatDurationLabel, hasReadyTalkingPresenter, type VideoStoryboard } from '../lib/videoStoryboard'
import { renderStoryboardLocally, VideoLocalRenderError } from '../lib/videoLocalRenderService'
import { submitOnlineVideoRender, checkOnlineVideoRender, ONLINE_VIDEO_RENDERING_ENABLED } from '../lib/videoOnlineRenderService'
import { VideoRenderJobError, type VideoRenderJobStatus } from '../lib/videoRenderJobService'
import type { NarrationVoiceOption } from '../lib/narrationVoices'
import TalkingPresenterStatus from './TalkingPresenterStatus'

interface VideoCreationGenerateProps {
  storyboard: VideoStoryboard
  narrationVoice: NarrationVoiceOption
  periodStartDate: string
  onBack: () => void
  onRendered: (fileName: string) => void
  onGoToPresenter: () => void
}

const ONLINE_POLL_INTERVAL_MS = 5000

// Generate Final Video — the ONE explicit action in this workflow that
// produces the final MP4.
//
// Two real paths, chosen automatically, never by the user:
// - Local development (`npm run dev`): unchanged — the existing dev-only
//   Remotion bridge (videoLocalRenderService.ts).
// - A deployed build: submits an authenticated render job
//   (videoOnlineRenderService.ts -> api/video/create-render-job.ts) and
//   polls it to completion, then offers the private, signed-URL preview
//   and download. This path is gated by ONLINE_VIDEO_RENDERING_ENABLED,
//   which is false until a separate approval turns it on server-side —
//   until then this step shows a disabled button with a clear
//   "Coming Soon" notice instead of an action that can only fail.
export default function VideoCreationGenerate({ storyboard, narrationVoice, periodStartDate, onBack, onRendered, onGoToPresenter }: VideoCreationGenerateProps) {
  const [rendering, setRendering] = useState(false)
  const [renderError, setRenderError] = useState<string | null>(null)
  // Shown instead of starting the render when the talking presenter isn't
  // ready — advisory only (never a hard block): a standard video without a
  // presenter is a legitimate, intentional choice, so this only asks once
  // per click rather than preventing generation outright.
  const [confirmingMissingPresenter, setConfirmingMissingPresenter] = useState(false)

  const [onlineStatus, setOnlineStatus] = useState<VideoRenderJobStatus | null>(null)
  const [onlineDownloadUrl, setOnlineDownloadUrl] = useState<string | null>(null)
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const durationLabel = formatDurationLabel(estimateStoryboardDurationSeconds(storyboard))
  const presenterReady = hasReadyTalkingPresenter(storyboard)
  const canRenderLocally = import.meta.env.DEV
  const generationUnavailable = !canRenderLocally && !ONLINE_VIDEO_RENDERING_ENABLED

  useEffect(() => () => {
    if (pollTimer.current) clearTimeout(pollTimer.current)
  }, [])

  const pollOnlineJob = (jobId: string) => {
    pollTimer.current = setTimeout(() => {
      void (async () => {
        try {
          const job = await checkOnlineVideoRender(jobId)
          setOnlineStatus(job.status)

          if (job.status === 'completed') {
            setOnlineDownloadUrl(job.downloadUrl ?? null)
            setRendering(false)
            return
          }
          if (job.status === 'failed' || job.status === 'canceled') {
            setRenderError(job.errorCode ? `Rendering failed (${job.errorCode}).` : 'Rendering failed.')
            setRendering(false)
            return
          }
          pollOnlineJob(jobId)
        } catch (err) {
          setRenderError(err instanceof VideoRenderJobError ? err.message : 'Could not check the video job status.')
          setRendering(false)
        }
      })()
    }, ONLINE_POLL_INTERVAL_MS)
  }

  const handleGenerate = async () => {
    setRendering(true)
    setRenderError(null)
    setOnlineDownloadUrl(null)
    setOnlineStatus(null)

    if (canRenderLocally) {
      try {
        const result = await renderStoryboardLocally(storyboard, narrationVoice)
        onRendered(result.fileName)
      } catch (err) {
        setRenderError(err instanceof VideoLocalRenderError ? err.message : 'The final render failed.')
      } finally {
        setRendering(false)
      }
      return
    }

    try {
      const job = await submitOnlineVideoRender({
        idempotencyKey: crypto.randomUUID(),
        sourceType: storyboard.sourceType,
        periodStartDate,
        storyboard,
        narrationVoice,
      })
      setOnlineStatus(job.status)
      pollOnlineJob(job.id)
    } catch (err) {
      setRenderError(err instanceof VideoRenderJobError ? err.message : 'Could not submit the video for rendering.')
      setRendering(false)
    }
  }

  const handleGenerateClick = () => {
    if (!presenterReady) {
      setConfirmingMissingPresenter(true)
      return
    }
    void handleGenerate()
  }

  const handleContinueWithoutPresenter = () => {
    setConfirmingMissingPresenter(false)
    void handleGenerate()
  }

  return (
    <div className="vc-generate">
      <div className="vc-template-card">
        <span className="vc-template-badge">Final Render</span>
        <h2>Generate Final Video</h2>
        <p className="vc-template-description">
          This renders the complete video &mdash; scenes, narration, and any cinematic footage already attached to the storyboard.
        </p>
      </div>

      <div className="vc-template-summary">
        <p className="vc-template-summary-line">
          {storyboard.scenes.length} scene{storyboard.scenes.length === 1 ? '' : 's'} &middot; approximately {durationLabel}
        </p>
        <TalkingPresenterStatus storyboard={storyboard} />
      </div>

      {renderError && <p className="vc-template-error">{renderError}</p>}

      {confirmingMissingPresenter && (
        <div className="vc-template-hint" role="alert">
          <p>This video will use the standard logo-card opening and closing — your talking presenter clips aren&apos;t ready yet.</p>
          <div className="vc-storyboard-actions">
            <button type="button" className="btn btn-secondary" onClick={onGoToPresenter}>
              Go to Presenter &amp; Voice
            </button>
            <button type="button" className="btn btn-primary" onClick={handleContinueWithoutPresenter}>
              Continue without presenter
            </button>
          </div>
        </div>
      )}

      {generationUnavailable && (
        <div className="vc-template-hint">
          <p><strong>Online Rendering &mdash; Coming Soon</strong></p>
          <p>Generating and downloading the final video from this online portal isn&apos;t available yet. This step currently only works when running the app locally for development.</p>
        </div>
      )}

      {!canRenderLocally && ONLINE_VIDEO_RENDERING_ENABLED && onlineStatus && (
        <div className="vc-template-hint" role="status">
          {onlineStatus === 'completed' && onlineDownloadUrl ? (
            <>
              <p><strong>Your video is ready.</strong></p>
              <video className="vc-preview-video" src={onlineDownloadUrl} controls />
              <div className="vc-storyboard-actions">
                <a className="btn btn-primary" href={onlineDownloadUrl} download>Download Video</a>
              </div>
            </>
          ) : (
            <p>Rendering in the cloud&hellip; ({onlineStatus}). This can take a few minutes.</p>
          )}
        </div>
      )}

      <div className="vc-storyboard-actions">
        <button type="button" className="btn btn-secondary" onClick={onBack} disabled={rendering}>
          Back to Preview
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleGenerateClick}
          disabled={rendering || generationUnavailable}
        >
          {rendering ? (canRenderLocally ? 'Rendering locally…' : 'Submitting…') : 'Generate Final Video'}
        </button>
      </div>
      {rendering && canRenderLocally && (
        <p className="vc-template-rendering-note">
          Running a local development render &mdash; this can take a minute. See the terminal running <code>npm run dev</code> for progress.
        </p>
      )}
    </div>
  )
}
