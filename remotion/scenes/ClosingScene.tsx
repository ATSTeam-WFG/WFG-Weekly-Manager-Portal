import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import { COLORS, FONT_SANS } from '../theme'
import { revealScaleStyle, revealStyle } from '../motion'
import { GlowField, BrandPlate } from '../cinematicChrome'
import { AvatarVideoOverlay, avatarVideoLoopFrames } from '../avatarVideo'
import type { SceneRenderProps } from '../sceneProps'

// V3 cinematic close — the same dark-glow-brand treatment as OpeningScene
// (deliberate bookend), replacing the earlier flat white slide. Logo plus
// the app's own existing tagline (scene.body, e.g. "Together We Close
// More." — reused verbatim from buildStoryboardFromAtsReport, never
// invented here). When scene.avatarVideoAssetPath is set (Phase 2 — not
// produced by any pipeline yet), the SAME AvatarVideoOverlay OpeningScene
// uses fills the reserved corner space, for a consistent presenter
// treatment across both bookend scenes; absent, this scene renders
// exactly as before.
export default function ClosingScene({ scene, durationInFrames }: SceneRenderProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const logo = revealScaleStyle(frame, fps, 0)
  const tagline = revealStyle(frame, fps, 16)

  return (
    <AbsoluteFill>
      <GlowField frame={frame} durationInFrames={durationInFrames} />
      {scene.avatarVideoAssetPath && (
        <AvatarVideoOverlay assetPath={scene.avatarVideoAssetPath} loopDurationInFrames={avatarVideoLoopFrames(scene, fps)} />
      )}
      <AbsoluteFill
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 30,
        }}
      >
        <BrandPlate style={logo} />
        {scene.body && (
          <div
            style={{
              ...tagline,
              fontFamily: FONT_SANS,
              fontSize: 28,
              fontWeight: 600,
              color: COLORS.gold,
              letterSpacing: '0.02em',
            }}
          >
            {scene.body}
          </div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
