import { supabase } from './supabaseClient'
import type { ManagerReportSectionsV2, ReportContent, ReportStatus } from '../types'
import { getReportingWeekFromStartDate } from '../utils/week'
import { REPORT_CONTENT_COLUMNS as REPORT_CONTENT_COLUMNS_BASE, rowToContent, serializeBullets } from './reportContentMapping'
import { getManagerWriteLockReason, MANAGER_WRITE_LOCK_MESSAGES, resolveSaveStatus } from './managerEditLock'

// Thrown by the two write functions below when a fresh, call-time check
// finds the relevant Friday cutoff already passed — this is the
// "application/service guard" layer of defense-in-depth: it catches a stale
// open tab (the UI rendered its enabled/disabled state before the cutoff,
// but the manager only clicks Save minutes later) without an unnecessary
// network round-trip. The database trigger (see
// supabase/migrations/*_manager_edit_lock.sql) is the authoritative,
// bypass-proof layer underneath this one — this error can never be the only
// thing standing between a determined bypass and a locked write.
export class ManagerEditLockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ManagerEditLockedError'
  }
}

function assertNotLocked(isNewReport: boolean): void {
  const reason = getManagerWriteLockReason(isNewReport)
  if (reason) throw new ManagerEditLockedError(MANAGER_WRITE_LOCK_MESSAGES[reason])
}

interface WeekReport {
  status: ReportStatus
  content: ReportContent
  submittedAt: string | null
}

// A genuine "no report exists yet" result and "the query itself failed"
// must never be collapsed into the same value — a caller that only checks
// for a falsy/null return can't tell them apart, which is exactly what
// previously let a failed fetch render as "Not Started" instead of a
// distinct, non-destructive error state. See App.tsx's finishSigningIn and
// Dashboard.tsx's statusLoadError handling for how each outcome is used.
export type FetchWeekReportOutcome =
  | { status: 'found'; report: WeekReport }
  | { status: 'not_found' }
  | { status: 'error' }

const REPORT_CONTENT_COLUMNS = `status, ${REPORT_CONTENT_COLUMNS_BASE}, submitted_at`

export async function fetchWeekReport(managerId: string, weekStartDate: string): Promise<FetchWeekReportOutcome> {
  const { data, error } = await supabase
    .from('reports')
    .select(REPORT_CONTENT_COLUMNS)
    .eq('manager_id', managerId)
    .eq('week_start_date', weekStartDate)
    .maybeSingle()

  if (error) {
    console.error('Failed to fetch report from Supabase:', error.message)
    return { status: 'error' }
  }
  if (!data) return { status: 'not_found' }

  return {
    status: 'found',
    report: {
      status: data.status,
      content: rowToContent(data),
      submittedAt: data.submitted_at,
    },
  }
}

export interface ManagerReportHistoryEntry {
  weekStartDate: string
  weekLabel: string
  status: ReportStatus
  submittedAt: string | null
}

export async function fetchReportHistory(
  managerId: string,
  beforeWeekStartDate: string,
): Promise<ManagerReportHistoryEntry[]> {
  const { data, error } = await supabase
    .from('reports')
    .select('week_start_date, status, submitted_at')
    .eq('manager_id', managerId)
    .lt('week_start_date', beforeWeekStartDate)
    .order('week_start_date', { ascending: false })

  if (error) {
    console.error('Failed to fetch report history from Supabase:', error.message)
    return []
  }

  return (data ?? []).map((row) => ({
    weekStartDate: row.week_start_date,
    weekLabel: getReportingWeekFromStartDate(row.week_start_date).label,
    status: row.status,
    submittedAt: row.submitted_at,
  }))
}

async function fetchCurrentStatus(managerId: string, weekStartDate: string): Promise<ReportStatus | null> {
  const { data, error } = await supabase
    .from('reports')
    .select('status')
    .eq('manager_id', managerId)
    .eq('week_start_date', weekStartDate)
    .maybeSingle()

  if (error) {
    console.error('Failed to check current report status before saving:', error.message)
    return null
  }
  return data?.status ?? null
}

// Edits to an already-submitted V2 report: update only the V2 columns, via
// an UPDATE (never an upsert), so status, submitted_at, and submission_source
// are never touched. If the existing row was still legacy-format, this is
// also how it transitions to V2 — its legacy columns are never referenced
// here, so they're left completely untouched, preserved for historical/audit
// purposes even though the row now displays as V2 going forward.
export async function updateReportSectionsV2(
  managerId: string,
  weekStartDate: string,
  sections: ManagerReportSectionsV2,
): Promise<void> {
  // Editing an existing report (whether a saved draft or an already-
  // submitted one) is never a "new report" — the single 4:00 PM edit cutoff
  // always applies here (see managerEditLock.ts).
  assertNotLocked(false)

  const { error } = await supabase
    .from('reports')
    .update({
      what_matters_now: serializeBullets(sections.whatMattersNow),
      looking_around_corner: serializeBullets(sections.lookingAroundCorner),
      next_week_priorities: serializeBullets(sections.nextWeekPriorities),
      other_notable_items: sections.otherNotableItems.trim(),
      okr_notes: sections.okrNotes.trim(),
    })
    .eq('manager_id', managerId)
    .eq('week_start_date', weekStartDate)

  if (error) {
    console.error('Failed to update report in Supabase:', error.message)
    throw error
  }
}

// Save Draft / Submit for the V2 form. Deliberately omits top_priorities,
// wins, and challenges from the payload — on conflict (an existing legacy
// row for this manager/week), Postgres's ON CONFLICT DO UPDATE SET only
// touches the columns actually listed here, so those three legacy columns
// are never altered, exactly as required.
//
// `isNewReport`: true only when no report row exists yet for this
// manager/week (the caller's status was 'not_started' before this call) —
// the caller (App.tsx) already tracks this and must pass it accurately,
// since this function's own upsert can't distinguish "creating" from
// "continuing a draft" without an extra read. No longer affects which
// cutoff applies (a new report and an existing one now share the same
// single 4:00 PM edit cutoff — see managerEditLock.ts) — still needed here
// for the stale-draft reconciliation below, which must only ever run for an
// existing report.
//
// Returns the status actually persisted — normally identical to the
// requested `status`, but see the stale-draft reconciliation below for the
// one case where it differs. Callers should use the returned value to
// correct any optimistic local state rather than assuming the request
// always got exactly what it asked for.
export async function saveReportV2(
  managerId: string,
  weekStartDate: string,
  sections: ManagerReportSectionsV2,
  status: ReportStatus,
  isNewReport: boolean,
): Promise<ReportStatus> {
  assertNotLocked(isNewReport)

  // Stale-draft reconciliation (see managerEditLock.ts's resolveSaveStatus
  // for the pure decision, tested there in isolation): only worth the extra
  // read when this call could possibly be racing an auto-submit — a fresh
  // 'draft' request against an existing row. A new report, or a genuine
  // Submit request, can never hit the regression this guards against.
  const currentStatus = status === 'draft' && !isNewReport ? await fetchCurrentStatus(managerId, weekStartDate) : null
  const resolution = resolveSaveStatus(status, isNewReport, currentStatus)

  if (resolution.mode === 'content-only') {
    // The report is already submitted; persist the manager's content edits
    // without touching status/submitted_at/submission_source at all —
    // reuses the exact same content-only update already proven correct for
    // editing an already-submitted report, rather than duplicating it.
    await updateReportSectionsV2(managerId, weekStartDate, sections)
    return resolution.status
  }

  const payload = {
    manager_id: managerId,
    week_start_date: weekStartDate,
    status: resolution.status,
    what_matters_now: serializeBullets(sections.whatMattersNow),
    looking_around_corner: serializeBullets(sections.lookingAroundCorner),
    next_week_priorities: serializeBullets(sections.nextWeekPriorities),
    other_notable_items: sections.otherNotableItems.trim(),
    okr_notes: sections.okrNotes.trim(),
    submitted_at: status === 'submitted' ? new Date().toISOString() : null,
    // This function is only ever called for a manager's own fresh save —
    // editing an already-submitted report goes through updateReportSectionsV2
    // instead, which never touches this column. So a 'submitted' status here
    // always means a genuine manual submission.
    submission_source: status === 'submitted' ? 'manual' : null,
  }

  const { error } = await supabase.from('reports').upsert(payload, { onConflict: 'manager_id,week_start_date' })

  if (error) {
    console.error('Failed to save report to Supabase:', error.message)
    throw error
  }

  return status
}
