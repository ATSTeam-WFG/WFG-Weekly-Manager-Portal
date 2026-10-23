import { COLORS } from './theme'
import type { MotifAccent } from './visualStorySpec'
import type { VisualSubject } from '../src/lib/videoStoryboard'

// THE ILLUSTRATED OBJECT SYSTEM — a small, reusable library of richer,
// dimensional SVG motifs (never a business-fact string injected as markup;
// every shape here is fixed/decorative, exactly like the existing
// illustrations/ directory's own established convention). Each icon is
// deliberately a small COMPOSITION of 2-3 shapes (base + accent + detail),
// not a single flat glyph, so a scene built from several of these reads as
// "illustrated," not "iconography." Shared by Opening, Executive Snapshot,
// and (in the systems-friction validation scene) LayeredStoryScene.

export function accentHex(accent: MotifAccent): string {
  if (accent === 'gold') return COLORS.gold
  if (accent === 'sage') return COLORS.sage
  if (accent === 'blue') return COLORS.slateBlue
  return COLORS.terracotta
}

// A small stack of overlapping coin-like value tokens — the gold "value/
// opportunity" motif. Two coins, gently offset, each with a raised rim and
// a plain (never a real currency symbol claim) center mark.
export function ValueTokenIcon({ size = 96, accent = COLORS.gold }: { size?: number; accent?: string }) {
  return (
    <svg viewBox="0 0 96 96" width={size} height={size}>
      <circle cx={40} cy={54} r={30} fill={accent} opacity={0.35} />
      <circle cx={56} cy={40} r={30} fill={accent} />
      <circle cx={56} cy={40} r={21} fill="none" stroke={COLORS.warmCream} strokeWidth={2.5} opacity={0.7} />
      <circle cx={56} cy={40} r={5} fill={COLORS.warmCream} opacity={0.85} />
    </svg>
  )
}

// A small folded-document stack — the terracotta "workflow/paper" motif,
// echoing the existing 'document' FlowToken skin but as a standalone,
// slightly larger composed object (a folder base + two peeking documents).
export function DocumentMotifIcon({ size = 96, accent = COLORS.terracotta }: { size?: number; accent?: string }) {
  return (
    <svg viewBox="0 0 96 96" width={size} height={size}>
      <rect x={14} y={38} width={68} height={46} rx={6} fill={COLORS.softSand} stroke={COLORS.espresso} strokeWidth={2.5} />
      <path d="M22 20 H58 L70 32 V78 H22 Z" fill={COLORS.warmCream} stroke={COLORS.espresso} strokeWidth={2.5} strokeLinejoin="round" />
      <path d="M58 20 V32 H70 Z" fill={COLORS.softSand} stroke={COLORS.espresso} strokeWidth={1.5} strokeLinejoin="round" />
      <rect x={30} y={46} width={30} height={5} rx={2.5} fill={COLORS.mutedGray} />
      <rect x={30} y={58} width={30} height={5} rx={2.5} fill={COLORS.mutedGray} />
      <rect x={30} y={70} width={18} height={5} rx={2.5} fill={accent} />
    </svg>
  )
}

// A small browser/interface window — the slateBlue "technology/systems"
// motif: a title bar with 3 window dots, and two content lines plus a
// status bar whose color communicates state (healthy vs failed) — reused
// directly by the richer systems-friction scene below, not just the
// preview motif.
export function SystemsMotifIcon({ size = 96, accent = COLORS.slateBlue, healthy = true }: { size?: number; accent?: string; healthy?: boolean }) {
  return (
    <svg viewBox="0 0 96 96" width={size} height={size}>
      <rect x={10} y={16} width={76} height={58} rx={6} fill={COLORS.warmCream} stroke={COLORS.espresso} strokeWidth={2.5} />
      <rect x={10} y={16} width={76} height={14} rx={6} fill={accent} opacity={0.85} />
      <circle cx={19} cy={23} r={2.4} fill={COLORS.warmCream} />
      <circle cx={27} cy={23} r={2.4} fill={COLORS.warmCream} opacity={0.7} />
      <circle cx={35} cy={23} r={2.4} fill={COLORS.warmCream} opacity={0.5} />
      <rect x={20} y={40} width={56} height={5} rx={2.5} fill={COLORS.mutedGray} />
      <rect x={20} y={52} width={40} height={5} rx={2.5} fill={COLORS.mutedGray} />
      <rect x={20} y={64} width={30} height={6} rx={3} fill={healthy ? accent : COLORS.espresso} />
    </svg>
  )
}

// An ascending route with a small destination marker — the sage "growth/
// progress" motif: a simple upward path plus a filled circle destination,
// distinct from the terracotta workflow motif and the gold value motif.
export function GrowthMotifIcon({ size = 96, accent = COLORS.sage }: { size?: number; accent?: string }) {
  return (
    <svg viewBox="0 0 96 96" width={size} height={size}>
      <path d="M14 78 Q 48 78 82 22" fill="none" stroke={accent} strokeWidth={4} strokeLinecap="round" strokeDasharray="1 10" opacity={0.5} />
      <path d="M14 78 Q 48 78 82 22" fill="none" stroke={accent} strokeWidth={4} strokeLinecap="round" />
      <circle cx={82} cy={22} r={11} fill={accent} />
      <circle cx={82} cy={22} r={18} fill={accent} opacity={0.18} />
    </svg>
  )
}

// The one dispatcher every motif-preview call site (Opening, Executive
// Snapshot) uses — keyed only by the already-decided visualPlan.subject
// (via accentForSubject's own grouping), never a second content judgment.
export function MotifIcon({ subject, accent, size = 96 }: { subject: VisualSubject; accent: MotifAccent; size?: number }) {
  const hex = accentHex(accent)
  if (subject === 'value-accumulation' || subject === 'comparison-bars') return <ValueTokenIcon size={size} accent={hex} />
  if (subject === 'systems-connection' || subject === 'blocked-connection') return <SystemsMotifIcon size={size} accent={hex} />
  if (subject === 'opportunity-nodes' || subject === 'trajectory-path' || subject === 'milestone-landscape' || subject === 'forward-destinations') {
    return <GrowthMotifIcon size={size} accent={hex} />
  }
  return <DocumentMotifIcon size={size} accent={hex} />
}
