import type { ComponentType } from 'react'
import type { VideoSceneType } from '../src/lib/videoStoryboard'
import type { SceneRenderProps } from './sceneProps'
import OpeningScene from './scenes/OpeningScene'
import ExecutiveSnapshotScene from './scenes/ExecutiveSnapshotScene'
import BigMetricScene from './scenes/BigMetricScene'
import MultiMetricScene from './scenes/MultiMetricScene'
import HighlightsScene from './scenes/HighlightsScene'
import StatusScene from './scenes/StatusScene'
import RiskScene from './scenes/RiskScene'
import ForwardLookScene from './scenes/ForwardLookScene'
import ClosingScene from './scenes/ClosingScene'

// The ENTIRE mapping from a storyboard scene's semantic type to a FIXED
// WFG renderer component — "AI chooses the STORY, the renderer controls
// the DESIGN." Nothing here is data-driven beyond this lookup: no scene
// type maps to arbitrary/dynamic component code, no scene ever receives
// HTML/CSS/positioning/color instructions from the storyboard itself
// (the VideoStoryboardScene shape has no such field to carry one).
export const SCENE_COMPONENTS: Record<VideoSceneType, ComponentType<SceneRenderProps>> = {
  opening: OpeningScene,
  'executive-snapshot': ExecutiveSnapshotScene,
  'big-metric': BigMetricScene,
  'multi-metric': MultiMetricScene,
  highlights: HighlightsScene,
  status: StatusScene,
  risk: RiskScene,
  'forward-look': ForwardLookScene,
  closing: ClosingScene,
}

// Accepts a plain string (not the narrow union) so a malformed/hand-edited
// storyboard's unrecognized scene type is handled by returning null —
// never a thrown exception or a crashed render. The caller (WfgExecutiveVideo.tsx)
// renders FallbackScene for a null result.
export function getSceneComponent(type: string): ComponentType<SceneRenderProps> | null {
  return (SCENE_COMPONENTS as Record<string, ComponentType<SceneRenderProps>>)[type] ?? null
}
