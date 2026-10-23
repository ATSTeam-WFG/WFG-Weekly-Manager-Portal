import { useState } from 'react'
import { estimateStoryboardDurationSeconds, formatDurationLabel, hasReadyTalkingPresenter, type VideoStoryboard } from '../lib/videoStoryboard'
import { renderStoryboardLocally, VideoLocalRenderError } from '../lib/videoLocalRenderService'
import type { NarrationVoiceOption } from '../lib/narrationVoices'
import TalkingPresenterStatus from './TalkingPresenterStatus'

interface VideoCreationGenerateProps {
  storyboard: VideoStoryboard
  narrationVoice: NarrationVoiceOption
  onBack: () => void
  onRendered: (fileName: string) => void
  onGoToPresenter: () => void
}

// Generate Final Video — the ONE explicit action in this workflow that
// produces the final MP4. Paid generation (real cinematic/Luma footage)
// never happens merely by entering Preview; today it doesn't happen here
// either (no provider is wired to a generate action yet — see the Video
// Creation architecture audit), but this is the step that WOULD trigger
// any pending cinematic-footage generation before the final render, once
// that's built. For now this performs the same local Remotion render
// Preview already can, just as the deliberate, final, explicit step.
export default function VideoCreationGenerate({ storyboard, narrationVoice, onBack, onRendered, onGoToPresenter }: VideoCreationGenerateProps) {
  const [rendering, setRendering] = useState(false)
  const [renderError, setRenderError] = useState<string | null>(null)
  // Shown instead of starting the render when the talking presenter isn't
  // ready — advisory only (never a hard block): a standard video without a
  // presenter is a legitimate, intentional choice, so this only asks once
  // per click rather than preventing generation outright.
  const [confirmingMissingPresenter, setConfirmingMissingPresenter] = useState(false)

  const durationLabel = formatDurationLabel(estimateStoryboardDurationSeconds(storyboard))
  const presenterReady = hasReadyTalkingPresenter(storyboard)

  const handleGenerate = async () => {
    setRendering(true)
    setRenderError(null)
    try {
      const result = await renderStoryboardLocally(storyboard, narrationVoice)
      onRendered(result.fileName)
    } catch (err) {
      setRenderError(err instanceof VideoLocalRenderError ? err.message : 'The final render failed.')
    } finally {
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
          This renders the complete video locally — scenes, narration, and any cinematic footage already attached to the storyboard.
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

      <div className="vc-storyboard-actions">
        <button type="button" className="btn btn-secondary" onClick={onBack} disabled={rendering}>
          Back to Preview
        </button>
        <button type="button" className="btn btn-primary" onClick={handleGenerateClick} disabled={rendering}>
          {rendering ? 'Rendering locally…' : 'Generate Final Video'}
        </button>
      </div>
      {rendering && (
        <p className="vc-template-rendering-note">
          Running a local development render &mdash; this can take a minute. See the terminal running <code>npm run dev</code> for progress.
        </p>
      )}
    </div>
  )
}
