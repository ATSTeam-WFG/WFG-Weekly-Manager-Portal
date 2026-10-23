import type { VideoStoryboard, VideoStoryboardScene } from '../src/lib/videoStoryboard'

// What every scene component receives — never more than this. In
// particular, a scene component never receives the raw AI/Anthropic
// response, never calls any service, and never sees anything beyond the
// already-validated VideoStoryboard the browser already has. "AI chooses
// the STORY, the renderer controls the DESIGN": the renderer maps
// scene.type to a FIXED component below (see sceneRegistry.ts) — nothing
// here interprets or executes any HTML/CSS/React/positioning/color
// instruction the AI might have produced, because none exists; the AI
// output schema (api/_lib/videoStoryboardSchema.ts) has no such field.
export interface SceneRenderProps {
  scene: VideoStoryboardScene
  storyboard: VideoStoryboard
  durationInFrames: number
}
