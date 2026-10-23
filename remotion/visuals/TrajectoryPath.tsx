import { interpolate, spring } from 'remotion'
import { COLORS } from '../theme'
import type { VisualDecorationProps } from './decorationProps'

interface TrajectoryPathProps extends VisualDecorationProps {
  direction?: 'up' | 'forward'
}

// A DECORATIVE animated path signaling "upward/forward movement" as a
// visual motif — it never plots real data. The source report carries no
// numeric time series to chart, so this shape/endpoint is a fixed constant
// regardless of scene content; it can never imply a specific number, rate,
// or magnitude. Used for growth-trajectory/progress-path (direction="up")
// and forward-path (direction="forward").
export default function TrajectoryPath({ frame, fps, direction = 'up' }: TrajectoryPathProps) {
  const progress = spring({ frame, fps, config: { damping: 200, mass: 1 }, durationInFrames: 50 })
  const dashOffset = interpolate(progress, [0, 1], [1, 0])
  const dotOpacity = interpolate(progress, [0.75, 1], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  const d =
    direction === 'up'
      ? 'M 20 260 C 90 260, 110 180, 160 150 C 200 126, 220 90, 270 40'
      : 'M 20 150 C 90 150, 130 90, 190 90 C 230 90, 250 130, 280 130'
  const dot = direction === 'up' ? { cx: 270, cy: 40 } : { cx: 280, cy: 130 }

  return (
    <svg viewBox="0 0 300 300" width="100%" height="100%" style={{ overflow: 'visible' }}>
      <path d={d} fill="none" stroke={COLORS.softSand} strokeWidth={3} />
      <path
        d={d}
        fill="none"
        stroke={COLORS.terracotta}
        strokeWidth={4}
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={dashOffset}
      />
      <circle cx={dot.cx} cy={dot.cy} r={7} fill={COLORS.terracotta} style={{ opacity: dotOpacity }} />
    </svg>
  )
}
