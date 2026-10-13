// Pure, dependency-free storyboard-generation schema + validation for
// api/video/generate-storyboard.ts. Split out for the same reason
// executiveSummaryJson.ts is: that endpoint's own heavy import graph
// (Anthropic SDK, Supabase) makes it unsafe to import directly under a
// bare `node --test` run — this file has neither dependency, so its real
// validation logic (including adversarial/hallucinated fixture data) can
// be exercised with actual execution, not just source inspection.
//
// SECURITY: like executiveSummaryJson.ts, this module and its callers must
// never log, throw with, or otherwise surface the raw AI response text or
// any source report content. Every rejection `reason` string here is a
// short structural description (a field name, an index, a type name) —
// never the offending value itself.
// inferStoryEngine itself is NOT imported here (even though it's pure) —
// same reason the vocab arrays below are duplicated rather than imported:
// a genuine VALUE import from this path would break this file's own
// real-execution testability (see the vocab-array comment just below).
// The story-engine FALLBACK inference therefore lives in
// api/video/generate-storyboard.ts instead, which already imports
// videoStoryboard.js as a value (it's never run under bare `node --test`
// directly — see that file's own header).
import type {
  LeadershipImportance,
  StoryEngine,
  VisualComposition,
  VisualConcept,
  VisualEmphasis,
  VisualMotion,
  VisualSubject,
} from '../../src/lib/videoStoryboard.js'

// Deliberately DUPLICATED (never imported as a VALUE) from
// src/lib/videoStoryboard.ts's own LEADERSHIP_IMPORTANCE_VALUES/
// VISUAL_CONCEPT_VALUES. The type-only import above is erased entirely
// before Node ever resolves it, so it's safe under the same '.js'
// convention every other cross-directory reference in this codebase uses —
// but a genuine VALUE import of the same path is NOT: Node's runtime
// resolver (unlike tsc's nodenext moduleResolution or Vercel's bundler)
// never rewrites a '.js' specifier to a sibling '.ts' file, so importing
// the real arrays here would break this file's own real-execution
// testability under plain `node --test` (the entire reason this module is
// split out from generate-storyboard.ts in the first place — see this
// file's header comment). Kept from drifting out of sync by
// videoStoryboardSchema.test.ts's own dedicated cross-check test, which
// imports both files' arrays directly and asserts they're identical.
export const AI_LEADERSHIP_IMPORTANCE_VALUES = [
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
export const AI_VISUAL_CONCEPT_VALUES = [
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

// Same duplication rationale as the two arrays above — kept in sync with
// src/lib/videoStoryboard.ts's VISUAL_SUBJECT_VALUES/VISUAL_EMPHASIS_VALUES/
// VISUAL_COMPOSITION_VALUES/VISUAL_MOTION_VALUES by
// videoStoryboardSchema.test.ts's own cross-check test.
export const AI_VISUAL_SUBJECT_VALUES = [
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
export const AI_VISUAL_EMPHASIS_VALUES = ['dominant-number', 'process-flow', 'comparison', 'forward-momentum', 'brand'] as const
export const AI_VISUAL_COMPOSITION_VALUES = [
  'full-bleed-illustration',
  'illustration-with-metric',
  'split-illustration-text',
  'minimal-brand',
] as const
export const AI_VISUAL_MOTION_VALUES = [
  'accumulate',
  'flow-forward',
  'flow-blocked',
  'connect-reveal',
  'trajectory-rise',
  'sequence-reveal',
  'static-hold',
] as const

// Same duplication rationale — kept in sync with videoStoryboard.ts's
// STORY_ENGINE_VALUES by videoStoryboardSchema.test.ts's own cross-check.
export const AI_STORY_ENGINE_VALUES = ['metric-story', 'bottleneck-story', 'pipeline-story'] as const

// Deliberately EXCLUDES 'opening'/'closing' — those two remain fixed,
// server-injected WFG framing scenes (see api/video/generate-storyboard.ts)
// so they can never vary or be talked into inventing something; the AI is
// only ever asked to produce the scenes in between. This is the app's own
// controlled vocabulary — "AI chooses the STORY, our renderer controls the
// DESIGN" — never arbitrary HTML/CSS/layout of the model's own invention.
export const AI_STORYBOARD_SCENE_TYPES = [
  'executive-snapshot',
  'big-metric',
  'multi-metric',
  'highlights',
  'status',
  'risk',
  'forward-look',
] as const

export type AiStoryboardSceneType = (typeof AI_STORYBOARD_SCENE_TYPES)[number]

const MIN_SCENE_COUNT = 2
const MAX_SCENE_COUNT = 9
const MIN_SCENE_DURATION_SECONDS = 3
const MAX_SCENE_DURATION_SECONDS = 20
const MAX_EYEBROW_LENGTH = 60
const MAX_TITLE_LENGTH = 120
// Concise by design — this is a SPOKEN sentence or two, not written-report
// prose (see the prompt's own narrationText guidance in generate-storyboard.ts).
// THE single narration-length contract — kept identical to
// videoStoryboard.ts's own NARRATION_TEXT_MAX_LENGTH (duplicated here for
// the same node16/nodenext reason as the vocabulary arrays above; cross-
// checked by videoStoryboardSchema.test.ts) — never a second, silently
// different number the AI/schema/validator can drift apart on.
const MAX_NARRATION_LENGTH = 210

// '' represents "the model did not classify this" — every OTHER optional
// string field in this schema (eyebrow/body/next) already uses the same
// required-but-empty-means-absent convention; an enum needs '' added to its
// own allowed-values list explicitly to keep that convention working.
const LEADERSHIP_IMPORTANCE_ENUM_OR_EMPTY = ['', ...AI_LEADERSHIP_IMPORTANCE_VALUES] as const
const VISUAL_CONCEPT_ENUM_OR_EMPTY = ['', ...AI_VISUAL_CONCEPT_VALUES] as const
const VISUAL_SUBJECT_ENUM_OR_EMPTY = ['', ...AI_VISUAL_SUBJECT_VALUES] as const
const VISUAL_EMPHASIS_ENUM_OR_EMPTY = ['', ...AI_VISUAL_EMPHASIS_VALUES] as const
const VISUAL_COMPOSITION_ENUM_OR_EMPTY = ['', ...AI_VISUAL_COMPOSITION_VALUES] as const
const VISUAL_MOTION_ENUM_OR_EMPTY = ['', ...AI_VISUAL_MOTION_VALUES] as const
const STORY_ENGINE_ENUM_OR_EMPTY = ['', ...AI_STORY_ENGINE_VALUES] as const

// The Visual Director's own structured (never free-text) plan — nested one
// level, but built from the exact same fixed-vocabulary convention as every
// other field here. additionalProperties: false means the model cannot
// smuggle an extra key (e.g. a color/CSS/layout instruction) into this
// object even if it tried.
export const AI_VISUAL_PLAN_SCHEMA = {
  type: 'object',
  properties: {
    subject: { type: 'string', enum: VISUAL_SUBJECT_ENUM_OR_EMPTY as unknown as string[] },
    emphasis: { type: 'string', enum: VISUAL_EMPHASIS_ENUM_OR_EMPTY as unknown as string[] },
    composition: { type: 'string', enum: VISUAL_COMPOSITION_ENUM_OR_EMPTY as unknown as string[] },
    motion: { type: 'string', enum: VISUAL_MOTION_ENUM_OR_EMPTY as unknown as string[] },
  },
  required: ['subject', 'emphasis', 'composition', 'motion'],
  additionalProperties: false,
} as const

// Anthropic's native structured-output feature: passed as
// output_config.format.schema (see api/executive-summary.ts's own
// ATS_REPORT_SCHEMA for the identical mechanism/precedent). Every field is
// required (never a true "optional" JSON Schema key) — an absent value is
// represented as an empty string/array instead, exactly the same
// convention ATS_REPORT_SCHEMA already uses, and additionalProperties:
// false on every object rejects any extra key the model might add.
// minItems is capped at 0 or 1 only, per Anthropic's own JSON Schema
// limitations (see ATS_REPORT_SCHEMA's comment) — no maxItems/minItems>=2
// appears anywhere below; the real count bounds (MIN/MAX_SCENE_COUNT
// above) are enforced by validateAiStoryboardResponse, after parsing, the
// same second-layer-of-defense pattern already used for ATS_REPORT_SCHEMA's
// own topic-count bounds.
export const AI_STORYBOARD_METRIC_SCHEMA = {
  type: 'object',
  properties: {
    label: { type: 'string' },
    value: { type: 'string' },
    context: { type: 'string' },
  },
  required: ['label', 'value', 'context'],
  additionalProperties: false,
} as const

export const AI_STORYBOARD_SCENE_SCHEMA = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: AI_STORYBOARD_SCENE_TYPES as unknown as string[] },
    eyebrow: { type: 'string' },
    title: { type: 'string' },
    body: { type: 'string' },
    bullets: { type: 'array', minItems: 0, items: { type: 'string' } },
    metrics: { type: 'array', minItems: 0, items: AI_STORYBOARD_METRIC_SCHEMA },
    next: { type: 'string' },
    durationSeconds: { type: 'integer' },
    sourceTopicIndexes: { type: 'array', minItems: 0, items: { type: 'integer' } },
    // Content selection (above) is fully decided before either of these is
    // ever considered — see generate-storyboard.ts's own prompt ordering
    // ("SOURCE FACTS -> LEADERSHIP IMPORTANCE -> STORY STRUCTURE -> VISUAL
    // TREATMENT", never the reverse).
    leadershipImportance: { type: 'string', enum: LEADERSHIP_IMPORTANCE_ENUM_OR_EMPTY as unknown as string[] },
    visualConcept: { type: 'string', enum: VISUAL_CONCEPT_ENUM_OR_EMPTY as unknown as string[] },
    // The Visual Director layer — layered ON TOP of visualConcept, never a
    // replacement for it (see AI_VISUAL_PLAN_SCHEMA's own comment).
    visualPlan: AI_VISUAL_PLAN_SCHEMA,
    // Which of the three reusable Remotion story-template engines this
    // scene renders through (see StoryEngine's own comment). "" is valid —
    // api/video/generate-storyboard.ts fills a deterministic fallback via
    // inferStoryEngine() when the model leaves this blank, exactly the
    // same "AI-provided-or-inferred" pattern leadershipImportance/
    // visualConcept already use.
    storyEngine: { type: 'string', enum: STORY_ENGINE_ENUM_OR_EMPTY as unknown as string[] },
    // Synthesized locally into audio by scripts/lib/narrationAudio.mts (see
    // that file for the TTS engine/license) — never sent to any external
    // service. Must be independently re-grounded below
    // (validateNarrationGrounding) rather than trusted just because it
    // passed this schema. maxLength is a structural hint to Anthropic's own
    // structured-output enforcement — validateScene's own MAX_NARRATION_LENGTH
    // check (with safe normalization first) remains the actual enforced
    // ceiling regardless of whether the model respects this hint.
    narrationText: { type: 'string', maxLength: MAX_NARRATION_LENGTH },
  },
  required: [
    'type',
    'eyebrow',
    'title',
    'body',
    'bullets',
    'metrics',
    'next',
    'durationSeconds',
    'sourceTopicIndexes',
    'leadershipImportance',
    'visualConcept',
    'visualPlan',
    'storyEngine',
    'narrationText',
  ],
  additionalProperties: false,
} as const

export const AI_STORYBOARD_SCHEMA = {
  type: 'object',
  properties: {
    scenes: {
      type: 'array',
      minItems: 1,
      items: AI_STORYBOARD_SCENE_SCHEMA,
    },
  },
  required: ['scenes'],
  additionalProperties: false,
} as const

export interface ValidatedAiStoryboardMetric {
  label: string
  value: string
  context?: string
}

export interface ValidatedVisualPlan {
  subject: VisualSubject
  emphasis: VisualEmphasis
  composition: VisualComposition
  motion: VisualMotion
}

export interface ValidatedAiStoryboardScene {
  type: AiStoryboardSceneType
  eyebrow?: string
  title: string
  body?: string
  bullets?: string[]
  metrics?: ValidatedAiStoryboardMetric[]
  next?: string
  durationSeconds: number
  sourceTopicIndexes: number[]
  leadershipImportance?: LeadershipImportance
  visualConcept?: VisualConcept
  visualPlan?: ValidatedVisualPlan
  storyEngine?: StoryEngine
  narrationText?: string
}

// A visual plan is valid in exactly two shapes: all four fields '' (the
// model declined to classify this scene visually — omitted entirely from
// the validated scene, never a fabricated default), or all four fields a
// real enum member. Anything PARTIAL (e.g. subject set but motion blank) is
// rejected outright rather than silently patched — a half-formed visual
// plan is a sign the model didn't actually follow the schema, not something
// safe to guess the rest of.
function validateVisualPlan(raw: unknown, sceneIndex: number): { ok: true; plan: ValidatedVisualPlan | undefined } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: `Scene ${sceneIndex} has an invalid visualPlan.` }
  }
  const p = raw as Record<string, unknown>

  const isValidEnumOrEmpty = (value: unknown, allowed: readonly string[]) => typeof value === 'string' && allowed.includes(value)
  if (
    !isValidEnumOrEmpty(p.subject, VISUAL_SUBJECT_ENUM_OR_EMPTY) ||
    !isValidEnumOrEmpty(p.emphasis, VISUAL_EMPHASIS_ENUM_OR_EMPTY) ||
    !isValidEnumOrEmpty(p.composition, VISUAL_COMPOSITION_ENUM_OR_EMPTY) ||
    !isValidEnumOrEmpty(p.motion, VISUAL_MOTION_ENUM_OR_EMPTY)
  ) {
    return { ok: false, reason: `Scene ${sceneIndex} has a disallowed visualPlan field.` }
  }

  const fields = [p.subject, p.emphasis, p.composition, p.motion] as string[]
  const emptyCount = fields.filter((f) => f.length === 0).length
  if (emptyCount === fields.length) {
    return { ok: true, plan: undefined }
  }
  if (emptyCount > 0) {
    return { ok: false, reason: `Scene ${sceneIndex} has a partially-filled visualPlan (must be fully specified or fully absent).` }
  }

  return {
    ok: true,
    plan: {
      subject: p.subject as VisualSubject,
      emphasis: p.emphasis as VisualEmphasis,
      composition: p.composition as VisualComposition,
      motion: p.motion as VisualMotion,
    },
  }
}

// Extracts every digit-group (an integer/decimal, optionally with a leading
// currency symbol and/or a trailing '%', e.g. "$2.93M"'s "2.93" or "92%"'s
// "92") from a piece of text — used to compare narrationText's own numbers
// against the scene's already-grounded on-screen fields.
function extractNumberTokens(text: string): string[] {
  return text.match(/\d+(?:[.,]\d+)*/g) ?? []
}

// TITLE FIDELITY — a scene tied to real source topic(s) must keep a title
// that is recognizably the SAME topic, not a newly-invented editorial
// headline. A small, FIXED filler-word list — never a semantic stopword
// list — reflecting only grammatical glue words ("and", "the", "&"'s
// spelled-out form, etc.) that the phase brief's own GOOD examples
// legitimately drop when shortening.
const TITLE_FILLER_WORDS = new Set(['a', 'an', 'and', 'or', 'the', 'of', 'for', 'to', 'in', 'on', 'with'])

// Normalizes a title into its set of significant words: lowercase,
// punctuation stripped (hyphens kept, so "Quarter-End" stays one token),
// a trailing 's' collapsed on longer words (so "Calculators"/"Calculator"
// compare equal), filler words removed. A DELIBERATELY narrow, purely
// mechanical transform — never a semantic/synonym map — so it can only
// ever recognize an EXACT (case/plural/punctuation-insensitive) reuse of
// the source's own wording, never judge two different words as "close
// enough."
function significantTitleWords(title: string): Set<string> {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((word) => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word))
    .filter((word) => word.length > 0 && !TITLE_FILLER_WORDS.has(word))
  return new Set(words)
}

// An AI-written scene title is faithful to its source topic(s) only when
// EVERY significant word in it already appears somewhere in the
// referenced source topic title(s) — shortening, dropping filler words,
// and combining multiple referenced topics' own wording are all still
// faithful (the result is still built entirely from source words); a
// title is rejected the moment it contains even one word the source
// title(s) never used — exactly the pattern in every one of the phase
// brief's own BAD examples ("Record", "Breakdowns", "Tools"/"Lagging",
// "Advancing" — each a word absent from its source topic title). A
// single supporting metric/number elevated into the title (e.g. "2.93
// Million...") fails the same way: the digits are words the source TITLE
// never contained, even though they're grounded elsewhere in the scene.
export function isTitleFaithfulToSourceTopics(aiTitle: string, sourceTopicTitles: string[]): boolean {
  const aiWords = significantTitleWords(aiTitle)
  if (aiWords.size === 0) return false
  const allowedWords = new Set(sourceTopicTitles.flatMap((sourceTitle) => [...significantTitleWords(sourceTitle)]))
  return [...aiWords].every((word) => allowedWords.has(word))
}

// The ONLY fallback ever used when a title fails the faithfulness check —
// never an attempt to salvage/rewrite the AI's own wording (that would
// reintroduce exactly the "fragile keyword heuristic" risk this is meant
// to avoid). A single referenced topic falls back to that topic's own
// title, verbatim; multiple referenced topics fall back to a plain,
// mechanical join of every one of their own titles — every word in the
// result is therefore, by construction, drawn straight from the source
// report, never invented.
export function groundedTitleFallback(sourceTopicTitles: string[]): string {
  return sourceTopicTitles.join(' & ')
}

// A safe, MEANING-PRESERVING normalization for a narrationText that comes
// back slightly over MAX_NARRATION_LENGTH — tried once, before rejecting.
// Step 1: collapse whitespace only (never changes meaning at all). Step 2,
// only if still over: trim to the LAST complete sentence that still fits,
// at a real sentence-ending boundary ('.', '!', or '?') — this can only
// ever REMOVE a trailing sentence wholesale, never cut mid-sentence and
// never rewrite/paraphrase a kept one, so every character that survives is
// a verbatim substring of the model's own original text. Because this only
// ever REMOVES trailing text, the result can only contain the SAME numbers
// as the original or fewer — it can never introduce a number the original
// didn't already have, so a result that still needs grounding is checked
// against validateNarrationGrounding exactly like an unmodified narration.
// Returns null (never a partial/mid-sentence string) when not even the
// first sentence fits under the limit — the caller then rejects the scene
// exactly as it did before this normalization existed.
export function normalizeOverlongNarration(text: string, maxLength: number): string | null {
  const collapsed = text.trim().replace(/\s+/g, ' ')
  if (collapsed.length <= maxLength) return collapsed

  const sentenceEndPattern = /[.!?](?=\s|$)/g
  let lastSafeEnd = -1
  let match: RegExpExecArray | null
  while ((match = sentenceEndPattern.exec(collapsed)) !== null) {
    const endIndex = match.index + 1
    if (endIndex > maxLength) break
    lastSafeEnd = endIndex
  }

  if (lastSafeEnd <= 0) return null
  return collapsed.slice(0, lastSafeEnd)
}

// A scene's own on-screen fields are themselves already grounded (every
// business-content scene type has already been required, above, to cite a
// real sourceTopicIndexes entry) — so this checks narrationText introduces
// NO number that doesn't already appear somewhere in that same scene's
// title/body/bullets/metrics/next. This can't verify a number is factually
// correct (no access to the source report here), but it DOES catch the
// specific failure mode section 3 of the phase brief warns about: the
// narration inventing a new figure that never appears anywhere on screen.
export function validateNarrationGrounding(
  narrationText: string,
  scene: Pick<ValidatedAiStoryboardScene, 'title' | 'body' | 'bullets' | 'metrics' | 'next'>,
): boolean {
  const groundedText = [
    scene.title,
    scene.body ?? '',
    ...(scene.bullets ?? []),
    ...(scene.metrics ?? []).flatMap((m) => [m.label, m.value, m.context ?? '']),
    scene.next ?? '',
  ].join(' \n ')
  const groundedNumbers = new Set(extractNumberTokens(groundedText))
  return extractNumberTokens(narrationText).every((token) => groundedNumbers.has(token))
}

export type ValidateAiStoryboardResult =
  | { ok: true; scenes: ValidatedAiStoryboardScene[] }
  | { ok: false; reason: string }

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function validateMetric(raw: unknown, sceneIndex: number, metricIndex: number): { ok: true; metric: ValidatedAiStoryboardMetric } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: `Scene ${sceneIndex} metric ${metricIndex} was not a JSON object.` }
  }
  const m = raw as Record<string, unknown>
  if (!isNonEmptyString(m.label) || !isNonEmptyString(m.value) || typeof m.context !== 'string') {
    return { ok: false, reason: `Scene ${sceneIndex} metric ${metricIndex} has an invalid label/value/context.` }
  }
  return {
    ok: true,
    metric: { label: m.label, value: m.value, context: m.context.length > 0 ? m.context : undefined },
  }
}

// Validates one raw scene object against the controlled vocabulary and
// against the SUPPLIED source topic titles (sourceTopicTitles — the
// caller's own report.topics.map(t => t.title), never trusted from the AI
// response itself — used both for index-bounds checking, exactly as a
// plain count used to, AND for title-fidelity normalization below, which
// is why a count alone no longer suffices). Every field is checked for
// both TYPE and, where applicable, bounds/enum membership — this is the
// second, independent validation layer beyond Anthropic's own schema
// constraint (the schema alone is never trusted as sufficient, exactly
// like ATS_REPORT_SCHEMA's own post-parse topics.map() re-validation in
// executive-summary.ts).
function validateScene(
  raw: unknown,
  sourceTopicTitles: string[],
  sceneIndex: number,
): { ok: true; scene: ValidatedAiStoryboardScene } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: `Scene ${sceneIndex} was not a JSON object.` }
  }
  const s = raw as Record<string, unknown>

  if (typeof s.type !== 'string' || !(AI_STORYBOARD_SCENE_TYPES as readonly string[]).includes(s.type)) {
    return { ok: false, reason: `Scene ${sceneIndex} has a missing or disallowed type.` }
  }
  const type = s.type as AiStoryboardSceneType

  if (!isNonEmptyString(s.title) || s.title.length > MAX_TITLE_LENGTH) {
    return { ok: false, reason: `Scene ${sceneIndex} has an invalid or missing title.` }
  }
  if (typeof s.eyebrow !== 'string' || s.eyebrow.length > MAX_EYEBROW_LENGTH) {
    return { ok: false, reason: `Scene ${sceneIndex} has an invalid eyebrow.` }
  }
  if (typeof s.body !== 'string') {
    return { ok: false, reason: `Scene ${sceneIndex} has an invalid body.` }
  }
  if (typeof s.next !== 'string') {
    return { ok: false, reason: `Scene ${sceneIndex} has an invalid next.` }
  }
  if (!Array.isArray(s.bullets) || !s.bullets.every((bullet) => typeof bullet === 'string')) {
    return { ok: false, reason: `Scene ${sceneIndex} has an invalid bullets array.` }
  }
  if (!Array.isArray(s.metrics)) {
    return { ok: false, reason: `Scene ${sceneIndex} has an invalid metrics array.` }
  }

  const metrics: ValidatedAiStoryboardMetric[] = []
  for (const [metricIndex, metricRaw] of s.metrics.entries()) {
    const validatedMetric = validateMetric(metricRaw, sceneIndex, metricIndex)
    if (!validatedMetric.ok) return validatedMetric
    metrics.push(validatedMetric.metric)
  }

  if (
    typeof s.durationSeconds !== 'number' ||
    !Number.isFinite(s.durationSeconds) ||
    s.durationSeconds < MIN_SCENE_DURATION_SECONDS ||
    s.durationSeconds > MAX_SCENE_DURATION_SECONDS
  ) {
    return { ok: false, reason: `Scene ${sceneIndex} has an out-of-range durationSeconds.` }
  }

  if (!Array.isArray(s.sourceTopicIndexes) || !s.sourceTopicIndexes.every((i) => typeof i === 'number' && Number.isInteger(i))) {
    return { ok: false, reason: `Scene ${sceneIndex} has an invalid sourceTopicIndexes array.` }
  }
  const sourceTopicIndexes = s.sourceTopicIndexes as number[]
  for (const topicIndex of sourceTopicIndexes) {
    // The server-authoritative guard against a hallucinated/out-of-range
    // reference — sourceTopicTitles is always the CALLER's own, freshly
    // re-fetched report.topics, never anything the AI supplied.
    if (!Number.isInteger(topicIndex) || topicIndex < 0 || topicIndex >= sourceTopicTitles.length) {
      return { ok: false, reason: `Scene ${sceneIndex} references a source topic index that does not exist.` }
    }
  }

  // Every business-content scene type must cite at least one real source
  // topic — "vague free-text citations" are never accepted because there's
  // no free-text citation mechanism at all, only these validated indexes.
  // executive-snapshot is the sole exception: it is grounded in the
  // report's own opening paragraph, not a specific topic.
  if (type !== 'executive-snapshot' && sourceTopicIndexes.length === 0) {
    return { ok: false, reason: `Scene ${sceneIndex} (type ${type}) has no source topic references.` }
  }

  if (typeof s.leadershipImportance !== 'string' || !(LEADERSHIP_IMPORTANCE_ENUM_OR_EMPTY as readonly string[]).includes(s.leadershipImportance)) {
    return { ok: false, reason: `Scene ${sceneIndex} has a disallowed leadershipImportance.` }
  }
  if (typeof s.visualConcept !== 'string' || !(VISUAL_CONCEPT_ENUM_OR_EMPTY as readonly string[]).includes(s.visualConcept)) {
    return { ok: false, reason: `Scene ${sceneIndex} has a disallowed visualConcept.` }
  }
  const validatedVisualPlan = validateVisualPlan(s.visualPlan, sceneIndex)
  if (!validatedVisualPlan.ok) return validatedVisualPlan
  if (typeof s.storyEngine !== 'string' || !(STORY_ENGINE_ENUM_OR_EMPTY as readonly string[]).includes(s.storyEngine)) {
    return { ok: false, reason: `Scene ${sceneIndex} has a disallowed storyEngine.` }
  }
  if (typeof s.narrationText !== 'string') {
    return { ok: false, reason: `Scene ${sceneIndex} has an invalid narrationText.` }
  }
  // Try the safe, meaning-preserving normalization FIRST — a narrationText
  // already within the limit passes through unchanged (still just
  // whitespace-collapsed); one slightly over it gets one chance to trim to
  // its last complete sentence before this scene is rejected outright.
  const normalizedNarrationText = normalizeOverlongNarration(s.narrationText, MAX_NARRATION_LENGTH)
  if (normalizedNarrationText === null) {
    return { ok: false, reason: `Scene ${sceneIndex} has an invalid or too-long narrationText.` }
  }

  // TITLE FIDELITY normalization — never a rejection, always a
  // substitution, so an otherwise-valid AI storyboard is never thrown
  // away just because one title needs grounding. forward-look's title is
  // ALWAYS the same fixed, neutral label the deterministic transformer
  // itself uses (see buildStoryboardFromAtsReport's own forward-look
  // scene) — the AI's own forward-look title is never trusted, exactly
  // like the fixed opening/closing framing scenes are never AI-generated
  // at all. executive-snapshot is exempt (grounded in the report's own
  // opening paragraph, not a specific topic, so there is no source TITLE
  // to check against). Every other business scene type falls back to
  // groundedTitleFallback(referencedTitles) the moment its title isn't
  // faithful to the topic(s) it actually cites.
  let title = s.title
  if (type === 'forward-look') {
    title = 'Forward Look'
  } else if (type !== 'executive-snapshot') {
    const referencedTitles = sourceTopicIndexes.map((topicIndex) => sourceTopicTitles[topicIndex])
    if (!isTitleFaithfulToSourceTopics(title, referencedTitles)) {
      title = groundedTitleFallback(referencedTitles)
    }
  }

  const body = s.body.length > 0 ? s.body : undefined
  const bullets = s.bullets.length > 0 ? (s.bullets as string[]) : undefined
  const next = s.next.length > 0 ? s.next : undefined

  if (normalizedNarrationText.length > 0 && !validateNarrationGrounding(normalizedNarrationText, { title, body, bullets, metrics, next })) {
    return { ok: false, reason: `Scene ${sceneIndex} narrationText introduces a number not grounded elsewhere in the scene.` }
  }

  return {
    ok: true,
    scene: {
      type,
      eyebrow: s.eyebrow.length > 0 ? s.eyebrow : undefined,
      title,
      body,
      bullets,
      metrics: metrics.length > 0 ? metrics : undefined,
      next,
      durationSeconds: s.durationSeconds,
      sourceTopicIndexes,
      leadershipImportance: s.leadershipImportance.length > 0 ? (s.leadershipImportance as LeadershipImportance) : undefined,
      visualConcept: s.visualConcept.length > 0 ? (s.visualConcept as VisualConcept) : undefined,
      visualPlan: validatedVisualPlan.plan,
      storyEngine: s.storyEngine.length > 0 ? (s.storyEngine as StoryEngine) : undefined,
      narrationText: normalizedNarrationText.length > 0 ? normalizedNarrationText : undefined,
    },
  }
}

// The single validation entry point for an AI storyboard response, called
// AFTER JSON.parse (see api/video/generate-storyboard.ts). Rejects (rather
// than best-effort-repairs) on the first structural problem found —
// api/video/generate-storyboard.ts treats any `{ ok: false }` result here
// as a signal to fall back to the deterministic transformer, never as
// something to patch up and use anyway.
export function validateAiStoryboardResponse(raw: unknown, sourceTopicTitles: string[]): ValidateAiStoryboardResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'Response was not a JSON object.' }
  }
  const scenesRaw = (raw as Record<string, unknown>).scenes
  if (!Array.isArray(scenesRaw)) {
    return { ok: false, reason: 'Response is missing a scenes array.' }
  }
  if (scenesRaw.length < MIN_SCENE_COUNT || scenesRaw.length > MAX_SCENE_COUNT) {
    return { ok: false, reason: `Scene count ${scenesRaw.length} is outside the allowed ${MIN_SCENE_COUNT}-${MAX_SCENE_COUNT} range.` }
  }

  const scenes: ValidatedAiStoryboardScene[] = []
  for (const [index, sceneRaw] of scenesRaw.entries()) {
    const validated = validateScene(sceneRaw, sourceTopicTitles, index)
    if (!validated.ok) return validated
    scenes.push(validated.scene)
  }

  return { ok: true, scenes }
}

const MIN_REASONABLE_TOTAL_SECONDS = 20
const MAX_REASONABLE_TOTAL_SECONDS = 180

// A generous sanity check on TOTAL duration (including the fixed
// opening/closing scenes the caller adds) — the prompt targets ~60-90s as
// a soft goal; this only guards against a wildly broken response (e.g.
// every scene claiming the schema's 20s ceiling), not a strict 60-90s gate.
export function isTotalDurationReasonable(totalSeconds: number): boolean {
  return totalSeconds >= MIN_REASONABLE_TOTAL_SECONDS && totalSeconds <= MAX_REASONABLE_TOTAL_SECONDS
}
