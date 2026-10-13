// Run with: node --test remotion/visualConceptWiring.test.ts
//
// Covers the leadership-importance/visual-concept phase's own cross-cutting
// guarantees, via source inspection (the primitives/scene components are
// .tsx — see sceneRegistry.test.ts's own header for why plain `node --test`
// can't import/execute them directly).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const remotionDir = path.dirname(fileURLToPath(import.meta.url))

function read(...parts: string[]): string {
  return readFileSync(path.join(remotionDir, ...parts), 'utf8')
}

const decorationPropsSrc = read('visuals', 'decorationProps.ts')
const decorationsSrc = read('visuals', 'decorations.tsx')
const decorationColumnSrc = read('visuals', 'DecorationColumn.tsx')
const trajectoryPathSrc = read('visuals', 'TrajectoryPath.tsx')
const flowDiagramSrc = read('visuals', 'FlowDiagram.tsx')
const pressureGaugeSrc = read('visuals', 'PressureGauge.tsx')
const milestoneMarkerSrc = read('visuals', 'MilestoneMarker.tsx')
const metricComparisonAccentSrc = read('visuals', 'MetricComparisonAccent.tsx')
const visualConceptRegistrySrc = read('visualConceptRegistry.ts')
const riskSceneSrc = read('scenes', 'RiskScene.tsx')
const highlightsSceneSrc = read('scenes', 'HighlightsScene.tsx')
const statusSceneSrc = read('scenes', 'StatusScene.tsx')
const forwardLookSceneSrc = read('scenes', 'ForwardLookScene.tsx')
const multiMetricSceneSrc = read('scenes', 'MultiMetricScene.tsx')

// Same line-comment-stripping pattern used throughout this codebase's
// wiring tests (e.g. videoCreationSourceStoryboardWiring.test.ts) — a
// forbidden-pattern check must only ever match real code, never a comment
// that's simply EXPLAINING why the code doesn't do that thing.
const stripComments = (src: string) =>
  src
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')

const ALL_VISUAL_SOURCES = [
  decorationPropsSrc,
  decorationsSrc,
  decorationColumnSrc,
  trajectoryPathSrc,
  flowDiagramSrc,
  pressureGaugeSrc,
  milestoneMarkerSrc,
  metricComparisonAccentSrc,
  visualConceptRegistrySrc,
]

describe('5. visual concepts cannot replace/remove business facts — decoration primitives structurally cannot receive scene content', () => {
  test('VisualDecorationProps carries only frame/fps/itemCount — no scene/storyboard/business-text field exists to pass', () => {
    assert.match(decorationPropsSrc, /export interface VisualDecorationProps \{\s*\n\s*frame: number\s*\n\s*fps: number\s*\n\s*itemCount\?: number\s*\n\s*\}/)
  })

  test('none of the decoration primitive/registry files reference `scene.` or `storyboard.` in real code (only in explanatory comments) — they cannot read business content even if a caller tried to pass it', () => {
    for (const src of ALL_VISUAL_SOURCES) {
      const code = stripComments(src)
      assert.equal(/\bscene\.\w+/.test(code), false)
      assert.equal(/\bstoryboard\.\w+/.test(code), false)
    }
  })

  test('DecorationColumn only forwards frame/fps/itemCount to the decoration component — never a scene field', () => {
    const callMatch = decorationColumnSrc.match(/<Decoration[^/]*\/>/)
    assert.ok(callMatch)
    assert.match(callMatch[0], /frame=\{frame\}/)
    assert.match(callMatch[0], /fps=\{fps\}/)
    assert.match(callMatch[0], /itemCount=\{itemCount\}/)
    assert.doesNotMatch(callMatch[0], /scene/)
  })
})

describe('6. structured metric values are used for DISPLAY, never for decoration scaling (a parsed/scaled bar could visually imply an unsupported comparison)', () => {
  test('MetricComparisonAccent never parses a metric string into a number (no parseFloat/parseInt/Number(/scaling logic)', () => {
    assert.equal(/parseFloat|parseInt|Number\(/.test(metricComparisonAccentSrc), false)
  })

  test('FlowDiagram\'s node count derives only from itemCount (a count), never from a metric VALUE string', () => {
    assert.match(flowDiagramSrc, /itemCount \?\? 3/)
    assert.equal(/metric/i.test(stripComments(flowDiagramSrc)), false)
  })

  test('PressureGauge\'s fill level is a hard-coded constant, never computed from scene/metric content', () => {
    assert.match(pressureGaugeSrc, /const DECORATIVE_FILL_LEVEL = 0\.62/)
    assert.equal(/metric|scene/i.test(stripComments(pressureGaugeSrc)), false)
  })

  test('every content scene that wires a decoration passes itemCount as a real bullets/metrics LENGTH, never the array or a metric value itself', () => {
    for (const src of [riskSceneSrc, highlightsSceneSrc, statusSceneSrc, forwardLookSceneSrc]) {
      assert.match(src, /itemCount=\{bullets\.length\}/)
    }
    assert.match(multiMetricSceneSrc, /itemCount=\{metrics\.length\}/)
  })
})

describe('12. no Anthropic/AI call occurs anywhere in the visual-concept decoration layer', () => {
  test('none of the decoration primitive/registry files reference the Anthropic SDK', () => {
    const anthropicUsage = /from ['"]@anthropic-ai|new Anthropic\(|anthropic\.messages\.|ANTHROPIC_API_KEY/i
    for (const src of ALL_VISUAL_SOURCES) {
      assert.equal(anthropicUsage.test(src), false)
    }
  })
})

describe('13/14/15. no external image/video/avatar/voice-cloning provider was introduced by the decoration layer', () => {
  test('no decoration primitive/registry file references a generative-video/avatar/voice provider or fetches an external image/video asset', () => {
    const forbidden = /heygen|synthesia|tavus|elevenlabs|d-id\b|voice.?clon|avatar|https?:\/\//i
    for (const src of ALL_VISUAL_SOURCES) {
      assert.equal(forbidden.test(src), false)
    }
  })

  test('every visual is built from inline SVG/CSS primitives only — no <img>/<Img>/background-image referencing an external or generated asset', () => {
    for (const src of ALL_VISUAL_SOURCES) {
      assert.equal(/<img|<Img|backgroundImage/i.test(src), false)
    }
  })
})
