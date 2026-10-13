import { AbsoluteFill, Audio, Img, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig, interpolate } from 'remotion'
import { TransitionSeries, linearTiming } from '@remotion/transitions'
import { fade } from '@remotion/transitions/fade'
import { COLORS, FONT_SANS, FONT_SERIF } from './theme'
import { revealStyle, revealScaleStyle, growWidthStyle } from './motion'
import { BrandPlate, GlowField, AscendingSparkline } from './cinematicChrome'
import { fitFontSize } from './textFit'

// Hybrid Broadcast-Anchor / Cinematic-Documentary sample (approved
// direction) — a THIRD, fully independent composition, additive to
// Root.tsx exactly like DesignProofV3 before it: never touches
// WfgExecutiveVideo, the approved nine-scene storyboard, or any existing
// rendered MP4. Three fixed segments, not a general-purpose scene system:
// 1) presenter introduction (the REAL, already-generated opening HeyGen
//    clip, shown large via objectFit:'contain' so it is never stretched
//    or cropped — no <Loop>, since this segment's own duration is sized
//    to the clip's real measured length by the render script), 2) a
//    cinematic Ken-Burns transition over an EXISTING cached FLUX image
//    (metric-story__value-accumulation__hero.png — the one already
//    generated for this exact approved metric's visual story), 3) one
//    real, approved metric (topic-0 in the current checkpoint) narrated
//    locally via Kokoro, paired with the existing AscendingSparkline
//    motif rather than a risky digit-by-digit count-up of an
//    AI-formatted value string (see BigMetricScene's own header for why
//    that's deliberately avoided everywhere in this codebase).
export type CinematicSampleV1Props = {
  presenterDurationInFrames: number
  metricDurationInFrames: number
} & Record<string, unknown>

const TRANSITION_SEGMENT_SECONDS = 3
const FADE_SECONDS = 0.5

const METRIC_LABEL = 'Florida agency YTD YoY trends remain positive'
const METRIC_VALUE = 'remittance +16.4%, orders +8.8%, OTL files +21.8%.'
const HERO_IMAGE = 'flux-assets/metric-story__value-accumulation__hero.png'

function PresenterIntro({ durationInFrames }: { durationInFrames: number }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const titleStyle = revealStyle(frame, fps, 6)
  const plateStyle = revealScaleStyle(frame, fps, 0)

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.darkCharcoal }}>
      <GlowField frame={frame} durationInFrames={durationInFrames} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        {/* Large presenter panel — native 16:9 aspect, objectFit:'contain'
            so the real clip is never stretched or cropped, just shown
            much bigger than the old small circular inset. */}
        <div style={{ width: '82%', aspectRatio: '16 / 9', borderRadius: 24, overflow: 'hidden', boxShadow: '0 0 90px rgba(0,0,0,0.6)' }}>
          <OffthreadVideo src={staticFile('avatar-video/opening.mp4')} muted={false} style={{ width: '100%', height: '100%', objectFit: 'contain', backgroundColor: COLORS.darkCharcoal }} />
        </div>
      </AbsoluteFill>
      <div style={{ position: 'absolute', top: 56, left: 56, ...plateStyle }}>
        <BrandPlate />
      </div>
      <div
        style={{
          position: 'absolute',
          top: 150,
          left: 56,
          ...titleStyle,
          fontFamily: FONT_SERIF,
          fontSize: 34,
          fontWeight: 700,
          color: COLORS.warmCream,
        }}
      >
        WFG Weekly Leadership Update
      </div>
    </AbsoluteFill>
  )
}

function CinematicTransition({ durationInFrames }: { durationInFrames: number }) {
  const frame = useCurrentFrame()
  const t = durationInFrames > 0 ? frame / durationInFrames : 0
  const scale = interpolate(t, [0, 1], [1, 1.14])
  const translateX = interpolate(t, [0, 1], [0, -28])

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.espresso, overflow: 'hidden' }}>
      <Img
        src={staticFile(HERO_IMAGE)}
        style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${scale}) translateX(${translateX}px)` }}
      />
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(41,37,34,0) 50%, rgba(41,37,34,0.75) 100%)' }} />
    </AbsoluteFill>
  )
}

function AnimatedMetric({ durationInFrames }: { durationInFrames: number }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const labelStyle = revealStyle(frame, fps, 10)
  const valueStyle = revealScaleStyle(frame, fps, 20)
  const ruleStyle = growWidthStyle(frame, fps, 6)
  const valueFontSize = fitFontSize(METRIC_VALUE, { maxFontSize: 56, minFontSize: 34, idealLength: 40 })

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.warmCream }}>
      <GlowField frame={frame} durationInFrames={durationInFrames} />
      <AbsoluteFill
        style={{
          padding: '0 140px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 28,
        }}
      >
        <div style={{ ...labelStyle, fontFamily: FONT_SANS, fontSize: 26, fontWeight: 600, color: COLORS.mutedGray, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {METRIC_LABEL}
        </div>
        <div style={{ ...ruleStyle, height: 2, backgroundColor: COLORS.gold, maxWidth: 420 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 40 }}>
          <div style={{ ...valueStyle, fontFamily: FONT_SERIF, fontSize: valueFontSize, fontWeight: 700, color: COLORS.terracotta, maxWidth: 1100, lineHeight: 1.2 }}>
            {METRIC_VALUE}
          </div>
          <AscendingSparkline frame={frame} fps={fps} />
        </div>
      </AbsoluteFill>
      <div style={{ position: 'absolute', bottom: 56, right: 56 }}>
        <BrandPlate />
      </div>
    </AbsoluteFill>
  )
}

export default function CinematicSampleV1({ presenterDurationInFrames, metricDurationInFrames }: CinematicSampleV1Props) {
  const { fps } = useVideoConfig()
  const fadeFrames = Math.round(FADE_SECONDS * fps)
  const transitionFrames = Math.round(TRANSITION_SEGMENT_SECONDS * fps)

  return (
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={presenterDurationInFrames}>
        <PresenterIntro durationInFrames={presenterDurationInFrames} />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: fadeFrames })} />
      <TransitionSeries.Sequence durationInFrames={transitionFrames}>
        <CinematicTransition durationInFrames={transitionFrames} />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: fadeFrames })} />
      <TransitionSeries.Sequence durationInFrames={metricDurationInFrames}>
        <AnimatedMetric durationInFrames={metricDurationInFrames} />
        <Audio src={staticFile('narration-sample/metric.wav')} />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  )
}

export function cinematicSampleTotalDurationInFrames(presenterDurationInFrames: number, metricDurationInFrames: number, fps: number): number {
  const transitionFrames = Math.round(TRANSITION_SEGMENT_SECONDS * fps)
  const fadeFrames = Math.round(FADE_SECONDS * fps)
  const naiveTotal = presenterDurationInFrames + transitionFrames + metricDurationInFrames
  return Math.max(1, naiveTotal - fadeFrames * 2)
}
