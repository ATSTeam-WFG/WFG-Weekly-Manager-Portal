// Run with: node --test src/lib/repReportBucket.test.ts
// This module has zero Supabase/runtime dependency (only `../types`, which
// itself has no imports) — unlike almost everything else that touches
// rep_reports in this codebase, it is genuinely, directly importable and
// callable here, not just source-inspectable.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { deriveRepReportBucket, type BucketableRepReport } from './repReportBucket.ts'

function report(status: BucketableRepReport['status'], reviewStatus: BucketableRepReport['reviewStatus']): BucketableRepReport {
  return { status, reviewStatus }
}

describe('deriveRepReportBucket — status calculations', () => {
  test('null (no report row at all) is "missing"', () => {
    assert.equal(deriveRepReportBucket(null), 'missing')
  })

  test('a draft report (never submitted) is "missing", regardless of its reviewStatus field', () => {
    assert.equal(deriveRepReportBucket(report('draft', 'pending')), 'missing')
    assert.equal(deriveRepReportBucket(report('draft', 'approved')), 'missing')
    assert.equal(deriveRepReportBucket(report('draft', 'rejected')), 'missing')
  })

  test('a submitted report with reviewStatus "pending" is "pending"', () => {
    assert.equal(deriveRepReportBucket(report('submitted', 'pending')), 'pending')
  })

  test('a submitted report with reviewStatus "approved" is "approved"', () => {
    assert.equal(deriveRepReportBucket(report('submitted', 'approved')), 'approved')
  })

  test('a submitted report with reviewStatus "rejected" is "rejected"', () => {
    assert.equal(deriveRepReportBucket(report('submitted', 'rejected')), 'rejected')
  })

  test('reviewStatus is checked in a fixed order — approved before rejected — but the two states are mutually exclusive in practice, so this just documents the precedence', () => {
    // A real row never has reviewStatus simultaneously meaning two things;
    // this asserts the function reads reviewStatus directly rather than
    // falling through to a default for any status==='submitted' input.
    assert.equal(deriveRepReportBucket(report('submitted', 'approved')), 'approved')
    assert.equal(deriveRepReportBucket(report('submitted', 'rejected')), 'rejected')
  })
})
