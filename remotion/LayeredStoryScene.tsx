import { useMemo } from 'react'
import { AbsoluteFill, Img, staticFile } from 'remotion'
import { COLORS, FONT_SANS, FONT_SERIF } from './theme'
import { revealStyle } from './motion'
import { fitFontSize } from './textFit'
import {
  buildProgress,
  chipCountForRelativeHeight,
  chipVisibility,
  computeFlowBeatSchedule,
  computeWaypointArrivals,
  DEFAULT_FLOW_PATH,
  flowBeatAt,
  flowGateGapWidth,
  flowPressureGlow,
  leadingDollarFigure,
  mechanicForEngine,
  roughMagnitude,
  simulateFlowTokens,
  staggeredBuildProgress,
  travelerProgress,
  type FlowTokenFrame,
} from './layeredMechanics'
import type { StoryEngine, VideoStoryboardScene, VisualSubject } from '../src/lib/videoStoryboard'

// THE VISUAL DIRECTOR'S RENDERER — consumes an already-fully-decided scene
// (type/title/metrics/bullets/next/storyEngine/visualPlan/fluxAssetPath —
// every one of these was decided upstream by the content-intelligence
// layer; this component never re-derives what matters, never invents a
// number, and never overrides a title). Its only job is HOW to show that
// already-decided content developing over time, using one of a small,
// reusable set of mechanics keyed by storyEngine — never a bespoke
// per-topic animation. Generalized from (but shares no file with) the
// isolated remotion-prototypes/layered-visual-story/ experiment: only the
// PROVEN IDEAS (a static FLUX plate as ambient backdrop, deterministic
// Remotion motion doing all of the actual storytelling, extremely limited
// on-screen text) were extracted — see layeredMechanics.ts for the
// generalized, subject-agnostic mechanics themselves.
interface LayeredStorySceneProps {
  scene: VideoStoryboardScene
  frame: number
  fps: number
  durationInFrames: number
  engine: StoryEngine
  backgroundColor?: string
  // Forward Look ONLY: the grounded titles of the sibling scenes it draws
  // its priorities from (resolved at render time by ForwardLookScene.tsx via
  // sourceTopicIndexes cross-reference — see forwardLookPriorities.ts).
  // Used as a fallback ONLY when scene.bullets itself is empty, so a
  // business pipeline-story scene with its own real bullets is never
  // affected by this prop.
  priorityLabels?: string[]
}

// WHAT the flow-pressure mechanic's moving tokens look like — a rendering
// choice driven entirely by the already-decided visualPlan.subject (never a
// second content judgment): paper/order documents for a production
// workflow, or a small interface/device glyph for a systems/connection
// failure — "a system visually fails or becomes constrained," per the
// visual-direction brief, rather than the same generic node for any kind
// of friction.
type TokenSkin = 'document' | 'interface' | 'chip'

function skinForSubject(subject: VisualSubject | undefined): TokenSkin {
  if (subject === 'document-workflow') return 'document'
  if (subject === 'systems-connection' || subject === 'blocked-connection') return 'interface'
  return 'chip'
}

const TOKEN_SIZE = 100

// 'interface' is deliberately excluded here — that subject now routes to
// SystemsFrictionComposition instead (see the mechanic dispatch below),
// which never calls FlowToken at all.
function FlowToken({ token, skin }: { token: FlowTokenFrame; skin: Exclude<TokenSkin, 'interface'> }) {
  const dimmed = token.state === 'held'
  const style = {
    position: 'absolute' as const,
    left: token.x - TOKEN_SIZE / 2,
    top: token.y - TOKEN_SIZE / 2,
    transform: `rotate(${token.rotation}deg)`,
    filter: 'drop-shadow(0 8px 12px rgba(41,37,36,0.22))',
    opacity: dimmed ? 0.55 : 1,
  }
  if (skin === 'document') {
    return (
      <svg viewBox="0 0 74 92" width={TOKEN_SIZE} height={(TOKEN_SIZE * 92) / 74} style={style}>
        <path d="M4 4 H54 L70 20 V88 H4 Z" fill={COLORS.warmCream} stroke={COLORS.espresso} strokeWidth={3} strokeLinejoin="round" />
        <path d="M54 4 V20 H70 Z" fill={COLORS.softSand} stroke={COLORS.espresso} strokeWidth={2} strokeLinejoin="round" />
        <rect x={14} y={38} width={40} height={5} rx={2.5} fill={COLORS.mutedGray} />
        <rect x={14} y={50} width={40} height={5} rx={2.5} fill={COLORS.mutedGray} />
        <rect x={14} y={62} width={24} height={5} rx={2.5} fill={COLORS.terracotta} />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 74 74" width={TOKEN_SIZE} height={TOKEN_SIZE} style={style}>
      <rect x={4} y={4} width={66} height={66} rx={14} fill={COLORS.warmCream} stroke={COLORS.darkCharcoal} strokeWidth={4} />
      <rect x={20} y={46} width={34} height={8} rx={4} fill={COLORS.terracotta} />
    </svg>
  )
}

function FlowGate({ x, laneY, gapWidth, pressureGlow }: { x: number; laneY: number; gapWidth: number; pressureGlow: number }) {
  const barHeight = 360
  const barWidth = 30
  return (
    <>
      {[-1, 1].map((side) => (
        <div
          key={side}
          style={{
            position: 'absolute',
            left: x + (side * gapWidth) / 2 + (side === -1 ? -barWidth : 0),
            top: laneY - barHeight / 2,
            width: barWidth,
            height: barHeight,
            background: COLORS.darkCharcoal,
            borderRadius: 6,
          }}
        />
      ))}
      {pressureGlow > 0 && (
        <div
          style={{
            position: 'absolute',
            left: x - 120,
            top: laneY - 120,
            width: 240,
            height: 240,
            borderRadius: '50%',
            border: `4px solid ${COLORS.terracotta}`,
            opacity: pressureGlow * 0.8,
            boxShadow: `0 0 ${28 * pressureGlow}px rgba(183,101,74,0.4)`,
          }}
        />
      )}
    </>
  )
}

// A small "stalled ticket" chip — the backlog building up at the
// checkpoint during the systems-friction composition's accumulate/rework
// beats. Deliberately tiny and undecorated (a plain rounded chip), never
// competing with the two system windows for attention.
function StalledTicketChip({ x, y, opacity }: { x: number; y: number; opacity: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x - 22,
        top: y - 14,
        width: 44,
        height: 28,
        borderRadius: 6,
        background: COLORS.espresso,
        opacity: opacity * 0.85,
        boxShadow: '0 4px 8px rgba(41,37,36,0.2)',
      }}
    />
  )
}

// THE RICHER SYSTEMS-FRICTION COMPOSITION (visual-direction v2) — replaces
// the generic "small icons crossing a dashed line" treatment for the
// systems-connection/blocked-connection subject ONLY (the document-
// workflow subject keeps its own already-approved token-flow-through-gate
// rendering, untouched, below). Reuses the SAME flow-pressure timing
// primitives (flowSchedule/flowBeatAt/flowGateGapWidth/flowPressureGlow —
// nothing new is invented here, only the PRESENTATION): two illustrated
// "system window" objects connected by a route, inside a soft
// environment panel that fills most of the frame. Healthy flow (a
// traveling pulse) gives way to pressure (the route jitters, a glow
// appears at the checkpoint), a visible backlog of stalled tickets
// accumulates, and finally a visible gap breaks the route while the
// downstream window's status goes from healthy (blue) to failed
// (espresso) — "a system visually fails," not a label on a diagram.
function SystemsFrictionComposition({
  frame,
  durationInFrames,
  flowSchedule,
  bullets,
}: {
  frame: number
  durationInFrames: number
  flowSchedule: ReturnType<typeof computeFlowBeatSchedule>
  bullets: string[]
}) {
  const gapWidth = flowGateGapWidth(frame, flowSchedule)
  const pressureGlow = flowPressureGlow(frame, flowSchedule)
  const beat = flowBeatAt(frame, flowSchedule)
  const failed = beat === 'rework' || beat === 'constrained-exit'
  const backlogCount = beat === 'accumulate' || beat === 'rework' || beat === 'constrained-exit' ? 5 : 0

  const panelX = 300
  const panelY = 210
  const panelW = 1500
  const panelH = 660
  const routeY = panelY + panelH / 2 - 30
  const leftX = panelX + 230
  const rightX = panelX + panelW - 230
  const midX = (leftX + rightX) / 2
  const pulseX = leftX + (rightX - leftX) * travelerProgress(frame, durationInFrames)

  // A gentle "camera push" — the whole composition scales 0.97 -> 1.02
  // across the scene's own duration, the one restrained camera-movement
  // touch the visual-direction brief asked for, never a jump/zoom.
  const cameraScale = 0.97 + 0.05 * Math.min(1, frame / durationInFrames)

  const windowW = 300
  const windowH = 200

  function SystemWindow({ x, healthy }: { x: number; healthy: boolean }) {
    return (
      <div style={{ position: 'absolute', left: x - windowW / 2, top: routeY - windowH / 2, width: windowW, height: windowH }}>
        <svg viewBox={`0 0 ${windowW} ${windowH}`} width={windowW} height={windowH}>
          <rect x={4} y={4} width={windowW - 8} height={windowH - 8} rx={10} fill={COLORS.warmCream} stroke={COLORS.espresso} strokeWidth={3} />
          <rect x={4} y={4} width={windowW - 8} height={36} rx={10} fill={COLORS.slateBlue} opacity={0.85} />
          <circle cx={22} cy={22} r={5} fill={COLORS.warmCream} />
          <circle cx={38} cy={22} r={5} fill={COLORS.warmCream} opacity={0.7} />
          <circle cx={54} cy={22} r={5} fill={COLORS.warmCream} opacity={0.5} />
          <rect x={26} y={64} width={windowW - 100} height={10} rx={5} fill={COLORS.mutedGray} />
          <rect x={26} y={90} width={windowW - 160} height={10} rx={5} fill={COLORS.mutedGray} />
          <rect x={26} y={windowH - 56} width={110} height={16} rx={8} fill={healthy ? COLORS.slateBlue : COLORS.espresso} />
        </svg>
        {!healthy && (
          <div
            style={{
              position: 'absolute',
              right: 16,
              top: -16,
              width: 34,
              height: 34,
              borderRadius: '50%',
              background: COLORS.warmCream,
              border: `3px solid ${COLORS.terracotta}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: FONT_SANS,
              fontWeight: 700,
              color: COLORS.terracotta,
              fontSize: 20,
            }}
          >
            !
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ position: 'absolute', inset: 0, transform: `scale(${cameraScale})`, transformOrigin: '50% 55%' }}>
      <div
        style={{
          position: 'absolute',
          left: panelX,
          top: panelY,
          width: panelW,
          height: panelH,
          borderRadius: 28,
          background: `linear-gradient(180deg, rgba(76,107,138,0.10), rgba(76,107,138,0.03))`,
          border: `1px solid rgba(76,107,138,0.18)`,
        }}
      />
      <svg viewBox="0 0 1920 1080" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        <line x1={leftX} y1={routeY} x2={midX - gapWidth / 2} y2={routeY} stroke={failed ? COLORS.espresso : COLORS.slateBlue} strokeWidth={3} strokeDasharray={pressureGlow > 0 ? '8 10' : '0'} opacity={0.6} />
        <line x1={midX + gapWidth / 2} y1={routeY} x2={rightX} y2={routeY} stroke={failed ? COLORS.espresso : COLORS.slateBlue} strokeWidth={3} strokeDasharray={pressureGlow > 0 ? '8 10' : '0'} opacity={0.6} />
      </svg>
      {pressureGlow > 0 && (
        <div
          style={{
            position: 'absolute',
            left: midX - 90,
            top: routeY - 90,
            width: 180,
            height: 180,
            borderRadius: '50%',
            border: `3px solid ${COLORS.terracotta}`,
            opacity: pressureGlow * 0.75,
            boxShadow: `0 0 ${24 * pressureGlow}px rgba(183,101,74,0.35)`,
          }}
        />
      )}
      {!failed && gapWidth > 20 && (
        <div
          style={{
            position: 'absolute',
            left: pulseX - 9,
            top: routeY - 9,
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: COLORS.slateBlue,
            boxShadow: '0 6px 10px rgba(41,37,36,0.25)',
          }}
        />
      )}
      {Array.from({ length: backlogCount }, (_, i) => {
        const opacity = chipVisibility(1, backlogCount, i)
        const row = Math.floor(i / 3)
        const col = i % 3
        return <StalledTicketChip key={i} x={midX - 40 + col * 40} y={routeY + 90 + row * 34} opacity={opacity} />
      })}
      <SystemWindow x={leftX} healthy />
      <SystemWindow x={rightX} healthy={!failed} />
      {bullets[0] && (
        <div style={{ position: 'absolute', left: leftX - 150, top: routeY + windowH / 2 + 20, width: 300, textAlign: 'center' }}>
          <div style={{ fontFamily: FONT_SANS, fontSize: 20, color: COLORS.darkCharcoal, lineHeight: 1.3 }}>{bullets[0]}</div>
        </div>
      )}
      {bullets[1] && (
        <div style={{ position: 'absolute', left: rightX - 150, top: routeY + windowH / 2 + 20, width: 300, textAlign: 'center' }}>
          <div style={{ fontFamily: FONT_SANS, fontSize: 20, color: COLORS.darkCharcoal, lineHeight: 1.3 }}>{bullets[1]}</div>
        </div>
      )}
    </div>
  )
}

// A rising stack of magnitude-free "value chips" — the literal "value
// piling up" visual metaphor (echoing the reference video's own literal
// cash/coin imagery, without copying its artwork): value is shown as a
// stack of overlapping chips that visibly GROWS, not a flat bar that
// merely gets taller. Shared by both accumulation (one hero number, a tall
// stack of `chipCount` chips) and comparison (several numbers, each its
// own shorter/narrower stack sized by chipCountForRelativeHeight) — see
// the mechanic branches below for how each configures it. Paced against
// buildProgress/staggeredBuildProgress (this scene's own duration) rather
// than a fixed internal spring, so the build always finishes with time to
// spare before the scene ends regardless of how long narration made this
// scene run.
function ValueChipStack({
  progress,
  x,
  baseY,
  chipCount,
  chipWidth,
  chipHeight,
  overlap,
}: {
  progress: number
  x: number
  baseY: number
  chipCount: number
  chipWidth: number
  chipHeight: number
  overlap: number
}) {
  return (
    <>
      {Array.from({ length: chipCount }, (_, i) => {
        const chipProgress = chipVisibility(progress, chipCount, i)
        if (chipProgress <= 0) return null
        const y = baseY - i * overlap - chipHeight + (1 - chipProgress) * 26
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: x - chipWidth / 2,
              top: y,
              width: chipWidth,
              height: chipHeight,
              borderRadius: chipHeight / 2,
              background: `linear-gradient(180deg, ${COLORS.terracotta}, ${COLORS.espresso})`,
              opacity: chipProgress,
              boxShadow: '0 8px 14px rgba(41,37,36,0.2)',
            }}
          />
        )
      })}
    </>
  )
}

export default function LayeredStoryScene({
  scene,
  frame,
  fps,
  durationInFrames,
  engine,
  backgroundColor = COLORS.warmCream,
  priorityLabels,
}: LayeredStorySceneProps) {
  void fps
  const mechanic = mechanicForEngine(engine, scene.metrics?.length ?? 0)
  const skin = skinForSubject(scene.visualPlan?.subject)

  const flowSchedule = useMemo(() => (mechanic === 'flow-pressure' ? computeFlowBeatSchedule(durationInFrames) : []), [mechanic, durationInFrames])
  const flowFrames = useMemo(() => (mechanic === 'flow-pressure' ? simulateFlowTokens(durationInFrames, DEFAULT_FLOW_PATH) : []), [mechanic, durationInFrames])

  const titleFontSize = fitFontSize(scene.title, { maxFontSize: 52, minFontSize: 34, idealLength: 30 })

  const textOverlay = (
    <div style={{ position: 'absolute', left: 90, top: 80, maxWidth: 900 }}>
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
  )

  let foreground: React.ReactNode = null

  if (mechanic === 'accumulation') {
  const progress = buildProgress(frame, durationInFrames)
  const metric = scene.metrics?.[0]
  const revealAt = Math.max(20, Math.round(durationInFrames * 0.62))

  foreground = (
    <>
      <ValueChipStack
        progress={progress}
        x={1390}
        baseY={960}
        chipCount={7}
        chipWidth={340}
        chipHeight={80}
        overlap={54}
      />

      {metric && (
        <div
          style={{
            position: 'absolute',
            left: 90,
            top: 420,
            width: 850,
            maxWidth: 850,
            ...revealStyle(frame, fps, revealAt),
          }}
        >
          <div
            style={{
              fontFamily: FONT_SERIF,
              fontSize: fitFontSize(metric.value, {
                maxFontSize: 112,
                minFontSize: 56,
                idealLength: 5,
              }),
              fontWeight: 700,
              color: COLORS.terracotta,
              lineHeight: 1.1,
              overflowWrap: 'anywhere',
            }}
          >
            {metric.value}
          </div>

          <div
            style={{
              fontFamily: FONT_SANS,
              fontSize: 26,
              color: COLORS.mutedGray,
              marginTop: 18,
              lineHeight: 1.35,
              maxWidth: 800,
              overflowWrap: 'break-word',
            }}
          >
            {metric.label}
          </div>
        </div>
      )}
    </>
  )
  } else if (mechanic === 'comparison') {
    const metrics = (scene.metrics ?? []).slice(0, 3)
    const magnitudes = metrics.map((m) => roughMagnitude(m.value))
    const allParsed = magnitudes.every((m) => m !== null)
    const maxMagnitude = allParsed ? Math.max(...(magnitudes as number[])) : 1
    // A fixed gap between stack CENTERS (never an edge-to-edge span, which
    // would push exactly two stacks out to the far corners) — centered
    // right-of-middle, in the same large area the other two mechanics use.
    const stackGap = 340
    const centerX = 1180
    const baseY = 940
    const maxChipCount = 6
    const chipHeight = 100
    const overlap = 92
    const chipWidth = 240
    foreground = (
      <>
        {metrics.map((metric, index) => {
          const progress = staggeredBuildProgress(frame, durationInFrames, index, metrics.length)
          const relativeHeight = allParsed && maxMagnitude > 0 ? Math.max(0.3, (magnitudes[index] as number) / maxMagnitude) : 0.75
          const chipCount = chipCountForRelativeHeight(relativeHeight, maxChipCount)
          const totalWidth = (metrics.length - 1) * stackGap
          const x = centerX - totalWidth / 2 + index * stackGap
          const revealAt = Math.max(20, Math.round(durationInFrames * 0.62)) + index * 6
          return (
            <div key={index}>
              <ValueChipStack progress={progress} x={x} baseY={baseY} chipCount={chipCount} chipWidth={chipWidth} chipHeight={chipHeight} overlap={overlap} />
              <div style={{ position: 'absolute', left: x - 150, top: baseY + 30, width: 300, textAlign: 'center', ...revealStyle(frame, fps, revealAt) }}>
                <div style={{ fontFamily: FONT_SERIF, fontSize: 56, fontWeight: 700, color: COLORS.terracotta }}>{metric.value}</div>
                <div style={{ fontFamily: FONT_SANS, fontSize: 19, color: COLORS.mutedGray, marginTop: 6 }}>{metric.label}</div>
              </div>
            </div>
          )
        })}
      </>
    )
  } else if (mechanic === 'flow-pressure' && skin === 'interface') {
    // The richer, illustrated systems-friction composition (visual-
    // direction v2) — see SystemsFrictionComposition's own header for why
    // this is a PRESENTATION change only, reusing the same flow-pressure
    // timing as the document-workflow path below.
    foreground = <SystemsFrictionComposition frame={frame} durationInFrames={durationInFrames} flowSchedule={flowSchedule} bullets={scene.bullets ?? []} />
  } else if (mechanic === 'flow-pressure' && skin !== 'interface') {
    const beat = flowBeatAt(frame, flowSchedule)
    void beat
    const gapWidth = flowGateGapWidth(frame, flowSchedule)
    const pressureGlow = flowPressureGlow(frame, flowSchedule)
    const tokens = flowFrames[Math.min(frame, flowFrames.length - 1)] ?? []
    foreground = (
      <>
        <svg viewBox="0 0 1920 1080" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
          <line
            x1={DEFAULT_FLOW_PATH.startX}
            y1={DEFAULT_FLOW_PATH.laneY}
            x2={DEFAULT_FLOW_PATH.endX}
            y2={DEFAULT_FLOW_PATH.laneY}
            stroke={COLORS.mutedGray}
            strokeWidth={2}
            strokeDasharray="10 12"
            opacity={0.4}
          />
        </svg>
        <FlowGate x={DEFAULT_FLOW_PATH.checkpointX} laneY={DEFAULT_FLOW_PATH.laneY} gapWidth={gapWidth} pressureGlow={pressureGlow} />
        {tokens.map((token) => (
          <FlowToken key={token.id} token={token} skin={skin} />
        ))}
        {scene.next && (
          <div style={{ position: 'absolute', left: 90, bottom: 90, ...revealStyle(frame, fps, Math.round(durationInFrames * 0.7)) }}>
            <div style={{ fontFamily: FONT_SANS, fontSize: 14, fontWeight: 700, color: COLORS.terracotta, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Next
            </div>
            <div style={{ fontFamily: FONT_SANS, fontSize: 24, color: COLORS.darkCharcoal, marginTop: 4, maxWidth: 700 }}>{scene.next}</div>
          </div>
        )}
      </>
    )
  } else {
    // progression — pipeline-story business scenes AND forward-look. A
    // business scene's own scene.bullets (grounded, from content-
    // intelligence) always wins; priorityLabels is a Forward-Look-only,
    // render-time fallback (see forwardLookPriorities.ts) for the one case
    // where the AI's own bullets array is empty and the scene would
    // otherwise show unlabeled waypoints.
    const labels = (scene.bullets?.length ? scene.bullets : (priorityLabels ?? [])).slice(0, 4)
    // With 3+ labels, alternate each one above/below the path — otherwise
    // closely-spaced waypoints (a 4-priority Forward Look, or a future
    // richer pipeline scene) would crowd the same horizontal band and
    // their text would collide.
    const zigzag = labels.length > 2
    const waypointCount = Math.max(2, labels.length || 3)
    const arrivals = computeWaypointArrivals(frame, durationInFrames, waypointCount)
    const traveler = travelerProgress(frame, durationInFrames)
    const pathStartX = 300
    const pathEndX = 1720
    const laneY = 610
    // A gentle upward arc (not a flat line) — uses more of the frame's
    // vertical space and reads as "ascending toward a destination," never
    // merely a horizontal timeline.
    const laneYAt = (x: number) => laneY - 160 * Math.pow((x - pathStartX) / (pathEndX - pathStartX), 1.4)
    const traverX = pathStartX + (pathEndX - pathStartX) * traveler
    const traverY = laneYAt(traverX)
    const waypointDiameter = 116
    foreground = (
      <>
        <svg viewBox="0 0 1920 1080" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
          <path
            d={`M ${pathStartX} ${laneY} Q ${(pathStartX + pathEndX) / 2} ${laneYAt((pathStartX + pathEndX) / 2)} ${pathEndX} ${laneYAt(pathEndX)}`}
            stroke={COLORS.mutedGray}
            strokeWidth={3}
            strokeDasharray="12 14"
            opacity={0.45}
            fill="none"
          />
        </svg>
        {arrivals.map((arrival, index) => {
          const x = pathStartX + ((pathEndX - pathStartX) * (index + 1)) / (waypointCount + 1)
          const y = laneYAt(x)
          const isLast = index === arrivals.length - 1
          const scale = 0.6 + arrival * 0.4
          const label = labels[index]
          // A grounded dollar figure pulled straight out of this label (if
          // it has one) gets its own small emphasized badge right at the
          // waypoint — "a meaningful business scale," never an invented
          // number — while the full label still renders below/above as
          // usual. A label with no dollar figure renders exactly as before.
          const valueBadge = label ? leadingDollarFigure(label) : null
          const labelAbove = zigzag && index % 2 === 1
          return (
            <div key={index}>
              {isLast && (
                <div
                  style={{
                    position: 'absolute',
                    left: x - 170,
                    top: y - 170,
                    width: 340,
                    height: 340,
                    borderRadius: '50%',
                    background: `radial-gradient(circle, rgba(183,101,74,0.16), rgba(183,101,74,0))`,
                    opacity: arrival,
                  }}
                />
              )}
              <div
                style={{
                  position: 'absolute',
                  left: x - waypointDiameter / 2,
                  top: y - waypointDiameter / 2,
                  width: waypointDiameter,
                  height: waypointDiameter,
                  borderRadius: '50%',
                  background: COLORS.warmCream,
                  border: `6px solid ${arrival > 0.05 ? COLORS.terracotta : COLORS.softSand}`,
                  opacity: 0.55 + arrival * 0.45,
                  boxShadow: arrival > 0.4 ? '0 10px 18px rgba(41,37,36,0.18)' : 'none',
                  transform: `scale(${scale})`,
                }}
              />
              {valueBadge && (
                <div
                  style={{
                    position: 'absolute',
                    left: x - 90,
                    top: y - waypointDiameter / 2 - 46,
                    width: 180,
                    textAlign: 'center',
                    opacity: arrival,
                    fontFamily: FONT_SERIF,
                    fontSize: 30,
                    fontWeight: 700,
                    color: COLORS.terracotta,
                  }}
                >
                  {valueBadge}
                </div>
              )}
              {label && (
                <div
                  style={{
                    position: 'absolute',
                    left: x - 170,
                    top: labelAbove ? y - 230 : y + 90,
                    width: 340,
                    textAlign: 'center',
                    opacity: arrival,
                  }}
                >
                  <div style={{ fontFamily: FONT_SANS, fontSize: zigzag ? 26 : 28, color: COLORS.darkCharcoal, lineHeight: 1.3 }}>{label}</div>
                </div>
              )}
            </div>
          )
        })}
        <div
          style={{
            position: 'absolute',
            left: traverX - 30,
            top: traverY - 30,
            width: 60,
            height: 60,
            borderRadius: '50%',
            background: COLORS.terracotta,
            boxShadow: '0 10px 16px rgba(41,37,36,0.28)',
          }}
        />
      </>
    )
  }

  return (
    <AbsoluteFill style={{ backgroundColor, overflow: 'hidden' }}>
      {scene.fluxAssetPath ? (
        <>
          <AbsoluteFill style={revealStyle(frame, fps, 0)}>
            <Img src={staticFile(scene.fluxAssetPath)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </AbsoluteFill>
          <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg, rgba(248,245,239,0.3) 0%, rgba(248,245,239,0.05) 30%, rgba(248,245,239,0.2) 100%)` }} />
        </>
      ) : (
        <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg, ${COLORS.warmCream}, ${COLORS.softSand})` }} />
      )}
      {foreground}
      {textOverlay}
    </AbsoluteFill>
  )
}
