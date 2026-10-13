import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { COLORS, FONT_SERIF, FONT_SANS } from '../theme'
import { revealStyle, growWidthStyle, revealScaleStyle } from '../motion'
import { storyHeroAssets, storyMotifs } from '../visualStorySpec'
import { MotifIcon } from '../illustratedObjects'
import { GlowField, BrandPlate } from '../cinematicChrome'
import { AvatarVideoOverlay, avatarVideoLoopFrames } from '../avatarVideo'
import type { SceneRenderProps } from '../sceneProps'

// V3 cinematic opening — the approved dark-glow-brand treatment (see
// DesignProofV3.tsx / cinematicChrome.tsx), replacing the earlier flat
// warmCream slide. The factual title/body is untouched (comes from the
// scene object exactly as the deterministic transformer/AI-assisted path
// built it — this component never invents its own text). The hero-asset
// preview row is preserved (a real visual callback to this week's own
// generated illustrations, never regenerated here).
//
// Composition stays centered and vertically compact rather than
// full-bleed text, so there is open, unused space on both sides of the
// frame — reserved for a talking-avatar presenter appearance, per
// the approved design direction ("reserve avatar appearances for opening
// and forward-looking scenes"). When scene.avatarVideoAssetPath is set
// (Phase 2 — not produced by any pipeline yet), AvatarVideoOverlay fills
// that reserved space; absent, this scene renders exactly as before.
export default function OpeningScene({ scene, storyboard, durationInFrames }: SceneRenderProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const logo = revealScaleStyle(frame, fps, 4)
  const rule = growWidthStyle(frame, fps, 14)
  const title = revealStyle(frame, fps, 20)
  const week = revealStyle(frame, fps, 28)
  const heroAssets = storyHeroAssets(storyboard)
  const motifs = storyMotifs(storyboard)

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
          gap: 32,
        }}
      >
        <BrandPlate style={logo} />
        <div style={{ ...rule, height: 2, backgroundColor: COLORS.gold, maxWidth: 320 }} />
        <div
          style={{
            ...title,
            fontFamily: FONT_SERIF,
            fontSize: 58,
            fontWeight: 700,
            color: COLORS.white,
            textAlign: 'center',
            letterSpacing: '-0.01em',
            textShadow: '0 2px 20px rgba(0,0,0,0.5)',
            maxWidth: 1400,
          }}
        >
          {scene.title}
        </div>
        {scene.body && (
          <div
            style={{
              ...week,
              fontFamily: FONT_SANS,
              fontSize: 24,
              color: COLORS.softSand,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            {scene.body}
          </div>
        )}
        {heroAssets.length > 0 ? (
          <div style={{ display: 'flex', gap: 48, marginTop: 8 }}>
            {heroAssets.map((asset, index) => {
              const arrive = revealStyle(frame, fps, 36 + index * 6)
              return (
                <div key={asset.subject} style={{ ...arrive, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 84, height: 84, borderRadius: '50%', overflow: 'hidden', border: `3px solid ${COLORS.gold}` }}>
                    <Img src={staticFile(asset.heroAssetPath)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          motifs.length > 0 && (
            <div style={{ display: 'flex', gap: 48, marginTop: 8 }}>
              {motifs.map((motif, index) => {
                const arrive = revealStyle(frame, fps, 36 + index * 6)
                return (
                  <div key={motif.subject} style={{ ...arrive, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                    <MotifIcon subject={motif.subject} accent={motif.accent} size={64} />
                  </div>
                )
              })}
            </div>
          )
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
