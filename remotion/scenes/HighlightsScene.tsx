import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import { COLORS, FONT_SANS, FRAME_PADDING_X, FRAME_PADDING_Y } from '../theme'
import { revealStyle, STAGGER_FRAMES } from '../motion'
import { fitListFontSize } from '../textFit'
import SceneHeader from '../SceneHeader'
import StoryScene from '../StoryScene'
import DecorationColumn from '../visuals/DecorationColumn'
import type { SceneRenderProps } from '../sceneProps'

// Achievement/growth presentation — headline plus a staged list of
// bullets, each with a terracotta accent mark (never a plain round bullet
// dot, which reads as a slide-deck list rather than an editorial one).
// If the scene also carries metrics (a highlights scene the deterministic
// transformer produced with no metric-shaped bullets still won't have
// any, but an AI-assisted highlights scene safely can), they get a
// visually emphasized inline treatment per the brief's "metrics may
// receive additional emphasis when present."
export default function HighlightsScene({ scene, durationInFrames }: SceneRenderProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  if (scene.visualPlan) {
    return <StoryScene scene={scene} frame={frame} fps={fps} durationInFrames={durationInFrames} backgroundColor={COLORS.white} />
  }

  const bullets = scene.bullets ?? []

  const bulletFontSize = fitListFontSize(bullets, { maxFontSize: 32, minFontSize: 22, idealTotalLength: 220 })

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.white, padding: `${FRAME_PADDING_Y}px ${FRAME_PADDING_X}px`, display: 'flex', flexDirection: 'row', gap: 48 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <SceneHeader eyebrow={scene.eyebrow} title={scene.title} frame={frame} fps={fps} />
        {scene.body && (
          <div style={{ ...revealStyle(frame, fps, 24), fontFamily: FONT_SANS, fontSize: 26, color: COLORS.espresso, marginBottom: 32, maxWidth: 1300 }}>
            {scene.body}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          {bullets.map((bullet, index) => {
            const style = revealStyle(frame, fps, 34 + index * STAGGER_FRAMES)
            return (
              <div key={index} style={{ ...style, display: 'flex', alignItems: 'flex-start', gap: 18 }}>
                <div style={{ width: 28, height: 3, backgroundColor: COLORS.terracotta, marginTop: 18, flexShrink: 0 }} />
                <div style={{ fontFamily: FONT_SANS, fontSize: bulletFontSize, color: COLORS.darkCharcoal, lineHeight: 1.4, maxWidth: 1280 }}>
                  {bullet}
                </div>
              </div>
            )
          })}
        </div>
        {scene.metrics && scene.metrics.length > 0 && (
          <div style={{ display: 'flex', gap: 48, marginTop: 32 }}>
            {scene.metrics.map((metric, index) => (
              <div key={index} style={{ ...revealStyle(frame, fps, 40 + bullets.length * STAGGER_FRAMES + index * STAGGER_FRAMES) }}>
                <div style={{ fontFamily: FONT_SANS, fontSize: 18, color: COLORS.mutedGray, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {metric.label}
                </div>
                <div style={{ fontFamily: FONT_SANS, fontSize: 40, fontWeight: 700, color: COLORS.terracotta }}>{metric.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <DecorationColumn concept={scene.visualConcept} frame={frame} fps={fps} itemCount={bullets.length} />
    </AbsoluteFill>
  )
}
