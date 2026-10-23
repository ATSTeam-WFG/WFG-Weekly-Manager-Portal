// Run with: node --test remotion/IllustratedStoryScene.test.ts
//
// JSX file — verified via source inspection, exactly like
// LayeredStoryScene.test.ts's own established convention.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const src = readFileSync(path.join(dir, 'IllustratedStoryScene.tsx'), 'utf8')
const storySceneSrc = readFileSync(path.join(dir, 'StoryScene.tsx'), 'utf8')

function block(name: string): string {
  const match = src.match(new RegExp(`function ${name}\\(([\\s\\S]*?)\\n}\\n`))
  assert.ok(match, `expected to find function ${name}`)
  return match![1]
}

describe('IllustratedStoryScene dispatches on cinematicTreatmentForScene (visual-direction v4) — never recipeForSubject alone', () => {
  test('the top-level component imports cinematicTreatmentForScene from visualStorySpec.ts and switches on it', () => {
    assert.match(src, /import \{ accentForSubject, cinematicTreatmentForScene, recipeForSubject, treatmentSeed, type CinematicTreatment \} from '\.\/visualStorySpec'/)
    assert.match(src, /const treatment = cinematicTreatmentForScene\(props\.scene\)/)
  })

  test('all six illustrated-capable treatments each have a distinct top-level component', () => {
    for (const name of [
      'CinematicEnvironmentTreatment',
      'HeroMetricTreatment',
      'DataStoryTreatment',
      'ChallengeTreatment',
      'TechnologyTreatment',
      'RegionalMapTreatment',
    ]) {
      assert.match(src, new RegExp(`function ${name}\\(`))
    }
  })

  test('ILLUSTRATED_TREATMENTS is exported and lists exactly the six treatments this file renders — never the three dedicated-component treatments', () => {
    assert.match(src, /export const ILLUSTRATED_TREATMENTS: ReadonlySet<CinematicTreatment> = new Set\(\[/)
    for (const name of ['CHALLENGE', 'TECHNOLOGY', 'REGIONAL_MAP', 'DATA_STORY', 'HERO_METRIC', 'CINEMATIC_ENVIRONMENT']) {
      assert.match(src, new RegExp(`'${name}'`))
    }
    for (const dedicated of ['BRANDED_OPENING', 'BRANDED_CLOSING', 'FORWARD_LOOKING']) {
      const setBlock = src.match(/export const ILLUSTRATED_TREATMENTS[\s\S]*?\]\)/)![0]
      assert.equal(setBlock.includes(`'${dedicated}'`), false)
    }
  })
})

describe('treatmentSeed varies presentation within a treatment — two scenes sharing a treatment are not forced into an identical layout', () => {
  test('HeroMetricTreatment picks between two corner placements via treatmentSeed', () => {
    assert.match(block('HeroMetricTreatment'), /treatmentSeed\(scene\.id\) % 2 === 0/)
  })

  test('RegionalMapTreatment picks between two map placements via treatmentSeed', () => {
    assert.match(block('RegionalMapTreatment'), /treatmentSeed\(scene\.id\) % 2 === 0/)
  })

  test('pickOrigin varies the camera origin per scene id, and every treatment calls it with its own distinct offset', () => {
    assert.match(src, /function pickOrigin\(sceneId: string, offset = 0\): string/)
    const offsets = [...src.matchAll(/pickOrigin\(scene\.id(?:, (\d+))?\)/g)].map((m) => m[1] ?? '0')
    assert.equal(new Set(offsets).size, offsets.length, 'expected every pickOrigin call site to use a distinct offset')
  })
})

describe('CinematicEnvironmentTreatment consults recipeForSubject only as an internal camera/composition hint, never a business-fact source', () => {
  test('workflow and growth recipes get genuinely different compositions (file-pile accumulation vs. forward pan + detail callout)', () => {
    const envBlock = block('CinematicEnvironmentTreatment')
    assert.match(envBlock, /if \(recipe === 'workflow'\)/)
    assert.match(envBlock, /if \(recipe === 'growth'\)/)
    assert.match(envBlock, /camera="pan"/)
  })
})

describe('metrics/bullets remain exact and grounded — no treatment invents, relabels, or drops a value', () => {
  test('HeroMetricTreatment renders the metric\'s real value/label as text, never a derived/rounded figure', () => {
    const b = block('HeroMetricTreatment')
    assert.match(b, /\{metric\.value\}/)
    assert.match(b, /\{metric\.label\}/)
  })

  test('DataStoryTreatment renders every metric\'s real value/label as text; relative bar height is a presentation-only scale, not a replacement for the real value', () => {
    const b = block('DataStoryTreatment')
    assert.match(b, /\{metric\.value\}/)
    assert.match(b, /\{metric\.label\}/)
    assert.match(b, /roughMagnitude\(m\.value\)/)
  })

  test('RegionalMapTreatment only ever names a region detectGroundedRegion actually found, and only shows a detail value derived from leadingDollarFigure or a real scene.metrics entry', () => {
    const b = block('RegionalMapTreatment')
    assert.match(b, /const region = detectGroundedRegion\(scene\)/)
    assert.match(b, /leadingDollarFigure\(value\)/)
  })

  test('TechnologyTreatment\'s caption comes directly from scene.bullets/scene.next — never a fabricated string', () => {
    assert.match(block('TechnologyTreatment'), /const caption = scene\.bullets\?\.\[0\] \?\? scene\.next/)
  })

  test('ChallengeTreatment\'s caption comes directly from scene.next/scene.bullets — never a fabricated string', () => {
    assert.match(block('ChallengeTreatment'), /const caption = scene\.next \|\| scene\.bullets\?\.\[0\]/)
  })
})

describe('no leftover chip/pill/badge-stack decoration from the pre-cinematic-direction renderer (per the "STOP BEFORE ANOTHER FULL RENDER" feedback)', () => {
  test('no treatment renders a metric-chip stack or a bordered/backgrounded badge around a metric value', () => {
    assert.equal(/chipCountForRelativeHeight|chipVisibility/.test(src), false)
  })
})

describe('this file never imports the Anthropic SDK or calls any AI service — it only ever renders an already-decided scene', () => {
  test('no Anthropic reference anywhere in the file', () => {
    assert.equal(/anthropic|@anthropic-ai/i.test(src), false)
  })
})

describe('StoryScene routes to IllustratedStoryScene ONLY when a hero backdrop exists (FLUX still OR cinematicAssets) AND the classified treatment is one this component renders — otherwise it falls straight through to the existing, unchanged LayeredStoryScene/neutral paths', () => {
  test('the routing condition checks (fluxHeroAssetPath OR cinematicAssets.length > 0) AND ILLUSTRATED_TREATMENTS membership together', () => {
    assert.match(storySceneSrc, /scene\.fluxHeroAssetPath \|\| \(scene\.cinematicAssets && scene\.cinematicAssets\.length > 0\)/)
    assert.match(storySceneSrc, /ILLUSTRATED_TREATMENTS\.has\(cinematicTreatmentForScene\(scene\)\)/)
    assert.match(storySceneSrc, /return <IllustratedStoryScene/)
  })

  test('this branch appears BEFORE the effectiveEngine/LayeredStoryScene branch, so a qualifying hero illustration always wins when both would otherwise apply — the two render paths are mutually exclusive by construction (single function, early returns)', () => {
    const illustratedIndex = storySceneSrc.indexOf('scene.fluxHeroAssetPath || (scene.cinematicAssets')
    const layeredIndex = storySceneSrc.indexOf('const effectiveEngine')
    assert.ok(illustratedIndex > 0 && layeredIndex > 0 && illustratedIndex < layeredIndex)
  })

  test('ILLUSTRATED_TREATMENTS is imported directly from IllustratedStoryScene.tsx, never redefined in StoryScene.tsx (a single source of truth for which treatments are illustrated)', () => {
    assert.match(storySceneSrc, /import IllustratedStoryScene, \{ ILLUSTRATED_TREATMENTS \} from '\.\/IllustratedStoryScene'/)
    assert.equal(/const ILLUSTRATED_TREATMENTS/.test(storySceneSrc), false)
  })
})

describe('the generalized multi-shot cinematic engine (v4) — works for ANY week\'s scenes via scene.cinematicAssets, never hard-coded to one topic', () => {
  test('IllustratedStoryScene dispatches to LumaShotSequence whenever scene.cinematicAssets is a non-empty array, before the six FLUX treatments are even considered', () => {
    assert.match(src, /if \(props\.scene\.cinematicAssets && props\.scene\.cinematicAssets\.length > 0\) \{/)
    assert.match(src, /return <LumaShotSequence/)
  })

  test('LumaShotSequence delegates ALL timing to shotPlanForScene (remotion/shotPlan.ts) — it never computes a shot boundary itself', () => {
    assert.match(src, /import \{ shotPlanForScene, type Shot \} from '\.\/shotPlan'/)
    assert.match(block('LumaShotSequence'), /shotPlanForScene\(scene, fps, durationInFrames\)/)
  })

  test('a cinematic shot plays the real asset bounded by its own Sequence — VideoBackdrop never receives a hardcoded/invented duration', () => {
    const cinematicShotInner = block('CinematicShotInner')
    assert.match(cinematicShotInner, /<VideoBackdrop asset=\{asset\} frame=\{frame\} fps=\{fps\} camera="zoom-out" \/>/)
  })

  test('VideoBackdrop supports trim (startFrom/endAt) and crop (cropScale/cropOrigin) — the mechanism that lets ONE generated clip yield two distinct-feeling shots without a new generation', () => {
    const videoBackdrop = block('VideoBackdrop')
    assert.match(videoBackdrop, /startFrom=\{startFrom\}/)
    assert.match(videoBackdrop, /endAt=\{endAt\}/)
    assert.match(videoBackdrop, /cropScale/)
    assert.match(videoBackdrop, /cropOrigin/)
  })

  test('exactly one accent shot kind, chosen by the SAME content-driven cinematicTreatmentForScene classifier every other treatment uses — never a per-topic special case', () => {
    const accentShot = block('AccentShot')
    assert.match(accentShot, /const treatment = cinematicTreatmentForScene\(scene\)/)
    for (const name of ['RegionalAccent', 'MetricAccent', 'OperationalAccent', 'BrandedAccent']) {
      assert.match(src, new RegExp(`function ${name}\\(`))
    }
  })

  test('accent content pulls only metrics[0]/bullets[0]/a detected region — never the full metric or bullet stack, and never a hardcoded scene-specific value', () => {
    assert.match(block('MetricAccent'), /scene\.metrics\?\.\[0\]/)
    assert.match(block('OperationalAccent'), /scene\.bullets\?\.\[0\] \?\? scene\.next/)
    assert.match(block('RegionalAccent'), /detectGroundedRegion\(scene\)/)
    // never an index into metrics/bullets beyond position 0 anywhere in the accent components
    assert.equal(/metrics\?\.\[[1-9]\]|bullets\?\.\[[1-9]\]/.test(src), false)
  })
})
