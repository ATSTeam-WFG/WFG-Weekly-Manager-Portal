import { supabase } from './supabaseClient'
import type { RepReportReviewStatus, RepReportStatus, SalesRepReportSections } from '../types'

// The client-side counterpart to
// supabase/migrations/20261027140300_rep_reports.sql and
// 20261027150000_rep_reports_submission_governance.sql. `rep_reports`,
// `rep_manager_assignments`, and `rep_report_review_history` are
// default-deny RLS (SELECT only, zero INSERT/UPDATE/DELETE grant to
// anyone) — every write in this file goes exclusively through a
// SECURITY DEFINER RPC, exactly like leadershipReportDraftService.ts's own
// save_leadership_report_draft. A read-only fetch still goes straight to
// the table (RLS-scoped), since SELECT is directly permitted.

export interface RepReport {
  id: string
  repId: string
  weekStartDate: string
  status: RepReportStatus
  submissionSource: 'manual' | 'automatic' | null
  submittedAt: string | null
  // Set exactly once, at the FIRST submission, and immutable thereafter
  // (trigger-enforced) — never touched by a later resubmission. This is the
  // server-derived fact APPROVED POLICY 1's post-deadline correction
  // exemption is keyed off: "on time" is re-derived live by the server
  // against this timestamp, never cached or client-supplied. Null until the
  // report has been submitted for the first time.
  firstSubmittedAt: string | null
  content: SalesRepReportSections
  owningAssignmentId: string | null
  reviewStatus: RepReportReviewStatus
  reviewedBy: string | null
  reviewedAt: string | null
  createdAt: string
  updatedAt: string
}

interface RepReportRow {
  id: string
  rep_id: string
  week_start_date: string
  status: RepReportStatus
  submission_source: 'manual' | 'automatic' | null
  submitted_at: string | null
  first_submitted_at: string | null
  content: unknown
  owning_assignment_id: string | null
  review_status: RepReportReviewStatus
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
}

// A legacy/partial row (or one saved before a field existed) should never
// crash the UI — missing sections simply render empty, matching
// EMPTY_SALES_REP_REPORT_SECTIONS field-for-field.
function contentFromRow(raw: unknown): SalesRepReportSections {
  const c = (raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}) as Record<string, unknown>
  const bulletsOf = (key: string): string[] => (Array.isArray(c[key]) ? (c[key] as unknown[]).filter((v) => typeof v === 'string') : [])
  return {
    accomplishments: bulletsOf('accomplishments'),
    salesMetrics: bulletsOf('salesMetrics'),
    pipelineUpdates: bulletsOf('pipelineUpdates'),
    blockers: bulletsOf('blockers'),
    nextWeekPriorities: bulletsOf('nextWeekPriorities'),
    managerSupportNeeded: typeof c.managerSupportNeeded === 'string' ? c.managerSupportNeeded : '',
  }
}

function fromRow(row: RepReportRow): RepReport {
  return {
    id: row.id,
    repId: row.rep_id,
    weekStartDate: row.week_start_date,
    status: row.status,
    submissionSource: row.submission_source,
    submittedAt: row.submitted_at,
    firstSubmittedAt: row.first_submitted_at,
    content: contentFromRow(row.content),
    owningAssignmentId: row.owning_assignment_id,
    reviewStatus: row.review_status,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const REP_REPORT_COLUMNS =
  'id, rep_id, week_start_date, status, submission_source, submitted_at, first_submitted_at, content, owning_assignment_id, review_status, reviewed_by, reviewed_at, created_at, updated_at'

// The RPC layer raises 'CODE: message' (FORBIDDEN, NOT_FOUND,
// REP_STATUS_REGRESSION_BLOCKED, SUBMISSION_DEADLINE_PASSED,
// INVALID_STATE, INVALID_REVIEW_STATUS, REASON_REQUIRED) — the same
// convention as every other RPC in this project (see
// leadershipReportDraftService.ts's own parseRpcError, mirrored here rather
// than imported, so this module has zero dependency on that one).
export type RepReportErrorCode =
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'REP_STATUS_REGRESSION_BLOCKED'
  | 'SUBMISSION_DEADLINE_PASSED'
  | 'INVALID_STATE'
  | 'INVALID_REVIEW_STATUS'
  | 'REASON_REQUIRED'
  | 'UNKNOWN'

export class RepReportError extends Error {
  code: RepReportErrorCode

  constructor(code: RepReportErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

function parseRpcError(message: string | undefined): RepReportError {
  const match = message?.match(/^([A-Z_]+):\s*(.*)$/)
  if (match) {
    const [, code, detail] = match
    return new RepReportError(code as RepReportErrorCode, detail || message || 'Something went wrong.')
  }
  return new RepReportError('UNKNOWN', message || 'Something went wrong.')
}

// Read-only, RLS-scoped: returns null if the rep has never saved a draft
// for this week yet (not an error). Works identically for a rep reading
// their own report, a manager (current or former, per RLS) reading an
// assigned/historical rep's report, or an admin.
export async function fetchRepReport(repId: string, weekStartDate: string): Promise<RepReport | null> {
  const { data, error } = await supabase
    .from('rep_reports')
    .select(REP_REPORT_COLUMNS)
    .eq('rep_id', repId)
    .eq('week_start_date', weekStartDate)
    .maybeSingle()

  if (error) {
    console.error('Failed to fetch rep report:', error.message)
    return null
  }
  return data ? fromRow(data as RepReportRow) : null
}

// Read-only history for a single rep, most recent first — used by both the
// rep's own "past reports" view and a manager's/admin's detail drill-down.
export async function fetchRepReportHistory(repId: string): Promise<RepReport[]> {
  const { data, error } = await supabase
    .from('rep_reports')
    .select(REP_REPORT_COLUMNS)
    .eq('rep_id', repId)
    .order('week_start_date', { ascending: false })

  if (error) {
    console.error('Failed to fetch rep report history:', error.message)
    return []
  }
  return (data ?? []).map((row) => fromRow(row as RepReportRow))
}

// The only write path for a draft (new or edited, including the
// post-rejection correction case). Caller identity/role/ownership are all
// re-derived server-side from auth.uid() — repId is never sent.
export async function saveSalesRepReportDraft(weekStartDate: string, content: SalesRepReportSections): Promise<RepReport> {
  const { data, error } = await supabase.rpc('save_rep_report_draft', {
    p_week_start_date: weekStartDate,
    p_content: content,
  })
  if (error) throw parseRpcError(error.message)
  return fromRow(data as RepReportRow)
}

// First submission of a draft (draft -> submitted). Subject to the Friday
// 2:00 PM Eastern cutoff server-side — see repReportLock.ts for the
// client-side UX mirror of the same cutoff.
export async function submitSalesRepReport(weekStartDate: string): Promise<RepReport> {
  const { data, error } = await supabase.rpc('submit_rep_report', { p_week_start_date: weekStartDate })
  if (error) throw parseRpcError(error.message)
  return fromRow(data as RepReportRow)
}

// The correction path: moves a REJECTED, submitted report back to pending
// review. Edit the content via saveSalesRepReportDraft FIRST — this RPC
// takes no content, only transitions lifecycle state. Subject to the same
// Friday 2:00 PM Eastern cutoff + single-use admin exception as a first
// submission.
export async function resubmitRejectedSalesRepReport(weekStartDate: string): Promise<RepReport> {
  const { data, error } = await supabase.rpc('resubmit_rejected_rep_report', { p_week_start_date: weekStartDate })
  if (error) throw parseRpcError(error.message)
  return fromRow(data as RepReportRow)
}

// Manager (current assignment only) or admin: approve/reject, and every
// later revision of that decision. p_reason is mandatory and non-empty,
// enforced server-side.
export async function reviewSalesRepReport(
  reportId: string,
  reviewStatus: Extract<RepReportReviewStatus, 'approved' | 'rejected'>,
  reason: string,
): Promise<RepReport> {
  const { data, error } = await supabase.rpc('review_rep_report', {
    p_report_id: reportId,
    p_review_status: reviewStatus,
    p_reason: reason,
  })
  if (error) throw parseRpcError(error.message)
  return fromRow(data as RepReportRow)
}

// A single late-submission exception grant — a PERMANENT audit record (see
// supabase/migrations/20261027150000_rep_reports_submission_governance.sql,
// APPROVED POLICY 2). Never cleared or deleted once consumed; consumedAt/
// consumedBy/consumedByOperation are set exactly once, together, the first
// (and only) time this exception authorizes a late submit/resubmit.
export interface RepReportLateSubmissionException {
  id: string
  reportId: string
  grantedBy: string
  grantedAt: string
  reason: string
  consumedAt: string | null
  consumedBy: string | null
  consumedByOperation: 'submit' | 'resubmit' | null
}

interface RepReportLateSubmissionExceptionRow {
  id: string
  report_id: string
  granted_by: string
  granted_at: string
  reason: string
  consumed_at: string | null
  consumed_by: string | null
  consumed_by_operation: 'submit' | 'resubmit' | null
}

function exceptionFromRow(row: RepReportLateSubmissionExceptionRow): RepReportLateSubmissionException {
  return {
    id: row.id,
    reportId: row.report_id,
    grantedBy: row.granted_by,
    grantedAt: row.granted_at,
    reason: row.reason,
    consumedAt: row.consumed_at,
    consumedBy: row.consumed_by,
    consumedByOperation: row.consumed_by_operation,
  }
}

// Admin-only: authorizes exactly ONE subsequent late submit/resubmit for
// this specific rep/week report. Requires a draft/report row to already
// exist (NOT_FOUND otherwise) and a non-empty reason (REASON_REQUIRED
// otherwise). Multiple outstanding grants are permitted — each becomes its
// own durable row; the oldest unused one is consumed first (FIFO).
export async function grantLateSubmissionException(
  repId: string,
  weekStartDate: string,
  reason: string,
): Promise<RepReportLateSubmissionException> {
  const { data, error } = await supabase.rpc('grant_rep_report_late_submission_exception', {
    p_rep_id: repId,
    p_week_start_date: weekStartDate,
    p_reason: reason,
  })
  if (error) throw parseRpcError(error.message)
  return exceptionFromRow(data as RepReportLateSubmissionExceptionRow)
}

// Read-only, RLS-scoped, permanent audit trail for one report — every grant
// ever made against it, oldest first, whether or not it was ever consumed.
export async function fetchRepReportLateSubmissionExceptions(reportId: string): Promise<RepReportLateSubmissionException[]> {
  const { data, error } = await supabase
    .from('rep_report_late_submission_exceptions')
    .select('id, report_id, granted_by, granted_at, reason, consumed_at, consumed_by, consumed_by_operation')
    .eq('report_id', reportId)
    .order('granted_at', { ascending: true })

  if (error) {
    console.error('Failed to fetch rep report late submission exceptions:', error.message)
    return []
  }
  return (data ?? []).map((row) => exceptionFromRow(row as RepReportLateSubmissionExceptionRow))
}

// A single correction/resubmission event — permanent, append-only (see
// rep_report_resubmission_events). Records exactly how a post-rejection
// resubmission was authorized: before the deadline at all ('on_time_window'),
// via APPROVED POLICY 1's free exemption for an originally-on-time report
// ('on_time_original_exemption'), or via a freshly consumed admin exception
// ('admin_exception', with usedExceptionId pointing at which one).
export interface RepReportResubmissionEvent {
  id: string
  reportId: string
  repId: string
  occurredAt: string
  previousReviewStatus: string
  newReviewStatus: string
  cutoffWasPassed: boolean
  authorizationBasis: 'on_time_window' | 'on_time_original_exemption' | 'admin_exception'
  usedExceptionId: string | null
}

interface RepReportResubmissionEventRow {
  id: string
  report_id: string
  rep_id: string
  occurred_at: string
  previous_review_status: string
  new_review_status: string
  cutoff_was_passed: boolean
  authorization_basis: 'on_time_window' | 'on_time_original_exemption' | 'admin_exception'
  used_exception_id: string | null
}

// Read-only, RLS-scoped, permanent audit trail for one report's
// corrections/resubmissions, oldest first.
export async function fetchRepReportResubmissionEvents(reportId: string): Promise<RepReportResubmissionEvent[]> {
  const { data, error } = await supabase
    .from('rep_report_resubmission_events')
    .select('id, report_id, rep_id, occurred_at, previous_review_status, new_review_status, cutoff_was_passed, authorization_basis, used_exception_id')
    .eq('report_id', reportId)
    .order('occurred_at', { ascending: true })

  if (error) {
    console.error('Failed to fetch rep report resubmission events:', error.message)
    return []
  }
  return (data ?? []).map((row) => {
    const r = row as RepReportResubmissionEventRow
    return {
      id: r.id,
      reportId: r.report_id,
      repId: r.rep_id,
      occurredAt: r.occurred_at,
      previousReviewStatus: r.previous_review_status,
      newReviewStatus: r.new_review_status,
      cutoffWasPassed: r.cutoff_was_passed,
      authorizationBasis: r.authorization_basis,
      usedExceptionId: r.used_exception_id,
    }
  })
}

export interface RepReportReviewHistoryEntry {
  id: string
  reportId: string
  reviewStatus: 'approved' | 'rejected'
  reason: string
  reviewedBy: string
  reviewedAt: string
}

interface RepReportReviewHistoryRow {
  id: string
  report_id: string
  review_status: 'approved' | 'rejected'
  reason: string
  reviewed_by: string
  reviewed_at: string
}

// Read-only, append-only audit trail — every decision AND every revision,
// oldest first, for one report.
export async function fetchRepReportReviewHistory(reportId: string): Promise<RepReportReviewHistoryEntry[]> {
  const { data, error } = await supabase
    .from('rep_report_review_history')
    .select('id, report_id, review_status, reason, reviewed_by, reviewed_at')
    .eq('report_id', reportId)
    .order('reviewed_at', { ascending: true })

  if (error) {
    console.error('Failed to fetch rep report review history:', error.message)
    return []
  }
  return (data ?? []).map((row) => {
    const r = row as RepReportReviewHistoryRow
    return {
      id: r.id,
      reportId: r.report_id,
      reviewStatus: r.review_status,
      reason: r.reason,
      reviewedBy: r.reviewed_by,
      reviewedAt: r.reviewed_at,
    }
  })
}

export interface RepManagerAssignment {
  id: string
  repId: string
  managerId: string
  assignedAt: string
  assignedBy: string
  unassignedAt: string | null
  unassignedBy: string | null
}

interface RepManagerAssignmentRow {
  id: string
  rep_id: string
  manager_id: string
  assigned_at: string
  assigned_by: string
  unassigned_at: string | null
  unassigned_by: string | null
}

function assignmentFromRow(row: RepManagerAssignmentRow): RepManagerAssignment {
  return {
    id: row.id,
    repId: row.rep_id,
    managerId: row.manager_id,
    assignedAt: row.assigned_at,
    assignedBy: row.assigned_by,
    unassignedAt: row.unassigned_at,
    unassignedBy: row.unassigned_by,
  }
}

// Admin-only. Idempotent (re-assigning to the already-active manager
// returns the existing assignment unchanged) and concurrency-safe
// server-side.
export async function assignSalesRep(repId: string, managerId: string): Promise<RepManagerAssignment> {
  const { data, error } = await supabase.rpc('assign_sales_rep', { p_rep_id: repId, p_manager_id: managerId })
  if (error) throw parseRpcError(error.message)
  return assignmentFromRow(data as RepManagerAssignmentRow)
}

// Admin-only.
export async function unassignSalesRep(repId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('unassign_sales_rep', { p_rep_id: repId })
  if (error) throw parseRpcError(error.message)
  return data === true
}

// Read-only, RLS-scoped: every rep currently or formerly assigned to the
// CALLING manager, with each rep's active assignment row (unassigned_at is
// null) listed first implicitly by the id filter below being the manager's
// own CURRENT assignments only — this is what the "My Reps" view's roster
// should use (it does not need historical/former reps in the roster list,
// only in a past report's own former-manager read access, which is
// enforced independently by RLS on rep_reports itself).
export async function fetchMyCurrentReps(managerId: string): Promise<RepManagerAssignment[]> {
  const { data, error } = await supabase
    .from('rep_manager_assignments')
    .select('id, rep_id, manager_id, assigned_at, assigned_by, unassigned_at, unassigned_by')
    .eq('manager_id', managerId)
    .is('unassigned_at', null)
    .order('assigned_at', { ascending: true })

  if (error) {
    console.error('Failed to fetch assigned reps:', error.message)
    return []
  }
  return (data ?? []).map((row) => assignmentFromRow(row as RepManagerAssignmentRow))
}
