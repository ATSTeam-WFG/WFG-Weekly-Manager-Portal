import { useState } from 'react'
import { estimateStoryboardDurationSeconds, formatDurationLabel, type VideoStoryboard } from '../lib/videoStoryboard'
import { renderStoryboardLocally, renderedVideoUrl, VideoLocalRenderError } from '../lib/videoLocalRenderService'
import type { NarrationVoiceOption } from '../lib/narrationVoices'
import TalkingPresenterStatus from './TalkingPresenterStatus'

interface VideoCreationTemplateProps {
  storyboard: VideoStoryboard
  narrationVoice: NarrationVoiceOption
  onBackToCinematicPlan: () => void
  onContinueToGenerate: () => void
}

// Preview — lets the admin render and watch the CURRENT storyboard/voice
// selection before committing to "Generate Final Video". This never
// triggers paid cinematic-footage generation on its own (nothing in this
// step calls Luma); it renders with whatever's already attached to the
// storyboard (today: the existing FLUX/LayeredStoryScene treatment, since
// no cinematic generation step is wired up yet). Rendering here is the
// SAME local Remotion render Generate Final Video performs — there is no
// separate lower-fidelity "draft" render tier today; see the final
// report's own note on this.
export default function VideoCreationTemplate({ storyboard, narrationVoice, onBackToCinematicPlan, onContinueToGenerate }: VideoCreationTemplateProps) {
  const [rendering, setRendering] = useState(false)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [previewFileName, setPreviewFileName] = useState<string | null>(null)

  const durationLabel = formatDurationLabel(estimateStoryboardDurationSeconds(storyboard))

  const handlePreviewRender = async () => {
    setRendering(true)
    setRenderError(null)
    try {
      const result = await renderStoryboardLocally(storyboard, narrationVoice)
      setPreviewFileName(result.fileName)
    } catch (err) {
      setRenderError(err instanceof VideoLocalRenderError ? err.message : 'The preview render failed.')
    } finally {
      setRendering(false)
    }
  }

  return (
    <div className="vc-template">
      <div className="vc-template-card">
        <span className="vc-template-badge">WFG Executive</span>
        <h2>Preview</h2>
        <p className="vc-template-description">Adaptive executive layout based on your storyboard.</p>
        <p className="vc-template-hint">
          Layouts adapt automatically to your storyboard&apos;s scene types &mdash; there is nothing to configure per scene.
        </p>
      </div>

      <div className="vc-template-summary">
        <p className="vc-template-summary-line">
          {storyboard.scenes.length} scene{storyboard.scenes.length === 1 ? '' : 's'} &middot; approximately {durationLabel}
        </p>
        <TalkingPresenterStatus storyboard={storyboard} />
      </div>

      {renderError && <p className="vc-template-error">{renderError}</p>}

      <div className="vc-storyboard-actions">
        <button type="button" className="btn btn-secondary" onClick={onBackToCinematicPlan} disabled={rendering}>
          Back to Cinematic Plan
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void handlePreviewRender()} disabled={rendering}>
          {rendering ? 'Rendering locally…' : 'Preview Render'}
        </button>
        <button type="button" className="btn btn-primary" onClick={onContinueToGenerate} disabled={rendering}>
          Continue to Generate Final Video
        </button>
      </div>
      {rendering && (
        <p className="vc-template-rendering-note">
          Running a local development render &mdash; this can take a minute. See the terminal running <code>npm run dev</code> for progress.
        </p>
      )}
      {previewFileName && (
        <div className="vc-preview">
          <p className="vc-preview-label">Local development render &mdash; not a production video.</p>
          <video className="vc-preview-video" src={renderedVideoUrl(previewFileName)} controls />
        </div>
      )}
    </div>
  )
}
