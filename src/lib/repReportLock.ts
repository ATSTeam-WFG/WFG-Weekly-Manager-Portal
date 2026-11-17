// Pure decision logic for the Sales Rep weekly submission/editing cutoff.
// Mirrors managerEditLock.ts exactly (same isPastEasternCutoff primitive,
// same shape, same WEEKLY_DEADLINE_* constant — per the beta-feedback
// requirement that submission and editing follow the same deadline rules,
// consistently across every role). No imports beyond easternTime.ts, so
// this — and its test file — run directly via a bare `node --test`.
//
// This is a UX/client mirror only, NOT the enforcement boundary. The
// database is authoritative and independently enforces the identical
// cutoff (DST-safe, via the same AT TIME ZONE idiom as the manager cutoff)
// inside save_rep_report_draft/submit_rep_report/
// resubmit_rejected_rep_report — see
// supabase/migrations/20261027150000_rep_reports_submission_governance.sql.
// A stale client clock or a modified frontend can never bypass the real
// cutoff; this module exists purely so the UI can show the right message
// and disable the right button immediately, without a network round-trip.
import { isPastEasternCutoff, WEEKLY_DEADLINE_WEEKDAY, WEEKLY_DEADLINE_HOUR, WEEKLY_DEADLINE_MINUTE } from '../utils/easternTime.js'

export const REP_SUBMISSION_CUTOFF_WEEKDAY = WEEKLY_DEADLINE_WEEKDAY
export const REP_SUBMISSION_CUTOFF_HOUR = WEEKLY_DEADLINE_HOUR
export const REP_SUBMISSION_CUTOFF_MINUTE = WEEKLY_DEADLINE_MINUTE

export function isRepSubmissionPastCutoff(now: Date = new Date()): boolean {
  return isPastEasternCutoff(REP_SUBMISSION_CUTOFF_WEEKDAY, REP_SUBMISSION_CUTOFF_HOUR, REP_SUBMISSION_CUTOFF_MINUTE, now)
}

// Beta feedback (2026-11-16): drafts and edits to an already-submitted
// report are both locked by this same cutoff, with no exception path (same
// as a Manager's edit lock) — only a brand-new SUBMISSION past the deadline
// can still be unlocked by an admin-granted late-submission exception (see
// grant_rep_report_late_submission_exception), unchanged by this update.
export const REP_SUBMISSION_DEADLINE_MESSAGE =
  'The Thursday 11:59 PM Eastern deadline for this reporting week has passed. Submitting now requires an admin-authorized exception.'
