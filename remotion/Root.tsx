import { Composition } from 'remotion'
import { z } from 'zod'
import WfgExecutiveVideo, { type WfgExecutiveVideoProps } from './WfgExecutiveVideo'
import { totalStoryboardDurationWithTransitionsInFrames } from './duration'
import { FPS, VIDEO_WIDTH, VIDEO_HEIGHT } from './theme'
import type { VideoStoryboard } from '../src/lib/videoStoryboard'
import DesignProofV3, { type DesignProofV3Props } from './DesignProofV3'
import { DEFAULT_PROOF_DURATIONS_SECONDS } from './designProofContent'
import CinematicSampleV1, { type CinematicSampleV1Props, cinematicSampleTotalDurationInFrames } from './CinematicSampleV1'
import WfgNewsroomNoAvatarV1, { type WfgNewsroomNoAvatarV1Props, newsroomTotalDurationInFrames } from './WfgNewsroomNoAvatarV1'
import WfgNewsroomNoAvatarV1Reconstructed, {
  type WfgNewsroomNoAvatarV1ReconstructedProps,
  newsroomReconstructedTotalDurationInFrames,
} from './WfgNewsroomNoAvatarV1Reconstructed'

// z.custom<VideoStoryboard>() carries the real TypeScript shape through
// Remotion's schema-typed Composition API without duplicating
// VideoStoryboard's full structure as a second, parallel Zod schema —
// this app's own videoStoryboardSchema.ts (Anthropic's json_schema) and
// the client-side VideoStoryboard TS type remain the only two shape
// definitions; this is a type-carrier only, never a runtime validator
// (the storyboard reaching this composition has already been through the
// real validation server-side).
const storyboardPropsSchema = z.object({
  storyboard: z.custom<VideoStoryboard>(),
})

// A minimal placeholder storyboard so the composition has a valid
// `defaultProps` shape (Remotion Studio needs one to preview without
// input props supplied) — the real storyboard is always passed in via
// --props at render time (see dev/local-video-render-plugin.ts), never
// hard-coded content presented as if it were real.
const PLACEHOLDER_STORYBOARD: VideoStoryboard = {
  title: 'WFG Weekly Leadership Update',
  weekEnding: 'Week Ending —',
  sourceType: 'weekly-summary',
  generationMethod: 'deterministic',
  scenes: [
    { id: 'opening', type: 'opening', title: 'WFG Weekly Leadership Update', body: 'Week Ending —', durationSeconds: 5 },
    { id: 'closing', type: 'closing', title: 'WFG Weekly Leadership Update', body: 'Together We Close More.', durationSeconds: 4 },
  ],
}

// DesignProofV3 — a second, fully independent composition (new id, new
// component, new schema) added purely additively alongside
// WfgExecutiveVideo above, which this does not alter in any way. Used only
// by scripts/render-design-proof.mts for the standalone cinematic design
// proof; never reached by the real storyboard-driven render path.
const designProofPropsSchema = z.object({
  sceneDurationsInFrames: z.object({
    opening: z.number(),
    cinematic: z.number(),
    metric: z.number(),
    closing: z.number(),
  }),
})

// CinematicSampleV1 — a third, fully independent composition (new id, new
// component, new schema), added purely additively like DesignProofV3
// above. Used only by scripts/render-cinematic-sample.mts for the 15s
// hybrid Broadcast-Anchor/Cinematic-Documentary sample; never reached by
// the real storyboard-driven render path.
const cinematicSamplePropsSchema = z.object({
  presenterDurationInFrames: z.number(),
  metricDurationInFrames: z.number(),
})

// WfgNewsroomNoAvatarV1 — a fourth, fully independent composition (new id,
// new component, new schema), added purely additively like the others
// above. Used only by scripts/render-newsroom-sample.mts for the 15s
// WITHOUT-AVATAR newsroom prototype; never reached by the real
// storyboard-driven render path.
const newsroomPropsSchema = z.object({
  establishDurationInFrames: z.number(),
  pushDurationInFrames: z.number(),
  metricDurationInFrames: z.number(),
})

// WfgNewsroomNoAvatarV1Reconstructed — a fifth, fully independent
// composition, added purely additively. Restores the ORIGINAL (pre-FLUX)
// newsroom v1 implementation for side-by-side comparison against the
// current (FLUX-backdrop) WfgNewsroomNoAvatarV1 above — never modifies
// that composition.
const newsroomReconstructedPropsSchema = z.object({
  establishDurationInFrames: z.number(),
  pushDurationInFrames: z.number(),
  metricDurationInFrames: z.number(),
})

const DEFAULT_PROOF_DURATIONS_IN_FRAMES = {
  opening: Math.round(DEFAULT_PROOF_DURATIONS_SECONDS.opening * FPS),
  cinematic: Math.round(DEFAULT_PROOF_DURATIONS_SECONDS.cinematic * FPS),
  metric: Math.round(DEFAULT_PROOF_DURATIONS_SECONDS.metric * FPS),
  closing: Math.round(DEFAULT_PROOF_DURATIONS_SECONDS.closing * FPS),
}

function designProofTotalDurationInFrames(sceneDurationsInFrames: DesignProofV3Props['sceneDurationsInFrames']): number {
  const naiveTotal = sceneDurationsInFrames.opening + sceneDurationsInFrames.cinematic + sceneDurationsInFrames.metric + sceneDurationsInFrames.closing
  // Matches DesignProofV3.tsx's own transition scheme exactly: two 0.6s
  // fades (opening->cinematic, cinematic->metric) plus one 0.9s wipe
  // (metric->closing, the one deliberate "strong transition").
  const fadeOverlap = Math.round(0.6 * FPS) * 2
  const strongOverlap = Math.round(0.9 * FPS)
  return Math.max(1, naiveTotal - fadeOverlap - strongOverlap)
}

export default function RemotionRoot() {
  return (
    <>
      <Composition<typeof storyboardPropsSchema, WfgExecutiveVideoProps>
        id="WfgExecutiveVideo"
        component={WfgExecutiveVideo}
        schema={storyboardPropsSchema}
        fps={FPS}
        width={VIDEO_WIDTH}
        height={VIDEO_HEIGHT}
        durationInFrames={totalStoryboardDurationWithTransitionsInFrames(PLACEHOLDER_STORYBOARD, FPS)}
        defaultProps={{ storyboard: PLACEHOLDER_STORYBOARD }}
        calculateMetadata={async ({ props }) => ({
          durationInFrames: totalStoryboardDurationWithTransitionsInFrames(props.storyboard, FPS),
        })}
      />
      <Composition<typeof designProofPropsSchema, DesignProofV3Props>
        id="DesignProofV3"
        component={DesignProofV3}
        schema={designProofPropsSchema}
        fps={FPS}
        width={VIDEO_WIDTH}
        height={VIDEO_HEIGHT}
        durationInFrames={designProofTotalDurationInFrames(DEFAULT_PROOF_DURATIONS_IN_FRAMES)}
        defaultProps={{ sceneDurationsInFrames: DEFAULT_PROOF_DURATIONS_IN_FRAMES }}
        calculateMetadata={async ({ props }) => ({
          durationInFrames: designProofTotalDurationInFrames(props.sceneDurationsInFrames),
        })}
      />
      <Composition<typeof cinematicSamplePropsSchema, CinematicSampleV1Props>
        id="CinematicSampleV1"
        component={CinematicSampleV1}
        schema={cinematicSamplePropsSchema}
        fps={FPS}
        width={VIDEO_WIDTH}
        height={VIDEO_HEIGHT}
        durationInFrames={cinematicSampleTotalDurationInFrames(Math.round(5 * FPS), Math.round(7 * FPS), FPS)}
        defaultProps={{ presenterDurationInFrames: Math.round(5 * FPS), metricDurationInFrames: Math.round(7 * FPS) }}
        calculateMetadata={async ({ props }) => ({
          durationInFrames: cinematicSampleTotalDurationInFrames(props.presenterDurationInFrames, props.metricDurationInFrames, FPS),
        })}
      />
      <Composition<typeof newsroomPropsSchema, WfgNewsroomNoAvatarV1Props>
        id="WfgNewsroomNoAvatarV1"
        component={WfgNewsroomNoAvatarV1}
        schema={newsroomPropsSchema}
        fps={FPS}
        width={VIDEO_WIDTH}
        height={VIDEO_HEIGHT}
        durationInFrames={newsroomTotalDurationInFrames(Math.round(4 * FPS), Math.round(4 * FPS), Math.round(7 * FPS))}
        defaultProps={{ establishDurationInFrames: Math.round(4 * FPS), pushDurationInFrames: Math.round(4 * FPS), metricDurationInFrames: Math.round(7 * FPS) }}
        calculateMetadata={async ({ props }) => ({
          durationInFrames: newsroomTotalDurationInFrames(props.establishDurationInFrames, props.pushDurationInFrames, props.metricDurationInFrames),
        })}
      />
      <Composition<typeof newsroomReconstructedPropsSchema, WfgNewsroomNoAvatarV1ReconstructedProps>
        id="WfgNewsroomNoAvatarV1Reconstructed"
        component={WfgNewsroomNoAvatarV1Reconstructed}
        schema={newsroomReconstructedPropsSchema}
        fps={FPS}
        width={VIDEO_WIDTH}
        height={VIDEO_HEIGHT}
        durationInFrames={newsroomReconstructedTotalDurationInFrames(Math.round(4 * FPS), Math.round(4 * FPS), Math.round(7 * FPS))}
        defaultProps={{ establishDurationInFrames: Math.round(4 * FPS), pushDurationInFrames: Math.round(4 * FPS), metricDurationInFrames: Math.round(7 * FPS) }}
        calculateMetadata={async ({ props }) => ({
          durationInFrames: newsroomReconstructedTotalDurationInFrames(props.establishDurationInFrames, props.pushDurationInFrames, props.metricDurationInFrames),
        })}
      />
    </>
  )
}
