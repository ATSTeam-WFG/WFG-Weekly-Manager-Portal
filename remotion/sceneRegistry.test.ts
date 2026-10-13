// Run with: node --test remotion/sceneRegistry.test.ts
//
// sceneRegistry.ts itself is JSX-free, but it imports nine .tsx scene
// components — Node's built-in type-stripping erases TypeScript types,
// it does not transform JSX syntax, so this file cannot be imported and
// executed directly under plain `node --test` (the same limitation every
// .tsx file in this project already has — see e.g.
// videoCreationSourceStoryboardWiring.test.ts's own header). Verified via
// source inspection instead — see videoRenderWiring.test.ts for the
// complementary source-inspection coverage of the individual scene
// components this registry wires up.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const src = readFileSync(path.join(dir, 'sceneRegistry.ts'), 'utf8')
const storyboardLibSrc = readFileSync(path.join(dir, '..', 'src', 'lib', 'videoStoryboard.ts'), 'utf8')

describe('SCENE_COMPONENTS maps every allowed scene type to a renderer component', () => {
  test('the object literal has exactly one entry per documented scene type, matching the VideoSceneType union in videoStoryboard.ts exactly', () => {
    const unionMatch = storyboardLibSrc.match(/export type VideoSceneType =\s*\n((?:\s*\| '[a-z-]+'\s*\n)+)/)
    assert.ok(unionMatch, 'could not locate the VideoSceneType union')
    const documentedTypes = [...unionMatch[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1])
    assert.equal(documentedTypes.length, 9, 'expected exactly nine documented scene types')

    const mapMatch = src.match(/export const SCENE_COMPONENTS: Record<VideoSceneType, ComponentType<SceneRenderProps>> = \{([\s\S]*?)\n\}/)
    assert.ok(mapMatch, 'could not locate SCENE_COMPONENTS')
    const mappedTypes = [...mapMatch[1].matchAll(/(?:'([a-z-]+)'|^\s*([a-z]+):)/gm)].map((m) => m[1] ?? m[2])

    for (const type of documentedTypes) {
      assert.ok(mappedTypes.includes(type), `expected SCENE_COMPONENTS to map '${type}'`)
    }
    assert.equal(mappedTypes.length, documentedTypes.length, 'expected exactly one mapping per documented type, no more')
  })

  test('every mapped component is imported from its own dedicated scenes/ file — no two scene types share one component', () => {
    const importLines = [...src.matchAll(/import (\w+) from '\.\/scenes\/(\w+)'/g)]
    assert.equal(importLines.length, 9, 'expected nine distinct scene component imports')
    const componentNames = importLines.map((m) => m[1])
    assert.equal(new Set(componentNames).size, 9, 'expected nine distinct component names')
  })

  test('opening and closing are included in the map (they ARE valid renderer targets — only the AI-facing schema excludes them, not the renderer itself)', () => {
    assert.match(src, /opening: OpeningScene,/)
    assert.match(src, /closing: ClosingScene,/)
  })
})

describe('getSceneComponent fails safely on an unrecognized type', () => {
  test('accepts a plain string (not the narrow union) and returns null for anything not in SCENE_COMPONENTS — never throws', () => {
    assert.match(src, /export function getSceneComponent\(type: string\): ComponentType<SceneRenderProps> \| null \{/)
    assert.match(src, /\?\? null/)
  })

  test('never uses a bare/unchecked object index (e.g. SCENE_COMPONENTS[type] without the ?? null fallback) that could return undefined instead of null', () => {
    const fnMatch = src.match(/export function getSceneComponent\(type: string\)[\s\S]*?\n\}/)
    assert.ok(fnMatch)
    assert.match(fnMatch[0], /\)\[type\] \?\? null/)
  })
})

describe('The renderer never executes AI-supplied code — only a fixed lookup by scene.type', () => {
  test('no eval/Function/dangerouslySetInnerHTML/dynamic-import-by-string appears anywhere in this file', () => {
    assert.equal(/eval\(|new Function\(|dangerouslySetInnerHTML|import\(/.test(src), false)
  })
})
