// Isolated provider-pricing configuration — kept SEPARATE from the core
// planner (cinematicPlan.ts) and from rendering logic, so a future pricing
// change or provider swap only ever touches this one file. Current rate
// reflects the already-verified official Luma Ray 3.2 price (720p, SDR):
// $0.30 per 5-second generation, confirmed during this project's earlier
// Luma POC phase — never re-derived or hardcoded anywhere else.
export const COST_PER_GENERATED_SECOND_USD = 0.3 / 5

export function estimateGenerationCostUsd(totalGeneratedSeconds: number): number {
  return Math.round(totalGeneratedSeconds * COST_PER_GENERATED_SECOND_USD * 100) / 100
}
