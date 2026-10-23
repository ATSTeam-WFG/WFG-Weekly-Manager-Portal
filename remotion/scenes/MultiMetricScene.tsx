import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import { COLORS, FONT_SANS, FONT_SERIF, FRAME_PADDING_X, FRAME_PADDING_Y } from '../theme'
import { revealStyle, STAGGER_FRAMES } from '../motion'
import { fitFontSize } from '../textFit'
import SceneHeader from '../SceneHeader'
import StoryScene from '../StoryScene'
import { getVisualConceptDecoration } from '../visualConceptRegistry'
import type { SceneRenderProps } from '../sceneProps'

// 2-4 metrics presented as an editorial "stat bar" — large numerals side
// by side, separated by thin rules, each with its own staged reveal
// (later metrics arrive a beat after earlier ones). Deliberately NOT a
// grid of bordered/shadowed cards — no background fill, no rounded
// corners, no drop shadow on the metric blocks themselves, so this never
// reads as a dashboard/form-field layout.
export default function MultiMetricScene({ scene, durationInFrames }: SceneRenderProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  if (scene.visualPlan) {
    return <StoryScene scene={scene} frame={frame} fps={fps} durationInFrames={durationInFrames} backgroundColor={COLORS.white} />
  }

  const metrics = scene.metrics ?? []

  // Fewer metrics get more room; every metric still gets a comfortable
  // minimum, so 4 metrics never crowd out to illegibility.
  const valueFontSize = Math.max(72, Math.min(120, Math.round(420 / Math.max(metrics.length, 1))))

  // Rendered as a full-width strip BELOW the stat bar (never a side column,
  // which would crowd this scene's already-horizontal metric layout) — see
  // DecorationColumn's own comment for why this is a fixed-width column in
  // every OTHER content scene instead.
  const Decoration = getVisualConceptDecoration(scene.visualConcept)

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.white, padding: `${FRAME_PADDING_Y}px ${FRAME_PADDING_X}px` }}>
      <SceneHeader eyebrow={scene.eyebrow} title={scene.title} frame={frame} fps={fps} />
      <div style={{ display: 'flex', flex: 1, alignItems: 'center', gap: 0 }}>
        {metrics.map((metric, index) => {
          const delay = 30 + index * STAGGER_FRAMES
          const style = revealStyle(frame, fps, delay)
          const contextFontSize = metric.context
            ? fitFontSize(metric.context, { maxFontSize: 20, minFontSize: 15, idealLength: 40 })
            : 20
          return (
            <div
              key={index}
              style={{
                ...style,
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                padding: '0 32px',
                borderLeft: index > 0 ? `1px solid ${COLORS.softSand}` : 'none',
              }}
            >
              <div
                style={{
                  fontFamily: FONT_SANS,
                  fontSize: 19,
                  fontWeight: 600,
                  color: COLORS.mutedGray,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: 14,
                }}
              >
                {metric.label}
              </div>
              <div style={{ fontFamily: FONT_SERIF, fontSize: valueFontSize, fontWeight: 700, color: COLORS.terracotta, lineHeight: 1 }}>
                {metric.value}
              </div>
              {metric.context && (
                <div style={{ fontFamily: FONT_SANS, fontSize: contextFontSize, color: COLORS.espresso, marginTop: 16 }}>{metric.context}</div>
              )}
            </div>
          )
        })}
      </div>
      {Decoration && (
        <div style={{ height: 56, marginTop: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Decoration frame={frame} fps={fps} itemCount={metrics.length} />
        </div>
      )}
    </AbsoluteFill>
  )
}
