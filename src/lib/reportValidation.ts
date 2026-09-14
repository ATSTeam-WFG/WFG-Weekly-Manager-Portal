// Pure, framework-free helpers for the V2 bullet sections — shared by
// BulletListInput (UI) and ReportForm (submit-time validation), and directly
// unit-testable with no rendering harness required.

export function countMeaningfulBullets(bullets: string[]): number {
  return bullets.filter((b) => b.trim().length > 0).length
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
