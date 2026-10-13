import { AbsoluteFill } from 'remotion'
import { COLORS, FONT_SANS, FONT_SERIF, FRAME_PADDING_X, FRAME_PADDING_Y } from './theme'
import { revealStyle, growWidthStyle, STAGGER_FRAMES } from './motion'
import { fitFontSize, fitListFontSize } from './textFit'
import { getHeroIllustration } from './heroIllustrationRegistry'
import LayeredStoryScene from './LayeredStoryScene'
import IllustratedStoryScene, { ILLUSTRATED_TREATMENTS } from './IllustratedStoryScene'
import { cinematicTreatmentForScene } from './visualStorySpec'
import type { StoryEngine, VideoStoryboardScene } from '../src/lib/videoStoryboard'

interface StorySceneProps {
  scene: VideoStoryboardScene
  frame: number
  fps: number
  durationInFrames: number
  backgroundColor?: string
  // Forward Look ONLY — see LayeredStoryScene.tsx's own comment on this
  // same prop for what it's for and why it can never affect any other
  // scene.
  priorityLabels?: string[]
}

// The VISUAL-FIRST replacement layout every redesigned content scene
// (BigMetric/MultiMetric/Risk/Highlights/Status/ForwardLook) routes through
// WHEN scene.visualPlan is present — a big illustration doing the primary
// storytelling work, sparse onscreen text (a category, a headline, an
// important metric or a very short phrase, an optional short label, an
// optional concise Next), never the old "headline + paragraph + bullets +
// tiny decoration" shape. A scene without a visualPlan never reaches this
// component at all (each scene file falls back to its own original layout
// — see each one's own comment), so nothing here can ever regress an
// existing, already-approved render.
export default function StoryScene({ scene, frame, fps, durationInFrames, backgroundColor = COLORS.white, priorityLabels }: StorySceneProps) {
  const plan = scene.visualPlan
  const Illustration = getHeroIllustration(plan?.subject)
  const itemCount = scene.bullets?.length || scene.metrics?.length || undefined
  const composition = plan?.composition ?? 'split-illustration-text'

  const eyebrowStyle = revealStyle(frame, fps, 0)
  const titleStyle = revealStyle(frame, fps, 8)
  const ruleStyle = growWidthStyle(frame, fps, 16)
  const bodyStyle = revealStyle(frame, fps, 24)
  const metricStyle = revealStyle(frame, fps, 20)
  const nextStyle = revealStyle(frame, fps, 34 + (scene.bullets?.length ?? 0) * STAGGER_FRAMES)

  const titleFontSize = fitFontSize(scene.title, { maxFontSize: 64, minFontSize: 38, idealLength: 26 })
  const bodyFontSize = scene.body ? fitFontSize(scene.body, { maxFontSize: 28, minFontSize: 22, idealLength: 60 }) : 28
  const bulletFontSize = fitListFontSize(scene.bullets ?? [], { maxFontSize: 26, minFontSize: 20, idealTotalLength: 90 })
  const singleMetric = scene.metrics?.length === 1 ? scene.metrics[0] : undefined
  const metricValueFontSize = singleMetric ? fitFontSize(singleMetric.value, { maxFontSize: 128, minFontSize: 72, idealLength: 6 }) : 96

  const textColumn = (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 20, minWidth: 0 }}>
      {scene.eyebrow && (
        <div
          style={{
            ...eyebrowStyle,
            fontFamily: FONT_SANS,
            fontSize: 19,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: COLORS.terracotta,
          }}
        >
          {scene.eyebrow}
        </div>
      )}
      <div
        style={{
          ...titleStyle,
          fontFamily: FONT_SERIF,
          fontSize: titleFontSize,
          fontWeight: 700,
          color: COLORS.darkCharcoal,
          lineHeight: 1.1,
          maxWidth: 640,
        }}
      >
        {scene.title}
      </div>
      <div style={{ ...ruleStyle, height: 3, backgroundColor: COLORS.softSand, maxWidth: 120 }} />

      {singleMetric && (
        <div style={{ ...metricStyle }}>
          <div style={{ fontFamily: FONT_SERIF, fontSize: metricValueFontSize, fontWeight: 700, color: COLORS.terracotta, lineHeight: 1 }}>
            {singleMetric.value}
          </div>
          <div style={{ fontFamily: FONT_SANS, fontSize: 20, color: COLORS.mutedGray, marginTop: 8 }}>{singleMetric.label}</div>
        </div>
      )}

      {scene.metrics && scene.metrics.length > 1 && (
        <div style={{ ...metricStyle, display: 'flex', gap: 40 }}>
          {scene.metrics.slice(0, 3).map((metric, index) => (
            <div key={index}>
              <div style={{ fontFamily: FONT_SANS, fontSize: 16, color: COLORS.mutedGray, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {metric.label}
              </div>
              <div style={{ fontFamily: FONT_SERIF, fontSize: 44, fontWeight: 700, color: COLORS.terracotta }}>{metric.value}</div>
            </div>
          ))}
        </div>
      )}

      {scene.body && (
        <div style={{ ...bodyStyle, fontFamily: FONT_SANS, fontSize: bodyFontSize, color: COLORS.espresso, lineHeight: 1.4, maxWidth: 620 }}>
          {scene.body}
        </div>
      )}

      {scene.bullets && scene.bullets.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {scene.bullets.slice(0, 2).map((bullet, index) => (
            <div
              key={index}
              style={{ ...revealStyle(frame, fps, 30 + index * STAGGER_FRAMES), display: 'flex', gap: 12, alignItems: 'flex-start' }}
            >
              <div style={{ width: 20, height: 3, backgroundColor: COLORS.terracotta, marginTop: 12, flexShrink: 0 }} />
              <div style={{ fontFamily: FONT_SANS, fontSize: bulletFontSize, color: COLORS.darkCharcoal, lineHeight: 1.3, maxWidth: 560 }}>{bullet}</div>
            </div>
          ))}
        </div>
      )}

      {scene.next && (
        <div
          style={{
            ...nextStyle,
            display: 'inline-flex',
            flexDirection: 'column',
            gap: 6,
            padding: '12px 20px',
            backgroundColor: COLORS.softSand,
            borderRadius: 4,
            maxWidth: 560,
            alignSelf: 'flex-start',
          }}
        >
          <div style={{ fontFamily: FONT_SANS, fontSize: 13, fontWeight: 700, color: COLORS.terracotta, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Next
          </div>
          <div style={{ fontFamily: FONT_SANS, fontSize: 19, color: COLORS.darkCharcoal, lineHeight: 1.3 }}>{scene.next}</div>
        </div>
      )}
    </div>
  )

  // THE LAYERED-MECHANIC RENDER PATH — whenever this scene's content was
  // classified into one of the three reusable story engines (or is a
  // forward-look scene, which the RENDERER always treats as
  // pipeline-shaped regardless of storyEngine — see effectiveEngine below;
  // this is a fixed rendering convention, exactly like opening/closing
  // always getting the minimal-brand treatment, never a content
  // classification), the visual DEVELOPS over the scene's own duration —
  // environment (FLUX, when available) + foreground story objects whose
  // state visibly changes (see LayeredStoryScene.tsx/layeredMechanics.ts)
  // — instead of a single static illustration/image. A scene with NO
  // storyEngine (an unknown/future business concept the current three
  // mechanics don't fit) never reaches this branch at all and instead
  // falls through to the ordinary composition-based layout below — the
  // neutral, always-safe editorial fallback, completely untouched.
  // THE CINEMATIC ILLUSTRATED-HERO RENDER PATH (visual-direction v4) —
  // takes priority over the layered-mechanic geometric path below whenever
  // BOTH a hero backdrop actually exists for this scene — either a FLUX
  // still (scene.fluxHeroAssetPath) or one-or-more real generated cinematic
  // clips (scene.cinematicAssets; see IllustratedStoryScene.tsx's
  // VideoBackdrop/LumaShotSequence) — AND this scene's classified treatment
  // (cinematicTreatmentForScene) is one of the six this component renders
  // (CHALLENGE/TECHNOLOGY/REGIONAL_MAP/DATA_STORY/HERO_METRIC/
  // CINEMATIC_ENVIRONMENT — see ILLUSTRATED_TREATMENTS in
  // IllustratedStoryScene.tsx). BRANDED_OPENING/BRANDED_CLOSING/
  // FORWARD_LOOKING never reach this check at all (their own scene
  // components short-circuit before ever calling StoryScene). A
  // failed/unavailable hero generation falls straight through to the
  // existing layered-mechanic/neutral-fallback paths below, completely
  // unchanged.
  if (
    (scene.fluxHeroAssetPath || (scene.cinematicAssets && scene.cinematicAssets.length > 0)) &&
    ILLUSTRATED_TREATMENTS.has(cinematicTreatmentForScene(scene))
  ) {
    return <IllustratedStoryScene scene={scene} frame={frame} fps={fps} durationInFrames={durationInFrames} priorityLabels={priorityLabels} />
  }

  const effectiveEngine: StoryEngine | undefined = scene.storyEngine ?? (scene.type === 'forward-look' ? 'pipeline-story' : undefined)
  if (effectiveEngine) {
    return (
      <LayeredStoryScene
        scene={scene}
        frame={frame}
        fps={fps}
        durationInFrames={durationInFrames}
        engine={effectiveEngine}
        backgroundColor={backgroundColor}
        priorityLabels={priorityLabels}
      />
    )
  }

  const illustrationEl = Illustration && (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 640 }}>
        <Illustration frame={frame} fps={fps} itemCount={itemCount} />
      </div>
    </div>
  )

  if (composition === 'minimal-brand') {
    return (
      <AbsoluteFill style={{ backgroundColor, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 32 }}>
        {Illustration && <Illustration frame={frame} fps={fps} itemCount={itemCount} />}
        <div style={{ textAlign: 'center' }}>{textColumn}</div>
      </AbsoluteFill>
    )
  }

  if (composition === 'full-bleed-illustration') {
    return (
      <AbsoluteFill style={{ backgroundColor }}>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60 }}>
          {Illustration && <Illustration frame={frame} fps={fps} itemCount={itemCount} />}
        </div>
        <div style={{ position: 'absolute', left: FRAME_PADDING_X, top: FRAME_PADDING_Y, maxWidth: 620 }}>{textColumn}</div>
      </AbsoluteFill>
    )
  }

  // 'illustration-with-metric' and 'split-illustration-text' share the same
  // side-by-side skeleton — the only real difference between them is
  // WHICH content the AI chose to put in each scene (a dominant metric vs.
  // short supporting text), not a different layout mechanism.
  return (
    <AbsoluteFill
      style={{
        backgroundColor,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        padding: `${FRAME_PADDING_Y}px ${FRAME_PADDING_X}px`,
        gap: 64,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>{textColumn}</div>
      {illustrationEl}
    </AbsoluteFill>
  )
}
