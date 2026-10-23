// Shared, pure timing constants for the narration-driven render pipeline —
// imported from BOTH sides of the render process: scripts/lib/narrationAudio.mts
// (Node-side, computing each scene's real durationSeconds from synthesized
// audio) and remotion/ components (browser-bundled side, positioning the
// <Audio> track and the visual "arrival" beat within that same duration).
// Kept as one file so the two sides can never drift out of sync on what
// "a beat of breathing room" means.

// A modest pause before narration starts, so the scene's visual reveal gets
// a beat to begin before the voice does — never a jump-cut straight into
// speech. Trimmed from 0.35s during the visual-direction/duration pass
// (target: bring the finished video from ~98s into 60-90s) — still a real
// beat, just tighter "dead air" per scene.
export const NARRATION_LEAD_IN_SECONDS = 0.25

// A modest pause after narration ends before the scene cuts away — long
// enough to not feel clipped, short enough to avoid dead air. Trimmed
// alongside NARRATION_LEAD_IN_SECONDS for the same duration pass.
export const NARRATION_TAIL_SECONDS = 0.45

// Even a very short narration line still gets a legible minimum time on
// screen.
export const MIN_NARRATED_SCENE_SECONDS = 2.5

// The crossfade duration used for every scene-to-scene transition (see
// WfgExecutiveVideo.tsx's <TransitionSeries>) — restrained and uniform
// throughout, never a per-scene gimmick.
export const TRANSITION_DURATION_SECONDS = 0.6
