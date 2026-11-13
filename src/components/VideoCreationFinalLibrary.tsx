import { useState } from 'react'

// A static library of already-approved sample videos, shown above the
// step-by-step wizard regardless of its own state (step/storyboard) — this
// is deliberately its own component, not inline in VideoCreation.tsx, so
// that file (and the Source/Storyboard phase it guards — see
// videoCreationSourceStoryboardWiring.test.ts) stays free of any final-
// render/MP4 specifics. Nothing here is generated or uploaded; both files
// are pre-existing static assets served from /dev/rendered-video/.
type FinalVideoVersion = 'avatar' | 'no-avatar'

export default function VideoCreationFinalLibrary() {
  const [finalVideoVersion, setFinalVideoVersion] = useState<FinalVideoVersion>('avatar')

  const finalVideoFileName =
    finalVideoVersion === 'avatar'
      ? 'wfg-v3-final-with-avatar-fixed.mp4'
      : 'wfg-v3-final-approved-candidate.mp4'

  const finalVideoUrl = `/dev/rendered-video/${finalVideoFileName}`

  return (
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
        <a className="btn btn-primary" href={finalVideoUrl} download={finalVideoFileName}>
          Download Selected Video
        </a>
      </div>
    </section>
  )
}
