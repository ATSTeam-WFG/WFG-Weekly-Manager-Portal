// Pure, framework-free helpers for the V2 bullet sections — shared by
// BulletListInput (UI) and ReportForm (submit-time validation), and directly
// unit-testable with no rendering harness required.

export function countMeaningfulBullets(bullets: string[]): number {
  return bullets.filter((b) => b.trim().length > 0).length
}

// A bullet is stored newline-delimited (see reportContentMapping.ts's
// serializeBullets/parseBullets — bullets are joined/split on '\n'), so an
// embedded newline inside a single bullet's own text is indistinguishable
// from the delimiter between two bullets: it would silently split one
// logical item into multiple stored bullets on the very next save/reload,
// changing the manager's actual item count without their knowledge. This
// replaces any newline (typed Enter or pasted multi-line text) with a
// single space, preserving one logical item per bullet while still
// allowing the field to wrap and grow visually across several lines.
export function sanitizeBulletValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ')
}

export function capBullets(bullets: string[], max: number): string[] {
  return bullets.slice(0, max)
}

// "What Matters Now" is the only section with a submit-time minimum — the
// approved format calls for 2-3 material items, never fewer. Save Draft is
// never gated by this; only the Submit action checks it.
export function isWhatMattersNowValidForSubmit(bullets: string[]): boolean {
  const count = countMeaningfulBullets(bullets)
  return count >= 2 && count <= 3
}
