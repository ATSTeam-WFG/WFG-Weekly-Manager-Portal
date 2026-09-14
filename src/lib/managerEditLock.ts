// Pure decision logic for the Friday Manager-editing cutoffs. No imports
// beyond easternTime.ts (itself import-free), so this — and its test file —
// run directly via a bare `node --test`, no build step.
//
// Two distinct cutoffs, both America/New_York, DST-safe via
// isPastEasternCutoff:
//   - 3:00 PM: a manager with NO existing report row for this reporting
//     week may no longer start one. They remain Not Submitted.
//   - 3:30 PM: ALL Manager writes lock — Save Draft, Submit, Save Changes,
//     Start, Continue/edit anything — for any report, new or existing.
// The database enforces the same two cutoffs independently (see
// supabase/migrations/*_manager_edit_lock.sql) as the authoritative,
// bypass-proof layer; this module is the client/service-side mirror used
// for immediate UX and to avoid an unnecessary network round-trip for the
// common "stale tab" case.
import { isPastEasternCutoff } from '../utils/easternTime.js'
import type { ReportStatus } from '../types.js'

export const NEW_REPORT_CUTOFF_HOUR = 15
export const NEW_REPORT_CUTOFF_MINUTE = 0
export const EDIT_CUTOFF_HOUR = 15
export const EDIT_CUTOFF_MINUTE = 30

export type ManagerWriteLockReason = 'new_report_locked' | 'edit_locked' | null

// `isNewReport` means: no report row exists yet for this manager/week (the
// caller's status was 'not_started' before this action) — as opposed to
// continuing a draft or editing an already-submitted report, both of which
// count as "existing" regardless of which service function performs the
// write. Checked in this order deliberately: past 3:30 PM always wins,
// regardless of isNewReport, since a manager with no report is just as
// locked out as one with an existing report once editing closes entirely.
export function getManagerWriteLockReason(isNewReport: boolean, now: Date = new Date()): ManagerWriteLockReason {
  if (isPastEasternCutoff(EDIT_CUTOFF_HOUR, EDIT_CUTOFF_MINUTE, now)) return 'edit_locked'
  if (isNewReport && isPastEasternCutoff(NEW_REPORT_CUTOFF_HOUR, NEW_REPORT_CUTOFF_MINUTE, now)) return 'new_report_locked'
  return null
}

export const MANAGER_WRITE_LOCK_MESSAGES: Record<Exclude<ManagerWriteLockReason, null>, string> = {
  new_report_locked: 'The submission deadline has passed for this reporting week. This report remains Not Submitted.',
  edit_locked: 'Editing is closed for this reporting week.',
}

// Stale-tab reconciliation for Save Draft. A manager's local status can go
// stale relative to the database — most notably, the Friday 3:00 PM
// scheduled auto-submit can flip an existing draft to 'submitted' in the
// background while a manager's open tab still shows 'draft'. If they then
// Save Draft between 3:00 and 3:30 PM (editing is intentionally still
// allowed in that window), the save must still persist their content edits
// but must never regress status back to 'draft'.
//
// `currentDbStatus` must be a FRESH read taken immediately before the
// write, never the caller's own possibly-stale in-memory status — that
// fresh read is what this function is checking against. Returns:
//   - 'content-only': the caller must persist sections WITHOUT touching
//     status/submitted_at/submission_source at all (the row is already
//     submitted and must stay that way).
//   - 'upsert': proceed with the normal save, exactly as requested.
// This is purely the decision — see reportsService.ts's saveReportV2 for
// where the fresh read and the actual writes happen. The database trigger's
// own status-regression guard remains as defense-in-depth regardless of
// whether this function is ever reached or reasoned about correctly.
export type SaveStatusResolution = { mode: 'content-only' | 'upsert'; status: ReportStatus }

export function resolveSaveStatus(
  requestedStatus: ReportStatus,
  isNewReport: boolean,
  currentDbStatus: ReportStatus | null,
): SaveStatusResolution {
  if (requestedStatus === 'draft' && !isNewReport && currentDbStatus === 'submitted') {
    return { mode: 'content-only', status: 'submitted' }
  }
  return { mode: 'upsert', status: requestedStatus }
}
