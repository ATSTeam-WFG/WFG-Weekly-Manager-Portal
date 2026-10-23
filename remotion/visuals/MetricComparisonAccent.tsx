import { spring } from 'remotion'
import { COLORS, FONT_SANS } from '../theme'
import type { VisualDecorationProps } from './decorationProps'

// A neutral structural divider/label, never a numerically-scaled bar — a
// bar sized by parsing an AI-formatted metric string (e.g. "$2.93M") risks
// visually implying a comparison the source doesn't actually support, which
// is exactly what the phase brief prohibits. This stays purely structural.
export default function MetricComparisonAccent({ frame, fps }: VisualDecorationProps) {
  const progress = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 20 })

  return (
    <div style={{ opacity: progress, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, width: '100%' }}>
      <div style={{ flex: 1, height: 2, background: COLORS.softSand, maxWidth: 120 }} />
      <div style={{ fontFamily: FONT_SANS, fontSize: 13, fontWeight: 700, color: COLORS.mutedGray, letterSpacing: '0.1em', whiteSpace: 'nowrap' }}>
        AT A GLANCE
      </div>
      <div style={{ flex: 1, height: 2, background: COLORS.softSand, maxWidth: 120 }} />
    </div>
  )
}
