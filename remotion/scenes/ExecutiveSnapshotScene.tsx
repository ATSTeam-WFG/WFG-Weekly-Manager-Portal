import { AbsoluteFill, Img, Loop, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { COLORS, FONT_SANS, FRAME_PADDING_X, FRAME_PADDING_Y } from '../theme'
import { revealStyle } from '../motion'
import { fitFontSize } from '../textFit'
import SceneHeader from '../SceneHeader'
import { storyHeroAssets, storyMotifs } from '../visualStorySpec'
import { MotifIcon, accentHex } from '../illustratedObjects'
import { CornerFrame } from '../cinematicChrome'
import type { SceneRenderProps } from '../sceneProps'

// The week's overview — an illustrated montage ("here is the visual world
// of this week"), not another title slide. Visual-direction v3: a row of
// the SAME hero illustrations (cropped) the later business scenes actually
// use settles in across the lower two-thirds of the frame — reused, never
// regenerated — while the header/body text keeps its established top
// treatment. Falls back to the plain SVG MotifIcon row only when no hero
// illustrations exist yet this week. This only ever previews themes the
// storyboard's own later scenes already established, never a new content
// decision made here.
//
// V2: when a real generated cinematic clip exists for THIS scene
// (scene.cinematicAssets[0] — e.g. a Luma Ray 3.2 shot specifically
// requested for the executive snapshot), it plays full-bleed as the
// backdrop instead of the illustrated-montage treatment below, muted. The
// header/body text gets a soft scrim behind it for legibility against
// real footage. A scene with no cinematic asset renders exactly as
// before — this is strictly additive.
//
// BUG FOUND + FIXED (V3 cinematic pass): the trimmed clip is only ~4s of
// real footage, but this scene's real narration-driven duration can run
// well past that (confirmed: at 11.47s, the clip ran out partway through
// and OffthreadVideo went blank/white for the remainder, with only the
// scrim gradient left showing — a real visible defect, not a transition
// artifact). Wrapped in <Loop> (same technique already used by
// DesignProofV3.tsx's own CinematicProof) so the trimmed window repeats
// seamlessly for however long the scene actually runs, regardless of
// narration length.
function CinematicSnapshotBackdrop({ assetPath, trimStartSeconds, trimEndSeconds, fps }: { assetPath: string; trimStartSeconds?: number; trimEndSeconds?: number; fps: number }) {
  const startFrom = trimStartSeconds ? Math.round(trimStartSeconds * fps) : 0
  const endAt = trimEndSeconds ? Math.round(trimEndSeconds * fps) : undefined
  const loopDurationInFrames = endAt !== undefined ? Math.max(1, endAt - startFrom) : undefined
  return (
    <AbsoluteFill>
      {loopDurationInFrames ? (
        <Loop durationInFrames={loopDurationInFrames}>
          <OffthreadVideo src={staticFile(assetPath)} muted startFrom={startFrom} endAt={endAt} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </Loop>
      ) : (
        <OffthreadVideo src={staticFile(assetPath)} muted startFrom={startFrom} endAt={endAt} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      )}
      {/* A gentle top-to-mid scrim only — keeps the header/body legible
          without hiding the footage across the whole frame. */}
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(41,37,36,0.55) 0%, rgba(41,37,36,0.18) 45%, rgba(41,37,36,0) 65%)' }} />
    </AbsoluteFill>
  )
}

export default function ExecutiveSnapshotScene({ scene, storyboard }: SceneRenderProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const cinematicAsset = scene.cinematicAssets?.[0]
  const bodyStyle = revealStyle(frame, fps, 26)
  const bodyFontSize = scene.body ? fitFontSize(scene.body, { maxFontSize: 34, minFontSize: 24, idealLength: 160 }) : 34
  const heroAssets = storyHeroAssets(storyboard)
  const motifs = storyMotifs(storyboard)
  // Real footage reads better with light text on a dark scrim; the
  // illustrated/motif fallback below keeps its original dark-on-white
  // treatment unchanged.
  const textColor = cinematicAsset ? COLORS.white : COLORS.espresso

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.white, padding: `${FRAME_PADDING_Y}px ${FRAME_PADDING_X}px` }}>
      {cinematicAsset && (
        <>
          <CinematicSnapshotBackdrop assetPath={cinematicAsset.assetPath} trimStartSeconds={cinematicAsset.trimStartSeconds} trimEndSeconds={cinematicAsset.trimEndSeconds} fps={fps} />
          <CornerFrame frame={frame} fps={fps} />
        </>
      )}
      <SceneHeader
        eyebrow={scene.eyebrow}
        title={scene.title}
        frame={frame}
        fps={fps}
        titleColor={cinematicAsset ? COLORS.white : undefined}
        eyebrowColor={cinematicAsset ? COLORS.white : undefined}
      />
      {scene.body && (
        <div
          style={{
            ...bodyStyle,
            fontFamily: FONT_SANS,
            fontSize: bodyFontSize,
            lineHeight: 1.5,
            color: textColor,
            maxWidth: 1300,
            textShadow: cinematicAsset ? '0 1px 10px rgba(0,0,0,0.45)' : 'none',
          }}
        >
          {scene.body}
        </div>
      )}
      {!cinematicAsset && heroAssets.length > 0 ? (
        <div style={{ position: 'absolute', left: FRAME_PADDING_X, right: FRAME_PADDING_X, bottom: 130, display: 'flex', justifyContent: 'space-between' }}>
          {heroAssets.map((asset, index) => {
            const settle = revealStyle(frame, fps, 30 + index * 10)
            return (
              <div key={asset.subject} style={{ ...settle, width: 220, height: 220, borderRadius: 20, overflow: 'hidden', border: `3px solid ${accentHex(asset.accent)}` }}>
                <Img src={staticFile(asset.heroAssetPath)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
            )
          })}
        </div>
      ) : (
        !cinematicAsset && motifs.length > 0 && (
          <div style={{ position: 'absolute', left: FRAME_PADDING_X, right: FRAME_PADDING_X, bottom: 130, display: 'flex', justifyContent: 'space-between' }}>
            {motifs.map((motif, index) => {
              const settle = revealStyle(frame, fps, 30 + index * 10)
              return (
                <div key={motif.subject} style={{ ...settle, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                  <div
                    style={{
                      width: 220,
                      height: 220,
                      borderRadius: 20,
                      backgroundColor: COLORS.softSand,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <MotifIcon subject={motif.subject} accent={motif.accent} size={132} />
                  </div>
                </div>
              )
            })}
          </div>
        )
      )}
    </AbsoluteFill>
  )
}
