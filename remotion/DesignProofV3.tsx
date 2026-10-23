import { Fragment } from 'react'
import { AbsoluteFill, Audio, Loop, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { TransitionSeries, linearTiming } from '@remotion/transitions'
import { fade } from '@remotion/transitions/fade'
import { wipe } from '@remotion/transitions/wipe'
import { COLORS, FONT_SERIF, FONT_SANS } from './theme'
import { revealStyle, revealScaleStyle, growWidthStyle } from './motion'
import { fitFontSize } from './textFit'
import { NARRATION_LEAD_IN_SECONDS } from './narrationTiming'
import { METRIC_VALUE, METRIC_LABEL, PROOF_CAPTIONS, type ProofSceneId } from './designProofContent'
import { GlowField, Caption, BrandPlate, CornerFrame, AscendingSparkline } from './cinematicChrome'

export { PROOF_CAPTIONS }

// V3 CINEMATIC DESIGN PROOF — a standalone, self-contained composition,
// completely separate from the real WfgExecutiveVideo pipeline/scene
// registry/VideoSceneType union (zero shared code touched, zero risk to
// production). Built in response to the V2 rejection: V2 read as a
// "narrated slideshow" (static illustrated cards, text competing with
// imagery). This proof answers that specific critique across 4 short
// beats — branded open, real cinematic footage, an animated metric, and a
// strong transition — using ONLY local assets/tools already in this repo
// (the one existing Luma clip, Kokoro narration, CSS/SVG motion graphics).
// No new paid generation calls, no edits to the protected Luma checkpoint.
//
// Reference-video synthesis (see the completion report for the full
// breakdown): WFG_Weekly_Update's cinematic depth/glow + big bold
// metric-reveal energy, combined with Agency Weekly Update's restrained
// editorial hierarchy, generous spacing, and persistent safe-caption band
// — never a literal copy of either.

export type DesignProofV3Props = {
  sceneDurationsInFrames: {
    opening: number
    cinematic: number
    metric: number
    closing: number
  }
} & Record<string, unknown>

function narrationAudioPath(sceneId: ProofSceneId): string {
  return staticFile(`narration-proof/${sceneId}.wav`)
}

function OpeningProof({ frame, fps, durationInFrames }: { frame: number; fps: number; durationInFrames: number }) {
  const logo = revealScaleStyle(frame, fps, 4)
  const rule = growWidthStyle(frame, fps, 18)
  const eyebrow = revealStyle(frame, fps, 26)

  return (
    <AbsoluteFill>
      <GlowField frame={frame} durationInFrames={durationInFrames} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', display: 'flex', flexDirection: 'column', gap: 30 }}>
        <BrandPlate style={logo} />
        <div style={{ ...rule, height: 2, backgroundColor: COLORS.gold, maxWidth: 280 }} />
        <div
          style={{
            ...eyebrow,
            fontFamily: FONT_SANS,
            fontSize: 24,
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: COLORS.softSand,
          }}
        >
          Weekly Leadership Update
        </div>
      </AbsoluteFill>
      <Caption text={PROOF_CAPTIONS.opening} frame={frame} fps={fps} />
    </AbsoluteFill>
  )
}

function CinematicProof({ frame, fps }: { frame: number; fps: number }) {
  const { fps: videoFps } = useVideoConfig()
  const headerStyle = revealStyle(frame, fps, 14)
  // The one real, existing Luma Ray 3.2 clip in this repo (never
  // regenerated) — trimmed to its clean 0-3.8s span and looped to cover
  // whatever this scene's narration-driven duration turns out to be, so
  // the footage never runs out mid-scene regardless of narration length.
  const trimStartFrame = 0
  const trimEndFrame = Math.round(3.8 * videoFps)
  const loopDurationInFrames = trimEndFrame - trimStartFrame

  return (
    <AbsoluteFill>
      <Loop durationInFrames={loopDurationInFrames}>
        <OffthreadVideo
          src={staticFile('luma-assets/executive-snapshot-asset-0.mp4')}
          muted
          startFrom={trimStartFrame}
          endAt={trimEndFrame}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </Loop>
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(41,37,36,0.60) 0%, rgba(41,37,36,0.15) 42%, rgba(41,37,36,0.05) 65%, rgba(41,37,36,0.35) 100%)' }} />
      <CornerFrame frame={frame} fps={fps} />
      <div style={{ position: 'absolute', left: 150, top: 110, maxWidth: 1200 }}>
        <div
          style={{
            ...headerStyle,
            fontFamily: FONT_SANS,
            fontSize: 20,
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: COLORS.gold,
            marginBottom: 12,
          }}
        >
          Executive Snapshot
        </div>
        <div style={{ ...revealStyle(frame, fps, 20), fontFamily: FONT_SERIF, fontSize: 46, fontWeight: 700, color: COLORS.white, lineHeight: 1.15, textShadow: '0 2px 16px rgba(0,0,0,0.5)' }}>
          This Week, At A Glance
        </div>
      </div>
      <Caption text={PROOF_CAPTIONS.cinematic} frame={frame} fps={fps} />
    </AbsoluteFill>
  )
}

function MetricProof({ frame, fps, durationInFrames }: { frame: number; fps: number; durationInFrames: number }) {
  const eyebrow = revealStyle(frame, fps, 4)
  const value = revealScaleStyle(frame, fps, 14)
  const label = revealStyle(frame, fps, 30)
  const valueFontSize = fitFontSize(METRIC_VALUE, { maxFontSize: 160, minFontSize: 90, idealLength: 8 })

  return (
    <AbsoluteFill>
      <GlowField frame={frame} durationInFrames={durationInFrames} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div
          style={{
            ...eyebrow,
            fontFamily: FONT_SANS,
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: COLORS.softSand,
          }}
        >
          Financial Close — September
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 36 }}>
          <div
            style={{
              ...value,
              fontFamily: FONT_SERIF,
              fontSize: valueFontSize,
              fontWeight: 700,
              color: COLORS.white,
              lineHeight: 1,
              textShadow: '0 0 60px rgba(184,146,63,0.55), 0 0 18px rgba(184,146,63,0.8)',
            }}
          >
            {METRIC_VALUE}
          </div>
          <AscendingSparkline frame={frame} fps={fps} />
        </div>
        <div
          style={{
            ...label,
            fontFamily: FONT_SANS,
            fontSize: 26,
            fontWeight: 500,
            color: COLORS.softSand,
            textAlign: 'center',
            maxWidth: 1000,
            marginTop: 6,
          }}
        >
          {METRIC_LABEL}
        </div>
      </AbsoluteFill>
      <Caption text={PROOF_CAPTIONS.metric} frame={frame} fps={fps} />
    </AbsoluteFill>
  )
}

function ClosingProof({ frame, fps, durationInFrames }: { frame: number; fps: number; durationInFrames: number }) {
  const logo = revealScaleStyle(frame, fps, 0)
  const tagline = revealStyle(frame, fps, 16)

  return (
    <AbsoluteFill>
      <GlowField frame={frame} durationInFrames={durationInFrames} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', display: 'flex', flexDirection: 'column', gap: 30 }}>
        <BrandPlate style={logo} />
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
          {PROOF_CAPTIONS.closing}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

function ProofNarration({ sceneId }: { sceneId: ProofSceneId }) {
  const { fps } = useVideoConfig()
  const leadInFrames = Math.round(NARRATION_LEAD_IN_SECONDS * fps)
  return (
    <Sequence from={leadInFrames} layout="none">
      <Audio src={narrationAudioPath(sceneId)} />
    </Sequence>
  )
}

export default function DesignProofV3({ sceneDurationsInFrames }: DesignProofV3Props) {
  const { fps } = useVideoConfig()
  const transitionFrames = Math.round(0.6 * fps)
  const strongTransitionFrames = Math.round(0.9 * fps)

  const scenes: Array<{ id: ProofSceneId; durationInFrames: number; render: (frame: number) => React.ReactNode }> = [
    { id: 'opening', durationInFrames: sceneDurationsInFrames.opening, render: (frame) => <OpeningProof frame={frame} fps={fps} durationInFrames={sceneDurationsInFrames.opening} /> },
    { id: 'cinematic', durationInFrames: sceneDurationsInFrames.cinematic, render: (frame) => <CinematicProof frame={frame} fps={fps} /> },
    { id: 'metric', durationInFrames: sceneDurationsInFrames.metric, render: (frame) => <MetricProof frame={frame} fps={fps} durationInFrames={sceneDurationsInFrames.metric} /> },
    { id: 'closing', durationInFrames: sceneDurationsInFrames.closing, render: (frame) => <ClosingProof frame={frame} fps={fps} durationInFrames={sceneDurationsInFrames.closing} /> },
  ]

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.darkCharcoal }}>
      <TransitionSeries>
        {scenes.map((scene, index) => {
          const isLast = index === scenes.length - 1
          const isStrongTransition = scene.id === 'metric'
          return (
            <Fragment key={scene.id}>
              <TransitionSeries.Sequence durationInFrames={scene.durationInFrames}>
                <CurrentFrameScene render={scene.render} />
                <ProofNarration sceneId={scene.id} />
              </TransitionSeries.Sequence>
              {!isLast && isStrongTransition && (
                <TransitionSeries.Transition presentation={wipe({ direction: 'from-right' })} timing={linearTiming({ durationInFrames: strongTransitionFrames })} />
              )}
              {!isLast && !isStrongTransition && <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: transitionFrames })} />}
            </Fragment>
          )
        })}
      </TransitionSeries>
    </AbsoluteFill>
  )
}

function CurrentFrameScene({ render }: { render: (frame: number) => React.ReactNode }) {
  const frame = useCurrentFrame()
  return <>{render(frame)}</>
}
