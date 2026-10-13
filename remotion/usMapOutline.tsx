import { COLORS } from './theme'
import type { DetectedRegion } from './regionDetection'

// A simplified, stylized US outline — used ONLY to give REGIONAL_MAP
// scenes real geographic context, never a surveyed-accurate map. A single
// low-detail path (a recognizable silhouette, not precise cartography) so
// the region marker below always has something to sit on. Drawn entirely
// by Remotion (never FLUX) — this is exactly what "no fake maps containing
// labels" requires: FLUX never generates geography, and every label/mark
// here is real vector/typography under our own control.
const US_OUTLINE_PATH =
  'M120,180 L220,120 L320,110 L420,100 L520,100 L620,110 L700,100 L780,110 L850,140 L900,180 ' +
  'L920,230 L900,280 L880,320 L900,360 L880,410 L850,450 L800,480 L760,520 L720,540 L680,560 ' +
  'L620,540 L580,500 L520,480 L460,500 L400,480 L340,460 L280,440 L220,420 L180,380 L140,340 ' +
  'L110,300 L100,250 L110,210 Z'

export interface UsMapOutlineProps {
  region?: DetectedRegion
  accent: string
  pulse: number
  reveal: number
}

// `reveal` (0-1) draws the outline on progressively (a subtle "map
// assembling" moment, never a static insert); `pulse` (0-1, oscillating)
// drives the region marker's glow so it reads as alive, not a pinned icon.
export default function UsMapOutline({ region, accent, pulse, reveal }: UsMapOutlineProps) {
  return (
    <svg viewBox="0 0 960 600" style={{ width: '100%', height: '100%' }}>
      <path
        d={US_OUTLINE_PATH}
        fill="none"
        stroke={COLORS.espresso}
        strokeWidth={3}
        strokeLinejoin="round"
        opacity={0.5}
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={1 - reveal}
      />
      {region && (
        <>
          <circle cx={region.x} cy={region.y} r={26 + 14 * pulse} fill={accent} opacity={0.12 + 0.08 * pulse} />
          <circle cx={region.x} cy={region.y} r={9} fill={accent} opacity={reveal} />
          <circle cx={region.x} cy={region.y} r={9} fill="none" stroke={accent} strokeWidth={2} opacity={reveal * 0.6} />
        </>
      )}
    </svg>
  )
}
