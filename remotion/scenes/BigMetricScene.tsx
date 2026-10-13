import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import { COLORS, FONT_SANS, FONT_SERIF, FRAME_PADDING_X, FRAME_PADDING_Y } from '../theme'
import { revealScaleStyle, revealStyle } from '../motion'
import { fitFontSize } from '../textFit'
import SceneHeader from '../SceneHeader'
import StoryScene from '../StoryScene'
import type { SceneRenderProps } from '../sceneProps'

// One standout number, given the strongest visual hierarchy in the whole
// system — a single huge serif numeral, never a dashboard-style stat
// card. Deliberately a scale+fade "arrival" (never a numeric count-up:
// AI-supplied values are arbitrary formatted strings like "$1.2M" or
// "92%", not always a clean number to animate digit-by-digit, and a
// naive parse-and-count-up risks a wrong/misleading intermediate value —
// scale+fade reads as equally confident without that risk).
//
// When the scene carries a visualPlan (the Visual Director layer), this
// routes to StoryScene's big-illustration-led layout instead — the
// original layout below remains the fallback for a scene with no visual
// plan (the deterministic path's own big-metric scenes, or an
// AI-generated one that left visualPlan blank), so nothing here can
// regress an already-approved render.
export default function BigMetricScene({ scene, durationInFrames }: SceneRenderProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  if (scene.visualPlan) {
    return <StoryScene scene={scene} frame={frame} fps={fps} durationInFrames={durationInFrames} backgroundColor={COLORS.white} />
  }

  const metric = scene.metrics?.[0]

  const metricStyle = revealScaleStyle(frame, fps, 28)
  const labelStyle = revealStyle(frame, fps, 20)
  const contextStyle = revealStyle(frame, fps, 40)

  const valueFontSize = metric ? fitFontSize(metric.value, { maxFontSize: 220, minFontSize: 120, idealLength: 6 }) : 220

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.white,
        padding: `${FRAME_PADDING_Y}px ${FRAME_PADDING_X}px`,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <SceneHeader eyebrow={scene.eyebrow} title={scene.title} frame={frame} fps={fps} />
      {metric && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
          <div
            style={{
              ...labelStyle,
              fontFamily: FONT_SANS,
              fontSize: 26,
              fontWeight: 600,
              color: COLORS.mutedGray,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            {metric.label}
          </div>
          <div
            style={{
              ...metricStyle,
              fontFamily: FONT_SERIF,
              fontSize: valueFontSize,
              fontWeight: 700,
              color: COLORS.terracotta,
              lineHeight: 1,
            }}
          >
            {metric.value}
          </div>
          {metric.context && (
            <div style={{ ...contextStyle, fontFamily: FONT_SANS, fontSize: 24, color: COLORS.espresso, maxWidth: 900, textAlign: 'center' }}>
              {metric.context}
            </div>
          )}
        </div>
      )}
    </AbsoluteFill>
  )
}
