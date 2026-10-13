// Run with: node --test remotion/duration.test.ts
//
// Pure, dependency-free (imports only videoStoryboard.ts's TYPES and
// theme.ts's plain FPS constant — no JSX) — real execution.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { sceneDurationInFrames, totalStoryboardDurationInFrames, totalStoryboardDurationWithTransitionsInFrames, transitionDurationInFrames } from './duration.ts'
import { TRANSITION_DURATION_SECONDS } from './narrationTiming.ts'
import type { VideoStoryboard } from '../src/lib/videoStoryboard.ts'

describe('sceneDurationInFrames — durationSeconds maps correctly to frames', () => {
  test('converts seconds to frames at the given fps, rounding to the nearest whole frame', () => {
    assert.equal(sceneDurationInFrames(5, 30), 150)
    assert.equal(sceneDurationInFrames(8, 30), 240)
    assert.equal(sceneDurationInFrames(2.5, 30), 75)
  })

  test('a missing/zero/negative durationSeconds falls back to a safe 5-second default rather than producing a zero-length or negative sequence', () => {
    assert.equal(sceneDurationInFrames(undefined, 30), 150)
    assert.equal(sceneDurationInFrames(0, 30), 150)
    assert.equal(sceneDurationInFrames(-3, 30), 150)
  })

  test('never returns less than 1 frame', () => {
    assert.ok(sceneDurationInFrames(0.001, 30) >= 1)
  })
})

describe('totalStoryboardDurationInFrames — sums every scene\'s own frame budget', () => {
  test('sums durationSeconds across all scenes, converted to frames', () => {
    const storyboard: VideoStoryboard = {
      title: 't',
      weekEnding: 'w',
      sourceType: 'weekly-summary',
      generationMethod: 'deterministic',
      scenes: [
        { id: 'a', type: 'opening', title: 'x', durationSeconds: 5 },
        { id: 'b', type: 'status', title: 'x', durationSeconds: 8 },
        { id: 'c', type: 'closing', title: 'x', durationSeconds: 4 },
      ],
    }
    assert.equal(totalStoryboardDurationInFrames(storyboard, 30), 150 + 240 + 120)
  })

  test('an empty scenes array totals to 0 frames (never a fabricated minimum for the whole video)', () => {
    const storyboard: VideoStoryboard = { title: 't', weekEnding: 'w', sourceType: 'weekly-summary', generationMethod: 'deterministic', scenes: [] }
    assert.equal(totalStoryboardDurationInFrames(storyboard, 30), 0)
  })
})

describe('transitionDurationInFrames / totalStoryboardDurationWithTransitionsInFrames — the composition\'s REAL total once crossfades overlap adjacent scenes', () => {
  test('transitionDurationInFrames converts TRANSITION_DURATION_SECONDS to frames at the given fps', () => {
    assert.equal(transitionDurationInFrames(30), Math.round(TRANSITION_DURATION_SECONDS * 30))
  })

  test('subtracts exactly (sceneCount - 1) transitions worth of frames from the naive total', () => {
    const storyboard: VideoStoryboard = {
      title: 't',
      weekEnding: 'w',
      sourceType: 'weekly-summary',
      generationMethod: 'deterministic',
      scenes: [
        { id: 'a', type: 'opening', title: 'x', durationSeconds: 5 },
        { id: 'b', type: 'status', title: 'x', durationSeconds: 8 },
        { id: 'c', type: 'closing', title: 'x', durationSeconds: 4 },
      ],
    }
    const naive = totalStoryboardDurationInFrames(storyboard, 30)
    const withTransitions = totalStoryboardDurationWithTransitionsInFrames(storyboard, 30)
    assert.equal(withTransitions, naive - 2 * transitionDurationInFrames(30))
  })

  test('a single-scene storyboard has zero transitions, so both totals are identical', () => {
    const storyboard: VideoStoryboard = {
      title: 't',
      weekEnding: 'w',
      sourceType: 'weekly-summary',
      generationMethod: 'deterministic',
      scenes: [{ id: 'a', type: 'opening', title: 'x', durationSeconds: 5 }],
    }
    assert.equal(totalStoryboardDurationWithTransitionsInFrames(storyboard, 30), totalStoryboardDurationInFrames(storyboard, 30))
  })

  test('never returns less than 1 frame even for a degenerate all-empty storyboard', () => {
    const storyboard: VideoStoryboard = { title: 't', weekEnding: 'w', sourceType: 'weekly-summary', generationMethod: 'deterministic', scenes: [] }
    assert.ok(totalStoryboardDurationWithTransitionsInFrames(storyboard, 30) >= 1)
  })
})
