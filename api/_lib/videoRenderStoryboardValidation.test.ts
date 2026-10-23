import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateRenderStoryboard } from './videoRenderStoryboardValidation.ts'

function validStoryboard(): Record<string, unknown> {
  return {
    title: 'WFG Weekly Leadership Update',
    weekEnding: 'Week Ending September 25, 2026',
    sourceType: 'weekly-summary',
    generationMethod: 'ai',
    scenes: [
      {
        id: 'opening',
        type: 'opening',
        title: 'Weekly Leadership Update',
        durationSeconds: 5,
        narrationText: 'Welcome to this weekly update.',
      },
      {
        id: 'highlights-1',
        type: 'highlights',
        title: 'Weekly Highlights',
        durationSeconds: 10,
        narrationText: 'Here are the highlights.',
      },
      {
        id: 'closing',
        type: 'closing',
        title: 'Together We Close More',
        durationSeconds: 5,
        narrationText: 'Together we close more.',
      },
    ],
  }
}

test('accepts a structurally valid storyboard', () => {
  const result = validateRenderStoryboard(
    validStoryboard(),
    'weekly-summary',
  )
  assert.equal(result.ok, true)
})

test('rejects a mismatched report source', () => {
  const result = validateRenderStoryboard(
    validStoryboard(),
    'leadership-report',
  )
  assert.deepEqual(result, {
    ok: false,
    code: 'INVALID_STORYBOARD',
  })
})

test('rejects duplicate scene IDs', () => {
  const storyboard = validStoryboard()
  const scenes = storyboard.scenes as Record<string, unknown>[]
  scenes[1].id = 'opening'

  const result = validateRenderStoryboard(storyboard, 'weekly-summary')
  assert.equal(result.ok, false)
})

test('rejects opening or closing scenes in the wrong position', () => {
  const storyboard = validStoryboard()
  const scenes = storyboard.scenes as Record<string, unknown>[]
  scenes[0].type = 'highlights'

  const result = validateRenderStoryboard(storyboard, 'weekly-summary')
  assert.deepEqual(result, {
    ok: false,
    code: 'INVALID_SCENE_ORDER',
  })
})

test('rejects videos longer than 90 seconds', () => {
  const storyboard = validStoryboard()
  const scenes = storyboard.scenes as Record<string, unknown>[]
  scenes[0].durationSeconds = 30
  scenes[1].durationSeconds = 30
  scenes[2].durationSeconds = 30

  // Exactly 90 seconds is allowed; add another scene to exceed it.
  scenes.splice(2, 0, {
    id: 'extra',
    type: 'status',
    title: 'Additional Status',
    durationSeconds: 10,
  })

  const result = validateRenderStoryboard(storyboard, 'weekly-summary')
  assert.deepEqual(result, {
    ok: false,
    code: 'VIDEO_TOO_LONG',
  })
})

test('rejects unverified presenter video paths', () => {
  const storyboard = validStoryboard()
  const scenes = storyboard.scenes as Record<string, unknown>[]
  scenes[0].avatarVideoAssetPath = '../../private/video.mp4'

  const result = validateRenderStoryboard(storyboard, 'weekly-summary')
  assert.deepEqual(result, {
    ok: false,
    code: 'ASSET_AUTHORIZATION_REQUIRED',
  })
})

test('rejects unverified cinematic footage', () => {
  const storyboard = validStoryboard()
  const scenes = storyboard.scenes as Record<string, unknown>[]
  scenes[1].cinematicAssets = [
    { assetPath: 'cinematic/example.mp4', durationSeconds: 5 },
  ]

  const result = validateRenderStoryboard(storyboard, 'weekly-summary')
  assert.deepEqual(result, {
    ok: false,
    code: 'ASSET_AUTHORIZATION_REQUIRED',
  })
})

test('rejects oversized narration', () => {
  const storyboard = validStoryboard()
  const scenes = storyboard.scenes as Record<string, unknown>[]
  scenes[1].narrationText = 'x'.repeat(211)

  const result = validateRenderStoryboard(storyboard, 'weekly-summary')
  assert.deepEqual(result, {
    ok: false,
    code: 'INVALID_SCENE',
  })
})

test('rejects missing scene titles', () => {
  const storyboard = validStoryboard()
  const scenes = storyboard.scenes as Record<string, unknown>[]
  scenes[1].title = ''

  const result = validateRenderStoryboard(storyboard, 'weekly-summary')
  assert.deepEqual(result, {
    ok: false,
    code: 'INVALID_SCENE',
  })
})
