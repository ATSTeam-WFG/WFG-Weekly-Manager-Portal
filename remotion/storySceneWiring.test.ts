// Run with: node --test remotion/storySceneWiring.test.ts
//
// Covers this phase's own cross-cutting guarantees for the Visual Director
// / illustration layer, via source inspection (StoryScene.tsx and the
// illustration components are .tsx — see sceneRegistry.test.ts's header for
// why plain `node --test` can't import/execute them directly).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const remotionDir = path.dirname(fileURLToPath(import.meta.url))

function read(...parts: string[]): string {
  return readFileSync(path.join(remotionDir, ...parts), 'utf8')
}

const stripComments = (source: string) =>
  source
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')

const storySceneSrc = read('StoryScene.tsx')
const heroIllustrationRegistrySrc = read('heroIllustrationRegistry.ts')
const illustrationWrappersSrc = read('illustrations', 'illustrationWrappers.tsx')
const valueAccumulationSrc = read('illustrations', 'ValueAccumulation.tsx')
const heroFlowSrc = read('illustrations', 'HeroFlowIllustration.tsx')
const trajectoryHeroSrc = read('illustrations', 'TrajectoryHero.tsx')
const comparisonBarsSrc = read('illustrations', 'ComparisonBars.tsx')
const brandMarkSrc = read('illustrations', 'BrandMark.tsx')

const ALL_ILLUSTRATION_SOURCES = [
  heroIllustrationRegistrySrc,
  illustrationWrappersSrc,
  valueAccumulationSrc,
  heroFlowSrc,
  trajectoryHeroSrc,
  comparisonBarsSrc,
  brandMarkSrc,
]

describe('5. business facts remain independent from visual metaphors — illustrations structurally cannot receive scene content', () => {
  test('none of the illustration primitive/registry/wrapper files reference `scene.` or `storyboard.` in real code (only in explanatory comments)', () => {
    for (const src of ALL_ILLUSTRATION_SOURCES) {
      const code = stripComments(src)
      assert.equal(/\bscene\.\w+/.test(code), false)
      assert.equal(/\bstoryboard\.\w+/.test(code), false)
    }
  })

  test('StoryScene only ever passes frame/fps/itemCount to the resolved Illustration component — never a scene text field', () => {
    const callMatch = storySceneSrc.match(/<Illustration frame=\{frame\} fps=\{fps\} itemCount=\{itemCount\} \/>/g)
    assert.ok(callMatch && callMatch.length >= 1)
  })

  test('itemCount passed to the illustration is always a bullets/metrics LENGTH (a count), never the array or any metric value itself', () => {
    assert.match(storySceneSrc, /const itemCount = scene\.bullets\?\.length \|\| scene\.metrics\?\.length \|\| undefined/)
  })
})

describe('4. visual concepts/plans cannot contain arbitrary HTML/CSS/code — illustrations are built only from controlled SVG/CSS primitives', () => {
  test('no illustration file uses dangerouslySetInnerHTML, eval, new Function, or a dynamic import', () => {
    for (const src of ALL_ILLUSTRATION_SOURCES) {
      assert.equal(/dangerouslySetInnerHTML|eval\(|new Function\(|import\(/.test(src), false)
    }
  })

  test('no illustration file reads a business-fact string and injects it as raw markup — every rendered value is a fixed decorative shape', () => {
    for (const src of [valueAccumulationSrc, heroFlowSrc, trajectoryHeroSrc, comparisonBarsSrc, brandMarkSrc]) {
      assert.equal(/dangerouslySetInnerHTML/.test(src), false)
    }
  })
})

describe('ComparisonBars/FlowDiagram-style illustrations never scale by a parsed metric value (would visually imply an unsupported magnitude)', () => {
  test('ComparisonBars uses a fixed decorative height pattern, never Number()/parseFloat() on any metric string', () => {
    assert.match(comparisonBarsSrc, /const BAR_HEIGHT_FRACTIONS = \[/)
    assert.equal(/parseFloat|parseInt|Number\(/.test(stripComments(comparisonBarsSrc)), false)
  })

  test('HeroFlowIllustration\'s node count derives only from itemCount (a count), never from a metric VALUE string', () => {
    assert.match(heroFlowSrc, /itemCount \?\? 4/)
    assert.equal(/metric/i.test(stripComments(heroFlowSrc)), false)
  })
})

describe('StoryScene falls back to each scene component\'s original layout when visualPlan is absent — never a regression for an existing storyboard', () => {
  test('every redesigned scene component checks `if (scene.visualPlan)` before routing to StoryScene, with its original layout still reachable otherwise', () => {
    for (const file of ['scenes/BigMetricScene.tsx', 'scenes/MultiMetricScene.tsx', 'scenes/RiskScene.tsx', 'scenes/HighlightsScene.tsx', 'scenes/StatusScene.tsx', 'scenes/ForwardLookScene.tsx']) {
      const src = read(...file.split('/'))
      assert.match(src, /if \(scene\.visualPlan\) \{\s*\n\s*return <StoryScene/, `expected ${file} to gate on scene.visualPlan`)
    }
  })
})
