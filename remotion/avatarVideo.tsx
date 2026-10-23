import { AbsoluteFill, Audio, Loop, OffthreadVideo, staticFile } from 'remotion'
import { COLORS } from './theme'
import type { VideoStoryboardScene } from '../src/lib/videoStoryboard'

// Converts scene.avatarVideoDurationSeconds (set by
// scripts/lib/avatarVideoAssets.mts — the clip's REAL measured length,
// never an estimate) into the frame count AvatarVideoOverlay's own Loop
// needs. Undefined whenever the scene has no avatar video, or its
// duration hasn't been measured yet (e.g. opened directly in Remotion
// Studio without a real render having run first) — AvatarVideoOverlay
// itself already treats that as "play once, unlooped," never a crash.
export function avatarVideoLoopFrames(scene: VideoStoryboardScene, fps: number): number | undefined {
  return scene.avatarVideoDurationSeconds ? Math.round(scene.avatarVideoDurationSeconds * fps) : undefined
}

export interface AvatarVideoOverlayProps {
  // Relative to remotion/public/ — same convention as every other
  // *AssetPath field (fluxHeroAssetPath, cinematicAssets[].assetPath).
  assetPath: string
  // The avatar clip's OWN real length in frames, when known — wraps
  // playback in <Loop> so a clip shorter than its scene repeats instead
  // of going blank after its last frame (the exact defect
  // ExecutiveSnapshotScene.tsx's own CinematicSnapshotBackdrop was fixed
  // for on a real footage clip — same risk, same fix, here reused rather
  // than reinvented). Omit it to play the clip once, unlooped — correct
  // only when the clip is already known to be at least as long as the
  // scene. Measuring a real generated avatar clip's length and passing it
  // here is a render-pipeline concern (Step 2), not this component's.
  loopDurationInFrames?: number
}

// Reusable talking-avatar inset — a circular, gold-bordered clip placed in
// a corner so it never covers the centered branding/title treatment
// OpeningScene and ClosingScene both already use (see each scene's own
// "composition stays centered... reserved space" comment). OffthreadVideo,
// not <Video> — the same choice every other real video asset in this
// codebase already makes for frame-accurate rendering (see
// ExecutiveSnapshotScene.tsx/IllustratedStoryScene.tsx/DesignProofV3.tsx).
// Un-muted: the avatar clip's own embedded audio IS this scene's
// narration (see WfgExecutiveVideo.tsx), never a second, separate track.
export function AvatarVideoOverlay({ assetPath, loopDurationInFrames }: AvatarVideoOverlayProps) {
  const video = <OffthreadVideo src={staticFile(assetPath)} muted={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          right: 120,
          bottom: 120,
          width: 500,
          height: 500,
          borderRadius: '50%',
          overflow: 'hidden',
          border: `6px solid ${COLORS.gold}`,
          boxShadow: '0 0 40px rgba(0,0,0,0.5)',
        }}
      >
        {loopDurationInFrames ? (
  <>
    <Loop durationInFrames={loopDurationInFrames}>
      <Audio src={staticFile(assetPath)} />
    </Loop>
    <OffthreadVideo
      src={staticFile(assetPath)}
      volume={1}
      style={{ width: 0, height: 0, position: 'absolute' }}
    />
  </>
) : video}
      </div>
    </AbsoluteFill>
  )
}
