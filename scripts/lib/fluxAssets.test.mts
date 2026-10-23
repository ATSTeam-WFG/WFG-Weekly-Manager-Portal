// Run with: node --experimental-strip-types --test scripts/lib/fluxAssets.test.mts
//
// resolveFluxAsset is pure (no fs/child_process) and is exercised directly
// with real execution below. generateFluxAssetsAndAttach/generateOneAsset
// spawn the local mflux CLI — a real, slow (~10s+), memory-heavy local
// model invocation requiring the FLUX.1-schnell weights already be present
// in this machine's Hugging Face cache — exactly the same class of
// "cannot safely execute under bare `node --test`" dependency
// narrationAudio.mts's real Kokoro model load already has (see that file's
// own test for the identical pattern). Verified via source inspection
// instead; the actual generation pipeline was proven working by this
// phase's own real end-to-end render (see the phase's final report for the
// measured generation times and the resulting cached PNG files).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { resolveFluxAsset, resolveFluxHeroAsset } from './fluxAssets.mts'
import type { VideoStoryboardScene } from '../../src/lib/videoStoryboard.ts'

const dir = path.dirname(fileURLToPath(import.meta.url))
const src = readFileSync(path.join(dir, 'fluxAssets.mts'), 'utf8')
const renderScriptSrc = readFileSync(path.join(dir, '..', 'render-storyboard.mts'), 'utf8')

function scene(overrides: Partial<VideoStoryboardScene> = {}): VideoStoryboardScene {
  return { id: 's1', type: 'big-metric', title: 'Test Scene', ...overrides }
}

describe('resolveFluxAsset — pure (storyEngine, visualPlan.subject) -> (cacheKey, prompt) resolution', () => {
  test('a scene with both storyEngine and a mapped visualPlan.subject resolves to a cacheKey and non-empty prompt', () => {
    const resolved = resolveFluxAsset(
      scene({ storyEngine: 'metric-story', visualPlan: { subject: 'value-accumulation', emphasis: 'dominant-number', composition: 'illustration-with-metric', motion: 'accumulate' } }),
    )
    assert.ok(resolved)
    assert.equal(resolved.cacheKey, 'metric-story__value-accumulation')
    assert.ok(resolved.prompt.length > 0)
  })

  test('a scene missing storyEngine resolves to undefined', () => {
    const resolved = resolveFluxAsset(
      scene({ visualPlan: { subject: 'value-accumulation', emphasis: 'dominant-number', composition: 'illustration-with-metric', motion: 'accumulate' } }),
    )
    assert.equal(resolved, undefined)
  })

  test('a scene missing visualPlan resolves to undefined', () => {
    const resolved = resolveFluxAsset(scene({ storyEngine: 'metric-story' }))
    assert.equal(resolved, undefined)
  })

  test('a forward-look scene resolves using pipeline-story even though it has NO storyEngine of its own — a fixed rendering convention, never written back into the scene', () => {
    const resolved = resolveFluxAsset(
      scene({
        type: 'forward-look',
        storyEngine: undefined,
        visualPlan: { subject: 'forward-destinations', emphasis: 'forward-momentum', composition: 'split-illustration-text', motion: 'sequence-reveal' },
      }),
    )
    assert.ok(resolved)
    assert.equal(resolved.cacheKey, 'pipeline-story__forward-destinations')
  })

  test('a scene whose subject is brand-mark resolves to undefined even with a storyEngine set — never AI-generated brand art', () => {
    const resolved = resolveFluxAsset(
      scene({ storyEngine: 'pipeline-story', visualPlan: { subject: 'brand-mark', emphasis: 'brand', composition: 'minimal-brand', motion: 'static-hold' } }),
    )
    assert.equal(resolved, undefined)
  })

  test('an unmapped (engine, subject) combination resolves to undefined, never a fabricated prompt', () => {
    const resolved = resolveFluxAsset(
      scene({ storyEngine: 'pipeline-story', visualPlan: { subject: 'value-accumulation', emphasis: 'dominant-number', composition: 'illustration-with-metric', motion: 'accumulate' } }),
    )
    assert.equal(resolved, undefined)
  })
})

describe('resolveFluxHeroAsset — pure subject -> (heroCacheKey, heroPrompt, motifCacheKey?, motifPrompt?) resolution (visual-direction v3)', () => {
  test('a scene whose subject has a mapped hero prompt resolves a hero cache key suffixed __hero', () => {
    const resolved = resolveFluxHeroAsset(
      scene({ storyEngine: 'metric-story', visualPlan: { subject: 'value-accumulation', emphasis: 'dominant-number', composition: 'illustration-with-metric', motion: 'accumulate' } }),
    )
    assert.ok(resolved)
    assert.equal(resolved.heroCacheKey, 'metric-story__value-accumulation__hero')
    assert.ok(resolved.heroPrompt.length > 0)
    assert.equal(resolved.motifCacheKey, undefined)
  })

  test('systems/blocked-connection additionally resolves a motif cache key suffixed __motif', () => {
    const resolved = resolveFluxHeroAsset(
      scene({ storyEngine: 'bottleneck-story', visualPlan: { subject: 'blocked-connection', emphasis: 'process-flow', composition: 'illustration-with-metric', motion: 'flow-blocked' } }),
    )
    assert.ok(resolved)
    assert.equal(resolved.heroCacheKey, 'bottleneck-story__blocked-connection__hero')
    assert.equal(resolved.motifCacheKey, 'bottleneck-story__blocked-connection__motif')
    assert.ok(resolved.motifPrompt && resolved.motifPrompt.length > 0)
  })

  test('a scene missing storyEngine, or whose subject has no hero prompt mapped, resolves to undefined', () => {
    assert.equal(
      resolveFluxHeroAsset(scene({ visualPlan: { subject: 'value-accumulation', emphasis: 'dominant-number', composition: 'illustration-with-metric', motion: 'accumulate' } })),
      undefined,
    )
    assert.equal(
      resolveFluxHeroAsset(scene({ storyEngine: 'pipeline-story', visualPlan: { subject: 'milestone-landscape', emphasis: 'forward-momentum', composition: 'illustration-with-metric', motion: 'trajectory-rise' } })),
      undefined,
    )
  })

  test('a forward-look scene resolves using pipeline-story even with no storyEngine of its own — the same fixed rendering convention as resolveFluxAsset', () => {
    const resolved = resolveFluxHeroAsset(
      scene({
        type: 'forward-look',
        storyEngine: undefined,
        visualPlan: { subject: 'opportunity-nodes', emphasis: 'forward-momentum', composition: 'split-illustration-text', motion: 'sequence-reveal' },
      }),
    )
    assert.ok(resolved)
    assert.equal(resolved.heroCacheKey, 'pipeline-story__opportunity-nodes__hero')
  })
})

describe('generation is local-only, sequential, and never sends raw report text', () => {
  test('the only prompt ever passed to mflux comes from remotion/fluxPrompts.ts\'s getFluxAssetPrompt — no scene.title/body/bullets/metrics/narrationText appears in a prompt anywhere in this file', () => {
    assert.doesNotMatch(src, /scene\.(title|body|bullets|metrics|next|narrationText)/)
  })

  test('generateFluxAssetsAndAttach awaits each generation inside a plain for-loop — never a concurrent Promise.all over spawns', () => {
    const code = src
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n')
    assert.match(code, /for \(const scene of storyboard\.scenes\)/)
    assert.doesNotMatch(code, /Promise\.all/)
  })

  test('no external/paid image-generation provider is referenced anywhere in the render pipeline', () => {
    const forbidden = /runway|luma|kling|midjourney|dall-?e|stability\.ai|replicate\.com|leonardo\.ai/i
    assert.equal(forbidden.test(src), false)
    assert.equal(forbidden.test(renderScriptSrc), false)
  })

  test('a failed/unavailable generation resolves false rather than throwing, and the caller falls back by leaving nextScene unchanged (started as `let nextScene = scene`)', () => {
    assert.match(src, /resolve\(false\)/)
    assert.match(src, /let nextScene = scene/)
    assert.match(src, /scenes\.push\(nextScene\)/)
  })
})

describe('13. Visual primitives do not mutate the storyboard passed in', () => {
  test('generateFluxAssetsAndAttach builds a NEW scenes array and a NEW top-level storyboard object via spreads — never assigns into the input storyboard/scene objects', () => {
    const code = src
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n')
    assert.doesNotMatch(code, /storyboard\.\w+\s*=[^=]/)
    assert.doesNotMatch(code, /scene\.\w+\s*=[^=]/)
    assert.match(code, /const scenes: VideoStoryboardScene\[\] = \[\]/)
    assert.match(code, /return \{ \.\.\.storyboard, scenes \}/)
  })
})

describe('generated assets are cached and never regenerated unnecessarily', () => {
  test('an existing output file short-circuits generation via existsSync before ever spawning mflux', () => {
    assert.match(src, /if \(existsSync\(outputPath\)\) \{/)
  })
})
