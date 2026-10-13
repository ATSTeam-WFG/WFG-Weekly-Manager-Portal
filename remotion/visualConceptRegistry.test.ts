// Run with: node --test remotion/visualConceptRegistry.test.ts
//
// visualConceptRegistry.ts itself is JSX-free, but it imports decorations.tsx
// (JSX), which itself imports the five .tsx primitive components — the same
// limitation sceneRegistry.test.ts documents for scene components applies
// here, so this is verified via source inspection instead.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const src = readFileSync(path.join(dir, 'visualConceptRegistry.ts'), 'utf8')
const storyboardLibSrc = readFileSync(path.join(dir, '..', 'src', 'lib', 'videoStoryboard.ts'), 'utf8')

describe('10. VISUAL_CONCEPT_DECORATIONS maps important visual concepts to a renderer safely', () => {
  test('every key in the map is a real, documented VisualConcept value (never a made-up/free-text key)', () => {
    const unionMatch = storyboardLibSrc.match(/export const VISUAL_CONCEPT_VALUES = \[([\s\S]*?)\] as const/)
    assert.ok(unionMatch, 'could not locate VISUAL_CONCEPT_VALUES')
    const documentedValues = [...unionMatch[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1])
    assert.equal(documentedValues.length, 13, 'expected exactly 13 documented visual concepts')

    const mapMatch = src.match(/export const VISUAL_CONCEPT_DECORATIONS: Partial<Record<VisualConcept, ComponentType<VisualDecorationProps>>> = \{([\s\S]*?)\n\}/)
    assert.ok(mapMatch, 'could not locate VISUAL_CONCEPT_DECORATIONS')
    const mappedKeys = [...mapMatch[1].matchAll(/(?:'([a-z-]+)'|^\s*([a-z]+):)/gm)].map((m) => m[1] ?? m[2])

    for (const key of mappedKeys) {
      assert.ok(documentedValues.includes(key), `mapped key "${key}" is not a documented VisualConcept value`)
    }
  })

  test('editorial-headline/hero-metric/closing-brand are deliberately UNMAPPED (documented, not accidental)', () => {
    assert.doesNotMatch(src, /'editorial-headline':/)
    assert.doesNotMatch(src, /'hero-metric':/)
    assert.doesNotMatch(src, /'closing-brand':/)
    assert.match(src, /deliberately\s*\n?\s*\/\/? ?ABSENT/i)
  })
})

describe('11. an unknown/unsupported visual concept fails safely', () => {
  test('getVisualConceptDecoration accepts a plain string and returns null for anything unrecognized or absent — never throws', () => {
    assert.match(src, /export function getVisualConceptDecoration\(concept: string \| undefined\): ComponentType<VisualDecorationProps> \| null \{/)
    assert.match(src, /if \(!concept\) return null/)
    assert.match(src, /\?\? null/)
  })

  test('never uses a bare/unchecked object index that could return undefined instead of null', () => {
    const fnMatch = src.match(/export function getVisualConceptDecoration\(concept: string \| undefined\)[\s\S]*?\n\}/)
    assert.ok(fnMatch)
    assert.match(fnMatch[0], /\)\[concept\] \?\? null/)
  })
})
