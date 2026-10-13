import { interpolate, spring } from 'remotion'
import { COLORS } from '../theme'
import type { VisualDecorationProps } from './decorationProps'

// Purely ATMOSPHERIC — the source report never carries a quantified risk
// score, so this fill level is a hard-coded constant, never computed from
// scene content. It signals "elevated concern" as a motif alongside the
// scene's own already-grounded text; it must never be read as, or evolve
// toward, a real measured value.
const DECORATIVE_FILL_LEVEL = 0.62

export default function PressureGauge({ frame, fps }: VisualDecorationProps) {
  const progress = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 40 })
  const fillFraction = interpolate(progress, [0, 1], [0, DECORATIVE_FILL_LEVEL])
  const trackHeight = 260
  const trackTop = 20

  return (
    <svg viewBox="0 0 120 300" width="100%" height="100%" style={{ overflow: 'visible' }}>
      <rect x={40} y={trackTop} width={40} height={trackHeight} rx={20} fill="none" stroke={COLORS.softSand} strokeWidth={3} />
      <rect
        x={40}
        y={trackTop + trackHeight * (1 - fillFraction)}
        width={40}
        height={trackHeight * fillFraction}
        rx={20}
        fill={COLORS.terracotta}
        opacity={0.85}
      />
    </svg>
  )
}
