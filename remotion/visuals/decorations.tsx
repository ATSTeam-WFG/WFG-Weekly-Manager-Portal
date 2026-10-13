import TrajectoryPath from './TrajectoryPath'
import FlowDiagram from './FlowDiagram'
import PressureGauge from './PressureGauge'
import MilestoneMarker from './MilestoneMarker'
import MetricComparisonAccent from './MetricComparisonAccent'
import type { VisualDecorationProps } from './decorationProps'

// Thin, fixed-prop wrappers around the shared primitives above — this is
// the "small reusable visual primitive system" the phase brief asks for:
// 13 visual concepts, only 5 underlying primitives. Each wrapper commits to
// exactly one variant/direction so visualConceptRegistry.ts (a plain,
// JSX-free file, exactly like sceneRegistry.ts) can map a concept string
// straight to a component of type ComponentType<VisualDecorationProps>,
// with no per-concept branching logic living in the registry itself.

export function GrowthTrajectoryDecoration(props: VisualDecorationProps) {
  return <TrajectoryPath {...props} direction="up" />
}

export function ProgressPathDecoration(props: VisualDecorationProps) {
  return <TrajectoryPath {...props} direction="up" />
}

export function ForwardPathDecoration(props: VisualDecorationProps) {
  return <TrajectoryPath {...props} direction="forward" />
}

export function PipelineFlowDecoration(props: VisualDecorationProps) {
  return <FlowDiagram {...props} variant="linear" />
}

export function ProcessFlowDecoration(props: VisualDecorationProps) {
  return <FlowDiagram {...props} variant="linear" />
}

export function BottleneckDecoration(props: VisualDecorationProps) {
  return <FlowDiagram {...props} variant="bottleneck" />
}

export function SystemsConnectionDecoration(props: VisualDecorationProps) {
  return <FlowDiagram {...props} variant="network" />
}

export function RiskPressureDecoration(props: VisualDecorationProps) {
  return <PressureGauge {...props} />
}

export function MilestoneDecoration(props: VisualDecorationProps) {
  return <MilestoneMarker {...props} />
}

export function MetricComparisonDecoration(props: VisualDecorationProps) {
  return <MetricComparisonAccent {...props} />
}
