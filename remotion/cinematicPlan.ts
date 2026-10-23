import type { VideoStoryboardScene } from '../src/lib/videoStoryboard.ts'
import { cinematicTreatmentForScene, type CinematicTreatment } from './visualStorySpec.ts'
import { detectGroundedRegion } from './regionDetection.ts'
import { estimateGenerationCostUsd } from './cinematicGenerationPricing.ts'

// THE PER-SCENE CINEMATIC SHOT PLANNER — the bridge between the already-
// grounded VideoStoryboard and the eventual multi-shot cinematic engine
// (scene.cinematicAssets[], remotion/shotPlan.ts). This is a PLANNING/
// DISPLAY layer only: it proposes what shots a scene WOULD need, at what
// estimated cost, before any generation happens. It never calls Luma,
// never writes to scene.cinematicAssets, and never invents a business
// fact — every accent's content is a direct, verbatim reference to an
// existing grounded field (metrics[0]/bullets[0]/a detected region), and
// every cinematic shot's visualPrompt is built from ONLY its treatment +
// purpose — buildVisualPrompt never receives the scene at all, so it is
// structurally incapable of leaking report text into a prompt.
//
// GENERALIZED: beat count and accent type are both derived purely from
// how much grounded content a scene actually has (metrics/bullets/region
// counts) — never from scene.id, scene.title, or any topic name. The same
// function run against any future week's storyboard produces a genuinely
// different plan per scene, driven only by that scene's own content.
//
// GENERATION ASSET vs. EDITORIAL SHOT/USAGE: a "shot" is an editorial
// beat the viewer sees; a "generation asset" is one paid Luma clip. Two
// shots MAY share one generation asset (different trim window/crop — a
// classic wide-then-detail editorial pair from one location) — see
// `generationAssetId`/`reuseNote` below. `requiresGeneration` is true only
// for the FIRST shot referencing a given asset id; every later shot
// sharing that id is `requiresGeneration: false` even though it's still a
// real, distinct editorial `cinematic` shot.

export type ShotType = 'cinematic' | 'motion_graphic' | 'branded'

export interface PlannedShot {
  id: string
  sceneId: string
  type: ShotType
  purpose: string
  screenDurationSeconds: number
  generationDurationSeconds?: number
  visualPrompt?: string
  accentType?: 'regional_map' | 'metric' | 'progress'
  sourceRefs: string[]
  requiresGeneration: boolean
  // Present for every 'cinematic' shot — identifies which generation asset
  // this shot's footage comes from. Two shots with the same id share one
  // paid generation (see reuseNote on the non-generating one).
  generationAssetId?: string
  // Present only on a 'cinematic' shot that REUSES an earlier shot's asset
  // (requiresGeneration: false) — a short, generalized (never scene-
  // specific) explanation of why this reuse is defensible, for display.
  reuseNote?: string
}

export interface ScenePlan {
  sceneId: string
  title: string
  treatment: CinematicTreatment
  treatmentLabel: string
  shots: PlannedShot[]
  totalScreenSeconds: number
}

export interface CinematicGenerationEstimate {
  // Every visual beat across the storyboard, regardless of type —
  // always equal to cinematicUsages + motionBeats + brandedBeats by
  // construction (every shot has exactly one `type`), proven in
  // cinematicPlan.test.ts rather than asserted by hand in a report.
  totalVisualBeats: number
  cinematicUsages: number
  motionBeats: number
  brandedBeats: number
  // Paid generation assets, counted via a Set of generationAssetId —
  // independent of newClipsRequired (which counts requiresGeneration
  // shots). The two must always match; cinematicPlan.test.ts proves it.
  uniqueGenerationAssets: number
  newClipsRequired: number
  totalGeneratedSeconds: number
  estimatedCostUsd: number
}

const DEDICATED_TREATMENTS = new Set<CinematicTreatment>(['BRANDED_OPENING', 'BRANDED_CLOSING', 'FORWARD_LOOKING'])

const TREATMENT_LABELS: Record<CinematicTreatment, string> = {
  BRANDED_OPENING: 'Branded Opening',
  BRANDED_CLOSING: 'Branded Closing',
  FORWARD_LOOKING: 'Forward Look',
  CHALLENGE: 'Challenge',
  TECHNOLOGY: 'Technology Friction',
  REGIONAL_MAP: 'Regional Map',
  DATA_STORY: 'Data Story',
  HERO_METRIC: 'Hero Metric',
  CINEMATIC_ENVIRONMENT: 'Cinematic Environment',
}

// Default per-shot estimates for PLANNING/display purposes only — the
// real, frame-accurate render-time duration is computed later from the
// actual generated clip's real length (remotion/shotPlan.ts). 5s matches
// Luma's cheapest real generation granularity; 4s is the editorial-trim
// screen estimate (consistent with this project's earlier POC pattern).
const CINEMATIC_SHOT_SCREEN_SECONDS = 4
const CINEMATIC_SHOT_GENERATION_SECONDS = 5
const ACCENT_SHOT_SCREEN_SECONDS = 2
const BRANDED_SHOT_FALLBACK_SECONDS = 5

// A single, generalized (never scene-specific) explanation for why a
// reused-asset shot is defensible — it is always the SAME structural
// reason (two framings of one location/moment), never a per-scene excuse.
const REUSE_NOTE =
  'Shares footage with the previous shot via a different trim window and crop — same environment, different framing (wide vs. detail), standard editorial coverage rather than repeated footage.'

// DISTINCT CINEMATIC GRAMMAR PER TREATMENT FAMILY — fixes the reported
// gap where TECHNOLOGY and CHALLENGE exposed identical purpose labels.
// Each family is its own ordered vocabulary of shot purposes; which
// family a treatment belongs to is fixed (never content-driven), but
// WHICH purposes get used, and whether a shot is new-generation or
// reused, still depends only on content richness (see planShotsForScene).
type PurposeId = string

const TREATMENT_PURPOSE_SEQUENCES: Record<CinematicTreatment, PurposeId[]> = {
  BRANDED_OPENING: [],
  BRANDED_CLOSING: [],
  FORWARD_LOOKING: [],
  // TECHNOLOGY — screen/workstation grammar.
  TECHNOLOGY: ['screen_workstation_environment', 'hands_process_interaction', 'person_reacting_workflow'],
  // CHALLENGE — risk/problem-solving grammar, deliberately distinct from TECHNOLOGY.
  CHALLENGE: ['contextual_establishing', 'focused_individual_problem_solving', 'restrained_human_reaction'],
  // FINANCIAL — HERO_METRIC and DATA_STORY share one financial grammar.
  HERO_METRIC: ['active_office_establishing', 'transaction_document_detail', 'closing_process_activity'],
  DATA_STORY: ['active_office_establishing', 'transaction_document_detail', 'closing_process_activity'],
  // REGIONAL/GROWTH grammar.
  REGIONAL_MAP: ['geographic_business_establishing', 'client_business_interaction', 'transaction_detail'],
  // CINEMATIC_ENVIRONMENT — the generalized default narrative grammar, its own vocabulary.
  CINEMATIC_ENVIRONMENT: ['natural_workplace_establishing', 'collaborative_moment', 'environmental_depth'],
}

const PURPOSE_LABELS: Record<PurposeId, string> = {
  // TECHNOLOGY
  screen_workstation_environment: 'Screen/workstation environment',
  hands_process_interaction: 'Hands/process interaction',
  person_reacting_workflow: 'Person reacting to workflow',
  // CHALLENGE
  contextual_establishing: 'Contextual establishing shot',
  focused_individual_problem_solving: 'Focused individual, problem-solving',
  restrained_human_reaction: 'Restrained human reaction',
  // FINANCIAL
  active_office_establishing: 'Active office establishing',
  transaction_document_detail: 'Transaction/document detail',
  closing_process_activity: 'Closing/process activity',
  // REGIONAL
  geographic_business_establishing: 'Geographic/business establishing',
  client_business_interaction: 'Client/business interaction',
  transaction_detail: 'Transaction/detail',
  // CINEMATIC_ENVIRONMENT
  natural_workplace_establishing: 'Natural workplace establishing',
  collaborative_moment: 'Collaborative moment',
  environmental_depth: 'Environmental depth',
}

// Purely cinematographic camera/action language — no business-fact
// vocabulary exists in this table at all, so there is nothing here CAN
// leak even if a future edit tried to parameterize it by scene.
const PURPOSE_CAMERA: Record<PurposeId, string> = {
  screen_workstation_environment:
    'wide shot of a workstation environment with a monitor and keyboard visible from an angle that never reveals screen content, ambient technical office lighting, slow dolly in',
  hands_process_interaction: 'medium shot of hands actively typing or interacting with a device, natural workflow motion, shallow depth of field',
  person_reacting_workflow:
    'medium shot of a professional’s subtle reaction — a pause, a glance — while reviewing a process, restrained naturalistic performance',
  contextual_establishing: 'wide establishing shot of a serious, focused operational workspace, muted natural lighting, subtle camera drift',
  focused_individual_problem_solving: 'medium shot of a professional concentrating intently on a task, thoughtful posture, slow push-in',
  restrained_human_reaction: 'medium close-up of a brief, restrained reaction — concern or focus — naturalistic, no exaggeration',
  active_office_establishing: 'wide establishing shot of an active, busy professional office, natural daylight, subtle camera drift',
  transaction_document_detail: 'close-up shot of hands organizing or reviewing documents, shallow depth of field, slow push-in',
  closing_process_activity: 'medium shot of a document being finalized or a file being closed, deliberate natural motion',
  geographic_business_establishing:
    'wide establishing shot suggestive of a regional business environment, a city skyline softly visible through a window or in the background, natural light',
  client_business_interaction: 'medium shot of a warm, professional handshake or client meeting moment, natural collaborative energy',
  transaction_detail: 'close-up shot of hands exchanging or signing paperwork, shallow depth of field',
  natural_workplace_establishing:
    'wide establishing shot of natural, everyday professional workplace activity, soft ambient lighting, subtle camera drift',
  collaborative_moment: 'medium shot of colleagues in natural conversation, soft camera settle',
  environmental_depth: 'wide environmental shot emphasizing workspace depth and atmosphere, gentle parallax',
}

const TREATMENT_SETTINGS: Record<CinematicTreatment, string> = {
  BRANDED_OPENING: '',
  BRANDED_CLOSING: '',
  FORWARD_LOOKING: '',
  CINEMATIC_ENVIRONMENT: 'a modern professional office environment',
  HERO_METRIC: 'a modern office desk environment focused on financial/closing activity',
  DATA_STORY: 'a modern office desk environment focused on financial/closing activity',
  REGIONAL_MAP: 'a professional meeting or client-facing business environment',
  TECHNOLOGY: 'a technology/computer-focused workspace',
  CHALLENGE: 'a process-oriented operational workspace',
}

// PROMPT VARIETY — fixes the reported gap where multiple generation
// assets that happen to share one (treatment, purpose) pair (e.g. two
// different scenes both landing on CINEMATIC_ENVIRONMENT's
// "natural_workplace_establishing" purpose) produced byte-identical Luma
// prompts. These two vocabularies add a composition and a lighting/mood
// clause, deterministically selected via a hash of
// (treatment, purpose, variationSeed) — variationSeed is always the
// shot's own generationAssetId, never scene title/body/bullets/metrics,
// so this stays structurally incapable of leaking report content while
// still varying cosmetically per distinct generation asset. No
// Math.random/Date.now anywhere — same inputs always produce the same
// prompt.
const COMPOSITIONS = [
  'wide, balanced framing with clear depth of field',
  'off-center framing with layered foreground interest',
  'clean, minimal framing with generous negative space',
  'layered foreground-to-background composition',
]

const LIGHTING_MOODS = ['natural daylight, airy mood', 'soft overcast light, calm mood', 'warm late-afternoon light, grounded mood', 'cool morning light, crisp mood']

// Simple deterministic string hash (djb2 variant) — pure function of its
// input string, never time- or randomness-based.
function stableHash(input: string): number {
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i)
  }
  return hash >>> 0
}

// Builds a Luma-ready cinematographer prompt from ONLY (treatment,
// purpose, variationSeed) — deliberately NEVER takes the scene as a
// parameter, so it is structurally incapable of describing a metric,
// location, person, company initiative, problem, status, or UI/screen.
// Explicitly excludes readable text/numbers/logos/maps-with-labels/
// charts/UI, per the approved direction — Remotion renders every factual
// element separately.
function buildVisualPrompt(treatment: CinematicTreatment, purpose: PurposeId, variationSeed: string): string {
  const setting = TREATMENT_SETTINGS[treatment] || 'a modern professional office environment'
  const camera = PURPOSE_CAMERA[purpose] ?? 'medium shot of natural workplace activity'
  const seed = stableHash(`${treatment}:${purpose}:${variationSeed}`)
  const composition = COMPOSITIONS[seed % COMPOSITIONS.length]
  const mood = LIGHTING_MOODS[Math.floor(seed / COMPOSITIONS.length) % LIGHTING_MOODS.length]
  return `Cinematic ${camera}, set in ${setting}, ${composition}, ${mood}, realistic corporate documentary cinematography, no readable text, no numbers, no logos, no screens with visible UI, 16:9.`
}

interface ContentSignal {
  accentType?: 'regional_map' | 'metric' | 'progress'
  accentSourceRef?: string
  accentDescription?: string
  richness: number
}

// The ONLY place that decides whether/what accent applies, and how
// cinematically "rich" a scene is — purely from counting existing
// grounded fields (metrics/bullets/a detected region). Never reads
// scene.id/title/leadershipImportance/treatment — so it works identically
// for any future week's content.
function detectContentSignal(scene: VideoStoryboardScene): ContentSignal {
  const region = detectGroundedRegion(scene)
  const metric = scene.metrics?.[0]
  const bullet = scene.bullets?.[0]
  const richness = (scene.metrics?.length ?? 0) + (scene.bullets?.length ?? 0) + (region ? 1 : 0)

  if (region) {
    return { accentType: 'regional_map', accentSourceRef: 'region', accentDescription: `Region: ${region.name}`, richness }
  }
  if (metric) {
    return { accentType: 'metric', accentSourceRef: 'metrics[0]', accentDescription: `${metric.value} — ${metric.label}`, richness }
  }
  if (bullet) {
    return { accentType: 'progress', accentSourceRef: 'bullets[0]', accentDescription: bullet, richness }
  }
  return { richness: 0 }
}

const ACCENT_PURPOSE_LABEL: Record<NonNullable<ContentSignal['accentType']>, string> = {
  regional_map: 'Regional map accent',
  metric: 'Metric accent',
  progress: 'Progress/comparison accent',
}

export function planShotsForScene(scene: VideoStoryboardScene): ScenePlan {
  const treatment = cinematicTreatmentForScene(scene)
  const treatmentLabel = TREATMENT_LABELS[treatment]

  if (DEDICATED_TREATMENTS.has(treatment)) {
    // Opening/closing/forward-look keep their existing fixed branded
    // treatment — no cinematic generation unless/until content specifically
    // requires it (none of the three dedicated treatments do today).
    const shot: PlannedShot = {
      id: `${scene.id}-branded`,
      sceneId: scene.id,
      type: 'branded',
      purpose: treatmentLabel,
      screenDurationSeconds: scene.durationSeconds ?? BRANDED_SHOT_FALLBACK_SECONDS,
      sourceRefs: [],
      requiresGeneration: false,
    }
    return { sceneId: scene.id, title: scene.title, treatment, treatmentLabel, shots: [shot], totalScreenSeconds: shot.screenDurationSeconds }
  }

  const signal = detectContentSignal(scene)
  // 2-4 beats, driven by content richness — never a universal fixed
  // count: a scene with no grounded metric/bullet/region richness gets
  // only the minimum 2 cinematic shots and no accent; genuinely rich
  // scenes (3+ combined signals) get a 3rd, distinct cinematic shot.
  const cinematicCount = signal.richness >= 3 ? 3 : 2
  const purposes = TREATMENT_PURPOSE_SEQUENCES[treatment].slice(0, cinematicCount)

  // ASSET-VS-USAGE RULE: shot index 0 always starts a new generation
  // asset. Shot index 1 (the "detail" framing of the SAME purpose-1
  // location) reuses shot 0's asset via a different trim/crop — the
  // classic wide-then-detail editorial pair, genuinely defensible for any
  // treatment since both purposes describe the same environment, only
  // reframed. Shot index 2, when present (richness >= 3), always starts a
  // its OWN new asset — its purpose is a genuinely different action
  // (e.g. "person reacting to workflow"), which a crop/trim of shot 0's
  // footage could not honestly depict.
  let assetCounter = 0
  let firstAssetId: string | undefined
  const shots: PlannedShot[] = purposes.map((purpose, index) => {
    const reuse = index === 1
    const generationAssetId = reuse && firstAssetId ? firstAssetId : `${scene.id}-asset-${assetCounter++}`
    if (index === 0) firstAssetId = generationAssetId
    return {
      id: `${scene.id}-cinematic-${index}`,
      sceneId: scene.id,
      type: 'cinematic',
      purpose: PURPOSE_LABELS[purpose] ?? purpose,
      screenDurationSeconds: CINEMATIC_SHOT_SCREEN_SECONDS,
      generationDurationSeconds: reuse ? undefined : CINEMATIC_SHOT_GENERATION_SECONDS,
      visualPrompt: buildVisualPrompt(treatment, purpose, generationAssetId),
      sourceRefs: [`leadershipImportance:${scene.leadershipImportance ?? 'none'}`],
      requiresGeneration: !reuse,
      generationAssetId,
      reuseNote: reuse ? REUSE_NOTE : undefined,
    }
  })

  if (signal.accentType) {
    shots.push({
      id: `${scene.id}-accent`,
      sceneId: scene.id,
      type: 'motion_graphic',
      purpose: ACCENT_PURPOSE_LABEL[signal.accentType],
      screenDurationSeconds: ACCENT_SHOT_SCREEN_SECONDS,
      accentType: signal.accentType,
      sourceRefs: signal.accentSourceRef ? [signal.accentSourceRef] : [],
      requiresGeneration: false,
    })
  }

  const totalScreenSeconds = shots.reduce((sum, shot) => sum + shot.screenDurationSeconds, 0)
  return { sceneId: scene.id, title: scene.title, treatment, treatmentLabel, shots, totalScreenSeconds }
}

export function planShotsForStoryboard(scenes: VideoStoryboardScene[]): ScenePlan[] {
  return scenes.map(planShotsForScene)
}

// AUTHORITATIVE COUNTING — every summary number a report or the UI shows
// is derived here, directly from the actual planned-shot collection.
// Nothing here is hand-computed or hardcoded: totalVisualBeats is just
// allShots.length, and the per-type counts are plain filters, so
// totalVisualBeats = cinematicUsages + motionBeats + brandedBeats holds
// structurally. uniqueGenerationAssets is computed via a Set of
// generationAssetId — a genuinely separate code path from newClipsRequired
// (which counts requiresGeneration shots) — so the two serve as an
// independent cross-check of each other rather than one being derived
// from the other.
export function summarizeGenerationNeeds(scenePlans: ScenePlan[]): CinematicGenerationEstimate {
  const allShots = scenePlans.flatMap((plan) => plan.shots)
  const cinematicShots = allShots.filter((shot) => shot.type === 'cinematic')
  const motionShots = allShots.filter((shot) => shot.type === 'motion_graphic')
  const brandedShots = allShots.filter((shot) => shot.type === 'branded')
  const generatingShots = allShots.filter((shot) => shot.requiresGeneration)
  const uniqueAssetIds = new Set(allShots.map((shot) => shot.generationAssetId).filter((id): id is string => Boolean(id)))
  const totalGeneratedSeconds = generatingShots.reduce((sum, shot) => sum + (shot.generationDurationSeconds ?? 0), 0)

  return {
    totalVisualBeats: allShots.length,
    cinematicUsages: cinematicShots.length,
    motionBeats: motionShots.length,
    brandedBeats: brandedShots.length,
    uniqueGenerationAssets: uniqueAssetIds.size,
    newClipsRequired: generatingShots.length,
    totalGeneratedSeconds,
    estimatedCostUsd: estimateGenerationCostUsd(totalGeneratedSeconds),
  }
}
