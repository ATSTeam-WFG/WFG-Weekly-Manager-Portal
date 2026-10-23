import { interpolate, spring } from 'remotion'
import { COLORS } from '../theme'
import type { VisualDecorationProps } from '../visuals/decorationProps'

interface HeroFlowIllustrationProps extends VisualDecorationProps {
  variant: 'workflow' | 'blocked' | 'network' | 'funnel'
}

const MIN_NODES = 3
const MAX_NODES = 5
const VIEW_WIDTH = 640
const VIEW_HEIGHT = 420

// The bigger, PRIMARY-illustration sibling of remotion/visuals/FlowDiagram —
// FlowDiagram stays a small side-column accent (visualConcept); this is a
// large hero illustration (visualPlan.subject) meant to occupy most of a
// scene's canvas. One shared node/connector primitive powers four subjects:
// 'workflow' (document-workflow: a document glyph moving through
// checkpoints, with a rework loop when a problem is present), 'blocked'
// (blocked-connection: an obvious broken gap + warning mark), 'network'
// (systems-connection: nodes arranged in a web with one pulsing "friction"
// node), 'funnel' (opportunity-nodes: nodes converging into a narrower
// destination). Node COUNT is the only content-derived input (itemCount,
// clamped 3-5, taken from the scene's own real bullet/metric count) — node
// positions/glyphs never carry business text.
export default function HeroFlowIllustration({ frame, fps, itemCount, variant }: HeroFlowIllustrationProps) {
  const nodeCount = Math.max(MIN_NODES, Math.min(MAX_NODES, itemCount ?? 4))
  const marginX = 70
  const positions = Array.from({ length: nodeCount }, (_, i) => {
    const t = i / (nodeCount - 1)
    const x = marginX + t * (VIEW_WIDTH - marginX * 2)
    const y =
      variant === 'network'
        ? VIEW_HEIGHT / 2 + (i % 2 === 0 ? -70 : 70)
        : variant === 'funnel'
          ? VIEW_HEIGHT / 2 + (i - (nodeCount - 1) / 2) * 46 * (1 - t * 0.7)
          : VIEW_HEIGHT / 2
    return { x, y }
  })
  const funnelDestination = { x: VIEW_WIDTH - marginX + 30, y: VIEW_HEIGHT / 2 }
  const blockedIndex = Math.floor((nodeCount - 1) / 2)
  const frictionIndex = Math.min(nodeCount - 2, Math.floor(nodeCount / 2))

  return (
    <svg viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} width="100%" height="100%" style={{ overflow: 'visible' }}>
      {/* Connectors */}
      {variant === 'funnel'
        ? positions.map((pos, i) => {
            const progress = spring({ frame: Math.max(0, frame - 10 - i * 6), fps, config: { damping: 200 }, durationInFrames: 24 })
            return (
              <line
                key={i}
                x1={pos.x}
                y1={pos.y}
                x2={funnelDestination.x}
                y2={funnelDestination.y}
                stroke={COLORS.softSand}
                strokeWidth={4}
                style={{ opacity: progress }}
              />
            )
          })
        : positions.slice(0, -1).map((pos, i) => {
            const next = positions[i + 1]
            const isBlockedGap = variant === 'blocked' && i === blockedIndex
            const progress = spring({ frame: Math.max(0, frame - 10 - i * 8), fps, config: { damping: 200 }, durationInFrames: 24 })
            if (isBlockedGap) {
              const midX = (pos.x + next.x) / 2
              return (
                <g key={i} style={{ opacity: progress }}>
                  <line x1={pos.x} y1={pos.y} x2={midX - 22} y2={pos.y} stroke={COLORS.softSand} strokeWidth={5} />
                  <line x1={midX + 22} y1={pos.y} x2={next.x} y2={pos.y} stroke={COLORS.softSand} strokeWidth={5} />
                  <line x1={midX - 14} y1={pos.y - 20} x2={midX + 14} y2={pos.y + 20} stroke={COLORS.terracotta} strokeWidth={5} strokeLinecap="round" />
                  <line x1={midX + 14} y1={pos.y - 20} x2={midX - 14} y2={pos.y + 20} stroke={COLORS.terracotta} strokeWidth={5} strokeLinecap="round" />
                </g>
              )
            }
            return (
              <line key={i} x1={pos.x} y1={pos.y} x2={next.x} y2={next.y} stroke={COLORS.softSand} strokeWidth={5} style={{ opacity: progress }} />
            )
          })}

      {/* A rework loop for 'workflow' scenes with a genuine issue — a curved arrow looping back from the last checkpoint toward an earlier one. */}
      {variant === 'workflow' && nodeCount >= 3 && (() => {
        const from = positions[nodeCount - 1]
        const to = positions[Math.max(0, nodeCount - 3)]
        const progress = spring({ frame: Math.max(0, frame - 40), fps, config: { damping: 200 }, durationInFrames: 26 })
        const loopTop = Math.min(from.y, to.y) - 90
        return (
          <path
            d={`M ${from.x} ${from.y - 22} C ${from.x} ${loopTop}, ${to.x} ${loopTop}, ${to.x} ${to.y - 22}`}
            fill="none"
            stroke={COLORS.terracotta}
            strokeWidth={3}
            strokeDasharray="6 6"
            style={{ opacity: progress }}
            markerEnd="url(#rework-arrow)"
          />
        )
      })()}
      <defs>
        <marker id="rework-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={COLORS.terracotta} />
        </marker>
      </defs>

      {/* Nodes */}
      {positions.map((pos, i) => {
        const progress = spring({ frame: Math.max(0, frame - i * 8), fps, config: { damping: 200 }, durationInFrames: 20 })
        const scale = interpolate(progress, [0, 1], [0.6, 1])
        const isEndpoint = i === 0 || i === nodeCount - 1
        const isFriction = variant === 'network' && i === frictionIndex
        const pulse = isFriction ? 1 + 0.08 * Math.sin(frame / 6) : 1
        return (
          <circle
            key={i}
            cx={pos.x}
            cy={pos.y}
            r={isFriction ? 22 : isEndpoint ? 20 : 16}
            fill={isEndpoint || isFriction ? COLORS.terracotta : COLORS.white}
            stroke={COLORS.terracotta}
            strokeWidth={3}
            style={{ opacity: progress, transform: `scale(${scale * pulse})`, transformOrigin: `${pos.x}px ${pos.y}px` }}
          />
        )
      })}

      {variant === 'funnel' && (() => {
        const progress = spring({ frame: Math.max(0, frame - 10 - nodeCount * 6), fps, config: { damping: 200 }, durationInFrames: 22 })
        return (
          <circle
            cx={funnelDestination.x}
            cy={funnelDestination.y}
            r={26}
            fill={COLORS.terracotta}
            stroke={COLORS.espresso}
            strokeWidth={2}
            style={{ opacity: progress }}
          />
        )
      })()}

      {/* A document glyph riding the path for 'workflow' — a simple rectangle+lines icon, never business text. */}
      {variant === 'workflow' && (() => {
        const travel = spring({ frame, fps, config: { damping: 200, mass: 1.4 }, durationInFrames: 70 })
        const t = interpolate(travel, [0, 1], [0, 1], { extrapolateRight: 'clamp' })
        const index = Math.min(nodeCount - 1, Math.floor(t * (nodeCount - 1)))
        const nextIndex = Math.min(nodeCount - 1, index + 1)
        const localT = t * (nodeCount - 1) - index
        const from = positions[index]
        const to = positions[nextIndex]
        const x = from.x + (to.x - from.x) * localT
        const y = from.y - 56
        return (
          <g transform={`translate(${x - 16}, ${y - 20})`}>
            <rect width={32} height={40} rx={3} fill={COLORS.white} stroke={COLORS.terracotta} strokeWidth={2.5} />
            <line x1={7} y1={12} x2={25} y2={12} stroke={COLORS.terracotta} strokeWidth={2} />
            <line x1={7} y1={20} x2={25} y2={20} stroke={COLORS.terracotta} strokeWidth={2} />
            <line x1={7} y1={28} x2={18} y2={28} stroke={COLORS.terracotta} strokeWidth={2} />
          </g>
        )
      })()}
    </svg>
  )
}
