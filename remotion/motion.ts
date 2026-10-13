import { interpolate, spring, type SpringConfig } from 'remotion'

// Shared, deterministic reveal primitives used by every scene component —
// one small set of motion patterns (fade + gentle upward settle) rather
// than a different bespoke animation per scene, matching the brief's
// "sophisticated motion," "subtle position/opacity transitions" guidance
// and its explicit "avoid bouncing/spinning/aggressive zooming/gimmicky
// transitions" constraint. Every function here is a pure function of
// (frame, fps) — no randomness, no external state — so a render is
// exactly reproducible.

const GENTLE_SPRING: Partial<SpringConfig> = { damping: 200, mass: 0.7 }

// Opacity 0->1 and a small upward settle (translateY 18px -> 0), starting
// `delayFrames` into the scene. Used for headlines, body copy, and
// individual staged bullets/metrics alike.
export function revealStyle(frame: number, fps: number, delayFrames = 0): { opacity: number; transform: string } {
  const localFrame = Math.max(0, frame - delayFrames)
  const progress = spring({ frame: localFrame, fps, config: GENTLE_SPRING, durationInFrames: 24 })
  const opacity = interpolate(progress, [0, 1], [0, 1])
  const translateY = interpolate(progress, [0, 1], [18, 0])
  return { opacity, transform: `translateY(${translateY}px)` }
}

// A thin rule/line that grows from 0 to full width — used as a restrained
// transitional accent (e.g. under a headline, or signaling forward
// momentum on the Forward Look scene) rather than a decorative flourish.
export function growWidthStyle(frame: number, fps: number, delayFrames = 0): { width: string } {
  const localFrame = Math.max(0, frame - delayFrames)
  const progress = spring({ frame: localFrame, fps, config: GENTLE_SPRING, durationInFrames: 30 })
  return { width: `${Math.round(interpolate(progress, [0, 1], [0, 100]))}%` }
}

// A restrained scale-in (0.92 -> 1) paired with the same fade — reserved
// for single hero elements (the big-metric figure, the opening logo) where
// a touch of "arrival" emphasis is appropriate; never a bounce/overshoot.
export function revealScaleStyle(frame: number, fps: number, delayFrames = 0): { opacity: number; transform: string } {
  const localFrame = Math.max(0, frame - delayFrames)
  const progress = spring({ frame: localFrame, fps, config: GENTLE_SPRING, durationInFrames: 24 })
  const opacity = interpolate(progress, [0, 1], [0, 1])
  const scale = interpolate(progress, [0, 1], [0.92, 1])
  return { opacity, transform: `scale(${scale})` }
}

// The fixed per-item stagger used for every "progressive reveal" list
// (bullets, multi-metric entries) — a single shared constant so every
// scene's staging reads consistently, rather than each scene inventing its
// own pacing.
export const STAGGER_FRAMES = 8
