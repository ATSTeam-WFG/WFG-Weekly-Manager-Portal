import assert from 'node:assert/strict'
import test from 'node:test'
import { validateRenderReportGrounding } from './videoRenderReportGrounding.ts'
import type { AtsReport } from '../../src/lib/atsReport.ts'
import type { VideoStoryboard } from '../../src/lib/videoStoryboard.ts'

const report = {
  openingParagraph: 'The team completed 12 improvements.',
  topics: [{
    title: 'Portal Updates',
    statusSummary: 'Completed 12 improvements.',
    next: 'Prepare the next release.',
    bullets: ['Resolved 8 issues.'],
  }],
} as AtsReport

function storyboard(): VideoStoryboard {
  return {
    title: 'Weekly Update',
    weekEnding: 'October 2026',
    sourceType: 'weekly-summary',
    generationMethod: 'ai',
    scenes: [
      {
        id: 'opening',
        type: 'opening',
        title: 'Welcome',
        durationSeconds: 5,
      },
      {
        id: 'updates',
        type: 'highlights',
        title: 'Portal Updates',
        body: 'Completed 12 improvements and resolved 8 issues.',
        narrationText: 'We completed 12 improvements.',
        sourceTopicIndexes: [0],
        durationSeconds: 10,
      },
      {
        id: 'closing',
        type: 'closing',
        title: 'Thank You',
        durationSeconds: 5,
      },
    ],
  } as VideoStoryboard
}

test('accepts supported numbers', () => {
  assert.deepEqual(
    validateRenderReportGrounding(storyboard(), report),
    { ok: true },
  )
})

test('rejects invented numbers', () => {
  const video = storyboard()
  video.scenes[1].body = 'Completed 999 improvements.'

  assert.deepEqual(
    validateRenderReportGrounding(video, report),
    { ok: false, code: 'UNSUPPORTED_NUMERIC_CLAIM' },
  )
})

test('rejects out-of-range source topic indexes', () => {
  const video = storyboard()
  video.scenes[1].sourceTopicIndexes = [7]

  assert.deepEqual(
    validateRenderReportGrounding(video, report),
    { ok: false, code: 'INVALID_SOURCE_TOPIC' },
  )
})

test('rejects fractional source topic indexes', () => {
  const video = storyboard()
  video.scenes[1].sourceTopicIndexes = [0.5]

  assert.deepEqual(
    validateRenderReportGrounding(video, report),
    { ok: false, code: 'INVALID_SOURCE_TOPIC' },
  )
})
