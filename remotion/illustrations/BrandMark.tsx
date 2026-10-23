import { Img, staticFile } from 'remotion'
import { COLORS } from '../theme'
import { revealScaleStyle, growWidthStyle } from '../motion'
import type { VisualDecorationProps } from '../visuals/decorationProps'

// The 'brand-mark' subject — the WFG logo plus a growing rule, reused
// verbatim from Opening/ClosingScene's own treatment (never a second,
// divergent brand mark). Used where the visual plan calls for restraint
// (composition: 'minimal-brand') rather than an illustrated metaphor.
export default function BrandMark({ frame, fps }: VisualDecorationProps) {
  const logoStyle = revealScaleStyle(frame, fps, 0)
  const ruleStyle = growWidthStyle(frame, fps, 12)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28 }}>
      <div style={{ ...logoStyle }}>
        <Img src={staticFile('wfg-logo.png')} style={{ height: 90 }} />
      </div>
      <div style={{ ...ruleStyle, height: 2, backgroundColor: COLORS.terracotta, maxWidth: 220 }} />
    </div>
  )
}
