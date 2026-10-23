// Run with: node --test remotion/heroIllustrationRegistry.test.ts
//
// heroIllustrationRegistry.ts itself is JSX-free, but it imports the
// illustration wrapper components (.tsx) — the same limitation
// sceneRegistry.test.ts/visualConceptRegistry.test.ts document for their
// own registries applies here, so this is verified via source inspection.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const src = readFileSync(path.join(dir, 'heroIllustrationRegistry.ts'), 'utf8')
const storyboardLibSrc = readFileSync(path.join(dir, '..', 'src', 'lib', 'videoStoryboard.ts'), 'utf8')

describe('every VisualSubject maps to a real hero illustration — never a silent gap', () => {
  test('HERO_ILLUSTRATIONS has exactly one entry per documented VisualSubject value, and no extras', () => {
    const unionMatch = storyboardLibSrc.match(/export const VISUAL_SUBJECT_VALUES = \[([\s\S]*?)\] as const/)
    assert.ok(unionMatch, 'could not locate VISUAL_SUBJECT_VALUES')
    const documentedValues = [...unionMatch[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1])
    assert.equal(documentedValues.length, 10, 'expected exactly 10 documented visual subjects')

    const mapMatch = src.match(/export const HERO_ILLUSTRATIONS: Record<VisualSubject, ComponentType<VisualDecorationProps>> = \{([\s\S]*?)\n\}/)
    assert.ok(mapMatch, 'could not locate HERO_ILLUSTRATIONS')
    const mappedKeys = [...mapMatch[1].matchAll(/(?:'([a-z-]+)'|^\s*([a-z-]+):)/gm)].map((m) => m[1] ?? m[2])

    for (const value of documentedValues) {
      assert.ok(mappedKeys.includes(value), `expected HERO_ILLUSTRATIONS to map '${value}'`)
    }
    assert.equal(mappedKeys.length, documentedValues.length, 'expected exactly one mapping per documented subject, no more')
  })
})

describe('getHeroIllustration fails safely on an unrecognized/absent subject', () => {
  test('accepts a plain string and returns null for anything not in HERO_ILLUSTRATIONS or when absent — never throws', () => {
    assert.match(src, /export function getHeroIllustration\(subject: string \| undefined\): ComponentType<VisualDecorationProps> \| null \{/)
    assert.match(src, /if \(!subject\) return null/)
    assert.match(src, /\?\? null/)
  })

  test('never uses a bare/unchecked object index that could return undefined instead of null', () => {
    const fnMatch = src.match(/export function getHeroIllustration\(subject: string \| undefined\)[\s\S]*?\n\}/)
    assert.ok(fnMatch)
    assert.match(fnMatch[0], /\)\[subject\] \?\? null/)
  })
})

describe('the renderer never executes AI-supplied code — only a fixed lookup by visualPlan.subject', () => {
  test('no eval/Function/dangerouslySetInnerHTML/dynamic-import-by-string appears anywhere in this file', () => {
    assert.equal(/eval\(|new Function\(|dangerouslySetInnerHTML|import\(/.test(src), false)
  })
})

// STORY_ENGINE_ACCENT_ILLUSTRATIONS/getStoryEngineAccent (a small corner
// accent layered over a static FLUX image) were removed when the layered
// visual-mechanics integration replaced that whole render path — see
// remotion/LayeredStoryScene.tsx/layeredMechanics.ts, which now supply the
// deterministic per-engine MOTION directly, making a separate accent
// illustration redundant.
describe('the removed accent-illustration exports do not linger as dead code', () => {
  test('STORY_ENGINE_ACCENT_ILLUSTRATIONS/getStoryEngineAccent no longer exist in this file', () => {
    assert.equal(/STORY_ENGINE_ACCENT_ILLUSTRATIONS|getStoryEngineAccent/.test(src), false)
  })
})
