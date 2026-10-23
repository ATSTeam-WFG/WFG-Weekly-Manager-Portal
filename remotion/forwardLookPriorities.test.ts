// Run with: node --test remotion/forwardLookPriorities.test.ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { forwardLookPriorityLabels } from './forwardLookPriorities.ts'
import type { VideoStoryboard, VideoStoryboardScene } from '../src/lib/videoStoryboard.ts'

function scene(overrides: Partial<VideoStoryboardScene> & Pick<VideoStoryboardScene, 'id' | 'title'>): VideoStoryboardScene {
  return { type: 'highlights', ...overrides }
}

function storyboard(scenes: VideoStoryboardScene[]): VideoStoryboard {
  return { title: 'WFG Weekly Leadership Update', weekEnding: 'Week Ending Jan 1, 2026', sourceType: 'weekly-summary', generationMethod: 'ai', scenes }
}

describe('forwardLookPriorityLabels — a render-time cross-reference, never a new content decision', () => {
  test('resolves each of Forward Look\'s own sourceTopicIndexes to the grounded title of the sibling scene that cites the same index', () => {
    const board = storyboard([
      scene({ id: 'ai-scene-0', title: 'Quarter-End Revenue & Remittance Performance', sourceTopicIndexes: [0] }),
      scene({ id: 'ai-scene-1', title: 'Title Production & Underwriting Quality Risk', sourceTopicIndexes: [1] }),
      scene({ id: 'ai-scene-2', title: 'New Agent & Commercial Growth Pipeline', sourceTopicIndexes: [2] }),
      scene({ id: 'forward-look', type: 'forward-look', title: 'Forward Look', sourceTopicIndexes: [0, 1, 2] }),
    ])
    const forwardLook = board.scenes[3]
    assert.deepEqual(forwardLookPriorityLabels(forwardLook, board), [
      'Quarter-End Revenue & Remittance Performance',
      'Title Production & Underwriting Quality Risk',
      'New Agent & Commercial Growth Pipeline',
    ])
  })

  test('an index Forward Look cites that no other scene actually covers is simply skipped — never a fabricated placeholder label', () => {
    const board = storyboard([
      scene({ id: 'ai-scene-0', title: 'Quarter-End Revenue & Remittance Performance', sourceTopicIndexes: [0] }),
      scene({ id: 'forward-look', type: 'forward-look', title: 'Forward Look', sourceTopicIndexes: [0, 1] }),
    ])
    const forwardLook = board.scenes[1]
    assert.deepEqual(forwardLookPriorityLabels(forwardLook, board), ['Quarter-End Revenue & Remittance Performance'])
  })

  test('never returns Forward Look\'s own title, even if it were (incorrectly) self-referencing its own index', () => {
    const board = storyboard([scene({ id: 'forward-look', type: 'forward-look', title: 'Forward Look', sourceTopicIndexes: [0] })])
    assert.deepEqual(forwardLookPriorityLabels(board.scenes[0], board), [])
  })

  test('a Forward Look scene with no sourceTopicIndexes at all returns an empty array', () => {
    const board = storyboard([
      scene({ id: 'ai-scene-0', title: 'Some Topic', sourceTopicIndexes: [0] }),
      scene({ id: 'forward-look', type: 'forward-look', title: 'Forward Look' }),
    ])
    assert.deepEqual(forwardLookPriorityLabels(board.scenes[1], board), [])
  })

  test('two scenes citing the same topic index only contribute that title once (no duplicate labels)', () => {
    const board = storyboard([
      scene({ id: 'ai-scene-0', title: 'Shared Topic', sourceTopicIndexes: [0, 1] }),
      scene({ id: 'ai-scene-1', title: 'Shared Topic', sourceTopicIndexes: [1] }),
      scene({ id: 'forward-look', type: 'forward-look', title: 'Forward Look', sourceTopicIndexes: [0, 1] }),
    ])
    assert.deepEqual(forwardLookPriorityLabels(board.scenes[2], board), ['Shared Topic'])
  })
})
