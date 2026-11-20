// Run with: node --test src/lib/repReportBucket.test.ts
// This module has zero Supabase/runtime dependency (only `../types`, which
// itself has no imports) — unlike almost everything else that touches
// rep_reports in this codebase, it is genuinely, directly importable and
// callable here, not just source-inspectable.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { deriveRepReportBucket, type BucketableRepReport } from './repReportBucket.ts'

function report(status: BucketableRepReport['status']): BucketableRepReport {
  return { status }
}

// Beta feedback (2026-11-16): collapsed from the old 4-way
// missing/pending/approved/rejected split (keyed off review_status) to a
// plain 3-way missing/draft/submitted split (keyed off status alone).
describe('deriveRepReportBucket — status calculations', () => {
  test('null (no report row at all) is "missing"', () => {
    assert.equal(deriveRepReportBucket(null), 'missing')
  })

  test('a draft report is "draft"', () => {
    assert.equal(deriveRepReportBucket(report('draft')), 'draft')
  })

  test('a submitted report is "submitted", regardless of review_status (no longer part of this type at all)', () => {
    assert.equal(deriveRepReportBucket(report('submitted')), 'submitted')
  })
})
