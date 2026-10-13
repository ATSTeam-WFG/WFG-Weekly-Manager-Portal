import type { ComponentType } from 'react'
import type { VisualConcept } from '../src/lib/videoStoryboard'
import type { VisualDecorationProps } from './visuals/decorationProps'
import {
  BottleneckDecoration,
  ForwardPathDecoration,
  GrowthTrajectoryDecoration,
  MetricComparisonDecoration,
  MilestoneDecoration,
  PipelineFlowDecoration,
  ProcessFlowDecoration,
  ProgressPathDecoration,
  RiskPressureDecoration,
  SystemsConnectionDecoration,
} from './visuals/decorations'

// sceneRegistry.ts's sibling: maps HOW a scene is told visually
// (scene.visualConcept) to a decoration primitive, exactly the same way
// sceneRegistry.ts maps WHAT a scene is (scene.type) to its base layout
// component. The two registries compose independently — a scene's layout
// always comes from sceneRegistry.ts; this registry only ever supplies an
// ADDITIONAL decorative accent alongside that layout (see each scene
// component's own DecorationColumn usage), never a replacement for it.
//
// 'editorial-headline'/'hero-metric'/'closing-brand' are deliberately
// ABSENT (not merely unmapped by accident): the scene types that typically
// carry these concepts (opening/executive-snapshot, big-metric, closing)
// already have the strongest visual weight in the whole system via their
// own native typographic/hero treatment — adding a decoration there would
// compete with, rather than support, the content the phase brief is
// explicit about never de-prioritizing.
export const VISUAL_CONCEPT_DECORATIONS: Partial<Record<VisualConcept, ComponentType<VisualDecorationProps>>> = {
  'metric-comparison': MetricComparisonDecoration,
  'growth-trajectory': GrowthTrajectoryDecoration,
  'pipeline-flow': PipelineFlowDecoration,
  'process-flow': ProcessFlowDecoration,
  bottleneck: BottleneckDecoration,
  'systems-connection': SystemsConnectionDecoration,
  'risk-pressure': RiskPressureDecoration,
  'progress-path': ProgressPathDecoration,
  milestone: MilestoneDecoration,
  'forward-path': ForwardPathDecoration,
}

// Accepts a plain string (scene.visualConcept is optional/free-typed at
// this boundary) so an unrecognized/absent concept is handled by returning
// null — never a thrown exception — exactly mirroring
// sceneRegistry.ts's own getSceneComponent contract.
export function getVisualConceptDecoration(concept: string | undefined): ComponentType<VisualDecorationProps> | null {
  if (!concept) return null
  return (VISUAL_CONCEPT_DECORATIONS as Record<string, ComponentType<VisualDecorationProps>>)[concept] ?? null
}
