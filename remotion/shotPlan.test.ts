// Run with: node --test remotion/shotPlan.test.ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { shotPlanForScene } from './shotPlan.ts'
import type { CinematicAsset, VideoStoryboardScene } from '../src/lib/videoStoryboard.ts'

const FPS = 30

function scene(overrides: Partial<VideoStoryboardScene> & Pick<VideoStoryboardScene, 'id' | 'title'>): VideoStoryboardScene {
  return { type: 'highlights', ...overrides }
}

function asset(overrides: Partial<CinematicAsset> & Pick<CinematicAsset, 'assetPath' | 'durationSeconds'>): CinematicAsset {
  return { ...overrides }
}

describe('shotPlanForScene — a scene with no cinematicAssets never produces shots (falls through to the existing FLUX treatment, untouched)', () => {
  test('undefined cinematicAssets returns []', () => {
    assert.deepEqual(shotPlanForScene(scene({ id: 's0', title: 'x' }), FPS, 300), [])
  })

  test('an empty cinematicAssets array returns []', () => {
    assert.deepEqual(shotPlanForScene(scene({ id: 's0', title: 'x', cinematicAssets: [] }), FPS, 300), [])
  })
})

describe('a cinematic shot is NEVER longer than its own real (optionally trimmed) duration — the freeze-proofing guarantee', () => {
  test('a single asset shorter than the scene budget never gets stretched past its own length', () => {
    const shots = shotPlanForScene(
      scene({ id: 's0', title: 'x', metrics: [{ label: 'a', value: '$1' }, { label: 'b', value: '$2' }], cinematicAssets: [asset({ assetPath: 'a.mp4', durationSeconds: 3 })] }),
      FPS,
      300, // 10s scene, only 3s of real footage
    )
    const cinematic = shots.filter((s) => s.kind === 'cinematic')
    assert.equal(cinematic.length, 1)
    assert.equal(cinematic[0].durationInFrames, 90) // exactly 3s @ 30fps, never more
  })

  test('trimStartSeconds/trimEndSeconds bound the usable length, not the raw clip duration', () => {
    const shots = shotPlanForScene(
      scene({ id: 's0', title: 'x', cinematicAssets: [asset({ assetPath: 'a.mp4', durationSeconds: 10, trimStartSeconds: 2, trimEndSeconds: 5 })] }),
      FPS,
      90,
    )
    const cinematic = shots.find((s) => s.kind === 'cinematic')
    assert.ok(cinematic)
    assert.equal(cinematic.durationInFrames, 90) // 3s trimmed window, scene budget allows all of it
  })

  test('a single asset LONGER than the scene budget is capped at the remaining budget, never overflowing the scene', () => {
    const shots = shotPlanForScene(scene({ id: 's0', title: 'x', cinematicAssets: [asset({ assetPath: 'a.mp4', durationSeconds: 20 })] }), FPS, 90)
    const total = shots.reduce((sum, s) => sum + s.durationInFrames, 0)
    assert.equal(total, 90)
  })
})

describe('an accent shot appears for a treatment with a genuine grounded fact to isolate, and is capped short (never a long filler screen)', () => {
  test('a DATA_STORY-classified scene (2+ metrics) with ample footage still gets a short accent, not an unbounded one', () => {
    const shots = shotPlanForScene(
      scene({
        id: 's0',
        title: 'x',
        metrics: [{ label: 'a', value: '$1' }, { label: 'b', value: '$2' }],
        cinematicAssets: [asset({ assetPath: 'a.mp4', durationSeconds: 20 })],
      }),
      FPS,
      300, // 10s scene
    )
    const accent = shots.find((s) => s.kind === 'accent')
    assert.ok(accent, 'expected an accent shot for a DATA_STORY scene')
    assert.ok(accent.durationInFrames <= 90, 'expected the accent to be capped at ~3s, never a long filler screen')
  })

  test('a CINEMATIC_ENVIRONMENT-classified scene (no metrics/bullets) gets NO accent when footage alone covers the full scene', () => {
    const shots = shotPlanForScene(scene({ id: 's0', title: 'x', cinematicAssets: [asset({ assetPath: 'a.mp4', durationSeconds: 20 })] }), FPS, 90)
    assert.equal(shots.some((s) => s.kind === 'accent'), false)
  })
})

describe('overflow handling — leftover scene time beyond the available footage NEVER freezes/loops a cinematic shot; it always goes to the (possibly newly-created) accent', () => {
  test('a CINEMATIC_ENVIRONMENT scene whose footage runs out early still gets an accent shot to cover the remainder, even though that treatment normally has none', () => {
    const shots = shotPlanForScene(scene({ id: 's0', title: 'x', cinematicAssets: [asset({ assetPath: 'a.mp4', durationSeconds: 2 })] }), FPS, 300)
    const total = shots.reduce((sum, s) => sum + s.durationInFrames, 0)
    assert.equal(total, 300, 'every frame of the scene must be covered by some shot')
    const accent = shots.find((s) => s.kind === 'accent')
    assert.ok(accent, 'expected an overflow accent even for a treatment with no normal accent')
    assert.ok(accent.durationInFrames > 150, 'expected the overflow accent to absorb most of the uncovered scene time')
  })
})

describe('multiple cinematic assets (two shots from one generation, or two distinct generations) split the cinematic budget, never exceeding any single asset\'s own length', () => {
  test('two assets each under their own cap split the available time without either exceeding its own usable length', () => {
    const shots = shotPlanForScene(
      scene({
        id: 's0',
        title: 'x',
        cinematicAssets: [
          asset({ assetPath: 'a.mp4', durationSeconds: 5, trimEndSeconds: 2.5 }),
          asset({ assetPath: 'a.mp4', durationSeconds: 5, trimStartSeconds: 2.5, cropScale: 1.3 }),
        ],
      }),
      FPS,
      150, // 5s scene
    )
    const cinematic = shots.filter((s) => s.kind === 'cinematic')
    assert.equal(cinematic.length, 2)
    for (const shot of cinematic) {
      assert.ok(shot.durationInFrames <= 75, 'no single asset-derived shot may exceed its own 2.5s usable length')
    }
    const totalCinematic = cinematic.reduce((sum, s) => sum + s.durationInFrames, 0)
    assert.equal(totalCinematic, 150, 'two 2.5s assets fully cover a 5s scene with no accent needed')
  })
})
