// Deterministic text-fit sizing — no live DOM/canvas measurement (which
// would make rendering non-reproducible and is fragile under Remotion's
// headless Chromium), and no clipping/truncation of real content (the
// brief is explicit: never silently discard factual content to make a
// layout fit). Instead, font size scales DOWN as text/bullet count grows,
// within a safe [minFontSize, maxFontSize] band tuned per call site, so
// long AI-generated copy shrinks to fit a fixed 1920x1080 frame rather
// than overflowing it. Wrapping (via ordinary CSS white-space/word-break)
// handles the rest.
//
// This is a first-pass heuristic (assumes a roughly-average character
// width for the font/weight in play), not pixel-perfect text
// measurement — appropriate for this phase; every call site keeps a
// generous minFontSize floor so even a worst-case very long string stays
// legible rather than vanishing.

export interface FitFontSizeOptions {
  maxFontSize: number
  minFontSize: number
  // The text length, at maxFontSize, past which scaling begins. Below
  // this length, maxFontSize is used unscaled.
  idealLength: number
}

export function fitFontSize(text: string, options: FitFontSizeOptions): number {
  const { maxFontSize, minFontSize, idealLength } = options
  const length = Math.max(text.trim().length, 1)
  if (length <= idealLength) return maxFontSize
  const scale = idealLength / length
  const size = Math.round(maxFontSize * scale)
  return Math.max(minFontSize, Math.min(maxFontSize, size))
}

// Same idea, applied across a list of bullets/lines: more lines (or
// longer combined text) -> a smaller per-line font size, so a scene with
// 4 bullets doesn't overflow the same vertical budget a scene with 1
// bullet fits comfortably. Never drops a bullet to make room — every
// bullet the caller passes in is still rendered, just smaller.
export interface FitListFontSizeOptions {
  maxFontSize: number
  minFontSize: number
  idealTotalLength: number
}

export function fitListFontSize(lines: string[], options: FitListFontSizeOptions): number {
  const { maxFontSize, minFontSize, idealTotalLength } = options
  const totalLength = lines.reduce((sum, line) => sum + line.trim().length, 0) || 1
  if (totalLength <= idealTotalLength) return maxFontSize
  const scale = idealTotalLength / totalLength
  const size = Math.round(maxFontSize * scale)
  return Math.max(minFontSize, Math.min(maxFontSize, size))
}
