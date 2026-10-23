// What every visual-concept decoration primitive receives — deliberately
// tiny. `itemCount` (when present) is always a REAL count already on this
// scene (e.g. its own bullets.length/metrics.length) so a diagram's node
// count reflects actual source-derived content, never an invented number.
// Nothing here carries report/business-fact text: a decoration is
// PRESENTATION ONLY, painted from frame/fps/itemCount alone, so it
// structurally cannot introduce or imply a business claim beyond "there are
// this many items."
export interface VisualDecorationProps {
  frame: number
  fps: number
  itemCount?: number
}
