import { interpolate, spring } from 'remotion'
import { COLORS } from '../theme'
import type { VisualDecorationProps } from './decorationProps'

// A static achievement badge (check mark in a ring) — decorative, never
// tied to any count or figure from the scene's own content.
export default function MilestoneMarker({ frame, fps }: VisualDecorationProps) {
  const progress = spring({ frame, fps, config: { damping: 200, mass: 0.7 }, durationInFrames: 24 })
  const scale = interpolate(progress, [0, 1], [0.7, 1])

  return (
    <div style={{ opacity: progress, transform: `scale(${scale})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg viewBox="0 0 80 80" width={80} height={80}>
        <circle cx={40} cy={40} r={36} fill="none" stroke={COLORS.terracotta} strokeWidth={4} />
        <path d="M 24 42 L 35 53 L 57 28" fill="none" stroke={COLORS.terracotta} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}
