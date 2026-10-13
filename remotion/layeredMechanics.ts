import type { StoryEngine } from '../src/lib/videoStoryboard'

// The REUSABLE VISUAL MECHANICS layer — pure, deterministic functions of
// (frame, durationInFrames) only. Nothing here reads scene.title/body/
// bullets/metrics/next, and nothing here is specific to any business
// topic — this is the generalized, production version of the idea proven
// in remotion-prototypes/layered-visual-story/storyMechanics.ts. A scene's
// CONTENT (what matters, what the exact grounded numbers are) is decided
// entirely upstream, by the content-intelligence layer
// (src/lib/videoStoryboard.ts / api/video/generate-storyboard.ts); this
// file only ever answers "how should motion progress over this scene's
// own duration," never "what is this scene about."
//
// Exactly three mechanics exist today, one per existing story engine (see
// mechanicForEngine below) — metric-story is further split into
// accumulation (one hero number) vs. comparison (several numbers) based on
// the scene's own metrics COUNT, a structural fact, never a second content
// judgment. A fourth, neutral "no mechanic" path (a scene with no
// storyEngine at all) is handled entirely OUTSIDE this file, by
// StoryScene.tsx's existing, untouched illustration/text fallback.

export type LayeredMechanic = 'accumulation' | 'comparison' | 'flow-pressure' | 'progression'

export function mechanicForEngine(engine: StoryEngine, metricsCount: number): LayeredMechanic {
  if (engine === 'metric-story') return metricsCount >= 2 ? 'comparison' : 'accumulation'
  if (engine === 'bottleneck-story') return 'flow-pressure'
  return 'progression' // pipeline-story (and forward-look, which the renderer treats as pipeline-shaped — see StoryScene.tsx's own comment)
}

// ============================================================
// ACCUMULATION / COMPARISON — a value (or several) visibly BUILDS during
// the scene, reaching its full, final state well before the scene ends so
// the exact grounded number (rendered separately, by Remotion text — see
// LayeredStoryScene.tsx) has time to read clearly once the visual settles.
// The build itself carries NO number/label of its own — a magnitude-free
// visual metaphor, never an invented intermediate value presented as data.
// ============================================================

export function buildProgress(frame: number, durationInFrames: number): number {
  const buildEndFrame = Math.max(20, Math.round(durationInFrames * 0.62))
  const t = Math.max(0, Math.min(1, frame / buildEndFrame))
  return 1 - Math.pow(1 - t, 2) // ease-out — settles, never overshoots
}

// A small, fixed per-instance stagger so a comparison's several bars/stacks
// don't all move in perfect lockstep (reads as more considered, less like
// one bar chart tweening) while still all finishing together.
export function staggeredBuildProgress(frame: number, durationInFrames: number, index: number, count: number): number {
  const staggerFrames = count > 1 ? 6 * index : 0
  return buildProgress(Math.max(0, frame - staggerFrames), durationInFrames)
}

// Rough, VISUAL-ONLY relative magnitude for a metric value string (e.g.
// "$2.93M" -> a big number, "92%" -> a mid number) — used ONLY to scale a
// bar/stack's height in a comparison; never rendered, never presented as a
// number itself. Returns null when the value can't be parsed as a rough
// magnitude at all (e.g. "3.5 days"), in which case the caller falls back
// to equal heights — a safe default that never implies an invented
// comparison.
export function roughMagnitude(value: string): number | null {
  const match = value.match(/([\d.]+)\s*([KkMmBb%])?/)
  if (!match) return null
  const num = parseFloat(match[1])
  if (Number.isNaN(num)) return null
  const suffix = match[2]?.toLowerCase()
  if (suffix === 'k') return num * 1_000
  if (suffix === 'm') return num * 1_000_000
  if (suffix === 'b') return num * 1_000_000_000
  return num
}

// ============================================================
// VALUE CHIP STACK — the literal "value piling up" visual metaphor shared
// by both accumulation (one hero number) and comparison (several numbers):
// a stack of overlapping chips growing in COUNT as the scene builds, and —
// for comparison specifically — a SHORTER relative magnitude means visibly
// FEWER chips, not merely a shorter solid bar. Kept here (pure, tested with
// real execution) rather than inline in LayeredStoryScene.tsx's JSX, same
// convention as buildProgress/staggeredBuildProgress above.
// ============================================================

// How much of chip `index` (0-based, bottom of the stack first) is visible
// at this build `progress` (0-1) out of `chipCount` total chips — 0 before
// its turn, 1 once fully settled, and a smooth partial value while it is
// the "next chip" currently animating in.
export function chipVisibility(progress: number, chipCount: number, index: number): number {
  const visibleChips = Math.max(0, Math.min(1, progress)) * chipCount
  return Math.max(0, Math.min(1, visibleChips - index))
}

// How many chips a comparison bar's stack should target, given its value's
// relative magnitude (0-1, already normalized against the largest metric in
// the same scene) — always at least 2 (a stack of exactly one chip reads as
// "a box," not "value accumulating"), scaled up to maxChips for the largest
// value.
export function chipCountForRelativeHeight(relativeHeight: number, maxChips: number): number {
  const clamped = Math.max(0, Math.min(1, relativeHeight))
  return Math.max(2, Math.round(maxChips * clamped))
}

// ============================================================
// GROUNDED VALUE CALLOUT — pulls the first dollar figure straight out of an
// already-grounded label/bullet string (e.g. "$18M TN deal secured" ->
// "$18M", "New agent placing $20M+ in orders" -> "$20M+") so a progression
// waypoint can give it its own small emphasized badge, echoing "a
// meaningful business scale" without ever inventing a number: this only
// ever surfaces a substring that was already present in the grounded text
// passed in, never a computed or estimated figure. Returns null when the
// label contains no dollar figure at all — the caller then renders the
// label exactly as before, unchanged.
// ============================================================

export function leadingDollarFigure(label: string): string | null {
  const match = label.match(/\$[\d,.]+\s*[KkMmBb]?\+?/)
  return match ? match[0].trim() : null
}

// ============================================================
// FLOW / PRESSURE / ACCUMULATE / (REWORK) / CONSTRAINED-EXIT — ported and
// generalized from the isolated prototype's own storyMechanics.ts. Every
// pixel position below is tuned for the fixed 1920x1080 production frame
// (this is production code, not a subject-agnostic library meant to run
// at other resolutions); every TIMING value is instead derived
// proportionally from whatever durationInFrames the scene actually has
// (itself driven by real synthesized narration length), so a short scene
// and a long scene both play the full beat progression, just at different
// paces. The "rework" beat (an object visibly diverting for a beat before
// rejoining) is included only when the scene has enough time to let it
// read clearly, never rushed into illegibility.
// ============================================================

export type FlowBeat = 'flow' | 'pressure' | 'accumulate' | 'rework' | 'constrained-exit'

export interface FlowBeatRange {
  beat: FlowBeat
  startFrame: number
  endFrame: number
}

const MIN_FRAMES_FOR_REWORK_BEAT = 150 // 5s @ 30fps

export function computeFlowBeatSchedule(durationInFrames: number): FlowBeatRange[] {
  const includeRework = durationInFrames >= MIN_FRAMES_FOR_REWORK_BEAT
  const weights: Array<[FlowBeat, number]> = includeRework
    ? [
        ['flow', 0.22],
        ['pressure', 0.22],
        ['accumulate', 0.2],
        ['rework', 0.16],
        ['constrained-exit', 0.2],
      ]
    : [
        ['flow', 0.3],
        ['pressure', 0.25],
        ['accumulate', 0.25],
        ['constrained-exit', 0.2],
      ]

  const schedule: FlowBeatRange[] = []
  let cursor = 0
  for (const [beat, weight] of weights) {
    const length = Math.max(6, Math.round(durationInFrames * weight))
    schedule.push({ beat, startFrame: cursor, endFrame: cursor + length })
    cursor += length
  }
  return schedule
}

export function flowBeatAt(frame: number, schedule: FlowBeatRange[]): FlowBeat {
  for (const range of schedule) {
    if (frame >= range.startFrame && frame < range.endFrame) return range.beat
  }
  return schedule[schedule.length - 1]?.beat ?? 'flow'
}

export interface FlowPathConfig {
  startX: number
  checkpointX: number
  endX: number
  laneY: number
  reworkWaypointX: number
  reworkLaneOffsetY: number
}

export const DEFAULT_FLOW_PATH: FlowPathConfig = {
  startX: 300,
  checkpointX: 960,
  endX: 1650,
  laneY: 660,
  reworkWaypointX: 620,
  reworkLaneOffsetY: 150,
}

export type FlowTokenState = 'moving' | 'reworking' | 'held' | 'exited'

export interface FlowTokenFrame {
  id: number
  x: number
  y: number
  rotation: number
  state: FlowTokenState
}

interface FlowTokenSim {
  id: number
  x: number
  y: number
  state: FlowTokenState
  reworkStartFrame: number | null
  reworkStartX: number
  reworkStartY: number
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function pointAlongArc(t: number, from: { x: number; y: number }, to: { x: number; y: number }, bow: number): { x: number; y: number } {
  const clamped = Math.max(0, Math.min(1, t))
  const midX = lerp(from.x, to.x, 0.5)
  const midY = lerp(from.y, to.y, 0.5) - bow
  const x = (1 - clamped) * (1 - clamped) * from.x + 2 * (1 - clamped) * clamped * midX + clamped * clamped * to.x
  const y = (1 - clamped) * (1 - clamped) * from.y + 2 * (1 - clamped) * clamped * midY + clamped * clamped * to.y
  return { x, y }
}

// Runs the whole simulation once and returns every frame's token states —
// deterministic and pure, exactly like the prototype's own
// simulateStoryObjects. Callers (LayeredStoryScene.tsx) memoize this per
// scene so it only ever runs once per render, not once per frame.
export function simulateFlowTokens(durationInFrames: number, path: FlowPathConfig = DEFAULT_FLOW_PATH): FlowTokenFrame[][] {
  const schedule = computeFlowBeatSchedule(durationInFrames)
  const reworkRange = schedule.find((r) => r.beat === 'rework')

  // Speed/zone constants scaled so the first spawned tokens clearly clear
  // the checkpoint during "flow" (a real pacing bug caught and fixed in
  // the isolated prototype's own QA — see that experiment's final report).
  const baseSpeed = 14
  const pressureSpeed = 1.6
  const accumulateSpeed = 0.6
  const slowZonePx = 260
  const queueZonePx = 340
  const constrainedPreSpeed = 0.15
  const constrainedPostSpeed = 1.2
  const spawnIntervalFrames = Math.max(10, Math.round(durationInFrames / 14))
  const spawnEndFrame = Math.round(durationInFrames * 0.55)
  const reworkTokenCount = 3

  const tokens: FlowTokenSim[] = []
  let nextId = 0
  const framesOut: FlowTokenFrame[][] = []
  let reworkAssigned = false

  for (let frame = 0; frame < durationInFrames; frame++) {
    const beat = flowBeatAt(frame, schedule)

    if (frame <= spawnEndFrame && frame % spawnIntervalFrames === 0) {
      tokens.push({ id: nextId++, x: path.startX, y: path.laneY, state: 'moving', reworkStartFrame: null, reworkStartX: 0, reworkStartY: 0 })
    }

    if (!reworkAssigned && reworkRange && frame === reworkRange.startFrame) {
      reworkAssigned = true
      const candidates = tokens.filter((t) => t.state === 'moving' && path.checkpointX - t.x <= queueZonePx && t.x < path.checkpointX)
      for (const token of candidates.slice(0, reworkTokenCount)) {
        token.state = 'reworking'
        token.reworkStartFrame = frame
        token.reworkStartX = token.x
        token.reworkStartY = token.y
      }
    }

    for (const token of tokens) {
      if (token.state === 'reworking' && token.reworkStartFrame !== null && reworkRange) {
        const beatLength = reworkRange.endFrame - reworkRange.startFrame
        const arcT = (frame - token.reworkStartFrame) / (beatLength * 0.7)
        if (arcT >= 1) {
          token.state = 'held'
          token.x = path.reworkWaypointX
          token.y = path.laneY + path.reworkLaneOffsetY
        } else {
          const point = pointAlongArc(arcT, { x: token.reworkStartX, y: token.reworkStartY }, { x: path.reworkWaypointX, y: path.laneY + path.reworkLaneOffsetY }, 140)
          token.x = point.x
          token.y = point.y
        }
        continue
      }

      if (token.state !== 'moving') continue

      const distanceToCheckpoint = path.checkpointX - token.x
      const beforeCheckpoint = distanceToCheckpoint > 0
      const inSlowZone = beforeCheckpoint && distanceToCheckpoint <= slowZonePx

      let speed: number
      if (beat === 'flow') {
        speed = baseSpeed
      } else if (beat === 'pressure') {
        speed = inSlowZone ? pressureSpeed : baseSpeed
      } else if (beat === 'accumulate' || beat === 'rework') {
        speed = inSlowZone ? accumulateSpeed : baseSpeed
      } else {
        speed = beforeCheckpoint ? constrainedPreSpeed : constrainedPostSpeed
      }

      token.x = Math.min(path.endX, token.x + speed)
      if (token.x >= path.endX) token.state = 'exited'
    }

    framesOut.push(
      tokens
        .filter((t) => t.state !== 'exited' || t.x < path.endX + 40)
        .map((t) => ({
          id: t.id,
          x: t.x,
          y: t.y,
          rotation: t.state === 'reworking' ? -8 : t.state === 'held' ? -4 : 0,
          state: t.state,
        })),
    )
  }

  return framesOut
}

// The checkpoint gate's gap width (px) — the ONE visual whose sole job is
// "delivery is now constrained," independent of any token's own position.
export function flowGateGapWidth(frame: number, schedule: FlowBeatRange[]): number {
  const exitRange = schedule.find((r) => r.beat === 'constrained-exit')
  if (!exitRange) return 130
  const t = Math.max(0, Math.min(1, (frame - exitRange.startFrame) / (exitRange.endFrame - exitRange.startFrame)))
  return Math.max(28, 130 - t * 102)
}

export function flowPressureGlow(frame: number, schedule: FlowBeatRange[]): number {
  const pressureRange = schedule.find((r) => r.beat === 'pressure')
  if (!pressureRange || frame < pressureRange.startFrame) return 0
  return Math.min(1, (frame - pressureRange.startFrame) / 20) * (0.85 + 0.15 * Math.sin(frame / 9))
}

// ============================================================
// PROGRESSION — staged opportunities/priorities advancing toward a
// destination, arriving at 2-4 waypoints in sequence over the scene.
// Used for pipeline-story business scenes AND forward-look (which the
// renderer treats as pipeline-shaped regardless of storyEngine — see
// StoryScene.tsx's own comment on why).
// ============================================================

// Per-waypoint arrival progress (0-1 each), staggered evenly across ~80%
// of the scene so the FINAL waypoint's arrival still has visible settle
// time before the scene ends.
export function computeWaypointArrivals(frame: number, durationInFrames: number, waypointCount: number): number[] {
  const spanEnd = Math.max(waypointCount * 10, Math.round(durationInFrames * 0.8))
  const segment = spanEnd / waypointCount
  return Array.from({ length: waypointCount }, (_, i) => {
    const startFrame = Math.round(segment * i)
    const localLength = Math.max(10, Math.round(segment) + 8)
    const local = Math.max(0, frame - startFrame)
    const t = Math.min(1, local / localLength)
    return 1 - Math.pow(1 - t, 2)
  })
}

// A single continuously-moving "lead" traveler advancing the full route —
// gives the eye one clear continuous motion even while discrete waypoint
// markers light up behind it.
export function travelerProgress(frame: number, durationInFrames: number): number {
  const spanEnd = Math.max(20, Math.round(durationInFrames * 0.85))
  const t = Math.min(1, frame / spanEnd)
  return 1 - Math.pow(1 - t, 2)
}
