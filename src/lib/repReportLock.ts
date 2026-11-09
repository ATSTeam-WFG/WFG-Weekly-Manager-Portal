// Pure decision logic for the Sales Rep Friday submission cutoff. Mirrors
// managerEditLock.ts exactly (same isPastEasternCutoff primitive, same
// shape), only the hour differs: 2:00 PM Eastern for a rep's submission,
// vs. 4:00 PM for a manager's edit lock. No imports beyond easternTime.ts,
// so this — and its test file — run directly via a bare `node --test`.
//
// This is a UX/client mirror only, NOT the enforcement boundary. The
// database is authoritative and independently enforces the identical
// Friday-2:00-PM-Eastern cutoff (DST-safe, via the same AT TIME ZONE idiom
// as the manager cutoff) inside submit_rep_report and
// resubmit_rejected_rep_report — see
// supabase/migrations/20261027150000_rep_reports_submission_governance.sql.
// A stale client clock or a modified frontend can never bypass the real
// cutoff; this module exists purely so the UI can show the right message
// and disable the right button immediately, without a network round-trip.
import { isPastEasternCutoff } from '../utils/easternTime.js'

export const REP_SUBMISSION_CUTOFF_HOUR = 14
export const REP_SUBMISSION_CUTOFF_MINUTE = 0

export function isRepSubmissionPastCutoff(now: Date = new Date()): boolean {
  return isPastEasternCutoff(REP_SUBMISSION_CUTOFF_HOUR, REP_SUBMISSION_CUTOFF_MINUTE, now)
}

export const REP_SUBMISSION_DEADLINE_MESSAGE =
  'The Friday 2:00 PM Eastern deadline for this reporting week has passed. Saving a draft is still allowed; submitting requires an admin-authorized exception.'
