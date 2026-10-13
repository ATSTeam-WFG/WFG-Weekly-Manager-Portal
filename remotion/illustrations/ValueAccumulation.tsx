import { interpolate, spring } from 'remotion'
import { COLORS } from '../theme'
import type { VisualDecorationProps } from '../visuals/decorationProps'

const COIN_COUNT = 6
const COIN_WIDTH = 190
const COIN_HEIGHT = 46
const COIN_OVERLAP = 30

// A rising stack of coin-like discs — the "value-accumulation" subject
// (record remittance, revenue, any hero figure). Every coin is the SAME
// FIXED size: this is a motion metaphor for "value building up," never a
// bar chart of comparative magnitudes, so it can never visually imply a
// specific number, ratio, or trend beyond what the scene's own metric
// already states in text.
export default function ValueAccumulation({ frame, fps }: VisualDecorationProps) {
  const stackHeight = (COIN_COUNT - 1) * COIN_OVERLAP + COIN_HEIGHT
  const width = COIN_WIDTH + 40
  const height = stackHeight + 60

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%" style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id="coin-face" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={COLORS.terracotta} />
          <stop offset="100%" stopColor={COLORS.espresso} />
        </linearGradient>
      </defs>
      {Array.from({ length: COIN_COUNT }, (_, i) => {
        const delay = 10 + (COIN_COUNT - 1 - i) * 6
        const progress = spring({ frame: Math.max(0, frame - delay), fps, config: { damping: 200, mass: 0.8 }, durationInFrames: 22 })
        const opacity = interpolate(progress, [0, 1], [0, 1])
        const settleY = interpolate(progress, [0, 1], [30, 0])
        const y = height - 40 - i * COIN_OVERLAP - COIN_HEIGHT + settleY
        return (
          <g key={i} style={{ opacity }}>
            <ellipse cx={width / 2} cy={y + COIN_HEIGHT} rx={COIN_WIDTH / 2} ry={COIN_HEIGHT / 2.6} fill={COLORS.softSand} />
            <rect x={width / 2 - COIN_WIDTH / 2} y={y} width={COIN_WIDTH} height={COIN_HEIGHT} fill="url(#coin-face)" rx={COIN_HEIGHT / 2} />
            <ellipse cx={width / 2} cy={y} rx={COIN_WIDTH / 2} ry={COIN_HEIGHT / 2.6} fill={COLORS.terracotta} opacity={0.9} />
          </g>
        )
      })}
    </svg>
  )
}
