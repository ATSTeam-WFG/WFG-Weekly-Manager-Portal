import ValueAccumulation from './ValueAccumulation'
import HeroFlowIllustration from './HeroFlowIllustration'
import TrajectoryHero from './TrajectoryHero'
import ComparisonBars from './ComparisonBars'
import BrandMark from './BrandMark'
import type { VisualDecorationProps } from '../visuals/decorationProps'

// Thin, fixed-prop wrappers — the same pattern remotion/visuals/decorations.tsx
// already established for the small decoration primitives: a handful of
// shared illustrations (5), each committed to one variant/prop combination
// per VisualSubject, so remotion/heroIllustrationRegistry.ts (a plain,
// JSX-free file) can map a subject string straight to a
// ComponentType<VisualDecorationProps> with no branching logic of its own.

export function DocumentWorkflowIllustration(props: VisualDecorationProps) {
  return <HeroFlowIllustration {...props} variant="workflow" />
}

export function SystemsConnectionIllustration(props: VisualDecorationProps) {
  return <HeroFlowIllustration {...props} variant="network" />
}

export function BlockedConnectionIllustration(props: VisualDecorationProps) {
  return <HeroFlowIllustration {...props} variant="blocked" />
}

export function OpportunityNodesIllustration(props: VisualDecorationProps) {
  return <HeroFlowIllustration {...props} variant="funnel" />
}

export function TrajectoryPathIllustration(props: VisualDecorationProps) {
  return <TrajectoryHero {...props} showMilestones={false} />
}

export function MilestoneLandscapeIllustration(props: VisualDecorationProps) {
  return <TrajectoryHero {...props} showMilestones />
}

export function ForwardDestinationsIllustration(props: VisualDecorationProps) {
  return <TrajectoryHero {...props} showMilestones />
}

export { ValueAccumulation, ComparisonBars, BrandMark }
