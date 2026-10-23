import { renderedVideoUrl } from '../lib/videoLocalRenderService'
import type { VideoStoryboard } from '../lib/videoStoryboard'
import TalkingPresenterStatus from './TalkingPresenterStatus'

interface VideoCreationPreviewProps {
  fileName: string
  storyboard: VideoStoryboard
  onBackToTemplate: () => void
}

// Final Preview & Download — the rendered file is served by the same
// local-development-only bridge that produced it
// (dev/local-video-render-plugin.ts's GET /dev/rendered-video/<file>
// route). No production storage of any kind is involved; this step does
// not exist once `npm run dev` is not running. The prop is still named
// onBackToTemplate for historical reasons; it now navigates back to the
// Generate Final Video step.
export default function VideoCreationPreview({ fileName, storyboard, onBackToTemplate }: VideoCreationPreviewProps) {
  const videoUrl = renderedVideoUrl(fileName)

  return (
    <div className="vc-preview">
      <p className="vc-preview-label">Local development render &mdash; not a production video.</p>
      <TalkingPresenterStatus storyboard={storyboard} />
      <video className="vc-preview-video" src={videoUrl} controls />
      <div className="vc-storyboard-actions">
        <button type="button" className="btn btn-secondary" onClick={onBackToTemplate}>
          Back to Generate Final Video
        </button>
        <a className="btn btn-primary" href={videoUrl} download={fileName}>
          Download Video
        </a>
      </div>
    </div>
  )
}
