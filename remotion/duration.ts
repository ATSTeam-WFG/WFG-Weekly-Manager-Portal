import type { VideoStoryboard } from '../src/lib/videoStoryboard'
import { FPS } from './theme.ts'
import { TRANSITION_DURATION_SECONDS } from './narrationTiming.ts'

// storyboard.durationSeconds -> frames, respected as-is (per the phase
// brief: "Respect storyboard.durationSeconds where reasonable") — no
// rescaling to force an exact 60-90s total; the server already validates
// each scene's duration and the overall total into a reasonable range
// before a storyboard ever reaches the renderer. When narration audio was
// synthesized for a scene, scripts/lib/narrationAudio.mts has already
// overwritten this same durationSeconds field with the real audio-driven
// value (plus lead-in/tail padding) before the storyboard ever reaches
// Remotion — this function has no separate "audio mode," it always just
// respects whatever durationSeconds it's given.
export function sceneDurationInFrames(durationSeconds: number | undefined, fps: number = FPS): number {
  const seconds = durationSeconds && durationSeconds > 0 ? durationSeconds : 5
  return Math.max(1, Math.round(seconds * fps))
}

export function totalStoryboardDurationInFrames(storyboard: VideoStoryboard, fps: number = FPS): number {
  return storyboard.scenes.reduce((sum, scene) => sum + sceneDurationInFrames(scene.durationSeconds, fps), 0)
}

export function transitionDurationInFrames(fps: number = FPS): number {
  return Math.max(1, Math.round(TRANSITION_DURATION_SECONDS * fps))
}

// The composition's REAL total duration once scene-to-scene crossfades are
// in play (see WfgExecutiveVideo.tsx's <TransitionSeries>): each of the
// (sceneCount - 1) transitions overlaps two adjacent scenes by
// transitionDurationInFrames, so the naive sum above overcounts by exactly
// that much per transition — this is the one place that overcounting is
// corrected, kept alongside totalStoryboardDurationInFrames so the two can
// never drift out of sync with however WfgExecutiveVideo.tsx actually
// assembles the scenes.
export function totalStoryboardDurationWithTransitionsInFrames(storyboard: VideoStoryboard, fps: number = FPS): number {
  const naiveTotal = totalStoryboardDurationInFrames(storyboard, fps)
  const transitionCount = Math.max(0, storyboard.scenes.length - 1)
  return Math.max(1, naiveTotal - transitionCount * transitionDurationInFrames(fps))
}
