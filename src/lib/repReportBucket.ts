// Pure, dependency-free (no Supabase import, no side effects) status-bucket
// logic for a Sales Rep's weekly report — extracted into its own module
// specifically so it can be unit-tested directly (every other file in
// src/lib that touches rep_reports transitively imports supabaseClient.ts,
// which throws at module-eval time outside a real browser/Vite env — see
// adminRepVisibilityWiring.test.ts's own header comment). Mirrors the same
// state machine SalesRepDashboard.tsx's deriveReportState and MyReps.tsx's
// rowStatusLabel each already implement independently for their own
// screens — this codebase's established pattern of each surface owning its
// bucket function — collapsed to 4 buckets here since this is an aggregate
// rollup, not a single-report detail view.
import type { RepReportReviewStatus, RepReportStatus } from '../types'

export type RepReportBucket = 'missing' | 'pending' | 'approved' | 'rejected'

export interface BucketableRepReport {
  status: RepReportStatus
  reviewStatus: RepReportReviewStatus
}

// 'missing' covers both "no report row exists yet" and "a draft exists but
// was never submitted" — both read as "nothing submitted" for a
// reporting-progress rollup. A report's status stays 'submitted' forever
// once first submitted (even after rejection — see
// rep_reports_submission_governance.sql), so reviewStatus is what
// distinguishes pending/approved/rejected within that.
export function deriveRepReportBucket(report: BucketableRepReport | null): RepReportBucket {
  if (!report || report.status === 'draft') return 'missing'
  if (report.reviewStatus === 'approved') return 'approved'
  if (report.reviewStatus === 'rejected') return 'rejected'
  return 'pending'
}
