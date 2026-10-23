// Plain, JSX-free constants shared between DesignProofV3.tsx (the
// composition, bundled for the browser/Remotion renderer) and
// scripts/render-design-proof.mts (a Node-side .mts script that cannot
// import a .tsx file directly without a jsx compiler option). Kept as its
// own file for the same reason narrationVoices.ts is split out from
// narrationAudio.mts — one small, dependency-free source of truth both
// sides import.

// The one grounded figure this proof puts on screen — verbatim from the
// approved checkpoint's own topic-0 scene
// (output/cinematic-generation-checkpoint.json, bullets[0]: "One region
// posted its highest YTD remittance (Gross $2.93M / Net $440K)..."").
// Nothing here is invented.
export const METRIC_VALUE = '$2.93M'
export const METRIC_LABEL = 'Highest-Ever YTD Remittance (Gross) — One Region, September'

export const PROOF_CAPTIONS = {
  opening: "Here's this week's WFG leadership update.",
  cinematic: "The quarter closed strong on remittance and revenue, alongside process, technology, and retention challenges we're addressing.",
  metric: 'September closed strong — one region posted its highest-ever YTD remittance at $2.93M gross.',
  closing: 'Together, we close more.',
} as const

export type ProofSceneId = keyof typeof PROOF_CAPTIONS

export const DEFAULT_PROOF_DURATIONS_SECONDS = {
  opening: 4,
  cinematic: 7,
  metric: 7,
  closing: 4.5,
}
