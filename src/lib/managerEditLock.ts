// Pure decision logic for the weekly Manager submission/editing cutoff. No
// imports beyond easternTime.ts (itself import-free), so this — and its
// test file — run directly via a bare `node --test`, no build step.
//
// ONE cutoff, America/New_York, DST-safe via isPastEasternCutoff: Thursday
// 11:59 PM (WEEKLY_DEADLINE_* in easternTime.ts — the same shared constant
// repReportLock.ts uses for Sales Reps, per the beta-feedback requirement
// that submission and editing follow the same deadline rules, consistently
// across every role). Before it, a manager may freely start a brand-new
// report, save a draft, continue editing, or submit — a report with no
// existing row (Not Started) is treated exactly the same as one that
// already has a row (Draft, auto-submitted, or Submitted) for lock
// purposes. At/after the cutoff, every Manager write locks — Start, Save
// Draft, Submit, Save Changes, Continue/edit anything — for any report, new
// or existing, and stays locked through the rest of the week (see
// isPastEasternCutoff's own later-weekday persistence).
//
// Beta feedback (2026-11-16): replaces the old Friday 3:00 PM
// submission / 4:00 PM editing split with this single Thursday 11:59 PM
// cutoff — only the constant/weekday changed; the decision logic and every
// caller are otherwise untouched. The database enforces this same cutoff
// independently (see supabase/migrations/*_manager_edit_lock.sql and its
// later refinements) as the authoritative, bypass-proof layer; this module
// is the client/service-side mirror used for immediate UX and to avoid an
// unnecessary network round-trip for the common "stale tab" case.
import { isPastEasternCutoff, WEEKLY_DEADLINE_WEEKDAY, WEEKLY_DEADLINE_HOUR, WEEKLY_DEADLINE_MINUTE } from '../utils/easternTime.js'
import type { ReportStatus } from '../types.js'

export const EDIT_CUTOFF_WEEKDAY = WEEKLY_DEADLINE_WEEKDAY
export const EDIT_CUTOFF_HOUR = WEEKLY_DEADLINE_HOUR
export const EDIT_CUTOFF_MINUTE = WEEKLY_DEADLINE_MINUTE

export type ManagerWriteLockReason = 'edit_locked' | null

// `isNewReport` is accepted (and still passed by every caller) purely for
// call-signature stability — callers already need it for other reasons
// (e.g. saveReportV2's stale-draft reconciliation), and keeping the
// parameter here means none of them needed to change when the earlier,
// separate 3:00 PM new-report cutoff was removed. It no longer affects the
// lock decision itself: a new report and an existing report now share the
// exact same cutoff.
export function getManagerWriteLockReason(_isNewReport: boolean, now: Date = new Date()): ManagerWriteLockReason {
  if (isPastEasternCutoff(EDIT_CUTOFF_WEEKDAY, EDIT_CUTOFF_HOUR, EDIT_CUTOFF_MINUTE, now)) return 'edit_locked'
  return null
}

export const MANAGER_WRITE_LOCK_MESSAGES: Record<Exclude<ManagerWriteLockReason, null>, string> = {
  edit_locked: 'Editing is closed for this reporting week.',
}

// Stale-tab reconciliation for Save Draft. A manager's local status can go
// stale relative to the database — most notably, the scheduled auto-submit
// (now tied to the same Thursday 11:59 PM cutoff) can flip an existing
// draft to 'submitted' in the background while a manager's open tab still
// shows 'draft'. If a Save Draft request for that same report still lands
// afterward, the save must still persist their content edits but must
// never regress status back to 'draft'.
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
