// .js extension: this file is also imported (as real VALUES) by
// scripts/lib/fluxAssets.mts, whose project (tsconfig.node.json) uses
// nodenext moduleResolution and therefore requires an explicit extension
// on every relative specifier — same reason src/lib/videoStoryboard.ts's
// own type-only import of atsReport.js uses one. Safe here because it's
// `import type`, erased before any runtime ever tries to resolve it.
import type { StoryEngine, VisualSubject } from '../src/lib/videoStoryboard.js'

// SANITIZATION BOUNDARY for local FLUX.1-schnell asset generation
// (scripts/lib/fluxAssets.mts). This file is a pure, hardcoded lookup table
// keyed ONLY by (storyEngine, visualPlan.subject) — two small controlled
// vocabularies (3 x 10 values) already validated server-side
// (api/_lib/videoStoryboardSchema.ts). It has NO parameter for scene
// title/body/bullets/metrics/next/narrationText, so it is structurally
// incapable of leaking confidential report text into a FLUX prompt — not a
// "trust me" filter, but a function that never receives the text it would
// need to leak. Every prompt below describes a GENERIC business visual
// concept (e.g. "an abstract network with one connection obstructed"),
// never a specific week's actual finding (e.g. never "NC rate calculator
// has been broken for three months").
//
// Not every (storyEngine, subject) combination has an entry — only the ones
// where the subject is a natural fit for that engine's story (the AI/
// deterministic path can still independently choose any subject for any
// engine; an unmapped combination simply means no FLUX asset is generated
// for that scene, and it falls back to the existing programmatic SVG hero
// illustration in remotion/illustrations/ — see heroIllustrationRegistry.ts).
// 'brand-mark' is never mapped here at all: the WFG brand mark stays an
// exact vector illustration, never an AI-generated approximation of it.

// ONE shared style vocabulary appended to every prompt below — this is what
// makes the three story engines read as a single coherent visual language
// rather than three unrelated aesthetics. Deliberately an AMBIENT TEXTURE
// description, not a literal scene ("a path with gates," "a network of
// nodes") — the layered visual-mechanics integration (see
// remotion/LayeredStoryScene.tsx / layeredMechanics.ts) draws every actual
// path/checkpoint/token/waypoint itself, deterministically, so FLUX only
// ever needs to supply ambient ART DIRECTION behind that foreground motion,
// never try to depict the story (which a single static image can't do
// anyway, and which an isolated prior prototype proved FLUX cannot
// reliably do across multiple states even when explicitly asked to).
export const FLUX_ASSET_STYLE_SUFFIX =
  'an abstract textured paper surface, warm off-white canvas, subtle charcoal ink-line brush texture with soft mottled grain, ' +
  'gentle dimensional shading suggesting shallow depth, generous negative space, quiet and minimal, ' +
  'fine-art paper texture close-up, editorial book-cover background aesthetic, ' +
  'no text, no numbers, no letters, no people, no objects, no logos, no photorealism, no clip art, no dashboard or chart UI elements'

// Each entry is a SMALL, generic accent fragment only — never a literal
// object, path, or scene element — layered onto the shared ambient texture
// above so the three engines (and different subjects within the same
// engine) read as related-but-distinct moods, purely through color/tone,
// while remaining reusable across every future week's report regardless
// of that week's actual topic.
const FLUX_ASSET_ACCENT_DESCRIPTIONS: Partial<Record<`${StoryEngine}:${VisualSubject}`, string>> = {
  'metric-story:value-accumulation': 'with one small restrained warm terracotta glow low in the frame, suggesting rising value',
  'metric-story:comparison-bars': 'with two or three small restrained warm terracotta accent marks at varying heights, suggesting comparison',

  'bottleneck-story:document-workflow': 'with a few faint horizontal ink lines suggesting a quiet corridor or pathway',
  'bottleneck-story:systems-connection': 'with a faint, orderly grid of soft ink dots suggesting a calm connected network',
  'bottleneck-story:blocked-connection': 'with a faint grid of soft ink dots and one small darker ink mark near the center, suggesting a single interruption',

  'pipeline-story:trajectory-path': 'with one soft ascending charcoal ink stroke suggesting steady forward momentum',
  'pipeline-story:milestone-landscape': 'with a few soft layered ink forms suggesting gentle depth and distance',
  'pipeline-story:opportunity-nodes': 'with a soft warm terracotta glow toward one edge, suggesting an open destination',
  'pipeline-story:forward-destinations': 'with a soft warm terracotta glow low on one side, suggesting arrival',
}

// 16:9 — a full-bleed AMBIENT BACKDROP for the 1920x1080 production frame
// (see LayeredStoryScene.tsx), not the small-illustration square this used
// to be sized for.
export const FLUX_ASSET_WIDTH = 1024
export const FLUX_ASSET_HEIGHT = 576

// Reused across every future weekly report — keyed ONLY by the (engine,
// subject) pair, never by report/week/scene id, so the exact same cached
// PNG is reused indefinitely instead of ever being regenerated per report.
export function fluxAssetCacheKey(storyEngine: StoryEngine, subject: VisualSubject): string {
  return `${storyEngine}__${subject}`
}

export function getFluxAssetPrompt(storyEngine: StoryEngine, subject: VisualSubject): string | undefined {
  const accent = FLUX_ASSET_ACCENT_DESCRIPTIONS[`${storyEngine}:${subject}`]
  if (!accent) return undefined
  return `${FLUX_ASSET_STYLE_SUFFIX}, ${accent}`
}

// A stable, deterministic seed derived from the cache key alone (never
// random) — the SAME (engine, subject) pair always generates the same
// image if regenerated, and different pairs get visually distinct seeds.
export function fluxAssetSeed(cacheKey: string): number {
  let hash = 0
  for (let i = 0; i < cacheKey.length; i++) {
    hash = (hash * 31 + cacheKey.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % 1_000_000
}

// ============================================================
// HERO ILLUSTRATIONS (visual-direction v3) — the isolated
// remotion-prototypes/flux-illustrated-story/ experiment proved local FLUX
// can supply the PRIMARY illustrated scene, not just an ambient backdrop,
// for a subject that genuinely has a concrete visual metaphor. Kept
// STRICTLY separate from FLUX_ASSET_STYLE_SUFFIX/FLUX_ASSET_ACCENT_DESCRIPTIONS
// above (the ambient-backdrop system) — those remain the safe fallback for
// any subject with no entry here (an unfamiliar future topic, or
// 'milestone-landscape'/'forward-destinations', which reuse OTHER scenes'
// hero illustrations at render time instead of getting their own — see
// IllustratedStoryScene.tsx/ForwardLookScene.tsx). Same sanitization
// guarantee as above: keyed only by subject, never scene title/body/
// bullets/metrics/narrationText, so no confidential report text can ever
// reach a prompt.
export const FLUX_HERO_WIDTH = 1920
export const FLUX_HERO_HEIGHT = 1088

// Visual-direction v4 color pass: the prior render's QA feedback was that
// the illustration read as too monochrome (ink-on-cream) with color only
// at the borders. This shared prefix now asks for a richer, FULLY-COLORED
// editorial illustration — coordinated across the whole composition, not
// a wash added after the fact — while staying restrained/professional
// (never a "rainbow," never neon/saturated-cartoon color): muted gold,
// sage green, and slate blue now sit alongside the base warm-cream/
// espresso/terracotta identity as genuine PAINTED color throughout the
// scene, not just accent marks.
const HAND_DRAWN_STYLE =
  'a sophisticated editorial illustration in a rich, fully-colored hand-drawn ink-and-wash style, warm cream paper background, ' +
  'confident charcoal ink linework with cross-hatching layered under soft painted color washes throughout the whole scene — ' +
  'muted gold, warm terracotta, sage green, and slate blue used as genuine color across objects, shadows, and background elements, not just border accents, ' +
  'dimensional shading, subtle paper grain texture, professional magazine-illustration quality, rich layered colorful composition filling the entire frame, ' +
  'no text, no numbers, no letters, no logos, no UI chrome, no photorealism, no screenshots'

// Per-subject color language (visual-direction v4): each scene family gets
// its OWN coordinated multi-color palette — never a single accent color —
// following the approved semantic examples (revenue/value = gold + sage +
// terracotta; technology = slate-blue + terracotta + cream/charcoal;
// growth = sage + gold + slate-blue). These are examples the Visual Story
// Director follows per subject, never a hardcoded single-color mapping.
const FLUX_HERO_ILLUSTRATION_PROMPTS: Partial<Record<VisualSubject, string>> = {
  'value-accumulation': `${HAND_DRAWN_STYLE}, a stylized quarter-end financial scene: a ledger book open on a warm terracotta-toned desk with neat stacks of richly muted-gold coin-like tokens and sage-green paper currency bundles rising beside it, a small calendar or clock motif suggesting quarter-end timing, warm gold light washing across the value tokens and terracotta shadow beneath them`,
  'comparison-bars': `${HAND_DRAWN_STYLE}, a stylized quarter-end financial scene: a ledger book open on a warm terracotta-toned desk with neat stacks of richly muted-gold coin-like tokens and sage-green paper currency bundles rising beside it, a small calendar or clock motif suggesting quarter-end timing, warm gold light washing across the value tokens and terracotta shadow beneath them`,
  'document-workflow': `${HAND_DRAWN_STYLE}, a stylized title-production workroom scene: a desk with stacked file folders in warm terracotta and muted-gold paper tones, a magnifying glass resting on one open file, a small inbox tray with papers, deep charcoal shadow pooling beneath the stack, a few flagged documents washed in richer gold and terracotta`,
  'systems-connection': `${HAND_DRAWN_STYLE}, a stylized business workflow scene: an open ledger and stacked application documents on a desk, a small mechanical rate-calculator device with dials and levers rendered in slate-blue metal tones, thin slate-blue pipes/wires connecting the calculator to a cluster of simple geometric system nodes in the background, warm terracotta accents on the documents, cool blue-charcoal shadow throughout the system wiring`,
  'blocked-connection': `${HAND_DRAWN_STYLE}, a stylized business workflow scene: an open ledger and stacked application documents on a desk, a small mechanical rate-calculator device with dials and levers rendered in slate-blue metal tones, thin slate-blue pipes/wires connecting the calculator to a cluster of simple geometric system nodes in the background, warm terracotta accents on the documents, cool blue-charcoal shadow throughout the system wiring`,
  'opportunity-nodes': `${HAND_DRAWN_STYLE}, a stylized business-growth landscape: a warm sage-green winding road leading from the foreground toward a cluster of a few simple geometric buildings in slate-blue and muted-gold on the horizon suggesting an expanding city skyline, a small gold flag or pennant marker planted partway along the road, scattered sage-green leaf motifs along the roadside, golden-hour light washing the whole landscape`,
  'trajectory-path': `${HAND_DRAWN_STYLE}, a stylized business-growth landscape: a warm sage-green winding road leading from the foreground toward a cluster of a few simple geometric buildings in slate-blue and muted-gold on the horizon suggesting an expanding city skyline, a small gold flag or pennant marker planted partway along the road, scattered sage-green leaf motifs along the roadside, golden-hour light washing the whole landscape`,
}

// The ONE small standalone "obstruction" motif this pass proved out —
// composited ON TOP of the systems-connection/blocked-connection hero by
// IllustratedStoryScene.tsx partway through the scene, exactly like the
// isolated prototype. No other subject needs a second asset: the
// value/workflow/growth recipes achieve their own state change with pure
// Remotion overlays (existing chip-stack/document/badge primitives), never
// a second FLUX generation.
const FLUX_MOTIF_PROMPTS: Partial<Record<VisualSubject, string>> = {
  'systems-connection': `${HAND_DRAWN_STYLE}, a small isolated motif: a single thin wire or pipe visibly snapped and disconnected with a small jagged break, a few loose ink-splatter marks near the break, restrained terracotta ink accent on the break point`,
  'blocked-connection': `${HAND_DRAWN_STYLE}, a small isolated motif: a single thin wire or pipe visibly snapped and disconnected with a small jagged break, a few loose ink-splatter marks near the break, restrained terracotta ink accent on the break point`,
}

export function getFluxHeroPrompt(subject: VisualSubject): string | undefined {
  return FLUX_HERO_ILLUSTRATION_PROMPTS[subject]
}

export function getFluxMotifPrompt(subject: VisualSubject): string | undefined {
  return FLUX_MOTIF_PROMPTS[subject]
}
