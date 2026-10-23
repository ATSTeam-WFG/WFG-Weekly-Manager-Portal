import { interpolate, spring } from 'remotion'
import { COLORS } from '../theme'
import type { VisualDecorationProps } from './decorationProps'

interface FlowDiagramProps extends VisualDecorationProps {
  variant?: 'linear' | 'bottleneck' | 'network'
}

const MIN_NODES = 2
const MAX_NODES = 5
const VIEW_WIDTH = 320
const VIEW_HEIGHT = 300

// One reusable node-and-connector diagram powering three visual concepts
// (pipeline-flow/process-flow use variant="linear"; bottleneck adds a
// converging "funnel" motif at the midpoint; systems-connection uses
// variant="network" — an alternating up/down layout suggesting
// interconnected systems rather than a single pipeline). Node COUNT is the
// only content-derived input (itemCount, clamped to a readable 2-5), taken
// directly from this scene's own real bullets/metrics length — never an
// invented figure — and node POSITIONS/labels never carry business text.
export default function FlowDiagram({ frame, fps, itemCount, variant = 'linear' }: FlowDiagramProps) {
  const nodeCount = Math.max(MIN_NODES, Math.min(MAX_NODES, itemCount ?? 3))
  const positions = Array.from({ length: nodeCount }, (_, i) => {
    const x = 40 + (i * (VIEW_WIDTH - 80)) / Math.max(1, nodeCount - 1)
    const y = variant === 'network' ? (i % 2 === 0 ? 100 : 200) : 150
    return { x, y }
  })
  // A fixed GEOMETRIC center — never tied to a specific node index — so the
  // funnel motif reads correctly even with only 2 nodes (the common case: a
  // 2-bullet risk scene), where there is no actual "middle" node to pinch at.
  const pinch = { x: VIEW_WIDTH / 2, y: 150 }

  return (
    <svg viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} width="100%" height="100%" style={{ overflow: 'visible' }}>
      {positions.slice(0, -1).map((pos, i) => {
        const next = positions[i + 1]
        const delay = 6 + i * 8
        const lineProgress = spring({ frame: Math.max(0, frame - delay), fps, config: { damping: 200 }, durationInFrames: 20 })
        return (
          <line
            key={i}
            x1={pos.x}
            y1={pos.y}
            x2={next.x}
            y2={next.y}
            stroke={COLORS.softSand}
            strokeWidth={4}
            style={{ opacity: lineProgress }}
          />
        )
      })}

      {variant === 'bottleneck' &&
        (() => {
          const spread = 40
          const funnelProgress = spring({ frame: Math.max(0, frame - 24), fps, config: { damping: 200 }, durationInFrames: 30 })
          const first = positions[0]
          const last = positions[nodeCount - 1]
          return (
            <g style={{ opacity: funnelProgress }}>
              <path
                d={`M ${first.x} ${first.y - spread} L ${pinch.x} ${pinch.y} L ${last.x} ${last.y - spread}`}
                fill="none"
                stroke={COLORS.terracotta}
                strokeWidth={2}
                strokeDasharray="4 5"
              />
              <path
                d={`M ${first.x} ${first.y + spread} L ${pinch.x} ${pinch.y} L ${last.x} ${last.y + spread}`}
                fill="none"
                stroke={COLORS.terracotta}
                strokeWidth={2}
                strokeDasharray="4 5"
              />
              <circle cx={pinch.x} cy={pinch.y} r={6} fill={COLORS.terracotta} />
            </g>
          )
        })()}

      {positions.map((pos, i) => {
        const delay = i * 8
        const nodeProgress = spring({ frame: Math.max(0, frame - delay), fps, config: { damping: 200 }, durationInFrames: 18 })
        const scale = interpolate(nodeProgress, [0, 1], [0.6, 1])
        const isEndpoint = i === 0 || i === nodeCount - 1
        return (
          <circle
            key={i}
            cx={pos.x}
            cy={pos.y}
            r={isEndpoint ? 10 : 8}
            fill={isEndpoint ? COLORS.terracotta : COLORS.white}
            stroke={COLORS.terracotta}
            strokeWidth={2}
            style={{ opacity: nodeProgress, transform: `scale(${scale})`, transformOrigin: `${pos.x}px ${pos.y}px` }}
          />
        )
      })}
    </svg>
  )
}
