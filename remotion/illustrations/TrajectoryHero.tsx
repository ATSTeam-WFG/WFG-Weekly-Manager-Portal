import { interpolate, spring } from 'remotion'
import { COLORS } from '../theme'
import type { VisualDecorationProps } from '../visuals/decorationProps'

interface TrajectoryHeroProps extends VisualDecorationProps {
  showMilestones?: boolean
}

const VIEW_WIDTH = 700
const VIEW_HEIGHT = 460
const MIN_MILESTONES = 2
const MAX_MILESTONES = 4

// The big-canvas sibling of remotion/visuals/TrajectoryPath — powers
// trajectory-path (growth/progress), milestone-landscape, and
// forward-destinations. A soft gradient area-fill under the rising curve
// gives it real visual weight; optional milestone markers (count from
// itemCount, clamped 2-4 — the scene's own real bullet/metric count, never
// invented) sit along the path when showMilestones is set. The curve's
// shape is a fixed constant regardless of scene content — a motion motif
// for "things moving forward/up," never a plotted data series.
export default function TrajectoryHero({ frame, fps, itemCount, showMilestones }: TrajectoryHeroProps) {
  const progress = spring({ frame, fps, config: { damping: 200, mass: 1.2 }, durationInFrames: 60 })
  const dashOffset = interpolate(progress, [0, 1], [1, 0])
  const fillOpacity = interpolate(progress, [0.3, 1], [0, 0.16], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  const d = `M 40 ${VIEW_HEIGHT - 60} C 200 ${VIEW_HEIGHT - 60}, 260 ${VIEW_HEIGHT - 220}, 380 ${VIEW_HEIGHT - 240} C 480 ${VIEW_HEIGHT - 256}, 540 ${VIEW_HEIGHT - 340}, 660 ${VIEW_HEIGHT - 400}`
  const areaD = `${d} L 660 ${VIEW_HEIGHT - 20} L 40 ${VIEW_HEIGHT - 20} Z`

  const milestoneCount = Math.max(MIN_MILESTONES, Math.min(MAX_MILESTONES, itemCount ?? 3))
  // Fixed points ALONG the same curve, spaced by t — not independently
  // positioned, so they always sit exactly on the visible line.
  const milestonePoints = [
    { x: 200, y: VIEW_HEIGHT - 150 },
    { x: 380, y: VIEW_HEIGHT - 240 },
    { x: 480, y: VIEW_HEIGHT - 256 },
    { x: 600, y: VIEW_HEIGHT - 360 },
  ].slice(0, milestoneCount)

  return (
    <svg viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} width="100%" height="100%" style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id="trajectory-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={COLORS.terracotta} />
          <stop offset="100%" stopColor={COLORS.terracotta} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaD} fill="url(#trajectory-fill)" style={{ opacity: fillOpacity }} />
      <path d={d} fill="none" stroke={COLORS.softSand} strokeWidth={4} />
      <path d={d} fill="none" stroke={COLORS.terracotta} strokeWidth={5} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={dashOffset} />

      {showMilestones &&
        milestonePoints.map((point, i) => {
          const markProgress = spring({ frame: Math.max(0, frame - 20 - i * 10), fps, config: { damping: 200, mass: 0.7 }, durationInFrames: 20 })
          const scale = interpolate(markProgress, [0, 1], [0.5, 1])
          return (
            <g key={i} style={{ opacity: markProgress, transform: `scale(${scale})`, transformOrigin: `${point.x}px ${point.y}px` }}>
              <circle cx={point.x} cy={point.y} r={10} fill={COLORS.white} stroke={COLORS.terracotta} strokeWidth={3} />
              <circle cx={point.x} cy={point.y} r={4} fill={COLORS.terracotta} />
            </g>
          )
        })}

      {(() => {
        const dotProgress = interpolate(progress, [0.85, 1], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
        return <circle cx={660} cy={VIEW_HEIGHT - 400} r={9} fill={COLORS.terracotta} style={{ opacity: dotProgress }} />
      })()}
    </svg>
  )
}
