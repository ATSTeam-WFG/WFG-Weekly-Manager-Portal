import type { VideoStoryboard, VideoStoryboardScene } from '../src/lib/videoStoryboard'

// A RENDER-TIME-ONLY cross-reference, exactly like StoryScene.tsx's own
// effectiveEngine convention: Forward Look's own scene.bullets is often
// empty (the AI writes a single combined "next" sentence instead of one
// bullet per priority — see generate-storyboard.ts's prompt), which left
// the progression mechanic's waypoints unlabeled. Rather than asking the
// content-intelligence layer to decide anything new, this simply looks up
// the scene(s) Forward Look's own sourceTopicIndexes already point to —
// each already has a real, grounded, title-fidelity-checked `title` — and
// reuses those exact titles as the waypoint labels. No new content
// decision is made here: every label returned already exists verbatim
// elsewhere in the same storyboard.
export function forwardLookPriorityLabels(scene: VideoStoryboardScene, storyboard: VideoStoryboard): string[] {
  const indexes = scene.sourceTopicIndexes ?? []
  const labels: string[] = []
  for (const index of indexes) {
    const source = storyboard.scenes.find((candidate) => candidate.id !== scene.id && (candidate.sourceTopicIndexes ?? []).includes(index))
    if (source && !labels.includes(source.title)) {
      labels.push(source.title)
    }
  }
  return labels
}
