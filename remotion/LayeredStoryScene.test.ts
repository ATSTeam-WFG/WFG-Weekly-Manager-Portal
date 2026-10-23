// Run with: node --test remotion/LayeredStoryScene.test.ts
//
// LayeredStoryScene.tsx is JSX — Node's built-in type-stripping erases
// TypeScript types but does not transform JSX, so (as with every other
// .tsx renderer in this project — see sceneRegistry.test.ts's own
// precedent) it is verified here via direct source inspection rather than
// import + render. The underlying MECHANICS it calls into
// (layeredMechanics.ts) are pure .ts and are exercised with real execution
// in layeredMechanics.test.ts instead.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const src = readFileSync(path.join(dir, 'LayeredStoryScene.tsx'), 'utf8')
const storySceneSrc = readFileSync(path.join(dir, 'StoryScene.tsx'), 'utf8')

const stripComments = (source: string) =>
  source
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')

describe('text reduction: LayeredStoryScene never renders a paragraph block, bullet list, or large Next box — only eyebrow/title, and mechanic-appropriate minimal text', () => {
  test('scene.body is never read/rendered — normal-business-scene paragraph text is deliberately dropped in this render path', () => {
    assert.equal(/scene\.body/.test(stripComments(src)), false)
  })

  test('scene.bullets are used ONLY as short progression waypoint labels (progression mechanic) or the systems-friction composition\'s two short consequence captions — never a rendered list of full sentences', () => {
    const matches = [...stripComments(src).matchAll(/scene\.bullets/g)]
    assert.equal(
      matches.length,
      3,
      'expected exactly three references to scene.bullets: the progression length check, its fallback-to-priorityLabels expression, and the SystemsFrictionComposition bullets prop',
    )
    assert.match(src, /const labels = \(scene\.bullets\?\.length \? scene\.bullets : \(priorityLabels \?\? \[\]\)\)\.slice\(0, 4\)/)
    assert.match(src, /bullets=\{scene\.bullets \?\? \[\]\}/)
  })

  test('scene.next is rendered only as a small label (flow-pressure mechanic), never inside a large "Next" box/card', () => {
    assert.equal(/backgroundColor:\s*COLORS\.softSand/.test(src), false)
    assert.match(src, /scene\.next &&/)
  })
})

describe('metrics remain exact and grounded — the render path never invents or labels an intermediate value as fact', () => {
  test('accumulation renders the single metric\'s REAL label/value as text — never a computed/interpolated number', () => {
    const accumBlock = src.match(/mechanic === 'accumulation'\) \{([\s\S]*?)\} else if/)
    assert.ok(accumBlock)
    assert.match(accumBlock[1], /\{metric\.value\}/)
    assert.match(accumBlock[1], /\{metric\.label\}/)
  })

  test('comparison renders each metric\'s REAL label/value as text for every bar — bar HEIGHT may be scaled by roughMagnitude, but the displayed text is always the verbatim grounded value', () => {
    const comparisonBlock = src.match(/mechanic === 'comparison'\) \{([\s\S]*?)\} else if/)
    assert.ok(comparisonBlock)
    assert.match(comparisonBlock[1], /\{metric\.value\}/)
    assert.match(comparisonBlock[1], /\{metric\.label\}/)
  })

  test('roughMagnitude is used only to scale a bar\'s HEIGHT (a style value), never rendered as on-screen text itself', () => {
    assert.equal(/\{roughMagnitude/.test(src), false)
  })

  test('buildProgress/staggeredBuildProgress (the 0-1 visual-only build fraction) are never themselves rendered as a visible text node — only passed as props or used for opacity/height/style', () => {
    // A JSX text CHILD looks like `>{expr}<` or `>{expr.toFixed(...)}<`; a
    // prop assignment like `progress={progress}` is fine (it's data
    // flowing into a sub-component's rendering logic, never displayed as
    // a number itself).
    assert.equal(/>\{[^}]*progress[^}]*\}</i.test(src), false)
  })
})

describe('FLUX is treated as an ambient backdrop only — never a source of on-screen text, never regenerated per frame', () => {
  test('scene.fluxAssetPath is used only to conditionally render a single background <Img> — never to render text, never read anywhere else', () => {
    const matches = [...src.matchAll(/scene\.fluxAssetPath/g)]
    assert.equal(matches.length, 2, 'expected exactly two references: the presence check and the <Img> src')
    assert.match(src, /scene\.fluxAssetPath \? \(/)
    assert.match(src, /<Img src=\{staticFile\(scene\.fluxAssetPath\)\}/)
  })

  test('the background image is fetched once per scene render, never re-requested per frame with a frame-dependent URL', () => {
    assert.equal(/staticFile\(`.*\$\{frame/.test(src), false)
  })
})

describe('mechanic selection is delegated entirely to layeredMechanics.ts — this file never re-implements or duplicates that logic', () => {
  test('mechanicForEngine (imported from layeredMechanics.ts) is the ONLY thing that decides which mechanic renders — no separate if/else re-deriving it from scene.type or scene.leadershipImportance', () => {
    assert.match(src, /import \{[\s\S]*?mechanicForEngine[\s\S]*?\} from '\.\/layeredMechanics'/)
    assert.match(src, /const mechanic = mechanicForEngine\(engine, scene\.metrics\?\.length \?\? 0\)/)
    assert.equal(/scene\.leadershipImportance/.test(src), false, 'mechanic selection must never re-read leadershipImportance — that content decision was already made upstream')
  })

  test('this file never imports the Anthropic SDK or calls any AI service — it only ever renders an already-decided scene', () => {
    assert.equal(/anthropic|@anthropic-ai/i.test(src), false)
  })
})

describe('StoryScene routes to LayeredStoryScene based on storyEngine (or forward-look), never based on fluxAssetPath presence — the layered mechanic must still render even when no FLUX asset exists', () => {
  test('the routing condition reads scene.storyEngine, not scene.fluxAssetPath', () => {
    assert.match(storySceneSrc, /const effectiveEngine: StoryEngine \| undefined = scene\.storyEngine \?\? \(scene\.type === 'forward-look' \? 'pipeline-story' : undefined\)/)
    assert.match(storySceneSrc, /if \(effectiveEngine\) \{/)
  })

  test('LayeredStoryScene itself renders a plain gradient background when scene.fluxAssetPath is absent — the deterministic fallback for a failed/unavailable asset generation', () => {
    assert.match(src, /scene\.fluxAssetPath \? \(/)
    assert.match(src, /linear-gradient\(180deg, \$\{COLORS\.warmCream\}, \$\{COLORS\.softSand\}\)/)
  })
})

describe('value is a literal "piling up" metaphor (ValueChipStack), shared by accumulation and comparison — never a flat generic bar', () => {
  test('both mechanics render the same ValueChipStack component — no separate, divergent bar-chart implementation for comparison', () => {
    assert.match(src, /function ValueChipStack\(/)
    const accumBlock = src.match(/mechanic === 'accumulation'\) \{([\s\S]*?)\} else if/)
    const comparisonBlock = src.match(/mechanic === 'comparison'\) \{([\s\S]*?)\} else if/)
    assert.ok(accumBlock && /<ValueChipStack/.test(accumBlock[1]))
    assert.ok(comparisonBlock && /<ValueChipStack/.test(comparisonBlock[1]))
  })

  test('comparison sizes each stack\'s chip COUNT from chipCountForRelativeHeight (imported from layeredMechanics.ts) — never a hardcoded chip count that ignores the metric\'s real relative magnitude', () => {
    assert.match(src, /import \{[\s\S]*?chipCountForRelativeHeight[\s\S]*?\} from '\.\/layeredMechanics'/)
    assert.match(src, /const chipCount = chipCountForRelativeHeight\(relativeHeight, maxChipCount\)/)
  })
})

describe('flow-pressure friction has a subject-specific visual — "document" (unchanged token flow) vs "interface" (the richer SystemsFrictionComposition) — never one generic node shape for every kind of friction', () => {
  test('SystemsFrictionComposition visibly changes a system window\'s status color once friction reaches "rework"/"constrained-exit" (the "visible operational consequence"), never a fixed color regardless of state', () => {
    const compositionBlock = src.match(/function SystemsFrictionComposition\(([\s\S]*?)\n}\n/)
    assert.ok(compositionBlock)
    assert.match(compositionBlock[1], /healthy \? COLORS\.slateBlue : COLORS\.espresso/)
    assert.match(compositionBlock[1], /const failed = beat === 'rework' \|\| beat === 'constrained-exit'/)
  })

  test('skinForSubject maps systems-connection/blocked-connection to the interface skin, and document-workflow to the document skin — a rendering choice keyed to the already-decided visualPlan.subject, never a new content judgment', () => {
    assert.match(src, /if \(subject === 'document-workflow'\) return 'document'/)
    assert.match(src, /if \(subject === 'systems-connection' \|\| subject === 'blocked-connection'\) return 'interface'/)
  })

  test('the interface skin routes to SystemsFrictionComposition, and reuses the SAME flow-pressure timing (flowSchedule) as the document-workflow path — never a second, divergent timing system', () => {
    assert.match(src, /mechanic === 'flow-pressure' && skin === 'interface'/)
    assert.match(src, /<SystemsFrictionComposition frame=\{frame\} durationInFrames=\{durationInFrames\} flowSchedule=\{flowSchedule\}/)
  })
})

describe('Forward Look\'s waypoint labels fall back to sibling scenes\' grounded titles ONLY when scene.bullets is itself empty — a business pipeline scene\'s own real bullets are never overridden', () => {
  test('priorityLabels is used strictly as the fallback branch of a ternary keyed on scene.bullets?.length, never unconditionally', () => {
    assert.match(src, /scene\.bullets\?\.length \? scene\.bullets : \(priorityLabels \?\? \[\]\)/)
  })

  test('LayeredStoryScene never imports or computes forwardLookPriorityLabels itself — that cross-reference lives in ForwardLookScene.tsx, which alone has access to the full storyboard', () => {
    assert.equal(/forwardLookPriorityLabels/.test(src), false)
  })
})

describe('a grounded dollar figure in a waypoint label gets its own small badge — extracted via leadingDollarFigure, never a separately computed/invented number', () => {
  test('the badge text comes directly from leadingDollarFigure(label), and renders nothing when the label has no dollar figure', () => {
    assert.match(src, /import \{[\s\S]*?leadingDollarFigure[\s\S]*?\} from '\.\/layeredMechanics'/)
    assert.match(src, /const valueBadge = label \? leadingDollarFigure\(label\) : null/)
    assert.match(src, /\{valueBadge && \(/)
  })
})
