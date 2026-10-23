import { interpolate, spring } from 'remotion'
import { COLORS } from '../theme'
import type { VisualDecorationProps } from '../visuals/decorationProps'

const VIEW_WIDTH = 560
const VIEW_HEIGHT = 380
const MIN_BARS = 2
const MAX_BARS = 4
// A FIXED decorative height pattern — never derived from any parsed metric
// value. Real relative magnitude isn't something we have (metric strings
// like "$2.93M" aren't safely comparable without risking a misleading
// scale), so every bar reads as "present," never "bigger/smaller than the
// others in a specific, implied ratio."
const BAR_HEIGHT_FRACTIONS = [0.62, 0.88, 0.72, 0.95]

// The 'comparison-bars' subject — a qualitative, non-numeric comparison
// motif (bar count from itemCount, the scene's own real metric count).
export default function ComparisonBars({ frame, fps, itemCount }: VisualDecorationProps) {
  const barCount = Math.max(MIN_BARS, Math.min(MAX_BARS, itemCount ?? 2))
  const gap = 36
  const barWidth = (VIEW_WIDTH - gap * (barCount - 1)) / barCount
  const baselineY = VIEW_HEIGHT - 40

  return (
    <svg viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} width="100%" height="100%" style={{ overflow: 'visible' }}>
      <line x1={20} y1={baselineY} x2={VIEW_WIDTH - 20} y2={baselineY} stroke={COLORS.softSand} strokeWidth={2} />
      {Array.from({ length: barCount }, (_, i) => {
        const fraction = BAR_HEIGHT_FRACTIONS[i % BAR_HEIGHT_FRACTIONS.length]
        const barHeight = (baselineY - 30) * fraction
        const x = i * (barWidth + gap)
        const progress = spring({ frame: Math.max(0, frame - i * 10), fps, config: { damping: 200, mass: 0.9 }, durationInFrames: 26 })
        const growth = interpolate(progress, [0, 1], [0, barHeight])
        const isAccent = i === barCount - 1
        return (
          <rect
            key={i}
            x={x}
            y={baselineY - growth}
            width={barWidth}
            height={growth}
            rx={6}
            fill={isAccent ? COLORS.terracotta : COLORS.softSand}
            style={{ opacity: interpolate(progress, [0, 0.2, 1], [0, 1, 1]) }}
          />
        )
      })}
    </svg>
  )
}
