import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import { COLORS, FONT_SANS, FRAME_PADDING_X, FRAME_PADDING_Y } from '../theme'
import { revealStyle, STAGGER_FRAMES } from '../motion'
import { fitFontSize, fitListFontSize } from '../textFit'
import SceneHeader from '../SceneHeader'
import StoryScene from '../StoryScene'
import DecorationColumn from '../visuals/DecorationColumn'
import type { SceneRenderProps } from '../sceneProps'

// A distinct editorial treatment for genuine operational concerns — a
// thin terracotta edge accent (the app's own existing "attention" color,
// never an alarm red) sets this scene apart from highlights/status at a
// glance, while staying professional rather than alarmist: no warning
// iconography, no saturated red, no exclamation styling. Next/action gets
// its own clearly separated callout, since a risk without a concrete next
// step is the least useful version of this scene.
export default function RiskScene({ scene, durationInFrames }: SceneRenderProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  if (scene.visualPlan) {
    return <StoryScene scene={scene} frame={frame} fps={fps} durationInFrames={durationInFrames} backgroundColor={COLORS.white} />
  }

  const bullets = scene.bullets ?? []

  const bodyFontSize = scene.body ? fitFontSize(scene.body, { maxFontSize: 30, minFontSize: 22, idealLength: 140 }) : 30
  const bulletFontSize = fitListFontSize(bullets, { maxFontSize: 26, minFontSize: 20, idealTotalLength: 200 })
  const nextFontSize = scene.next ? fitFontSize(scene.next, { maxFontSize: 26, minFontSize: 19, idealLength: 100 }) : 26

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.white, display: 'flex', flexDirection: 'row' }}>
      <div style={{ width: 10, backgroundColor: COLORS.terracotta }} />
      <div style={{ flex: 1, padding: `${FRAME_PADDING_Y}px ${FRAME_PADDING_X - 40}px`, display: 'flex', gap: 48 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <SceneHeader eyebrow={scene.eyebrow ?? 'Risk & Considerations'} title={scene.title} frame={frame} fps={fps} />

          {scene.body && (
            <div style={{ ...revealStyle(frame, fps, 24), fontFamily: FONT_SANS, fontSize: bodyFontSize, color: COLORS.espresso, lineHeight: 1.5, marginBottom: 28, maxWidth: 1250 }}>
              {scene.body}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 32 }}>
            {bullets.map((bullet, index) => (
              <div key={index} style={{ ...revealStyle(frame, fps, 34 + index * STAGGER_FRAMES), display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                <div style={{ width: 24, height: 3, backgroundColor: COLORS.espresso, marginTop: 16, flexShrink: 0 }} />
                <div style={{ fontFamily: FONT_SANS, fontSize: bulletFontSize, color: COLORS.darkCharcoal, lineHeight: 1.4, maxWidth: 1200 }}>{bullet}</div>
              </div>
            ))}
          </div>

          {scene.next && (
            <div
              style={{
                ...revealStyle(frame, fps, 40 + bullets.length * STAGGER_FRAMES),
                display: 'inline-flex',
                flexDirection: 'column',
                gap: 8,
                padding: '18px 28px',
                backgroundColor: COLORS.softSand,
                borderRadius: 4,
                maxWidth: 1100,
              }}
            >
              <div style={{ fontFamily: FONT_SANS, fontSize: 15, fontWeight: 700, color: COLORS.terracotta, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Next Step
              </div>
              <div style={{ fontFamily: FONT_SANS, fontSize: nextFontSize, color: COLORS.darkCharcoal, lineHeight: 1.4 }}>{scene.next}</div>
            </div>
          )}
        </div>
        <DecorationColumn concept={scene.visualConcept} frame={frame} fps={fps} itemCount={bullets.length} />
      </div>
    </AbsoluteFill>
  )
}
