import type { ComponentType } from 'react'
import type { VisualSubject } from '../src/lib/videoStoryboard'
import type { VisualDecorationProps } from './visuals/decorationProps'
import {
  BlockedConnectionIllustration,
  BrandMark,
  ComparisonBars,
  DocumentWorkflowIllustration,
  ForwardDestinationsIllustration,
  MilestoneLandscapeIllustration,
  OpportunityNodesIllustration,
  SystemsConnectionIllustration,
  TrajectoryPathIllustration,
  ValueAccumulation,
} from './illustrations/illustrationWrappers'

// The VISUAL DIRECTOR's own registry — maps visualPlan.subject to a BIG,
// primary illustration component (remotion/illustrations/), the sibling of
// visualConceptRegistry.ts's small decoration-column primitives. Every one
// of the 10 documented VisualSubject values is mapped (unlike
// visualConceptRegistry.ts, which deliberately leaves 3 concepts
// unmapped) — a scene with a visualPlan always gets a real hero
// illustration, never a silent gap.
export const HERO_ILLUSTRATIONS: Record<VisualSubject, ComponentType<VisualDecorationProps>> = {
  'value-accumulation': ValueAccumulation,
  'document-workflow': DocumentWorkflowIllustration,
  'systems-connection': SystemsConnectionIllustration,
  'blocked-connection': BlockedConnectionIllustration,
  'trajectory-path': TrajectoryPathIllustration,
  'milestone-landscape': MilestoneLandscapeIllustration,
  'opportunity-nodes': OpportunityNodesIllustration,
  'comparison-bars': ComparisonBars,
  'forward-destinations': ForwardDestinationsIllustration,
  'brand-mark': BrandMark,
}

// Accepts a plain string (visualPlan.subject is optional at this boundary)
// so an unrecognized/absent subject is handled by returning null — never a
// thrown exception — exactly mirroring sceneRegistry.ts's own
// getSceneComponent contract.
export function getHeroIllustration(subject: string | undefined): ComponentType<VisualDecorationProps> | null {
  if (!subject) return null
  return (HERO_ILLUSTRATIONS as Record<string, ComponentType<VisualDecorationProps>>)[subject] ?? null
}
