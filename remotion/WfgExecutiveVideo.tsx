import { Fragment } from 'react'
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { TransitionSeries, linearTiming } from '@remotion/transitions'
import { fade } from '@remotion/transitions/fade'
import { slide } from '@remotion/transitions/slide'
import type { VideoStoryboard, VideoStoryboardScene } from '../src/lib/videoStoryboard'
import { getSceneComponent } from './sceneRegistry'
import FallbackScene from './scenes/FallbackScene'
import { sceneDurationInFrames, transitionDurationInFrames } from './duration'
import { NARRATION_LEAD_IN_SECONDS } from './narrationTiming'
import { COLORS } from './theme'
import { Caption } from './cinematicChrome'

// Intersected with Record<string, unknown> solely so this satisfies
// Remotion's <Composition> generic constraint (it requires a props type
// assignable to Record<string, unknown>) — `storyboard` itself is still
// exactly VideoStoryboard, never widened to `unknown`.
export type WfgExecutiveVideoProps = {
  storyboard: VideoStoryboard
} & Record<string, unknown>

// A narration WAV for a scene lives at this exact, predictable path —
// scripts/lib/narrationAudio.mts writes every scene WITH a narrationText to
// precisely this filename before a real render ever starts. A scene whose
// narrationText is empty never gets an <Audio> at all (never a request for
// a file that was never meant to exist). Opening Remotion Studio directly
// (without having run a full local render first) can show a harmless
// missing-asset warning for a scene that DOES have narrationText but whose
// audio hasn't been generated yet in this session — that's a dev-preview
// limitation only, never true during an actual render.
function narrationAudioPath(sceneId: string): string {
  return staticFile(`narration/${sceneId}.wav`)
}

// A scene with scene.avatarVideoAssetPath set (Phase 2 — talking-avatar
// video, see AvatarVideoOverlay/videoStoryboard.ts's own comment) gets
// its narration from that clip's OWN embedded audio track — never also
// from the separate narration <Audio> below, which would double the
// voice. A scene with no avatar video keeps exactly the existing
// narration-audio path, completely unchanged.
function hasSeparateNarrationAudio(scene: VideoStoryboardScene): boolean {
  return Boolean(scene.narrationText) && !scene.avatarVideoAssetPath
}

// The one adaptive WFG Executive template. Every scene in
// storyboard.scenes is placed back-to-back — via Remotion's <TransitionSeries>
// (not the plain <Series> this used before narration/transitions existed),
// which still sequences purely by each scene's own durationInFrames, but
// now crossfades adjacent scenes by a fixed, restrained amount rather than
// hard-cutting between them (see the phase brief's own complaint about
// "dead frames"/abrupt cuts in the pre-narration render) — and mapped, by
// scene.type alone, to its fixed renderer component. This component never
// reads AI/Anthropic output directly and never receives anything the
// browser's already-validated VideoStoryboard didn't already contain.
// The opening -> first-story-scene cut is the ONE place the approved 10%
// promotional/Ryze-style energy shows up: a confident, slightly tighter
// push-slide rather than the restrained fade every other scene-to-scene
// cut uses, giving the video a stronger hook right after the branded open.
// Every OTHER transition in the video stays the original, cinematic fade —
// this is a single, deliberate exception, not a new default.
const OPENING_TRANSITION_FRAMES_FRACTION = 0.8

function transitionPresentation(index: number) {
  return index === 0 ? slide({ direction: 'from-right' }) : fade()
}

function transitionFramesForIndex(index: number, transitionFrames: number): number {
  return index === 0 ? Math.round(transitionFrames * OPENING_TRANSITION_FRAMES_FRACTION) : transitionFrames
}

// Narration-synchronized captions, applied globally to every scene from
// one place (never duplicated per scene component) — the approved V3
// lower-third safe-caption band (see cinematicChrome.tsx), shown for a
// scene's full duration so it's always legible, never flashing in/out
// mid-sentence. The closing scene is the one deliberate exception: its
// own on-screen tagline (scene.body) already reads as the spoken line, so
// a duplicate caption directly beneath it would be pure redundancy, not a
// missing caption.
function CaptionLayer({ scene }: { scene: VideoStoryboardScene }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  if (!scene.narrationText || scene.type === 'closing') return null
  return <Caption text={scene.narrationText} frame={frame} fps={fps} />
}

export default function WfgExecutiveVideo({ storyboard }: WfgExecutiveVideoProps) {
  const { fps } = useVideoConfig()
  const transitionFrames = transitionDurationInFrames(fps)
  const leadInFrames = Math.round(NARRATION_LEAD_IN_SECONDS * fps)

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.white }}>
      <TransitionSeries>
        {storyboard.scenes.map((scene, index) => {
          const durationInFrames = sceneDurationInFrames(scene.durationSeconds, fps)
          const SceneComponent = getSceneComponent(scene.type) ?? FallbackScene
          const isLast = index === storyboard.scenes.length - 1
          return (
            <Fragment key={scene.id}>
              <TransitionSeries.Sequence durationInFrames={durationInFrames}>
                <SceneComponent scene={scene} storyboard={storyboard} durationInFrames={durationInFrames} />
                <CaptionLayer scene={scene} />
                {hasSeparateNarrationAudio(scene) && (
                  <Sequence from={leadInFrames} layout="none">
                    <Audio src={narrationAudioPath(scene.id)} />
                  </Sequence>
                )}
              </TransitionSeries.Sequence>
              {!isLast && <TransitionSeries.Transition presentation={transitionPresentation(index)} timing={linearTiming({ durationInFrames: transitionFramesForIndex(index, transitionFrames) })} />}
            </Fragment>
          )
        })}
      </TransitionSeries>
    </AbsoluteFill>
  )
}
