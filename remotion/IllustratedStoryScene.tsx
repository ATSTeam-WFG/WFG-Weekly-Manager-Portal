import { useMemo } from 'react'
import { AbsoluteFill, Img, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame } from 'remotion'
import { COLORS, FONT_SANS, FONT_SERIF, FRAME_PADDING_X } from './theme'
import { revealStyle } from './motion'
import { fitFontSize } from './textFit'
import { computeFlowBeatSchedule, flowBeatAt, leadingDollarFigure, roughMagnitude, staggeredBuildProgress } from './layeredMechanics'
import { accentForSubject, cinematicTreatmentForScene, recipeForSubject, treatmentSeed, type CinematicTreatment } from './visualStorySpec'
import { detectGroundedRegion } from './regionDetection'
import { shotPlanForScene, type Shot } from './shotPlan'
import UsMapOutline from './usMapOutline'
import { GlowField, AscendingSparkline } from './cinematicChrome'
import type { CinematicAsset, VideoStoryboardScene } from '../src/lib/videoStoryboard'

// THE CINEMATIC STORY RENDERER (visual-direction v4) — the production
// integration of the approved Cinematic Visual Director plan. FLUX
// supplies the PRIMARY hero illustration for a scene (scene.fluxHeroAssetPath);
// this component makes that illustration DEVELOP during narration via one
// of the 9 approved treatments, dispatched by cinematicTreatmentForScene
// (visualStorySpec.ts) — a TOP-LEVEL classification the content layer
// never influences beyond the already-decided fields it reads. Six
// treatments render here (CHALLENGE, TECHNOLOGY, REGIONAL_MAP, DATA_STORY,
// HERO_METRIC, CINEMATIC_ENVIRONMENT); BRANDED_OPENING/BRANDED_CLOSING/
// FORWARD_LOOKING each keep their own dedicated component
// (OpeningScene/ClosingScene/ForwardLookScene.tsx) and never reach this
// file — StoryScene.tsx only routes here for the six illustrated
// treatments, and only when scene.fluxHeroAssetPath actually exists; any
// other case falls straight through to the existing LayeredStoryScene/
// neutral-fallback paths, completely unchanged.
//
// Every treatment reuses the SAME small set of primitives (HeroBackdrop's
// iris+camera, the layeredMechanics.ts pure timing helpers, TextOverlay) —
// but each treatment has its OWN distinct composition and state-change
// signature, and treatmentSeed(scene.id) varies camera origin/placement
// choices within a treatment so two scenes sharing one treatment don't
// default to an identical layout (e.g. two CHALLENGE scenes, or two
// CINEMATIC_ENVIRONMENT scenes with different visualPlan.subject values,
// read as genuinely different moments, not the same template restyled).

interface IllustratedStorySceneProps {
  scene: VideoStoryboardScene
  frame: number
  fps: number
  durationInFrames: number
  priorityLabels?: string[]
}

// The six illustrated-capable treatments this component actually renders —
// exported so StoryScene.tsx's routing condition can check membership
// without duplicating the list (BRANDED_OPENING/BRANDED_CLOSING/
// FORWARD_LOOKING are deliberately excluded: those three always keep their
// own dedicated scene component).
export const ILLUSTRATED_TREATMENTS: ReadonlySet<CinematicTreatment> = new Set([
  'CHALLENGE',
  'TECHNOLOGY',
  'REGIONAL_MAP',
  'DATA_STORY',
  'HERO_METRIC',
  'CINEMATIC_ENVIRONMENT',
])

function irisRadius(frame: number, fps: number): number {
  const progress = spring({ frame, fps, durationInFrames: 20, config: { damping: 200, mass: 0.8 } })
  return interpolate(progress, [0, 1], [10, 85])
}

// A small set of equally-valid iris/camera origins — treatmentSeed picks
// among them so the SAME treatment doesn't always push in on the exact
// same point of every illustration.
const CAMERA_ORIGINS = ['55% 45%', '48% 58%', '60% 40%', '45% 62%']

function pickOrigin(sceneId: string, offset = 0): string {
  return CAMERA_ORIGINS[(treatmentSeed(sceneId) + offset) % CAMERA_ORIGINS.length]
}

// The shared hero-illustration layer every treatment starts from — an
// iris reveal opening on the illustration, plus ONE of three camera
// behaviors: 'zoom-out' (the default — a slow push-back, revealing more of
// the environment), 'pan' (forward momentum — never used for a somber
// treatment), or 'drift' (a very gentle, almost static parallax-only hold,
// reserved for CHALLENGE's more restrained mood).
function HeroBackdrop({
  src,
  frame,
  fps,
  origin,
  camera,
}: {
  src: string
  frame: number
  fps: number
  origin: string
  camera: 'zoom-out' | 'pan' | 'drift'
}) {
  const radius = irisRadius(frame, fps)
  const t = Math.min(1, frame / 110)
  const transform =
    camera === 'zoom-out'
      ? `scale(${interpolate(t, [0, 1], [1.3, 1.15])})`
      : camera === 'pan'
        ? `scale(1.22) translateX(${interpolate(t, [0, 1], [60, -60])}px)`
        : `scale(${interpolate(t, [0, 1], [1.2, 1.12])}) translateY(${interpolate(t, [0, 1], [10, -6])}px)`
  return (
    <AbsoluteFill style={{ clipPath: `circle(${radius}% at ${origin})` }}>
      <div style={{ position: 'absolute', inset: 0, transform, transformOrigin: origin }}>
        <Img src={staticFile(src)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    </AbsoluteFill>
  )
}

// The Luma Ray 3.2 POC's one real addition: identical iris+camera treatment
// as HeroBackdrop above, but playing a real generated video clip
// (OffthreadVideo) instead of a static FLUX illustration. Muted — this POC
// never ships clip audio; the existing Kokoro narration remains the only
// soundtrack.
// Plays one real generated clip — bounded to exactly its own (optionally
// trimmed) real duration by the caller's Sequence, never held past its
// last frame, never looped. `asset.cropOrigin`/`cropScale` simulate a cut
// to a different angle from the SAME source clip (a digital reframe), so
// one generation can honestly yield two distinct-feeling shots.
function VideoBackdrop({
  asset,
  frame,
  fps,
  camera,
}: {
  asset: CinematicAsset
  frame: number
  fps: number
  camera: 'zoom-out' | 'pan' | 'drift'
}) {
  const origin = asset.cropOrigin ?? '50% 45%'
  const cropScale = asset.cropScale ?? 1
  const radius = irisRadius(frame, fps)
  const t = Math.min(1, frame / 110)
  const cameraScale =
    camera === 'zoom-out' ? interpolate(t, [0, 1], [1.3, 1.15]) : camera === 'pan' ? 1.22 : interpolate(t, [0, 1], [1.2, 1.12])
  const translateX = camera === 'pan' ? interpolate(t, [0, 1], [60, -60]) : 0
  const translateY = camera === 'drift' ? interpolate(t, [0, 1], [10, -6]) : 0
  const transform = `scale(${cameraScale * cropScale}) translate(${translateX}px, ${translateY}px)`
  const startFrom = asset.trimStartSeconds ? Math.round(asset.trimStartSeconds * fps) : undefined
  const endAt = asset.trimEndSeconds ? Math.round(asset.trimEndSeconds * fps) : undefined
  return (
    <AbsoluteFill style={{ clipPath: `circle(${radius}% at ${origin})` }}>
      <div style={{ position: 'absolute', inset: 0, transform, transformOrigin: origin }}>
        <OffthreadVideo
          src={staticFile(asset.assetPath)}
          muted
          startFrom={startFrom}
          endAt={endAt}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>
    </AbsoluteFill>
  )
}

// The six FLUX-based treatments below always use HeroBackdrop (a scene
// only reaches them at all when it has no cinematicAssets — see
// IllustratedStoryScene's dispatch — so there is nothing left to branch on
// here). Kept as its own named function (rather than inlining
// HeroBackdrop) so each treatment's call site reads the same as before.
function SceneBackdrop({
  scene,
  frame,
  fps,
  origin,
  camera,
}: {
  scene: VideoStoryboardScene
  frame: number
  fps: number
  origin: string
  camera: 'zoom-out' | 'pan' | 'drift'
}) {
  return <HeroBackdrop src={scene.fluxHeroAssetPath!} frame={frame} fps={fps} origin={origin} camera={camera} />
}

// Title/eyebrow — briefly a full, confident presence, then settles to a
// quieter secondary opacity once established ("titles may briefly overlay
// the world and then become secondary," per the approved cinematic
// direction) rather than sitting at full weight for the whole scene like a
// persistent slide headline.
function TextOverlay({ scene, frame, fps }: { scene: VideoStoryboardScene; frame: number; fps: number }) {
  // idealLength/maxWidth tightened alongside the FRAME_PADDING_X margin
  // change below — a long title (e.g. "Technology Migration and AI
  // Adoption", 36 chars) must still fit this panel's own safe width.
  const titleFontSize = fitFontSize(scene.title, { maxFontSize: 52, minFontSize: 32, idealLength: 26 })
  const settle = interpolate(frame, [0, 20, 70, 95], [0, 1, 1, 0.78], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return (
    // FRAME_PADDING_X (the same generous, title-safe margin every other
    // part of this video system already uses — theme.ts) replaces the
    // previous hardcoded left:90, which sat close enough to the frame edge
    // (and to whatever the hero illustration happens to be doing there)
    // to read as clipped/crowded on a long title. The translucent card
    // behind the heading — the same warmCream-on-illustration treatment
    // already used elsewhere in this file for a readable detail overlay
    // (see CinematicEnvironmentTreatment's 'growth' recipe) — guarantees
    // contrast against the hero illustration regardless of what's behind
    // it, rather than relying on the illustration happening to be plain
    // in that exact region.
    <div style={{ position: 'absolute', left: FRAME_PADDING_X, top: 70, maxWidth: 1920 - FRAME_PADDING_X * 2, opacity: settle }}>
      <div
        style={{
          display: 'inline-block',
          maxWidth: 820,
          backgroundColor: 'rgba(248,245,239,0.88)',
          borderRadius: 12,
          padding: '18px 28px',
          boxShadow: '0 4px 20px rgba(41,37,36,0.12)',
        }}
      >
        {scene.eyebrow && (
          <div
            style={{
              ...revealStyle(frame, fps, 0),
              fontFamily: FONT_SANS,
              fontSize: 19,
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: COLORS.terracotta,
              marginBottom: 10,
            }}
          >
            {scene.eyebrow}
          </div>
        )}
        <div style={{ ...revealStyle(frame, fps, 6), fontFamily: FONT_SERIF, fontSize: titleFontSize, fontWeight: 700, color: COLORS.darkCharcoal, lineHeight: 1.15 }}>
          {scene.title}
        </div>
      </div>
    </div>
  )
}

// ============================================================
// CINEMATIC_ENVIRONMENT — the default narrative/business-storytelling
// treatment. Consults recipeForSubject ONLY as a camera/composition HINT
// (never re-deciding content): a document-workflow subject gets a subtle
// accumulating-file detail (a callback to the proven flow/pressure beats,
// now understated rather than the whole scene), an opportunity/trajectory
// subject gets a forward PAN with its own grounded bullet appearing as a
// brief "detail shot," and any other subject gets a plain, unembellished
// push-in — so two CINEMATIC_ENVIRONMENT scenes with different subjects
// read as genuinely different moments, not one template restyled.
// ============================================================
function CinematicEnvironmentTreatment({ scene, frame, fps, durationInFrames }: IllustratedStorySceneProps) {
  const recipe = recipeForSubject(scene.visualPlan?.subject)
  const origin = pickOrigin(scene.id)
  // Computed unconditionally (Rules of Hooks) even though only the
  // 'workflow' branch below uses it — a cheap pure function, so there's no
  // cost to always deriving it.
  const schedule = useMemo(() => computeFlowBeatSchedule(durationInFrames), [durationInFrames])

  if (recipe === 'workflow') {
    const beat = flowBeatAt(frame, schedule)
    const pileCount = beat === 'flow' ? 0 : beat === 'pressure' ? 1 : 3
    const pileX = 1180
    const pileY = 880
    return (
      <AbsoluteFill style={{ backgroundColor: COLORS.warmCream, overflow: 'hidden' }}>
        <SceneBackdrop scene={scene} frame={frame} fps={fps} origin={origin} camera="zoom-out" />
        {Array.from({ length: pileCount }, (_, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: pileX - 60 + i * 6,
              top: pileY - i * 12,
              width: 120,
              height: 82,
              borderRadius: 6,
              background: COLORS.warmCream,
              border: `2px solid ${COLORS.espresso}`,
              opacity: 0.85,
              transform: `rotate(${i * 2}deg)`,
              boxShadow: '0 5px 8px rgba(41,37,36,0.18)',
            }}
          />
        ))}
        <TextOverlay scene={scene} frame={frame} fps={fps} />
      </AbsoluteFill>
    )
  }

  if (recipe === 'growth') {
    const detail = (scene.bullets ?? [])[0]
    const detailReveal = spring({ frame: Math.max(0, frame - Math.round(durationInFrames * 0.4)), fps, durationInFrames: 24, config: { damping: 200, mass: 0.8 } })
    return (
      <AbsoluteFill style={{ backgroundColor: COLORS.warmCream, overflow: 'hidden' }}>
        <SceneBackdrop scene={scene} frame={frame} fps={fps} origin={origin} camera="pan" />
        {detail && (
          <div
            style={{
              position: 'absolute',
              left: 1180,
              top: 760,
              width: 320,
              opacity: detailReveal,
              transform: `translateY(${interpolate(detailReveal, [0, 1], [14, 0])}px)`,
              fontFamily: FONT_SANS,
              fontSize: 20,
              color: COLORS.darkCharcoal,
              backgroundColor: 'rgba(248,245,239,0.78)',
              borderRadius: 6,
              padding: '6px 12px',
            }}
          >
            {detail}
          </div>
        )}
        <TextOverlay scene={scene} frame={frame} fps={fps} />
      </AbsoluteFill>
    )
  }

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.warmCream, overflow: 'hidden' }}>
      <SceneBackdrop scene={scene} frame={frame} fps={fps} origin={origin} camera="zoom-out" />
      <TextOverlay scene={scene} frame={frame} fps={fps} />
    </AbsoluteFill>
  )
}

// ============================================================
// HERO_METRIC — one grounded number becomes part of the cinematic
// composition: large serif typography in open illustration space (seeded
// corner, never a fixed card/pill), with a single confident "arrival"
// emphasis (a restrained scale+glow pulse, the 10% promotional touch for
// this treatment) rather than a dashboard card.
// ============================================================
// V3 cinematic treatment (replaces the earlier FLUX-illustrated-backdrop
// version) — the approved "big glowing number + sparkline on a dark
// cinematic glow" design from DesignProofV3.tsx's own Financial Close
// scene, now the real production treatment for every HERO_METRIC scene
// (today, exactly topic-0). TextOverlay is NOT reused here — it assumes a
// light backdrop (dark text), which would be illegible against GlowField's
// dark background, so this treatment renders its own white/gold eyebrow+
// title instead, in the same position/scale as every other scene's
// header for visual consistency.
function HeroMetricTreatment({ scene, frame, fps, durationInFrames }: IllustratedStorySceneProps) {
  const metric = scene.metrics?.[0]
  const eyebrowStyle = revealStyle(frame, fps, 0)
  const titleStyle = revealStyle(frame, fps, 10)
  const labelStyle = revealStyle(frame, fps, 30)
  // Capped at 45 frames (1.5s) regardless of scene duration — a longer
  // scene (this one now runs ~22s with the fuller V3 narration) must not
  // leave the number arriving ten-plus seconds late; the label gets its
  // own brief head start, then the number arrives promptly and holds for
  // the rest of the scene.
  const revealAt = Math.min(45, Math.max(16, Math.round(durationInFrames * 0.3)))
  const reveal = spring({ frame: Math.max(0, frame - revealAt), fps, durationInFrames: 26, config: { damping: 14, mass: 0.6 } })
  const emphasisScale = interpolate(reveal, [0, 0.7, 1], [0.9, 1.04, 1])
  // AI-supplied metric.value is sometimes a short figure ("$2.93M") and
  // sometimes a longer run-on clause pulled from source prose (e.g.
  // "remittance +16.4%, orders +8.8%, OTL files +21.8%.") — shrinks to fit
  // within a bounded width instead of ever assuming a short value.
  const valueFontSize = metric ? fitFontSize(metric.value, { maxFontSize: 140, minFontSize: 56, idealLength: 9 }) : 140
  const titleFontSize = fitFontSize(scene.title, { maxFontSize: 44, minFontSize: 30, idealLength: 36 })
  // Two scenes sharing HERO_METRIC must not read as the identical template
  // restyled — treatmentSeed alternates which side of the frame the glowing
  // number settles on (center vs. a right-shifted column), same variation
  // intent as RegionalMapTreatment's mapCorner, just expressed as alignment
  // rather than a literal corner box.
  const metricAlign = treatmentSeed(scene.id) % 2 === 0 ? 'center' : 'flex-end'
  const metricPadding = metricAlign === 'flex-end' ? { paddingRight: 220 } : {}
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <GlowField frame={frame} durationInFrames={durationInFrames} />
      <div style={{ position: 'absolute', left: 150, top: 110, maxWidth: 1200 }}>
        {scene.eyebrow && (
          <div
            style={{
              ...eyebrowStyle,
              fontFamily: FONT_SANS,
              fontSize: 19,
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: COLORS.gold,
              marginBottom: 10,
            }}
          >
            {scene.eyebrow}
          </div>
        )}
        <div style={{ ...titleStyle, fontFamily: FONT_SERIF, fontSize: titleFontSize, fontWeight: 700, color: COLORS.white, lineHeight: 1.15, textShadow: '0 2px 16px rgba(0,0,0,0.5)' }}>
          {scene.title}
        </div>
      </div>
      {metric && (
        <AbsoluteFill style={{ alignItems: metricAlign, justifyContent: 'center', display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 60, ...metricPadding }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 32, opacity: reveal, transform: `scale(${emphasisScale})` }}>
            <div
              style={{
                fontFamily: FONT_SERIF,
                fontSize: valueFontSize,
                fontWeight: 700,
                color: COLORS.white,
                lineHeight: 1,
                textShadow: '0 0 60px rgba(184,146,63,0.55), 0 0 18px rgba(184,146,63,0.8)',
              }}
            >
              {metric.value}
            </div>
            <AscendingSparkline frame={frame} fps={fps} />
          </div>
          <div style={{ ...labelStyle, fontFamily: FONT_SANS, fontSize: 24, fontWeight: 500, color: COLORS.softSand, textAlign: 'center', maxWidth: 1000 }}>{metric.label}</div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  )
}

// ============================================================
// DATA_STORY — 2-3 grounded metrics as an elegant, slim motion-graphic
// progression (thin rising rules with a soft glowing tip), never a diagram
// of blocky chips — the height difference alone communicates relative
// scale, and the exact grounded value/label is always the real text.
// ============================================================
function DataStoryTreatment({ scene, frame, fps, durationInFrames }: IllustratedStorySceneProps) {
  const metrics = (scene.metrics ?? []).slice(0, 3)
  const magnitudes = metrics.map((m) => roughMagnitude(m.value))
  const allParsed = magnitudes.every((m) => m !== null)
  const maxMagnitude = allParsed ? Math.max(...(magnitudes as number[])) : 1
  const accent = accentForSubject(scene.visualPlan?.subject)
  const accentHex = accent === 'gold' ? COLORS.gold : accent === 'blue' ? COLORS.slateBlue : accent === 'sage' ? COLORS.sage : COLORS.terracotta
  const origin = pickOrigin(scene.id, 2)
  const baseY = 940
  const maxHeight = 420
  const gap = 260
  const centerX = 1280
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.warmCream, overflow: 'hidden' }}>
      <SceneBackdrop scene={scene} frame={frame} fps={fps} origin={origin} camera="zoom-out" />
      {metrics.map((metric, index) => {
        const progress = staggeredBuildProgress(frame, durationInFrames, index, metrics.length)
        const relativeHeight = allParsed && maxMagnitude > 0 ? Math.max(0.3, (magnitudes[index] as number) / maxMagnitude) : 0.7
        const height = maxHeight * relativeHeight * progress
        const totalWidth = (metrics.length - 1) * gap
        const x = centerX - totalWidth / 2 + index * gap
        const revealAt = Math.max(20, Math.round(durationInFrames * 0.55)) + index * 6
        return (
          <div key={index}>
            <div
              style={{
                position: 'absolute',
                left: x - 5,
                top: baseY - height,
                width: 10,
                height,
                borderRadius: 5,
                background: `linear-gradient(180deg, ${accentHex}, transparent)`,
                opacity: 0.85,
              }}
            />
            {height > 4 && (
              <div
                style={{
                  position: 'absolute',
                  left: x - 9,
                  top: baseY - height - 9,
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  background: accentHex,
                  boxShadow: `0 0 18px ${accentHex}aa`,
                }}
              />
            )}
            <div style={{ position: 'absolute', left: x - 110, top: baseY + 24, width: 220, textAlign: 'center', ...revealStyle(frame, fps, revealAt) }}>
              <div style={{ fontFamily: FONT_SERIF, fontSize: 38, fontWeight: 700, color: accentHex }}>{metric.value}</div>
              <div style={{ fontFamily: FONT_SANS, fontSize: 16, color: COLORS.mutedGray, marginTop: 4 }}>{metric.label}</div>
            </div>
          </div>
        )
      })}
      <TextOverlay scene={scene} frame={frame} fps={fps} />
    </AbsoluteFill>
  )
}

// ============================================================
// CHALLENGE — a restrained/serious mood, never alarmist: a gentle
// desaturating/darkening wash (lighter than TECHNOLOGY's consequence
// vignette), one thin terracotta rule growing in (echoing the brand's own
// rule motif), and the grounded next-step/bullet as plain typography — no
// card, no icon, no chip stack.
// ============================================================
function ChallengeTreatment({ scene, frame, fps, durationInFrames }: IllustratedStorySceneProps) {
  const origin = pickOrigin(scene.id, 3)
  const moodT = Math.min(1, frame / 90)
  const ruleWidth = interpolate(spring({ frame, fps, durationInFrames: 40, config: { damping: 200, mass: 0.8 } }), [0, 1], [0, 220])
  const caption = scene.next || scene.bullets?.[0]
  const captionReveal = spring({ frame: Math.max(0, frame - Math.round(durationInFrames * 0.6)), fps, durationInFrames: 24, config: { damping: 200, mass: 0.8 } })
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.warmCream, overflow: 'hidden' }}>
      <SceneBackdrop scene={scene} frame={frame} fps={fps} origin={origin} camera="drift" />
      <div style={{ position: 'absolute', inset: 0, background: `rgba(41,37,36,${0.18 * moodT})` }} />
      <div style={{ position: 'absolute', left: FRAME_PADDING_X, top: 210, width: ruleWidth, height: 3, backgroundColor: COLORS.terracotta }} />
      {caption && (
        <div
          style={{
            position: 'absolute',
            left: FRAME_PADDING_X,
            // Raised from bottom:90 — the V3 global lower-third narration
            // caption (CaptionLayer in WfgExecutiveVideo.tsx, added after
            // this own-caption already existed) occupies roughly the
            // bottom ~170px of the frame (bottom:64 band, up to 2 lines of
            // text). bottom:90 sat squarely inside that band; a first pass
            // at bottom:190 still touched it for a long scene.next/bullet
            // (this treatment's own caption has no line-height cap and a
            // long grounded sentence wraps to 3-4 lines here, e.g. topic-3's
            // real bullet text — confirmed via render QA at both bottom:190
            // and this value). bottom:270 clears even that worst-case wrap
            // with real margin.
            bottom: 270,
            opacity: captionReveal,
            transform: `translateY(${interpolate(captionReveal, [0, 1], [12, 0])}px)`,
            fontFamily: FONT_SANS,
            fontSize: 22,
            color: COLORS.darkCharcoal,
            maxWidth: 760,
            // This caption previously rendered as bare text directly over
            // the hero illustration (confirmed via render QA: it visibly
            // overlapped book/document artwork and was hard to read). The
            // same translucent card treatment as TextOverlay's heading
            // above guarantees a clean, readable panel regardless of what
            // the illustration is doing underneath.
            backgroundColor: 'rgba(248,245,239,0.88)',
            borderRadius: 10,
            padding: '14px 22px',
            boxShadow: '0 4px 16px rgba(41,37,36,0.12)',
          }}
        >
          {caption}
        </div>
      )}
      <TextOverlay scene={scene} frame={frame} fps={fps} />
    </AbsoluteFill>
  )
}

// ============================================================
// TECHNOLOGY — the validated systems-friction recipe, reused as-is:
// working environment -> friction develops (the snapped-connection motif
// fades in) -> interruption/consequence (a darkening vignette) -> a short
// grounded caption settles in. "Use the existing generated visual
// capability," per the approved plan — no rework needed here.
// ============================================================
function TechnologyTreatment({ scene, frame, fps }: IllustratedStorySceneProps) {
  const origin = pickOrigin(scene.id, 4)
  const frictionReveal = spring({ frame: Math.max(0, frame - 130), fps, durationInFrames: 40, config: { damping: 200, mass: 0.8 } })
  const glowPulse = 0.5 + 0.5 * Math.sin(frame / 6)
  const vignetteT = Math.max(0, Math.min(1, (frame - 170) / 40))
  const vignetteOpacity = interpolate(vignetteT, [0, 1], [0, 0.36])
  const captionReveal = spring({ frame: Math.max(0, frame - 190), fps, durationInFrames: 24, config: { damping: 200, mass: 0.8 } })
  const caption = scene.bullets?.[0] ?? scene.next
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.warmCream, overflow: 'hidden' }}>
      <SceneBackdrop scene={scene} frame={frame} fps={fps} origin={origin} camera="zoom-out" />
      {scene.fluxMotifAssetPath && (
        <div
          style={{
            position: 'absolute',
            left: '58%',
            top: '24%',
            width: 260,
            height: 260,
            transform: `translate(-50%, -50%) scale(${0.7 + frictionReveal * 0.3})`,
            opacity: frictionReveal,
          }}
        >
          <div style={{ position: 'absolute', inset: -36, borderRadius: '50%', background: `radial-gradient(circle, rgba(183,101,74,${0.35 * glowPulse}), rgba(183,101,74,0))` }} />
          <Img
            src={staticFile(scene.fluxMotifAssetPath)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%', maskImage: 'radial-gradient(circle, black 55%, transparent 78%)', WebkitMaskImage: 'radial-gradient(circle, black 55%, transparent 78%)' }}
          />
        </div>
      )}
      <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(circle at 55% 42%, rgba(0,0,0,0) 40%, rgba(41,37,36,${vignetteOpacity}) 100%)` }} />
      <TextOverlay scene={scene} frame={frame} fps={fps} />
      {caption && (
        <div
          style={{
            position: 'absolute',
            left: FRAME_PADDING_X,
            // Raised from bottom:90 for the same reason as
            // ChallengeTreatment's own caption — clears the V3 global
            // lower-third narration caption band (see that comment,
            // including why bottom:270 rather than a smaller value).
            bottom: 270,
            opacity: captionReveal,
            transform: `translateY(${interpolate(captionReveal, [0, 1], [12, 0])}px)`,
            fontFamily: FONT_SANS,
            fontSize: 22,
            color: COLORS.espresso,
            maxWidth: 640,
            // Same fix as ChallengeTreatment's caption: this previously
            // rendered as bare text directly over the hero illustration —
            // confirmed via render QA on this exact scene (topic-3,
            // "Technology Migration and AI Adoption") to overlap the book
            // illustration and be hard to read. Same translucent card
            // treatment as every other text panel in this file now.
            backgroundColor: 'rgba(248,245,239,0.88)',
            borderRadius: 10,
            padding: '14px 22px',
            boxShadow: '0 4px 16px rgba(41,37,36,0.12)',
          }}
        >
          {caption}
        </div>
      )}
    </AbsoluteFill>
  )
}

// ============================================================
// REGIONAL_MAP — a cinematic composition, not a dashboard insert: the
// hero environment remains the backdrop, a simplified map silhouette with
// the real, already-grounded region highlighted settles into open
// composition space (never full-frame), a grounded metric/detail overlays
// where the scene actually has one, and the whole thing has the same
// gentle push/reveal motion as every other treatment. The region name
// itself is real Remotion typography, never baked into a generated image.
// ============================================================
function RegionalMapTreatment({ scene, frame, fps, durationInFrames }: IllustratedStorySceneProps) {
  const region = detectGroundedRegion(scene)
  const accent = accentForSubject(scene.visualPlan?.subject)
  const accentHex = accent === 'gold' ? COLORS.gold : accent === 'blue' ? COLORS.slateBlue : accent === 'sage' ? COLORS.sage : COLORS.terracotta
  const origin = pickOrigin(scene.id, 5)
  const mapReveal = spring({ frame, fps, durationInFrames: 70, config: { damping: 200, mass: 1 } })
  const pulse = 0.5 + 0.5 * Math.sin(frame / 10)
  const metric = scene.metrics?.[0]
  const value = metric ? undefined : region && scene.bullets?.find((b) => b.includes(region.abbreviation))
  const detailValue = value ? leadingDollarFigure(value) : undefined
  const detailReveal = spring({ frame: Math.max(0, frame - Math.round(durationInFrames * 0.5)), fps, durationInFrames: 24, config: { damping: 200, mass: 0.8 } })
  const mapCorner = treatmentSeed(scene.id) % 2 === 0 ? { left: 1080, top: 260, width: 640, height: 400 } : { left: 200, top: 260, width: 640, height: 400 }
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.warmCream, overflow: 'hidden' }}>
      <SceneBackdrop scene={scene} frame={frame} fps={fps} origin={origin} camera="drift" />
      <div style={{ position: 'absolute', left: mapCorner.left, top: mapCorner.top, width: mapCorner.width, height: mapCorner.height, opacity: 0.4 + 0.5 * mapReveal }}>
        <UsMapOutline region={region} accent={accentHex} pulse={pulse} reveal={mapReveal} />
      </div>
      {region && (
        <div
          style={{
            position: 'absolute',
            left: mapCorner.left + (mapCorner.width / 960) * region.x - 90,
            top: mapCorner.top + (mapCorner.height / 600) * region.y + 20,
            width: 180,
            textAlign: 'center',
            opacity: mapReveal,
            fontFamily: FONT_SANS,
            fontSize: 20,
            fontWeight: 700,
            color: accentHex,
          }}
        >
          {region.name}
        </div>
      )}
      {metric && (
        <div
          style={{
            position: 'absolute',
            left: FRAME_PADDING_X,
            bottom: 200,
            opacity: detailReveal || 1,
            transform: `translateY(${interpolate(detailReveal, [0, 1], [12, 0])}px)`,
            // Same fix as the other treatments' own captions — this card
            // previously rendered as bare text directly over the map/hero
            // illustration with no contrast guarantee.
            backgroundColor: 'rgba(248,245,239,0.88)',
            borderRadius: 10,
            padding: '14px 22px',
            boxShadow: '0 4px 16px rgba(41,37,36,0.12)',
          }}
        >
          <div style={{ fontFamily: FONT_SERIF, fontSize: 60, fontWeight: 700, color: accentHex }}>{metric.value}</div>
          <div style={{ fontFamily: FONT_SANS, fontSize: 19, color: COLORS.mutedGray, marginTop: 6 }}>{metric.label}</div>
        </div>
      )}
      {!metric && detailValue && (
        <div
          style={{
            position: 'absolute',
            left: FRAME_PADDING_X,
            bottom: 200,
            opacity: detailReveal,
            transform: `translateY(${interpolate(detailReveal, [0, 1], [12, 0])}px)`,
            backgroundColor: 'rgba(248,245,239,0.88)',
            borderRadius: 10,
            padding: '14px 22px',
            boxShadow: '0 4px 16px rgba(41,37,36,0.12)',
          }}
        >
          <div style={{ fontFamily: FONT_SERIF, fontSize: 54, fontWeight: 700, color: accentHex }}>{detailValue}</div>
          <div style={{ fontFamily: FONT_SANS, fontSize: 19, color: COLORS.mutedGray, marginTop: 6, maxWidth: 420 }}>{value}</div>
        </div>
      )}
      <TextOverlay scene={scene} frame={frame} fps={fps} />
    </AbsoluteFill>
  )
}

// ============================================================
// THE SHOT-LEVEL COMPOSITION MODEL (Luma POC) — for a scene hand-selected
// for this POC (scene.lumaVideoAssetPath set), replaces the single
// backdrop-plus-overlay treatment above with a true cut-to-cut sequence:
// a CINEMATIC shot (the real Luma clip, bounded at exactly its own real
// duration — see shotPlan.ts — never held past its last frame, never
// looped) followed, only when narration time remains, by ONE isolated DATA
// MOMENT (a clean dedicated composition, no footage underneath). Narration
// plays continuously underneath the whole sequence, exactly as it already
// does for every other scene. A scene without a Luma clip never reaches
// this path at all — every existing FLUX-backed treatment above is
// completely untouched.
// ============================================================

// A very small, unobtrusive context label — the ONLY on-screen text a
// cinematic shot is allowed (per the approved rule: no title/metrics/
// bullets/map/Next over real footage).
function CinematicLabel({ label, frame, fps }: { label: string; frame: number; fps: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: 60,
        top: 50,
        ...revealStyle(frame, fps, 0),
        fontFamily: FONT_SANS,
        fontSize: 16,
        fontWeight: 700,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: COLORS.white,
        textShadow: '0 1px 6px rgba(0,0,0,0.5)',
      }}
    >
      {label}
    </div>
  )
}

function CinematicShotInner({ asset, fps, label }: { asset: CinematicAsset; fps: number; label?: string }) {
  const frame = useCurrentFrame()
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.espresso }}>
      <VideoBackdrop asset={asset} frame={frame} fps={fps} camera="zoom-out" />
      {label && <CinematicLabel label={label} frame={frame} fps={fps} />}
    </AbsoluteFill>
  )
}

// ------------------------------------------------------------
// ACCENT SHOTS (generalized, v4) — a SHORT (~1.5-3s, bounded by shotPlan's
// own cap), continuously-animated editorial beat between cinematic shots —
// never a long static-feeling screen. Exactly ONE of these renders per
// accent shot, chosen by cinematicTreatmentForScene — the same
// content-driven classifier every other treatment already uses, so this
// works for ANY week's scenes, not just one hand-picked example. Every
// on-screen figure/phrase is pulled directly from scene.metrics[0],
// scene.bullets[0], or a detected grounded region — never invented, and
// never the full metric/bullet stack (one hero fact only, per the
// approved "cinematic footage carries most of the storytelling" direction).
// ------------------------------------------------------------

function accentHexFor(scene: VideoStoryboardScene): string {
  const accent = accentForSubject(scene.visualPlan?.subject)
  return accent === 'gold' ? COLORS.gold : accent === 'blue' ? COLORS.slateBlue : accent === 'sage' ? COLORS.sage : COLORS.terracotta
}

// DATA_STORY / HERO_METRIC — the single most important grounded figure
// (metrics[0]), never the full metric stack: one hero fact, briefly.
function MetricAccent({ scene, frame, fps }: { scene: VideoStoryboardScene; frame: number; fps: number }) {
  const metric = scene.metrics?.[0]
  if (!metric) return null
  const accentHex = accentHexFor(scene)
  const reveal = spring({ frame, fps, durationInFrames: 22, config: { damping: 14, mass: 0.6 } })
  const pulse = 0.96 + 0.04 * Math.sin(frame / 14)
  return (
    <div style={{ textAlign: 'center', opacity: reveal, transform: `scale(${interpolate(reveal, [0, 1], [0.88, 1]) * pulse})` }}>
      <div style={{ fontFamily: FONT_SERIF, fontSize: 104, fontWeight: 700, color: accentHex, lineHeight: 1 }}>{metric.value}</div>
      <div style={{ fontFamily: FONT_SANS, fontSize: 20, color: COLORS.mutedGray, marginTop: 10 }}>{metric.label}</div>
    </div>
  )
}

// REGIONAL_MAP — the map persists and breathes for the whole accent shot
// (never a static insert); the one grounded figure shown is scene.metrics[0]
// when present, else a dollar figure parsed from whichever bullet actually
// names the detected region — generalized, not tied to any one scene's bullet
// order.
function RegionalAccent({ scene, frame, fps }: { scene: VideoStoryboardScene; frame: number; fps: number }) {
  const region = detectGroundedRegion(scene)
  const accentHex = accentHexFor(scene)
  const reveal = spring({ frame, fps, durationInFrames: 50, config: { damping: 200, mass: 1 } })
  const pulse = 0.5 + 0.5 * Math.sin(frame / 10)
  const metric = scene.metrics?.[0]
  const bulletValue = !metric && region ? scene.bullets?.find((b) => b.includes(region.abbreviation)) : undefined
  const detailValue = bulletValue ? leadingDollarFigure(bulletValue) : undefined
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 420, height: 270, opacity: 0.4 + 0.6 * reveal }}>
        <UsMapOutline region={region} accent={accentHex} pulse={pulse} reveal={reveal} />
      </div>
      {region && (
        <div style={{ ...revealStyle(frame, fps, 8), fontFamily: FONT_SANS, fontSize: 20, fontWeight: 700, color: accentHex }}>{region.name}</div>
      )}
      {metric && (
        <div style={{ ...revealStyle(frame, fps, 14), textAlign: 'center' }}>
          <div style={{ fontFamily: FONT_SERIF, fontSize: 56, fontWeight: 700, color: accentHex, lineHeight: 1 }}>{metric.value}</div>
          <div style={{ fontFamily: FONT_SANS, fontSize: 16, color: COLORS.mutedGray, marginTop: 6 }}>{metric.label}</div>
        </div>
      )}
      {!metric && detailValue && (
        <div style={{ ...revealStyle(frame, fps, 14), textAlign: 'center' }}>
          <div style={{ fontFamily: FONT_SERIF, fontSize: 52, fontWeight: 700, color: accentHex, lineHeight: 1 }}>{detailValue}</div>
          <div style={{ fontFamily: FONT_SANS, fontSize: 16, color: COLORS.mutedGray, marginTop: 6, maxWidth: 360 }}>{bulletValue}</div>
        </div>
      )}
    </div>
  )
}

// TECHNOLOGY / CHALLENGE — the single most important grounded bullet
// (bullets[0]), as a short typed-in caption with a drawing accent rule —
// never the full bullet list, never a card.
function OperationalAccent({ scene, frame, fps }: { scene: VideoStoryboardScene; frame: number; fps: number }) {
  const accentHex = accentHexFor(scene)
  const headline = scene.bullets?.[0] ?? scene.next
  const ruleWidth = interpolate(spring({ frame, fps, durationInFrames: 30, config: { damping: 200, mass: 0.8 } }), [0, 1], [0, 64])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, maxWidth: 820, textAlign: 'center' }}>
      <div style={{ width: ruleWidth, height: 3, backgroundColor: accentHex }} />
      {headline && (
        <div style={{ ...revealStyle(frame, fps, 6), fontFamily: FONT_SERIF, fontSize: 34, fontWeight: 700, color: COLORS.darkCharcoal, lineHeight: 1.2 }}>
          {headline}
        </div>
      )}
    </div>
  )
}

// Fallback for CINEMATIC_ENVIRONMENT (no specific metric/map/bullet to
// isolate) — only ever reached when shotPlan's overflow rule needs
// SOMETHING other than held/looped video to fill leftover time. A quiet,
// continuously-breathing brand moment — scene.title only, never invented
// copy.
function BrandedAccent({ scene, frame, fps }: { scene: VideoStoryboardScene; frame: number; fps: number }) {
  const accentHex = accentHexFor(scene)
  const ruleWidth = interpolate(spring({ frame, fps, durationInFrames: 30, config: { damping: 200, mass: 0.8 } }), [0, 1], [0, 64])
  const breathe = 0.85 + 0.15 * Math.sin(frame / 20)
  return (
    <div style={{ textAlign: 'center', opacity: breathe }}>
      <div style={{ width: ruleWidth, height: 3, backgroundColor: accentHex, margin: '0 auto 14px' }} />
      <div style={{ fontFamily: FONT_SERIF, fontSize: 32, fontWeight: 700, color: COLORS.darkCharcoal }}>{scene.title}</div>
    </div>
  )
}

function AccentShot({ scene, frame, fps }: { scene: VideoStoryboardScene; frame: number; fps: number }) {
  const treatment = cinematicTreatmentForScene(scene)
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 60% 25%, ${COLORS.softSand} 0%, ${COLORS.warmCream} 65%)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {treatment === 'REGIONAL_MAP' && <RegionalAccent scene={scene} frame={frame} fps={fps} />}
      {(treatment === 'DATA_STORY' || treatment === 'HERO_METRIC') && <MetricAccent scene={scene} frame={frame} fps={fps} />}
      {(treatment === 'TECHNOLOGY' || treatment === 'CHALLENGE') && <OperationalAccent scene={scene} frame={frame} fps={fps} />}
      {treatment !== 'REGIONAL_MAP' && treatment !== 'DATA_STORY' && treatment !== 'HERO_METRIC' && treatment !== 'TECHNOLOGY' && treatment !== 'CHALLENGE' && (
        <BrandedAccent scene={scene} frame={frame} fps={fps} />
      )}
    </AbsoluteFill>
  )
}

function AccentShotInner({ scene, fps }: { scene: VideoStoryboardScene; fps: number }) {
  const frame = useCurrentFrame()
  return <AccentShot scene={scene} frame={frame} fps={fps} />
}


function LumaShotSequence({ scene, fps, durationInFrames }: IllustratedStorySceneProps) {
  const shots: Shot[] = useMemo(() => shotPlanForScene(scene, fps, durationInFrames), [scene, fps, durationInFrames])
  let offset = 0
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.espresso }}>
      {shots.map((shot, index) => {
        const from = offset
        offset += shot.durationInFrames
        return (
          <Sequence key={index} from={from} durationInFrames={shot.durationInFrames} layout="none">
            {shot.kind === 'cinematic' ? (
              <CinematicShotInner asset={shot.asset} fps={fps} label={shot.label} />
            ) : (
              <AccentShotInner scene={scene} fps={fps} />
            )}
          </Sequence>
        )
      })}
    </AbsoluteFill>
  )
}

export default function IllustratedStoryScene(props: IllustratedStorySceneProps) {
  if (props.scene.cinematicAssets && props.scene.cinematicAssets.length > 0) {
    return <LumaShotSequence {...props} />
  }
  const treatment = cinematicTreatmentForScene(props.scene)
  if (treatment === 'HERO_METRIC') return <HeroMetricTreatment {...props} />
  if (treatment === 'DATA_STORY') return <DataStoryTreatment {...props} />
  if (treatment === 'CHALLENGE') return <ChallengeTreatment {...props} />
  if (treatment === 'TECHNOLOGY') return <TechnologyTreatment {...props} />
  if (treatment === 'REGIONAL_MAP') return <RegionalMapTreatment {...props} />
  return <CinematicEnvironmentTreatment {...props} />
}
