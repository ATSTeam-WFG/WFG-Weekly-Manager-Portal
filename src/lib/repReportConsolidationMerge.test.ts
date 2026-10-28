// Run with: node --test src/lib/repReportConsolidationMerge.test.ts
//
// Phase 1C acceptance fix — EXECUTABLE tests (not source inspection) for the
// actual duplicate-text-prevention and failed-save-retry logic extracted
// into repReportConsolidationMerge.ts. This file has zero imports beyond
// the module under test, so every assertion here runs the REAL merge
// decision function directly, the same way reportValidation.test.ts and
// managerEditLock.test.ts already exercise their own pure logic modules.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  fieldHasContent,
  formatConsolidationField,
  formatRepBlock,
  newFieldBlocksForSelection,
  type SalesRepReportSectionsShape,
} from './repReportConsolidationMerge.ts'

const SAMPLE_CONTENT: SalesRepReportSectionsShape = {
  accomplishments: ['Closed 3 deals', 'Onboarded 2 new accounts'],
  salesMetrics: ['$50k booked'],
  pipelineUpdates: [],
  blockers: ['  '], // whitespace-only — must count as empty
  nextWeekPriorities: ['Follow up with ACME'],
  managerSupportNeeded: '',
}

describe('fieldHasContent', () => {
  test('a populated bullet array has content', () => {
    assert.equal(fieldHasContent(SAMPLE_CONTENT, 'accomplishments'), true)
  })
  test('an empty bullet array has no content', () => {
    assert.equal(fieldHasContent(SAMPLE_CONTENT, 'pipelineUpdates'), false)
  })
  test('a whitespace-only bullet array has no content', () => {
    assert.equal(fieldHasContent(SAMPLE_CONTENT, 'blockers'), false)
  })
  test('an empty free-text field has no content', () => {
    assert.equal(fieldHasContent(SAMPLE_CONTENT, 'managerSupportNeeded'), false)
  })
})

describe('formatConsolidationField / formatRepBlock — source traceability (clearly identifies rep and field)', () => {
  test('a bullet field is labeled and each bullet is prefixed', () => {
    const text = formatConsolidationField(SAMPLE_CONTENT, 'accomplishments')
    assert.equal(text, 'Accomplishments:\n• Closed 3 deals\n• Onboarded 2 new accounts')
  })

  test('formatRepBlock clearly names the rep, visually separated from the field content', () => {
    const block = formatRepBlock('Jane Doe', ['Accomplishments:\n• Closed 3 deals'])
    assert.match(block, /^— From Jane Doe —\n/)
    assert.match(block, /Accomplishments:/)
  })
})

describe('newFieldBlocksForSelection — the actual duplicate-text-prevention decision', () => {
  test('a first-time import returns every selected field with content', () => {
    const blocks = newFieldBlocksForSelection(SAMPLE_CONTENT, new Set(['accomplishments', 'salesMetrics']), '')
    assert.equal(blocks.length, 2)
  })

  test('a field with no content is never included even if selected', () => {
    const blocks = newFieldBlocksForSelection(SAMPLE_CONTENT, new Set(['pipelineUpdates']), '')
    assert.deepEqual(blocks, [])
  })

  // The core bug this acceptance round fixed: the DB ledger could report
  // "idempotent, no new row" while the client still blindly re-appended the
  // same text. This asserts the ACTUAL text-duplication decision directly,
  // independent of any database/ledger state.
  test('a field block already present verbatim in the current report is excluded — simulating a second Apply of the identical selection', () => {
    const firstPass = newFieldBlocksForSelection(SAMPLE_CONTENT, new Set(['accomplishments']), '')
    assert.equal(firstPass.length, 1)
    const alreadyAppliedText = `Some manager notes.\n\n${formatRepBlock('Jane Doe', firstPass)}`

    const secondPass = newFieldBlocksForSelection(SAMPLE_CONTENT, new Set(['accomplishments']), alreadyAppliedText)
    assert.deepEqual(secondPass, [], 'the second Apply of the exact same field must add nothing new')
  })

  test('partial overlap: a NEW field from the same rep is still added even when another field was already applied earlier', () => {
    const firstPass = newFieldBlocksForSelection(SAMPLE_CONTENT, new Set(['accomplishments']), '')
    const alreadyAppliedText = formatRepBlock('Jane Doe', firstPass)

    const secondPass = newFieldBlocksForSelection(SAMPLE_CONTENT, new Set(['accomplishments', 'salesMetrics']), alreadyAppliedText)
    assert.equal(secondPass.length, 1, 'only the genuinely new field (salesMetrics) should be returned')
    assert.match(secondPass[0], /Sales Metrics:/)
  })

  // "Do not treat an import ledger entry as proof that manager report
  // content was successfully persisted" — simulated here as: the import
  // RPC/ledger may have recorded the action, but the actual saved report
  // (represented by currentOtherNotableItems) never received the text
  // because the save failed and the page was reloaded. A retry must be
  // allowed to add the content again, not be silently blocked.
  test('failed-save retry: if the text never actually made it into the current report, a later attempt is treated as genuinely new, not a blocked duplicate', () => {
    const neverPersistedText = '' // represents a freshly-reloaded report whose save had failed before this
    const retryBlocks = newFieldBlocksForSelection(SAMPLE_CONTENT, new Set(['accomplishments']), neverPersistedText)
    assert.equal(retryBlocks.length, 1, 'a retry after a failed save must still add the content — an unrelated ledger row must never block it')
  })

  test('a manually edited/removed version of previously-imported text does not falsely block re-importing it — the check only ever prevents an EXACT re-duplication, never a legitimate re-add after the manager changed their own content', () => {
    const editedText = 'Accomplishments:\n• Closed 3 deals (manager added a note)' // no longer an exact match
    const blocks = newFieldBlocksForSelection(SAMPLE_CONTENT, new Set(['accomplishments']), editedText)
    assert.equal(blocks.length, 1, 'an inexact match must not be treated as already-applied')
  })

  test('selecting fields from two different reps never cross-contaminates — each rep/field is checked independently', () => {
    const repAContent: SalesRepReportSectionsShape = { ...SAMPLE_CONTENT, accomplishments: ['Rep A accomplishment'] }
    const repBContent: SalesRepReportSectionsShape = { ...SAMPLE_CONTENT, accomplishments: ['Rep B accomplishment'] }
    const afterRepAApplied = formatRepBlock('Rep A', newFieldBlocksForSelection(repAContent, new Set(['accomplishments']), ''))

    const repBBlocks = newFieldBlocksForSelection(repBContent, new Set(['accomplishments']), afterRepAApplied)
    assert.equal(repBBlocks.length, 1, 'Rep B\'s own distinct content must still be added — it is not textually present yet')
  })
})
