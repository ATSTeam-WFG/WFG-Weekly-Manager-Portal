import { detectGroundedRegion } from './regionDetection.ts'
import type { VideoStoryboard, VideoStoryboardScene, VisualSubject } from '../src/lib/videoStoryboard.ts'

// THE VISUAL STORY SPEC LAYER — sits between the already-approved
// storyboard and the illustrated-object renderer (illustratedObjects.tsx).
// This is VISUAL METADATA ONLY: it derives which THEMES/MOTIFS a scene (or
// the video as a whole) should visually preview, and which restrained
// accent color communicates each one — it NEVER decides what leadership
// content matters, never re-picks source topics, never invents a business
// fact. Every function here reads only visualPlan.subject (a field
// content-intelligence already decided) plus the scene ARRAY's own order —
// nothing here inspects narrationText/body/bullets for meaning.

// Restrained accent language (see theme.ts's own comment): each accent has
// exactly one contextual meaning, reused consistently everywhere a motif
// appears (Opening, Executive Snapshot, and — in spirit, though this v2
// pass only implements it end-to-end for one scene — later business
// scenes too).
export type MotifAccent = 'terracotta' | 'gold' | 'sage' | 'blue'

// value/comparison -> gold (value, achievement); systems/connection ->
// blue (technology, connectivity); opportunity/trajectory/milestone/
// forward -> sage (healthy progress); document-workflow and anything else
// (including an unfamiliar future subject) -> terracotta, the one accent
// already used everywhere else in this app for friction/emphasis, so an
// unrecognized subject never falls back to an arbitrary/ungrounded color.
export function accentForSubject(subject: VisualSubject | undefined): MotifAccent {
  if (subject === 'value-accumulation' || subject === 'comparison-bars') return 'gold'
  if (subject === 'systems-connection' || subject === 'blocked-connection') return 'blue'
  if (subject === 'opportunity-nodes' || subject === 'trajectory-path' || subject === 'milestone-landscape' || subject === 'forward-destinations') return 'sage'
  return 'terracotta'
}

export interface StoryMotif {
  subject: VisualSubject
  accent: MotifAccent
}

// THE VISUAL STORY DIRECTOR'S recipe choice (visual-direction v3) — which
// of the four HAND-BUILT illustrated Remotion progressions
// (IllustratedStoryScene.tsx) applies to this subject. Each recipe is a
// DISTINCT animation behavior (see that file's own header) — this
// function only ever answers "which one," never invents a new business
// fact, and a subject with no mapped recipe (an unfamiliar future topic,
// or one of the two subjects that intentionally has none —
// 'milestone-landscape'/'forward-destinations', which instead reuse OTHER
// scenes' hero illustrations — see ForwardLookScene.tsx) returns
// undefined, and the scene keeps its existing LayeredStoryScene/StoryScene
// fallback.
export type IllustratedRecipe = 'value' | 'workflow' | 'systems' | 'growth'

export function recipeForSubject(subject: VisualSubject | undefined): IllustratedRecipe | undefined {
  if (subject === 'value-accumulation' || subject === 'comparison-bars') return 'value'
  if (subject === 'document-workflow') return 'workflow'
  if (subject === 'systems-connection' || subject === 'blocked-connection') return 'systems'
  if (subject === 'opportunity-nodes' || subject === 'trajectory-path') return 'growth'
  return undefined
}

// Scans the storyboard's OWN scenes (in their own already-decided order)
// for the distinct visual subjects its business scenes actually use —
// 'brand-mark' (opening/closing) is always excluded, since it is not a
// theme to preview, and a subject already seen is never repeated. This is
// the ONE function Opening/Executive Snapshot both call to know which
// motifs to preview — for a completely different future week, this
// naturally derives a completely different set, with no topic-specific
// logic anywhere in this file.
export function storyMotifs(storyboard: VideoStoryboard, maxMotifs = 4): StoryMotif[] {
  const motifs: StoryMotif[] = []
  const seen = new Set<VisualSubject>()
  for (const scene of storyboard.scenes) {
    const subject = scene.visualPlan?.subject
    if (!subject || subject === 'brand-mark' || seen.has(subject)) continue
    seen.add(subject)
    motifs.push({ subject, accent: accentForSubject(subject) })
    if (motifs.length >= maxMotifs) break
  }
  return motifs
}

export interface StoryHeroAsset {
  subject: VisualSubject
  accent: MotifAccent
  title: string
  heroAssetPath: string
}

// The visual-direction v3 counterpart of storyMotifs — scans for scenes
// that actually got a PRIMARY hero illustration generated
// (scene.fluxHeroAssetPath), in the storyboard's own order, one per
// distinct subject. Opening/Executive Snapshot/Forward Look all call this
// (never re-deriving it themselves) so the SAME illustrations — never a
// newly generated asset — are reused as small callbacks throughout the
// video: "visual callbacks between scenes," per the visual-direction
// brief, and maximally economical (zero extra FLUX generations). A week
// whose scenes have no hero illustration yet (generation failed, or every
// subject fell back to the neutral treatment) simply returns an empty
// list — callers fall back to their own existing treatment.
export function storyHeroAssets(storyboard: VideoStoryboard): StoryHeroAsset[] {
  const assets: StoryHeroAsset[] = []
  const seen = new Set<VisualSubject>()
  for (const scene of storyboard.scenes as VideoStoryboardScene[]) {
    const subject = scene.visualPlan?.subject
    if (!subject || subject === 'brand-mark' || seen.has(subject) || !scene.fluxHeroAssetPath) continue
    seen.add(subject)
    assets.push({ subject, accent: accentForSubject(subject), title: scene.title, heroAssetPath: scene.fluxHeroAssetPath })
  }
  return assets
}

// ============================================================
// THE CINEMATIC VISUAL DIRECTOR (visual-direction v4) — approved plan's
// central classifier. This EXTENDS the Visual Story Director above rather
// than replacing it: accentForSubject/storyMotifs/storyHeroAssets/
// recipeForSubject are all unchanged and still used (recipeForSubject
// becomes an internal camera/composition HINT some treatments consult —
// see IllustratedStoryScene.tsx). cinematicTreatmentForScene is the new,
// single, TOP-LEVEL decision: which of the 9 approved treatments best
// tells THIS scene's already-decided content. It reads only fields
// content-intelligence already produced (scene.type, leadershipImportance,
// visualPlan.subject, metrics.length, and — for REGIONAL_MAP only — the
// literal text already present in title/body/bullets/next via
// detectGroundedRegion) — it never re-derives, invents, or reinterprets a
// business fact, and it never reads narrationText for meaning.
//
// STORY MEANING DETERMINES THE SCENE; DATA ENHANCES IT (the approved
// priority order, in this exact sequence — first match wins):
//   1. BRANDED_OPENING      — scene.type === 'opening'
//   2. BRANDED_CLOSING      — scene.type === 'closing'
//   3. FORWARD_LOOKING      — scene.type === 'forward-look'
//   4. CHALLENGE            — a genuine risk/blocker/operational-friction
//                             concern (but NOT technology-friction — that
//                             has its own dedicated treatment, see below)
//   5. TECHNOLOGY           — a technology/systems/process topic
//   6. REGIONAL_MAP         — a real, already-grounded region mention
//   7. DATA_STORY           — 2+ grounded metrics, no stronger narrative above
//   8. HERO_METRIC          — exactly 1 grounded metric, no stronger narrative above
//   9. CINEMATIC_ENVIRONMENT — the default narrative/business-storytelling treatment
//
// A scene with 2 metrics that's ALSO a genuine regional story (e.g. "New
// Agent & Commercial Growth Pipeline" citing a "$18M TN deal") still
// becomes REGIONAL_MAP — the metrics don't disappear, they're rendered AS
// PART OF that cinematic composition (see IllustratedStoryScene.tsx's
// RegionalMapTreatment, which still displays scene.metrics/leadingDollarFigure
// text) — exactly the "story meaning determines the scene, data enhances
// the scene" principle this function exists to enforce.
export type CinematicTreatment =
  | 'BRANDED_OPENING'
  | 'BRANDED_CLOSING'
  | 'FORWARD_LOOKING'
  | 'CHALLENGE'
  | 'TECHNOLOGY'
  | 'REGIONAL_MAP'
  | 'DATA_STORY'
  | 'HERO_METRIC'
  | 'CINEMATIC_ENVIRONMENT'

const CHALLENGE_IMPORTANCE = new Set(['risk', 'operational-friction', 'blocker'])
const TECHNOLOGY_SUBJECTS = new Set<VisualSubject>(['systems-connection', 'blocked-connection'])

function isChallengeScene(scene: VideoStoryboardScene): boolean {
  if (scene.leadershipImportance === 'technology-friction') return false // TECHNOLOGY owns this one instead
  if (scene.leadershipImportance && CHALLENGE_IMPORTANCE.has(scene.leadershipImportance)) return true
  return scene.type === 'risk'
}

function isTechnologyScene(scene: VideoStoryboardScene): boolean {
  if (scene.leadershipImportance === 'technology-friction') return true
  return scene.visualPlan?.subject !== undefined && TECHNOLOGY_SUBJECTS.has(scene.visualPlan.subject)
}

export function cinematicTreatmentForScene(scene: VideoStoryboardScene): CinematicTreatment {
  if (scene.type === 'opening') return 'BRANDED_OPENING'
  if (scene.type === 'closing') return 'BRANDED_CLOSING'
  if (scene.type === 'forward-look') return 'FORWARD_LOOKING'
  if (isChallengeScene(scene)) return 'CHALLENGE'
  if (isTechnologyScene(scene)) return 'TECHNOLOGY'
  if (detectGroundedRegion(scene)) return 'REGIONAL_MAP'
  const metricCount = scene.metrics?.length ?? 0
  if (metricCount >= 2) return 'DATA_STORY'
  if (metricCount === 1) return 'HERO_METRIC'
  return 'CINEMATIC_ENVIRONMENT'
}

// A stable, deterministic per-scene seed (same construction as
// fluxAssetSeed in fluxPrompts.ts) — used ONLY to pick among a few
// equally-valid PRESENTATION variants (camera origin, accent emphasis,
// text placement) within a treatment, so two scenes sharing a treatment
// don't default to an identical layout. Never affects content, grounding,
// or which treatment is chosen — purely a "which of these 2-3 valid looks"
// tie-breaker, keyed by the scene's own id so it's stable across re-renders
// of the same storyboard.
export function treatmentSeed(sceneId: string): number {
  let hash = 0
  for (let i = 0; i < sceneId.length; i++) {
    hash = (hash * 31 + sceneId.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}
