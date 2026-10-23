// Run with: node --test remotion/fluxPrompts.test.ts
//
// Pure, dependency-free — no mflux/mlx/child_process import — every
// generation-time property this file can guarantee is exercised with real
// execution here.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  FLUX_ASSET_STYLE_SUFFIX,
  fluxAssetCacheKey,
  fluxAssetSeed,
  getFluxAssetPrompt,
  getFluxHeroPrompt,
  getFluxMotifPrompt,
} from './fluxPrompts.ts'
import { STORY_ENGINE_VALUES, VISUAL_SUBJECT_VALUES, type StoryEngine, type VisualSubject } from '../src/lib/videoStoryboard.ts'

const dir = path.dirname(fileURLToPath(import.meta.url))
const src = readFileSync(path.join(dir, 'fluxPrompts.ts'), 'utf8')

describe('sanitization structural guarantee: the prompt lookup cannot leak raw report text', () => {
  test('getFluxAssetPrompt takes only (storyEngine, subject) — the two controlled-vocabulary enum params — never a scene/report-shaped argument', () => {
    assert.match(src, /export function getFluxAssetPrompt\(storyEngine: StoryEngine, subject: VisualSubject\): string \| undefined/)
  })

  test('this file never imports VideoStoryboardScene, VideoStoryboard, or AtsReport — it structurally cannot read scene title/body/bullets/metrics/narrationText', () => {
    assert.doesNotMatch(src, /VideoStoryboardScene|VideoStoryboard\b|AtsReport/)
  })
})

describe('every mapped (storyEngine, subject) prompt is well-formed and on-brand', () => {
  const allPairs: Array<[StoryEngine, VisualSubject]> = STORY_ENGINE_VALUES.flatMap((engine) =>
    VISUAL_SUBJECT_VALUES.map((subject) => [engine, subject] as [StoryEngine, VisualSubject]),
  )

  test('brand-mark never gets a FLUX prompt under any story engine — it stays an exact vector illustration', () => {
    for (const engine of STORY_ENGINE_VALUES) {
      assert.equal(getFluxAssetPrompt(engine, 'brand-mark'), undefined, `expected no FLUX prompt for ${engine}:brand-mark`)
    }
  })

  test('at least one (engine, subject) pair is mapped for every one of the three story engines', () => {
    for (const engine of STORY_ENGINE_VALUES) {
      const hasAny = VISUAL_SUBJECT_VALUES.some((subject) => getFluxAssetPrompt(engine, subject) !== undefined)
      assert.ok(hasAny, `expected at least one mapped subject for ${engine}`)
    }
  })

  test('every mapped prompt starts with the exact shared ambient style suffix — one coherent visual language across all engines, with only a small per-pair accent appended after it', () => {
    for (const [engine, subject] of allPairs) {
      const prompt = getFluxAssetPrompt(engine, subject)
      if (prompt === undefined) continue
      assert.ok(prompt.startsWith(FLUX_ASSET_STYLE_SUFFIX), `expected ${engine}:${subject} prompt to start with the shared style suffix`)
    }
  })

  test('no mapped prompt contains a digit — FLUX must never be asked to render a number/count', () => {
    for (const [engine, subject] of allPairs) {
      const prompt = getFluxAssetPrompt(engine, subject)
      if (prompt === undefined) continue
      assert.equal(/\d/.test(prompt), false, `expected ${engine}:${subject} prompt to contain no digits`)
    }
  })

  test('the shared style suffix itself explicitly forbids text/numbers/logos/photorealism/dashboards', () => {
    for (const phrase of ['no text', 'no numbers', 'no logos', 'no photorealism', 'no dashboard']) {
      assert.ok(FLUX_ASSET_STYLE_SUFFIX.includes(phrase), `expected style suffix to include "${phrase}"`)
    }
  })
})

describe('cache key / seed determinism — reusable across future weekly reports, never regenerated per report', () => {
  test('fluxAssetCacheKey depends only on (engine, subject), producing the identical key for the identical pair every call', () => {
    assert.equal(fluxAssetCacheKey('metric-story', 'value-accumulation'), fluxAssetCacheKey('metric-story', 'value-accumulation'))
    assert.equal(fluxAssetCacheKey('metric-story', 'value-accumulation'), 'metric-story__value-accumulation')
  })

  test('different (engine, subject) pairs produce different cache keys', () => {
    const keys = new Set(
      STORY_ENGINE_VALUES.flatMap((engine) => VISUAL_SUBJECT_VALUES.map((subject) => fluxAssetCacheKey(engine, subject))),
    )
    assert.equal(keys.size, STORY_ENGINE_VALUES.length * VISUAL_SUBJECT_VALUES.length)
  })

  test('fluxAssetSeed is a deterministic, non-negative integer that is stable across repeated calls', () => {
    const key = fluxAssetCacheKey('bottleneck-story', 'blocked-connection')
    const seed1 = fluxAssetSeed(key)
    const seed2 = fluxAssetSeed(key)
    assert.equal(seed1, seed2)
    assert.equal(Number.isInteger(seed1), true)
    assert.ok(seed1 >= 0)
  })
})

describe('hero illustration prompts (visual-direction v3) — keyed only by subject, same sanitization guarantee as the ambient system above', () => {
  test('getFluxHeroPrompt takes only subject — the one controlled-vocabulary enum param — never a scene/report-shaped argument', () => {
    assert.match(src, /export function getFluxHeroPrompt\(subject: VisualSubject\): string \| undefined/)
  })

  test('every hero-mapped subject\'s prompt forbids text/numbers/logos/photorealism, and contains no digit itself', () => {
    for (const subject of VISUAL_SUBJECT_VALUES) {
      const prompt = getFluxHeroPrompt(subject)
      if (prompt === undefined) continue
      for (const phrase of ['no text', 'no numbers', 'no logos', 'no photorealism']) {
        assert.ok(prompt.includes(phrase), `expected ${subject} hero prompt to include "${phrase}"`)
      }
      assert.equal(/\d/.test(prompt), false, `expected ${subject} hero prompt to contain no digits`)
    }
  })

  test('brand-mark never gets a hero prompt — it stays an exact vector illustration', () => {
    assert.equal(getFluxHeroPrompt('brand-mark'), undefined)
  })

  test('the two friction-adjacent subjects (systems-connection, blocked-connection) are the ONLY ones with a motif overlay prompt — every other hero-mapped subject achieves its own state change with pure Remotion overlays, never a second FLUX asset', () => {
    for (const subject of VISUAL_SUBJECT_VALUES) {
      const hasHero = getFluxHeroPrompt(subject) !== undefined
      const hasMotif = getFluxMotifPrompt(subject) !== undefined
      if (subject === 'systems-connection' || subject === 'blocked-connection') {
        assert.equal(hasMotif, true, `expected ${subject} to have a motif prompt`)
      } else {
        assert.equal(hasMotif, false, `expected ${subject} to have NO motif prompt`)
      }
      void hasHero
    }
  })

  test('a motif prompt (when present) also forbids text/numbers/logos/photorealism and contains no digit', () => {
    for (const subject of VISUAL_SUBJECT_VALUES) {
      const prompt = getFluxMotifPrompt(subject)
      if (prompt === undefined) continue
      for (const phrase of ['no text', 'no numbers', 'no logos', 'no photorealism']) {
        assert.ok(prompt.includes(phrase), `expected ${subject} motif prompt to include "${phrase}"`)
      }
      assert.equal(/\d/.test(prompt), false)
    }
  })
})
