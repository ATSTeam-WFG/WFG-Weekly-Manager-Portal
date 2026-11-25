// Pure, dependency-free (no Supabase import, no side effects) status-bucket
// logic for a Sales Rep's weekly report — extracted into its own module
// specifically so it can be unit-tested directly (every other file in
// src/lib that touches rep_reports transitively imports supabaseClient.ts,
// which throws at module-eval time outside a real browser/Vite env — see
// adminRepVisibilityWiring.test.ts's own header comment).
//
// Beta feedback (2026-11-16): collapsed from the old 4-way
// missing/pending/approved/rejected split (keyed off review_status) to a
// plain 3-way missing/draft/submitted split (keyed off status alone) —
// review_status no longer gates or labels anything now that Approve/
// Reject is replaced by optional, non-blocking feedback (see
// repReportsService.ts's addRepReportFeedback/fetchRepReportFeedback).
// Matches the shape SalesAdminReports.tsx's own local bucketOf already
// used (that screen deliberately never surfaced review status at all).
import type { RepReportStatus } from '../types'

export type RepReportBucket = 'missing' | 'draft' | 'submitted'

export interface BucketableRepReport {
  status: RepReportStatus
}

// 'missing' covers "no report row exists yet" (not_started). A 'draft'
// exists but was never submitted. Anything else (status === 'submitted')
// is 'submitted', regardless of review_status — review_status is now
// purely historical/informational (see MyReps.tsx's "Review History (Past
// Decisions)" section) and never changes which bucket a report falls into.
export function deriveRepReportBucket(report: BucketableRepReport | null): RepReportBucket {
  if (!report) return 'missing'
  if (report.status === 'draft') return 'draft'
  return 'submitted'
}
