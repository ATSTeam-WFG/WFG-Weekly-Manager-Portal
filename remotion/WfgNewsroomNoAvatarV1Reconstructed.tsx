import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame, useVideoConfig, interpolate } from 'remotion'
import { COLORS, FONT_SANS, FONT_SERIF } from './theme'
import { revealStyle, revealScaleStyle, growWidthStyle, STAGGER_FRAMES } from './motion'
import { BrandPlate, AscendingSparkline } from './cinematicChrome'

// RECONSTRUCTION of the original WFG Leadership Newsroom WITHOUT-AVATAR
// v1 (the flat CSS/Remotion studio, BEFORE the approved FLUX backdrop was
// integrated in WfgNewsroomNoAvatarV1.tsx). The v1 MP4 and its original
// source file were both overwritten when v2 was rendered to the same
// output path; this file restores v1's exact implementation from the
// conversation's own record of it (the Write tool call that first created
// it), not a guess or a redesign. A fifth, fully independent composition
// (new id/component/type names, own narration directory) — never touches
// WfgNewsroomNoAvatarV1.tsx (the current v2 composition) or
// WfgExecutiveVideo.
//
// One continuous camera move across the whole duration (no TransitionSeries
// cuts): a single `cameraT` progress value (0 during the establish beat,
// ramping 0->1 during the push beat, held at 1 during the metric beat)
// drives several depth layers at different rates for a parallax feel.
export type WfgNewsroomNoAvatarV1ReconstructedProps = {
  establishDurationInFrames: number
  pushDurationInFrames: number
  metricDurationInFrames: number
} & Record<string, unknown>

const NAVY_DEEP = '#0B1220'
const NAVY_MID = '#121B2E'
const NAVY_PANEL = '#162238'

const METRICS = [
  { label: 'Remittance', value: '+16.4%' },
  { label: 'Orders', value: '+8.8%' },
  { label: 'OTL Files', value: '+21.8%' },
]

// Several fixed vertical "architectural" panel lines, each drifting at
// its own rate (set via the `depth` multiplier below) — the cheapest way
// to read as a real studio with depth rather than a flat gradient card.
const PANEL_LINES = [
  { x: 180, depth: 0.3 },
  { x: 420, depth: 0.5 },
  { x: 1500, depth: 0.45 },
  { x: 1740, depth: 0.25 },
]

export default function WfgNewsroomNoAvatarV1Reconstructed({ establishDurationInFrames, pushDurationInFrames, metricDurationInFrames }: WfgNewsroomNoAvatarV1ReconstructedProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const pushStart = establishDurationInFrames
  const pushEnd = establishDurationInFrames + pushDurationInFrames
  const totalDuration = establishDurationInFrames + pushDurationInFrames + metricDurationInFrames

  // 0 for the whole establish beat, ramps to 1 across the push beat, held
  // at 1 for the whole metric beat — the one value every layer below
  // reads from, so the "camera" never jumps between beats.
  const cameraT = interpolate(frame, [pushStart, pushEnd], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  // A slow ambient drift across the ENTIRE duration (independent of
  // cameraT) so even the static establish beat reads as alive, not a
  // frozen frame.
  const ambientT = totalDuration > 0 ? frame / totalDuration : 0

  const dataWallScale = interpolate(cameraT, [0, 1], [0.42, 1.15])
  const dataWallX = interpolate(cameraT, [0, 1], [460, 0])
  const dataWallY = interpolate(cameraT, [0, 1], [50, 0])
  const backWallScale = interpolate(cameraT, [0, 1], [1, 1.1])

  const metricPhaseStart = pushEnd
  const localMetricFrame = Math.max(0, frame - metricPhaseStart)

  const eyebrowStyle = revealStyle(localMetricFrame, fps, 6)
  const ruleStyle = growWidthStyle(localMetricFrame, fps, 6)

  return (
    <AbsoluteFill style={{ backgroundColor: NAVY_DEEP, overflow: 'hidden' }}>
      {/* Back wall — slowest layer: a soft gradient + two warm/gold glow
          pools, scaling very slightly with the camera push for depth. */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(145deg, ${NAVY_DEEP} 0%, ${NAVY_MID} 60%, #0E1830 100%)`,
          transform: `scale(${backWallScale})`,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 120 + interpolate(ambientT, [0, 1], [0, 40]),
            top: 80 - interpolate(ambientT, [0, 1], [0, 30]),
            width: 820,
            height: 820,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(184,146,63,0.14), rgba(184,146,63,0) 70%)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            right: 100 - interpolate(ambientT, [0, 1], [0, 30]),
            bottom: 60 + interpolate(ambientT, [0, 1], [0, 20]),
            width: 700,
            height: 700,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(76,107,138,0.18), rgba(76,107,138,0) 70%)',
          }}
        />
      </AbsoluteFill>

      {/* Mid-ground architectural panel lines — medium depth layer, each
          drifting at its own rate via `depth`, giving real parallax
          separation from the back wall and the data-wall panel. */}
      {PANEL_LINES.map((line, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: line.x - interpolate(cameraT, [0, 1], [0, 260 * line.depth]),
            width: 2,
            background: 'linear-gradient(180deg, rgba(184,146,63,0) 0%, rgba(184,146,63,0.35) 50%, rgba(184,146,63,0) 100%)',
          }}
        />
      ))}

      {/* The data wall itself — foreground layer, the fastest-moving and
          the camera's actual destination. */}
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div
          style={{
            width: 1180,
            height: 680,
            borderRadius: 28,
            border: `2px solid rgba(184,146,63,0.55)`,
            background: `linear-gradient(165deg, ${NAVY_PANEL} 0%, #0F1829 100%)`,
            boxShadow: '0 0 120px rgba(184,146,63,0.12), inset 0 0 80px rgba(0,0,0,0.4)',
            transform: `translate(${dataWallX}px, ${dataWallY}px) scale(${dataWallScale})`,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '0 90px',
            gap: 28,
          }}
        >
          <div
            style={{
              ...eyebrowStyle,
              fontFamily: FONT_SANS,
              fontSize: 26,
              fontWeight: 600,
              color: COLORS.softSand,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            Florida Agency — Year to Date
          </div>
          <div style={{ ...ruleStyle, height: 2, backgroundColor: COLORS.gold, maxWidth: 360 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 64 }}>
            {METRICS.map((metric, i) => {
              const style = revealScaleStyle(localMetricFrame, fps, 16 + i * STAGGER_FRAMES)
              return (
                <div key={metric.label} style={{ ...style, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontFamily: FONT_SERIF, fontSize: 84, fontWeight: 700, color: COLORS.gold, lineHeight: 1 }}>{metric.value}</div>
                  <div style={{ fontFamily: FONT_SANS, fontSize: 24, color: COLORS.warmCream, letterSpacing: '0.03em' }}>{metric.label}</div>
                </div>
              )
            })}
            <AscendingSparkline frame={localMetricFrame} fps={fps} />
          </div>
        </div>
        <div style={{ position: 'absolute', top: 56, left: 56, ...revealScaleStyle(frame, fps, 0) }}>
          <BrandPlate />
        </div>
      </AbsoluteFill>

      <Sequence from={metricPhaseStart} durationInFrames={metricDurationInFrames}>
        <Audio src={staticFile('narration-newsroom-v1-reconstructed/metric.wav')} />
      </Sequence>
    </AbsoluteFill>
  )
}

export function newsroomReconstructedTotalDurationInFrames(establishDurationInFrames: number, pushDurationInFrames: number, metricDurationInFrames: number): number {
  return establishDurationInFrames + pushDurationInFrames + metricDurationInFrames
}
