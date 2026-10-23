import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import { COLORS, FONT_SANS } from '../theme'
import { revealStyle } from '../motion'
import type { SceneRenderProps } from '../sceneProps'

// Rendered only if a scene's type is somehow outside the controlled
// vocabulary (getSceneComponent in sceneRegistry.ts returns null for
// anything unrecognized) — this should not occur in practice, since
// api/_lib/videoStoryboardSchema.ts's enum already rejects anything
// outside AI_STORYBOARD_SCENE_TYPES before a storyboard ever reaches the
// browser, and buildStoryboardFromAtsReport only ever emits the
// deterministic-path subset. Still, the renderer must fail SAFELY rather
// than crash the whole render on a malformed/hand-edited storyboard
// object: a plain, minimal scene showing only scene.title (never
// fabricated content) instead of an unhandled exception.
export default function FallbackScene({ scene }: SceneRenderProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const style = revealStyle(frame, fps, 0)

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.warmCream, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ ...style, fontFamily: FONT_SANS, fontSize: 40, color: COLORS.darkCharcoal, textAlign: 'center', maxWidth: 1300 }}>
        {scene.title}
      </div>
    </AbsoluteFill>
  )
}
