import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { COLORS, FONT_SANS, FONT_SERIF, FRAME_PADDING_X, FRAME_PADDING_Y } from '../theme'
import { revealStyle, growWidthStyle, STAGGER_FRAMES } from '../motion'
import { fitListFontSize } from '../textFit'
import SceneHeader from '../SceneHeader'
import StoryScene from '../StoryScene'
import DecorationColumn from '../visuals/DecorationColumn'
import { forwardLookPriorityLabels } from '../forwardLookPriorities'
import { computeWaypointArrivals } from '../layeredMechanics'
import { storyHeroAssets } from '../visualStorySpec'
import { accentHex } from '../illustratedObjects'
import type { SceneRenderProps } from '../sceneProps'

// THE VISUAL FINALE (visual-direction v3) — reuses the SAME hero
// illustrations (storyHeroAssets — never a new FLUX generation) the
// week's own business scenes already used, and visually converges them
// toward a single destination glow as the grounded next-priority labels
// settle in beside each one: "these are the threads from this week, and
// this is where they go next." Falls back to the previous progression-
// diagram treatment (via StoryScene/LayeredStoryScene) only when no hero
// illustrations exist yet this week (generation unavailable).
function VisualFinale({ scene, storyboard, frame, fps, durationInFrames }: { scene: SceneRenderProps['scene']; storyboard: SceneRenderProps['storyboard']; frame: number; fps: number; durationInFrames: number }) {
  const heroAssets = storyHeroAssets(storyboard)
  const labels = forwardLookPriorityLabels(scene, storyboard)
  const arrivals = computeWaypointArrivals(frame, durationInFrames, heroAssets.length)
  // y nudged up from the original 880 to 760 — now that every scene gets a
  // global lower-third caption (see WfgExecutiveVideo.tsx's CaptionLayer),
  // the converging thumbnails must stay clear of that band (~y 940+)
  // rather than drifting into it.
  const destination = { x: 1650, y: 760 }
  // 5 distinct starting points — one per topic scene once every topic has
  // its own fluxHeroAssetPath (previously only 4 were ever populated at
  // once, so the 5th wrapped via index % starts.length and silently
  // overlapped the 1st for the entire animation).
  const starts = [
    { x: 300, y: 300 },
    { x: 650, y: 230 },
    { x: 1000, y: 300 },
    { x: 1300, y: 230 },
    { x: 1550, y: 420 },
  ]
  const maxArrival = arrivals.length > 0 ? Math.max(...arrivals) : 0

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.warmCream, overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          left: destination.x - 220,
          top: destination.y - 220,
          width: 440,
          height: 440,
          borderRadius: '50%',
          background: `radial-gradient(circle, rgba(183,101,74,${0.22 * maxArrival}), rgba(183,101,74,0) 70%)`,
        }}
      />
      {heroAssets.map((asset, index) => {
        const arrival = arrivals[index] ?? 1
        const start = starts[index % starts.length]
        const x = start.x + (destination.x - start.x) * arrival
        const y = start.y + (destination.y - start.y) * arrival
        const size = 170 - 60 * arrival
        const label = labels[index]
        return (
          <div key={asset.subject}>
            <div
              style={{
                position: 'absolute',
                left: x - size / 2,
                top: y - size / 2,
                width: size,
                height: size,
                borderRadius: '50%',
                overflow: 'hidden',
                border: `3px solid ${accentHex(asset.accent)}`,
                opacity: 0.5 + arrival * 0.5,
              }}
            >
              <Img src={staticFile(asset.heroAssetPath)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
            {label && (
              <div
                style={{
                  position: 'absolute',
                  left: start.x - 150,
                  top: start.y + 100,
                  width: 300,
                  textAlign: 'center',
                  // A bell curve, not a one-way fade-in: each label is only
                  // legible while its OWN thumbnail is still near its own
                  // starting position (correctly paired, per-priority), and
                  // fades back out well before every thumbnail converges on
                  // the same destination point — otherwise all four labels
                  // would stack unreadably on top of one another right at
                  // the end.
                  opacity: interpolate(arrival, [0, 0.3, 0.55, 0.75], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
                }}
              >
                <div style={{ fontFamily: FONT_SANS, fontSize: 21, color: COLORS.darkCharcoal, lineHeight: 1.3 }}>{label}</div>
              </div>
            )}
          </div>
        )
      })}
      <div style={{ position: 'absolute', left: 90, top: 80, maxWidth: 900 }}>
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
          {scene.eyebrow ?? 'Next Priorities'}
        </div>
        <div style={{ ...revealStyle(frame, fps, 6), fontFamily: FONT_SERIF, fontSize: 46, fontWeight: 700, color: COLORS.darkCharcoal, lineHeight: 1.15 }}>{scene.title}</div>
      </div>
    </AbsoluteFill>
  )
}

// "Next" / upcoming priorities — visually signals the transition from
// this week's results to what happens next via a growing horizontal rule
// under the header (echoing the opening/closing scenes' own rule motif,
// tying the whole video together), followed by a staged checklist-style
// reveal of the consolidated forward actions.
export default function ForwardLookScene({ scene, storyboard, durationInFrames }: SceneRenderProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  if (storyHeroAssets(storyboard).length > 0) {
    return <VisualFinale scene={scene} storyboard={storyboard} frame={frame} fps={fps} durationInFrames={durationInFrames} />
  }

  // scene.bullets is often empty for an AI-generated Forward Look (the
  // model writes one combined "next" sentence instead of a bullet per
  // priority) — priorityLabels is the render-time fallback that makes the
  // progression mechanic's waypoints legible even then, using titles that
  // already exist elsewhere in this same storyboard (see
  // forwardLookPriorities.ts). LayeredStoryScene only ever uses this when
  // scene.bullets itself is empty.
  if (scene.visualPlan) {
    return <StoryScene scene={scene} frame={frame} fps={fps} durationInFrames={durationInFrames} backgroundColor={COLORS.warmCream} priorityLabels={forwardLookPriorityLabels(scene, storyboard)} />
  }

  const bullets = scene.bullets ?? (scene.next ? [scene.next] : [])

  const bulletFontSize = fitListFontSize(bullets, { maxFontSize: 32, minFontSize: 22, idealTotalLength: 220 })

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.warmCream, padding: `${FRAME_PADDING_Y}px ${FRAME_PADDING_X}px`, display: 'flex', flexDirection: 'row', gap: 48 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <SceneHeader eyebrow={scene.eyebrow ?? 'Forward Look'} title={scene.title} frame={frame} fps={fps} />
        <div style={{ ...growWidthStyle(frame, fps, 26), height: 2, backgroundColor: COLORS.terracotta, marginBottom: 36, maxWidth: 1300 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {bullets.map((bullet, index) => (
            <div key={index} style={{ ...revealStyle(frame, fps, 34 + index * STAGGER_FRAMES), display: 'flex', gap: 20, alignItems: 'flex-start' }}>
              <div
                style={{
                  fontFamily: FONT_SANS,
                  fontSize: 20,
                  fontWeight: 700,
                  color: COLORS.white,
                  backgroundColor: COLORS.terracotta,
                  borderRadius: '50%',
                  width: 34,
                  height: 34,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {index + 1}
              </div>
              <div style={{ fontFamily: FONT_SANS, fontSize: bulletFontSize, color: COLORS.darkCharcoal, lineHeight: 1.4, maxWidth: 1250, paddingTop: 3 }}>
                {bullet}
              </div>
            </div>
          ))}
        </div>
      </div>
      <DecorationColumn concept={scene.visualConcept} frame={frame} fps={fps} itemCount={bullets.length} />
    </AbsoluteFill>
  )
}
