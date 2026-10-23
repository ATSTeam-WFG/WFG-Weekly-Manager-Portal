// .js extension required so this file remains resolvable both under the
// app's own bundler moduleResolution (tsconfig.app.json) and under
// tsconfig.api.json's nodenext resolution — this file is imported directly
// by api/video/generate-storyboard.ts (see that file's own comment on why
// videoStoryboard.ts/atsReport.ts, both pure/side-effect-free, are safe to
// import there), which pulls this same strictness in transitively.
import type { AtsReport } from './atsReport.js'

// Video Creation's own storyboard model — deliberately independent of
// AtsReport (never a modification of it, never re-exported as if it were
// the same shape). AtsReport is the single shared ATS-format source of
// truth for Weekly Summary/Leadership Report/Executive Analysis; a
// storyboard is a separate, video-specific transformation OF that source,
// then edited entirely independently in memory. Nothing in this file ever
// reads from or writes to Supabase, calls an AI service, or persists
// anything — purely a data shape plus a pure, deterministic transform
// function (buildStoryboardFromAtsReport, below). The AI-assisted
// generator (api/video/generate-storyboard.ts) is a separate, server-side
// module that returns this exact same shape — see its own file for how it
// validates an AI response into it. Both paths produce an identical
// VideoStoryboard, so the editor (VideoCreationStoryboard.tsx) never needs
// to know or care which one produced any given storyboard.
//
// The controlled scene-type vocabulary below is fixed by product direction
// (semantic scene types a future renderer maps to designed WFG layouts —
// "AI chooses the STORY, our renderer controls the DESIGN"). Nothing in
// this app lets a caller (human or AI) supply arbitrary HTML/CSS/layout —
// every scene is exactly this typed shape, nothing more.
export type VideoSceneType =
  | 'opening'
  | 'executive-snapshot'
  | 'big-metric'
  | 'multi-metric'
  | 'highlights'
  | 'status'
  | 'risk'
  | 'forward-look'
  | 'closing'

// A metric is only ever produced by lifting EXISTING numeric information
// out of the source report — label/value (and, for AI-generated scenes,
// optionally a short grounding `context`) are substrings/paraphrases of
// real source text, never computed/aggregated/invented figures.
export interface VideoSceneMetric {
  label: string
  value: string
  context?: string
}

export type VideoStoryboardGenerationMethod = 'ai' | 'deterministic'

// WHY a scene exists in the leadership video — a controlled classification
// separate from its on-screen content, so "why is this scene here?" is
// always answerable without parsing free text. Deliberately a single value
// per scene (not a set): a scene earns its place in the video for one
// dominant leadership reason, and forcing that choice keeps this a real
// prioritization signal rather than a vague multi-tag afterthought. This is
// LEADERSHIP INTELLIGENCE about the content, never itself a fact rendered
// on screen.
//
// 'notable-development' is the DELIBERATE escape valve: this vocabulary
// must never force a future week's genuinely different content (a product
// launch, an organizational change, a staffing/training update, customer
// experience, a regulatory matter, a strategic decision, a project
// delivery/implementation milestone — none of which are "performance,"
// "risk," or "growth-pipeline" shaped) into one of the other nine values
// just because they're the only ones that currently exist. Sep 25's
// content happened to be metric/risk/pipeline-shaped; that is a property of
// THAT week's report, never an assumption this vocabulary is allowed to
// bake in. A scene classified 'notable-development' still gets no story
// engine (see inferStoryEngine's own comment) and simply keeps the
// existing safe, neutral editorial treatment — it is never dropped or
// mis-classified just because no rich visual treatment exists for it yet.
export const LEADERSHIP_IMPORTANCE_VALUES = [
  'executive-context',
  'performance',
  'major-metric',
  'win',
  'risk',
  'operational-friction',
  'technology-friction',
  'growth-pipeline',
  'blocker',
  'next-priority',
  'notable-development',
] as const
export type LeadershipImportance = (typeof LEADERSHIP_IMPORTANCE_VALUES)[number]

export const LEADERSHIP_IMPORTANCE_LABELS: Record<LeadershipImportance, string> = {
  'executive-context': 'Executive Context',
  performance: 'Performance',
  'major-metric': 'Major Metric',
  win: 'Win',
  risk: 'Risk',
  'operational-friction': 'Operational Friction',
  'technology-friction': 'Technology Friction',
  'growth-pipeline': 'Growth / Pipeline',
  blocker: 'Blocker',
  'next-priority': 'Next Priority',
  'notable-development': 'Notable Development',
}

// HOW a scene tells its (already-selected) story visually — a SEPARATE
// concept from leadershipImportance on purpose (see videoStoryboard's own
// module comment below): business-fact selection must be locked in before
// visual treatment is ever chosen, so a scene's importance can never be
// influenced by which of these looks best animated. A small, deliberately
// reusable vocabulary (not "one concept per scene") — remotion/sceneRegistry.ts's
// sibling, remotion/visualConceptRegistry.ts, maps each of these to one of a
// handful of shared visual primitives (a flow/network diagram, an animated
// path, a pressure gauge, a milestone marker), never to bespoke per-concept
// artwork. 'editorial-headline'/'hero-metric'/'closing-brand' intentionally
// have no decoration in the renderer — those scene types already carry
// their own full visual weight; see visualConceptRegistry.ts's own comment.
export const VISUAL_CONCEPT_VALUES = [
  'editorial-headline',
  'hero-metric',
  'metric-comparison',
  'growth-trajectory',
  'pipeline-flow',
  'process-flow',
  'bottleneck',
  'systems-connection',
  'risk-pressure',
  'progress-path',
  'milestone',
  'forward-path',
  'closing-brand',
] as const
export type VisualConcept = (typeof VISUAL_CONCEPT_VALUES)[number]

export const VISUAL_CONCEPT_LABELS: Record<VisualConcept, string> = {
  'editorial-headline': 'Editorial Headline',
  'hero-metric': 'Hero Metric',
  'metric-comparison': 'Metric Comparison',
  'growth-trajectory': 'Growth Trajectory',
  'pipeline-flow': 'Pipeline Flow',
  'process-flow': 'Process Flow',
  bottleneck: 'Bottleneck',
  'systems-connection': 'Systems Connection',
  'risk-pressure': 'Risk Pressure',
  'progress-path': 'Progress Path',
  milestone: 'Milestone',
  'forward-path': 'Forward Path',
  'closing-brand': 'Closing Brand',
}

// The VISUAL DIRECTOR layer — a structured refinement layered ON TOP of
// visualConcept (never a replacement for it: visualConcept still names the
// concept and still drives remotion/visualConceptRegistry.ts's small
// decoration primitives unchanged). visualPlan additionally tells the
// renderer WHAT should visually communicate the concept (subject), what
// should dominate the frame (emphasis), how the scene should be composed
// (composition), and how it should move (motion) — enough structure for
// remotion/heroIllustrationRegistry.ts to select a big, primary illustration
// (see remotion/illustrations/) rather than a small side-column accent.
// Every value below is a fixed enum member, exactly like every other
// controlled vocabulary in this file — there is no field anywhere in this
// shape a caller (human or AI) can use to supply arbitrary HTML/CSS/React,
// so a visual plan can never become a second, uncontrolled design channel.
export const VISUAL_SUBJECT_VALUES = [
  'value-accumulation',
  'document-workflow',
  'systems-connection',
  'blocked-connection',
  'trajectory-path',
  'milestone-landscape',
  'opportunity-nodes',
  'comparison-bars',
  'forward-destinations',
  'brand-mark',
] as const
export type VisualSubject = (typeof VISUAL_SUBJECT_VALUES)[number]

export const VISUAL_SUBJECT_LABELS: Record<VisualSubject, string> = {
  'value-accumulation': 'Value Accumulation',
  'document-workflow': 'Document Workflow',
  'systems-connection': 'Systems Connection',
  'blocked-connection': 'Blocked Connection',
  'trajectory-path': 'Trajectory Path',
  'milestone-landscape': 'Milestone Landscape',
  'opportunity-nodes': 'Opportunity Nodes',
  'comparison-bars': 'Comparison Bars',
  'forward-destinations': 'Forward Destinations',
  'brand-mark': 'Brand Mark',
}

// What should visually DOMINATE the frame — informs relative sizing between
// the illustration and any onscreen metric/headline, never a numeric scale.
export const VISUAL_EMPHASIS_VALUES = ['dominant-number', 'process-flow', 'comparison', 'forward-momentum', 'brand'] as const
export type VisualEmphasis = (typeof VISUAL_EMPHASIS_VALUES)[number]

// How the frame is laid out — the renderer's fixed set of compositions
// (remotion/StoryScene.tsx), never an arbitrary layout instruction.
export const VISUAL_COMPOSITION_VALUES = [
  'full-bleed-illustration',
  'illustration-with-metric',
  'split-illustration-text',
  'minimal-brand',
] as const
export type VisualComposition = (typeof VISUAL_COMPOSITION_VALUES)[number]

// The illustration's motion intent — maps to one of the deterministic
// Remotion animation treatments already built for the matching subject
// (e.g. 'accumulate' drives ValueAccumulation's rising stack); never a
// request for arbitrary/gimmicky motion.
export const VISUAL_MOTION_VALUES = [
  'accumulate',
  'flow-forward',
  'flow-blocked',
  'connect-reveal',
  'trajectory-rise',
  'sequence-reveal',
  'static-hold',
] as const
export type VisualMotion = (typeof VISUAL_MOTION_VALUES)[number]

export interface VisualPlan {
  subject: VisualSubject
  emphasis: VisualEmphasis
  composition: VisualComposition
  motion: VisualMotion
}

// The REUSABLE STORY TEMPLATE a scene renders through — the layer ABOVE
// visualConcept/visualPlan (which still describe WHAT the visual is and
// HOW it should look/move; storyEngine decides WHICH of a small, fixed set
// of Remotion template components does the rendering). These are AVAILABLE
// VISUAL TREATMENTS, not required content categories — a scene whose
// actual content doesn't genuinely fit one of them always keeps its
// existing, perfectly safe editorial treatment instead (see
// inferStoryEngine's own comment); a scene is never forced into one of
// these three just because they're currently the only rich, FLUX-backed
// treatments that exist. Exactly three exist TODAY — "do not create a
// special animation specifically for [any single week's] topic" — each
// reusable across every future weekly report whose content genuinely fits:
//   - metric-story: revenue/remittance/orders/performance — a hero number
//     with a value-accumulation visual, exact figures rendered by
//     Remotion, never drawn by FLUX.
//   - bottleneck-story: operational friction/risk/technology or process
//     constraints — healthy flow -> friction -> congestion -> rework ->
//     constrained downstream flow.
//   - pipeline-story: commercial pipeline/growth/onboarding/forward
//     progress — staged opportunities advancing toward a visible
//     destination.
// A future report may contain entirely different concepts (a product
// launch, an organizational change, staffing/training, customer
// experience, a regulatory update, a strategic decision, a project
// delivery/implementation milestone) that no engine here fits — that scene
// correctly gets NO storyEngine (undefined) and none should ever be
// invented for it. Opening/executive-snapshot/forward-look/closing
// deliberately never get one either (see
// DETERMINISTIC_STORY_ENGINE_BY_SCENE_TYPE's own comment) — they keep
// their existing simpler editorial treatment.
export const STORY_ENGINE_VALUES = ['metric-story', 'bottleneck-story', 'pipeline-story'] as const
export type StoryEngine = (typeof STORY_ENGINE_VALUES)[number]

export const STORY_ENGINE_LABELS: Record<StoryEngine, string> = {
  'metric-story': 'Metric Story',
  'bottleneck-story': 'Bottleneck Story',
  'pipeline-story': 'Pipeline Story',
}

// Every field beyond id/type/title is optional and deliberately absent
// (not an empty string/array) when the source has nothing to say there —
// "missing content stays missing," never a fabricated placeholder. `next`
// exists only on scenes derived from a single source topic; forward-look's
// own aggregated next-items live in `bullets` instead (see below).
//
// sourceTopicIndexes: zero-based indexes into the SOURCE report's own
// `topics` array that this scene's factual content is grounded in —
// lightweight traceability, not shown in the video itself. Absent (never
// an empty array as a "no grounding needed" signal) on the purely
// structural opening/closing/executive-snapshot scenes; present on every
// scene that carries a business-content claim.
//
// leadershipImportance/visualConcept: see their own vocabulary comments
// above. Both optional/absent exactly like every other field here — the
// deterministic transformer only ever fills in visualConcept (a purely
// structural, always-safe inference from sceneType) and leaves
// leadershipImportance unset for topic-derived scenes, since judging WHY
// something matters to leadership is a semantic call the deterministic
// path deliberately never attempts (the same restraint it already applies
// to never guessing a 'risk' sceneType). visualPlan follows the identical
// restraint: the deterministic path only ever fills in a purely structural
// default (see DETERMINISTIC_VISUAL_PLAN_BY_SCENE_TYPE, below).
//
// narrationText: a concise, source-grounded SPOKEN version of this scene's
// content. Evolved (this phase) from an isolated per-scene aside into one
// segment of a single CONTINUOUS video script — the AI is prompted to write
// each scene's narrationText so that, read in scene order, they form one
// connected executive narration (see generate-storyboard.ts's prompt) —
// but the DATA SHAPE is unchanged: still one grounded string per scene,
// still produced by the SAME storyboard-generation call that already
// selected this scene's facts, never a second independent
// narration-writing pass over the source. Like every other content field,
// it must never contain a number that isn't already grounded elsewhere in
// this same scene — validated server-side in videoStoryboardSchema.ts's
// validateNarrationGrounding. Actually synthesized into audio (this phase)
// by scripts/lib/narrationAudio.mts, entirely locally — see that file's own
// header for the TTS engine/license.
//
// NARRATION_TEXT_MAX_LENGTH is the ONE shared narration-length contract —
// the single number every layer of the narration pipeline must agree on so
// they can never drift apart:
//   - THIS constant (the canonical value)
//   - api/video/generate-storyboard.ts's prompt (tells the model the exact
//     hard limit, imported as a real value — this file is exempt from the
//     .js/.ts bare-node-test constraint documented above, same as
//     inferStoryEngine)
//   - api/_lib/videoStoryboardSchema.ts's AI_STORYBOARD_SCENE_SCHEMA
//     narrationText.maxLength (a structural hint to Anthropic's own
//     structured-output enforcement) and its MAX_NARRATION_LENGTH business
//     validator (the actual enforced ceiling) — duplicated there for the
//     same node16/nodenext reason as the vocabulary arrays above, kept in
//     sync by videoStoryboardSchema.test.ts's own cross-check.
// Deliberately concise (not "arbitrarily huge") — a scene's narration is a
// short spoken sentence, not written-report prose, for a video whose total
// spoken narration targets roughly 35-55 seconds across every scene (see
// the prompt's own target). Tightened from 280 during the visual-
// direction/duration pass — the real Sep 25 test render came in at 98.45s
// against a 60-90s product target, and per-scene narration length (not the
// aggregate guidance alone) was the dominant lever, since scenes were
// consistently using close to the old ceiling.
export const NARRATION_TEXT_MAX_LENGTH = 210

export interface VideoStoryboardScene {
  id: string
  type: VideoSceneType
  eyebrow?: string
  title: string
  body?: string
  bullets?: string[]
  metrics?: VideoSceneMetric[]
  next?: string
  durationSeconds?: number
  sourceTopicIndexes?: number[]
  leadershipImportance?: LeadershipImportance
  visualConcept?: VisualConcept
  visualPlan?: VisualPlan
  storyEngine?: StoryEngine
  narrationText?: string
  // RENDER-TIME ONLY — never produced by the AI schema, the deterministic
  // transformer, or edited anywhere in the browser storyboard UI. Populated,
  // exactly like narrationAudio.mts overwrites durationSeconds with a real
  // synthesized length, by scripts/lib/fluxAssets.mts immediately before
  // bundle() — a path (relative to remotion/public/) to a locally generated,
  // cached FLUX.1-schnell PNG for this scene's (storyEngine,
  // visualPlan.subject) pair, only ever set when that generation actually
  // succeeded. Absent (never a fabricated path) whenever no FLUX asset
  // exists yet, generation failed, or the pair has no mapped prompt (see
  // remotion/fluxPrompts.ts) — StoryScene.tsx falls back to the existing
  // programmatic SVG hero illustration in every one of those cases.
  fluxAssetPath?: string
  // RENDER-TIME ONLY (visual-direction v3) — same discipline as
  // fluxAssetPath above, populated by the SAME scripts/lib/fluxAssets.mts
  // pass, but for the PRIMARY hero illustration (remotion/fluxPrompts.ts's
  // getFluxHeroPrompt) rather than an ambient backdrop. Only ever set for
  // the subjects that have a mapped hero prompt; absent for everything
  // else, in which case IllustratedStoryScene.tsx is never reached at all
  // and the scene falls back to the existing LayeredStoryScene/StoryScene
  // treatment — the safe editorial fallback for an unfamiliar future topic.
  fluxHeroAssetPath?: string
  // RENDER-TIME ONLY — a second, small "state change" motif composited on
  // top of fluxHeroAssetPath partway through the scene (see
  // getFluxMotifPrompt). Only ever set for the one subject pairing that
  // has one today (systems/blocked-connection's snapped-wire motif); every
  // other hero-mapped subject achieves its own state change with pure
  // Remotion overlays and never sets this field.
  fluxMotifAssetPath?: string
  // RENDER-TIME ONLY (Luma Ray 3.2 cinematic engine, generalized) — zero,
  // one, or more real generated/trimmed video clips for this scene, set
  // ONLY by an explicit human-approved generation step — never produced by
  // the AI schema, the deterministic transformer, or any automatic
  // process. Absent for every scene until that step runs, in which case
  // the scene keeps its existing FLUX-hero/LayeredStoryScene treatment
  // completely unchanged (see remotion/shotPlan.ts). When present,
  // IllustratedStoryScene.tsx's LumaShotSequence plays these real clips —
  // each bounded by its own trimmed duration, never held past its last
  // frame, never looped — instead of the FLUX still, interleaved with at
  // most one short (~1.5-3s) motion-graphic accent. This is a GENERAL
  // mechanism for any week/scene, not specific to any one topic.
  cinematicAssets?: CinematicAsset[]
  // RENDER-TIME ONLY (Phase 2 Step 2A — AI Presenter & Voice, HeyGen avatar
  // video) — same discipline as fluxHeroAssetPath/cinematicAssets above:
  // never produced by the AI schema, the deterministic transformer, or
  // any automatic process. Set by the browser (VideoCreationAvatarConsent.tsx's
  // "Prepare opening & closing clips" action) to a path RELATIVE TO
  // remotion/public/ — e.g. "avatar-video/opening.mp4" — once a real,
  // authorized generate_avatar_video result has been downloaded into that
  // local folder by dev/local-avatar-asset-plugin.ts's own dev-only
  // bridge. The clip's own audio track IS this scene's narration — see
  // WfgExecutiveVideo.tsx's own comment on why the separate narration
  // <Audio> is skipped whenever this is set. Only ever meaningful for the
  // opening/closing scenes per the approved design direction ("reserve
  // avatar appearances for opening and forward-looking scenes"), but
  // deliberately not type-restricted to those two — a scene component
  // that doesn't support it simply never reads this field, exactly like
  // every other optional render-time field above.
  avatarVideoAssetPath?: string
  // RENDER-TIME ONLY — the avatar clip's REAL measured length in seconds,
  // set by scripts/lib/avatarVideoAssets.mts immediately before bundle()
  // (same timing discipline, and same reason, as fluxAssetPath/narration
  // audio: the file must exist and be measured before Remotion's own
  // publicDir copy). Never estimated, never AI-authored. Drives both this
  // scene's own durationSeconds (so the clip is never cut off mid-speech)
  // and AvatarVideoOverlay's loopDurationInFrames (so the clip repeats
  // rather than going blank during this scene's lead-in/tail padding).
  // Absent whenever avatarVideoAssetPath is absent, or when the
  // referenced file could not be found/measured (a graceful degrade back
  // to the scene's normal, non-avatar treatment — see
  // avatarVideoAssets.mts's own header).
  avatarVideoDurationSeconds?: number
}

// ONE cinematic shot's source — the SAME downloaded clip may appear twice
// in a scene's cinematicAssets with different trim/crop values (an
// editorial "wide" vs "close-up" cut from one generation), which is the
// preferred way to get a second distinct-feeling shot before paying for a
// new generation. `assetPath` is relative to remotion/public/, exactly
// like fluxHeroAssetPath.
export interface CinematicAsset {
  assetPath: string
  // The clip's own real duration (via @remotion/renderer's
  // getVideoMetadata), probed once per generated file. Lets shotPlan.ts
  // bound this shot at exactly the real footage length.
  durationSeconds: number
  // Optional in-clip trim (seconds) — lets one generation yield more than
  // one shot. Omitted means "use from the start" / "use to the clip's end."
  trimStartSeconds?: number
  trimEndSeconds?: number
  // Optional digital reframe — simulates a "cut to a different angle"
  // from the same source (e.g. a tighter crop toward a detail) with no
  // new footage. cropOrigin is a CSS transform-origin value (e.g. "65% 70%");
  // cropScale is how far to zoom in (1 = no zoom).
  cropOrigin?: string
  cropScale?: number
}

export type VideoStoryboardSourceType = 'weekly-summary' | 'leadership-report'

export interface VideoStoryboard {
  title: string
  weekEnding: string
  sourceType: VideoStoryboardSourceType
  generationMethod: VideoStoryboardGenerationMethod
  scenes: VideoStoryboardScene[]
}

// Deterministic, source-text-only extraction — never a calculation, never
// an invented figure. A bullet qualifies only when it has a genuine
// "label: value" shape AND the value half contains at least one digit
// (distinguishing "Revenue: $1.2M" from ordinary prose like "Closed 12
// deals this week", which has a digit but no label:value structure and is
// correctly left as a plain bullet instead).
function tryParseMetricBullet(bullet: string): VideoSceneMetric | null {
  const colonIndex = bullet.indexOf(':')
  if (colonIndex === -1) return null
  const label = bullet.slice(0, colonIndex).trim()
  const value = bullet.slice(colonIndex + 1).trim()
  if (!label || !value) return null
  if (!/\d/.test(value)) return null
  return { label, value }
}

const MIN_SCENE_DURATION_SECONDS = 3
const MAX_SCENE_DURATION_SECONDS = 15

// A purely STRUCTURAL sceneType -> visualConcept default — safe for the
// deterministic path because it only ever reflects the scene's already-known
// shape (never a semantic/content judgment). 'risk' has no entry because the
// deterministic transformer never produces a 'risk' scene (see its own
// comment below); an AI-generated risk scene always supplies its own
// visualConcept, validated against the same vocabulary server-side.
const DETERMINISTIC_VISUAL_CONCEPT_BY_SCENE_TYPE: Partial<Record<VideoSceneType, VisualConcept>> = {
  opening: 'editorial-headline',
  'executive-snapshot': 'editorial-headline',
  'big-metric': 'hero-metric',
  'multi-metric': 'metric-comparison',
  highlights: 'growth-trajectory',
  status: 'progress-path',
  'forward-look': 'forward-path',
  closing: 'closing-brand',
}

// A purely STRUCTURAL sceneType -> visualPlan default — the Visual Director
// layer's own equivalent of the map above, and subject to the identical
// restraint: every value here reflects only the scene's already-known
// SHAPE, never a semantic read of its content. 'risk' has no entry for the
// same reason as above (the deterministic transformer never produces one).
const DETERMINISTIC_VISUAL_PLAN_BY_SCENE_TYPE: Partial<Record<VideoSceneType, VisualPlan>> = {
  opening: { subject: 'brand-mark', emphasis: 'brand', composition: 'minimal-brand', motion: 'static-hold' },
  'executive-snapshot': { subject: 'brand-mark', emphasis: 'brand', composition: 'split-illustration-text', motion: 'static-hold' },
  'big-metric': { subject: 'value-accumulation', emphasis: 'dominant-number', composition: 'illustration-with-metric', motion: 'accumulate' },
  'multi-metric': { subject: 'comparison-bars', emphasis: 'comparison', composition: 'illustration-with-metric', motion: 'sequence-reveal' },
  highlights: { subject: 'trajectory-path', emphasis: 'forward-momentum', composition: 'split-illustration-text', motion: 'trajectory-rise' },
  status: { subject: 'trajectory-path', emphasis: 'process-flow', composition: 'split-illustration-text', motion: 'sequence-reveal' },
  'forward-look': { subject: 'forward-destinations', emphasis: 'forward-momentum', composition: 'split-illustration-text', motion: 'sequence-reveal' },
  closing: { subject: 'brand-mark', emphasis: 'brand', composition: 'minimal-brand', motion: 'static-hold' },
}

// Selects one of the three reusable story engines (or none, for scenes
// that keep their simpler editorial treatment) — the SAME function backs
// both the deterministic transformer (scene.type only, since it never
// judges leadershipImportance) and api/video/generate-storyboard.ts's
// post-validation fallback for an AI-generated scene that left
// storyEngine "" (leadershipImportance is the stronger signal there,
// since it reflects the AI's own already-made judgment call). Never a
// second AI call — this is a pure, deterministic lookup.
export function inferStoryEngine(params: {
  sceneType: VideoSceneType
  leadershipImportance?: LeadershipImportance
  hasMetrics: boolean
}): StoryEngine | undefined {
  const { sceneType, leadershipImportance, hasMetrics } = params

  // Opening/executive-snapshot/forward-look/closing deliberately never
  // get a story engine, regardless of any other signal — they keep their
  // existing simpler editorial treatment (see StoryEngine's own comment).
  if (sceneType === 'opening' || sceneType === 'closing' || sceneType === 'executive-snapshot' || sceneType === 'forward-look') {
    return undefined
  }

  if (leadershipImportance) {
    switch (leadershipImportance) {
      case 'performance':
      case 'major-metric':
        return 'metric-story'
      case 'risk':
      case 'operational-friction':
      case 'technology-friction':
      case 'blocker':
        return 'bottleneck-story'
      case 'growth-pipeline':
      case 'next-priority':
        return 'pipeline-story'
      case 'win':
        // A "win" reads as either a metric win or a growth win — the
        // scene's own metrics (structural, not a second semantic
        // judgment) break the tie.
        return hasMetrics ? 'metric-story' : 'pipeline-story'
      case 'executive-context':
      // 'notable-development' is precisely the content that does NOT fit
      // one of the three available treatments — that is the entire point
      // of the value (see LEADERSHIP_IMPORTANCE_VALUES's own comment), so
      // it deliberately falls through to the same "no engine" result as
      // executive-context, never a forced/best-guess engine.
      case 'notable-development':
        return undefined
    }
  }

  // Structural fallback (scene.type alone) — what the deterministic
  // transformer always uses (it never sets leadershipImportance for
  // topic-derived scenes), and a safety net for an AI-generated scene
  // that left leadershipImportance blank too. Deliberately narrow: a scene
  // that structurally reduces to "one or more existing numbers" genuinely
  // suits metric-story's value-accumulation visual regardless of the
  // underlying topic (a staffing scene with "5 new hires" fits this just
  // as well as a revenue scene), so that inference carries no content
  // assumption. 'risk'/'highlights'/'status', in contrast, are broad,
  // content-agnostic buckets that could hold ANY future kind of update —
  // guessing bottleneck-story/pipeline-story from scene TYPE alone (with
  // no leadershipImportance signal backing it) would be exactly the
  // "force it into one of the only rich treatments we have" mistake this
  // function exists to avoid, so those now correctly fall through to no
  // engine at all (the existing, perfectly safe editorial treatment).
  switch (sceneType) {
    case 'big-metric':
    case 'multi-metric':
      return 'metric-story'
    default:
      return undefined
  }
}

// A rough, clearly-approximate per-scene pacing estimate — never presented
// as a fact drawn from the report, just a UI/renderer hint proportional to
// how much this scene actually has to show.
function estimateSceneDurationSeconds(scene: Pick<VideoStoryboardScene, 'body' | 'bullets' | 'metrics' | 'next'>): number {
  let seconds = 4
  if (scene.body) seconds += 2
  seconds += (scene.bullets?.length ?? 0) * 1.5
  seconds += (scene.metrics?.length ?? 0) * 1.5
  if (scene.next) seconds += 1.5
  return Math.min(MAX_SCENE_DURATION_SECONDS, Math.max(MIN_SCENE_DURATION_SECONDS, Math.round(seconds)))
}

// The deterministic Source -> Storyboard transform — no Anthropic/AI call
// of any kind, always available as a safe fallback for
// api/video/generate-storyboard.ts's AI-assisted path. `report` is only
// ever read here (.trim()/.map()/.filter() — never assigned into); every
// scene/bullets/metrics array below is newly constructed, so nothing in
// the returned VideoStoryboard can ever share a reference back into
// `report`, and mutating the storyboard afterward (scene edits,
// reordering, deletion) can never be observed by, or written back into,
// the source report.
//
// weekEndingLabel is caller-supplied (already resolved the same way every
// other ATS-format consumer in this app resolves it — see
// LeadershipReportCurrent.tsx's own weekEndingLabel/periodLabel handling)
// rather than recomputed here, so this module has no date-formatting
// opinion of its own.
export function buildStoryboardFromAtsReport(
  report: AtsReport,
  weekEndingLabel: string,
  sourceType: VideoStoryboardSourceType,
): VideoStoryboard {
  const scenes: VideoStoryboardScene[] = []

  scenes.push({
    id: 'opening',
    type: 'opening',
    title: 'WFG Weekly Leadership Update',
    body: weekEndingLabel,
    durationSeconds: 5,
    leadershipImportance: 'executive-context',
    visualConcept: DETERMINISTIC_VISUAL_CONCEPT_BY_SCENE_TYPE.opening,
    visualPlan: DETERMINISTIC_VISUAL_PLAN_BY_SCENE_TYPE.opening,
    // Fixed WFG framing copy, not a source-derived claim — safe for the
    // deterministic path to narrate, exactly like the fixed on-screen title.
    narrationText: FIXED_OPENING_NARRATION_TEXT,
  })

  const openingParagraph = report.openingParagraph.trim()
  if (openingParagraph.length > 0) {
    scenes.push({
      id: 'executive-snapshot',
      type: 'executive-snapshot',
      eyebrow: 'Executive Snapshot',
      title: 'Executive Snapshot',
      body: openingParagraph,
      durationSeconds: estimateSceneDurationSeconds({ body: openingParagraph }),
      leadershipImportance: 'executive-context',
      visualConcept: DETERMINISTIC_VISUAL_CONCEPT_BY_SCENE_TYPE['executive-snapshot'],
      visualPlan: DETERMINISTIC_VISUAL_PLAN_BY_SCENE_TYPE['executive-snapshot'],
      // The deterministic path narrates the SAME paragraph already shown
      // on screen verbatim — never a second, independently-written summary
      // of it (see this file's own "no second independent narration" note).
      narrationText: openingParagraph,
    })
  }

  report.topics.forEach((topic, index) => {
    const bullets = topic.bullets.map((bullet) => bullet.trim()).filter((bullet) => bullet.length > 0)
    const metrics: VideoSceneMetric[] = []
    const remainingBullets: string[] = []
    for (const bullet of bullets) {
      const metric = tryParseMetricBullet(bullet)
      if (metric) {
        metrics.push(metric)
      } else {
        remainingBullets.push(bullet)
      }
    }

    const statusSummary = topic.statusSummary.trim()
    const next = topic.next.trim()

    // One metric -> 'big-metric' (a single hero figure); several ->
    // 'multi-metric'; else 'highlights' when plain bullets remain; else
    // 'status' (statusSummary-only, no bullets at all). The deterministic
    // transformer never guesses 'risk' — that judgment call is left to the
    // AI-assisted path; this safe fallback sticks to what can be inferred
    // from structure alone, never content sentiment.
    const sceneType: VideoSceneType =
      metrics.length === 1 ? 'big-metric' : metrics.length > 1 ? 'multi-metric' : remainingBullets.length > 0 ? 'highlights' : 'status'

    const body = statusSummary.length > 0 ? statusSummary : undefined
    const sceneBullets = remainingBullets.length > 0 ? remainingBullets : undefined
    const sceneMetrics = metrics.length > 0 ? metrics : undefined
    const sceneNext = next.length > 0 ? next : undefined

    scenes.push({
      id: `topic-${index}`,
      type: sceneType,
      // The topic's own title, verbatim from the source report — never a
      // hard-coded/invented business-topic label of this module's own.
      title: topic.title,
      body,
      bullets: sceneBullets,
      metrics: sceneMetrics,
      next: sceneNext,
      durationSeconds: estimateSceneDurationSeconds({ body, bullets: sceneBullets, metrics: sceneMetrics, next: sceneNext }),
      sourceTopicIndexes: [index],
      visualConcept: DETERMINISTIC_VISUAL_CONCEPT_BY_SCENE_TYPE[sceneType],
      visualPlan: DETERMINISTIC_VISUAL_PLAN_BY_SCENE_TYPE[sceneType],
      storyEngine: inferStoryEngine({ sceneType, hasMetrics: sceneMetrics !== undefined }),
      // No narrationText: writing a spoken version of a topic's content is
      // a semantic judgment the deterministic path deliberately never
      // attempts (same restraint as leadershipImportance, above) — this
      // scene simply plays silently/on its own durationSeconds when the AI
      // path is unavailable, rather than fabricating a narrated summary.
    })
  })

  // Built ONLY from topics that actually have a non-empty Next/action —
  // never invented, and entirely absent (no forward-look scene at all)
  // when no topic has one.
  const forwardLookTopics = report.topics
    .map((topic, index) => ({ index, title: topic.title, next: topic.next.trim() }))
    .filter((topic) => topic.next.length > 0)

  if (forwardLookTopics.length > 0) {
    const forwardLookBullets = forwardLookTopics.map((topic) => `${topic.title}: ${topic.next}`)
    scenes.push({
      id: 'forward-look',
      type: 'forward-look',
      eyebrow: 'Forward Look',
      title: 'Forward Look',
      bullets: forwardLookBullets,
      durationSeconds: estimateSceneDurationSeconds({ bullets: forwardLookBullets }),
      sourceTopicIndexes: forwardLookTopics.map((topic) => topic.index),
      leadershipImportance: 'next-priority',
      visualConcept: DETERMINISTIC_VISUAL_CONCEPT_BY_SCENE_TYPE['forward-look'],
      visualPlan: DETERMINISTIC_VISUAL_PLAN_BY_SCENE_TYPE['forward-look'],
      // No narrationText — same restraint as the topic-derived scenes above.
    })
  }

  // "Together We Close More" is the app's own existing WFG tagline
  // (AdminSidebar.tsx's SidebarDecoration) — reused verbatim, not an
  // invented closing statement.
  scenes.push({
    id: 'closing',
    type: 'closing',
    title: 'WFG Weekly Leadership Update',
    body: 'Together We Close More.',
    durationSeconds: 4,
    leadershipImportance: 'executive-context',
    visualConcept: DETERMINISTIC_VISUAL_CONCEPT_BY_SCENE_TYPE.closing,
    visualPlan: DETERMINISTIC_VISUAL_PLAN_BY_SCENE_TYPE.closing,
    // The same fixed tagline, reused verbatim as narration too.
    narrationText: FIXED_CLOSING_NARRATION_TEXT,
  })

  return {
    title: 'WFG Weekly Leadership Update',
    weekEnding: weekEndingLabel,
    sourceType,
    generationMethod: 'deterministic',
    scenes,
  }
}

const SECONDS_PER_SCENE_FALLBACK = 6
const MIN_DURATION_SECONDS = 20

// A rough, clearly-approximate pacing estimate for the Storyboard step's
// "approximate duration estimate" — sums each scene's own durationSeconds
// when present (both the deterministic transformer above and the
// AI-assisted path always set one), falling back to a flat per-scene
// default only for a scene that somehow lacks one. A UI hint about the
// eventual video, never presented as a fact drawn from the report itself.
export function estimateStoryboardDurationSeconds(storyboard: VideoStoryboard): number {
  const total = storyboard.scenes.reduce((sum, scene) => sum + (scene.durationSeconds ?? SECONDS_PER_SCENE_FALLBACK), 0)
  return Math.max(MIN_DURATION_SECONDS, total)
}

// The single source of truth for "will this render actually include my
// talking presenter?" — used by Preview/Generate/Final Download to show a
// consistent Ready/Not Set indicator, and by Generate to decide whether to
// warn before rendering. True only when BOTH the opening and closing
// scenes (the only two scenes avatarVideoAssetPath is ever meaningfully
// attached to — see that field's own doc comment above) have a clip
// attached; a standard video (neither attached) or a half-prepared one
// (only one of the two) both read as "Not Set" here, by design — this is
// a binary presenter-ready signal, not a partial-progress indicator.
export function hasReadyTalkingPresenter(storyboard: VideoStoryboard): boolean {
  const opening = storyboard.scenes.find((scene) => scene.type === 'opening')
  const closing = storyboard.scenes.find((scene) => scene.type === 'closing')
  return Boolean(opening?.avatarVideoAssetPath) && Boolean(closing?.avatarVideoAssetPath)
}

// The exact text every opening/closing scene starts with — both the AI
// route and the deterministic fallback always produce these two scenes
// from this SAME builder (see buildStoryboardFromAtsReport below and
// api/video/generate-storyboard.ts's own "do not produce those two
// yourself" instruction to the model), so this is the one narration text a
// freshly-generated HeyGen clip for either scene is guaranteed to have
// been spoken against — UNLESS an admin edited it afterward in Executive
// Story (narrationText is editable there even though the scene's position
// is pinned). Exported so VideoCreation.tsx's clip-restoration logic can
// verify a scene's CURRENT text still matches before reattaching an
// already-generated clip, without needing to store the text a given clip
// job was actually generated for (a schema change, not needed here).
export const FIXED_OPENING_NARRATION_TEXT = "Here's this week's WFG leadership update."
export const FIXED_CLOSING_NARRATION_TEXT = 'Together, we close more.'

// Undefined for any scene type other than opening/closing — those are the
// only two this fixed-text guarantee applies to at all.
export function expectedFixedNarrationText(sceneType: VideoStoryboardScene['type']): string | undefined {
  if (sceneType === 'opening') return FIXED_OPENING_NARRATION_TEXT
  if (sceneType === 'closing') return FIXED_CLOSING_NARRATION_TEXT
  return undefined
}

// The HARD final-video ceiling (Phase 2, raised in the "complete 9-scene
// V3 cinematic video" phase) — distinct from
// api/_lib/videoStoryboardSchema.ts's own MAX_REASONABLE_TOTAL_SECONDS
// (180s), which only sanity-checks the AI's pre-render rough estimate.
// This constant is the one actually enforced against the REAL,
// narration-driven duration right before a render is allowed to produce a
// final MP4 (see scripts/render-storyboard.mts) — an over-the-limit
// composition must never silently render. Raised from the original 90 to
// 130 specifically to accommodate the explicit 90-120s target this phase
// was given (a full 9-scene narrated update no longer comfortably fits
// under 90s) — 130 is a safety margin above 120, still a real backstop,
// not an invitation to let narration run long.
export const MAX_FINAL_VIDEO_SECONDS = 130

export function isWithinFinalDurationLimit(totalSeconds: number): boolean {
  return totalSeconds <= MAX_FINAL_VIDEO_SECONDS
}

export function formatDurationLabel(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `~${minutes}:${String(seconds).padStart(2, '0')}`
}

// The Storyboard editor's (VideoCreationStoryboard.tsx) plain-textarea
// encodings for bullets/metrics — pulled out into this pure, JSX-free file
// so they can be unit-tested with real execution (the same reason
// executiveSummaryJson.ts exists: a .tsx file's JSX syntax can't be
// imported/run under plain `node --test`, unlike a .ts file). Never
// exported for any purpose beyond that component and its tests.

export function sceneBulletsToText(bullets: string[] | undefined): string {
  return (bullets ?? []).join('\n')
}

export function textToSceneBullets(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

// "Label: Value" — plus, only when the metric actually has one, a
// " | Context" suffix. This is the smallest round-trippable textarea
// encoding that preserves ALL THREE structured metric fields; a bare
// "Label: Value" line (no metric ever needed a trailing " | ...") parses
// back with no context, exactly as before this existed.
export function sceneMetricsToText(metrics: VideoSceneMetric[] | undefined): string {
  return (metrics ?? []).map((m) => (m.context ? `${m.label}: ${m.value} | ${m.context}` : `${m.label}: ${m.value}`)).join('\n')
}

export function textToSceneMetrics(text: string): VideoSceneMetric[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const colonIndex = line.indexOf(':')
      if (colonIndex === -1) return { label: line, value: '' }
      const label = line.slice(0, colonIndex).trim()
      const rest = line.slice(colonIndex + 1)
      const pipeIndex = rest.indexOf('|')
      if (pipeIndex === -1) return { label, value: rest.trim() }
      const value = rest.slice(0, pipeIndex).trim()
      const context = rest.slice(pipeIndex + 1).trim()
      return context ? { label, value, context } : { label, value }
    })
}
