import { supabase } from './supabaseClient'
import type { SalesRepReportSections } from '../types'

// Phase 1C — the client-side counterpart to
// supabase/migrations/20261028090000_manager_report_rep_consolidation.sql.
// Reads go straight to rep_reports (RLS already scopes a manager to their
// CURRENTLY assigned reps' reports — see rep_reports_select_assigned_manager
// — so this file never needs to re-derive or pass along an assignment
// check itself for the read side); the ONLY write path is the
// import_rep_report_for_consolidation RPC, which independently re-verifies
// approved-only/current-assignment/same-week before recording anything.

export type SalesRepReportFieldKey = keyof SalesRepReportSections

export interface ApprovedRepReportForConsolidation {
  repReportId: string
  repId: string
  repName: string
  weekStartDate: string
  content: SalesRepReportSections
}

interface RepReportRow {
  id: string
  rep_id: string
  week_start_date: string
  content: unknown
}

interface ProfileRow {
  id: string
  full_name: string | null
}

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

// Read-only: every APPROVED, submitted sales rep report for this exact week,
// for every rep RLS currently lets this manager see (i.e. their own
// currently-assigned reps — a former manager's own session would see
// nothing here for a rep they no longer manage, even though they can still
// read that rep's reports elsewhere, because this query also filters to
// review_status = 'approved' deliberately matching what import itself will
// accept; RLS alone does not already imply "approved", so this filter is
// load-bearing, not redundant).
export async function fetchApprovedRepReportsForWeek(weekStartDate: string): Promise<ApprovedRepReportForConsolidation[]> {
  const { data, error } = await supabase
    .from('rep_reports')
    .select('id, rep_id, week_start_date, content')
    .eq('week_start_date', weekStartDate)
    .eq('status', 'submitted')
    .eq('review_status', 'approved')

  if (error) {
    console.error('Failed to fetch approved sales rep reports for consolidation:', error.message)
    return []
  }
  const rows = (data ?? []) as RepReportRow[]
  if (rows.length === 0) return []

  const repIds = [...new Set(rows.map((r) => r.rep_id))]
  const { data: profileRows, error: profileError } = await supabase.from('profiles').select('id, full_name').in('id', repIds)
  if (profileError) {
    console.error('Failed to fetch rep names for consolidation:', profileError.message)
  }
  const nameById = new Map((profileRows as ProfileRow[] | null ?? []).map((p) => [p.id, p.full_name]))

  return rows.map((row) => ({
    repReportId: row.id,
    repId: row.rep_id,
    repName: nameById.get(row.rep_id) || 'Sales Rep',
    weekStartDate: row.week_start_date,
    content: contentFromRow(row.content),
  }))
}

export type ManagerConsolidationErrorCode = 'FORBIDDEN' | 'NO_FIELDS_SELECTED' | 'NOT_FOUND' | 'NOT_APPROVED' | 'WEEK_MISMATCH' | 'UNKNOWN'

export class ManagerConsolidationError extends Error {
  code: ManagerConsolidationErrorCode

  constructor(code: ManagerConsolidationErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

function parseRpcError(message: string | undefined): ManagerConsolidationError {
  const match = message?.match(/^([A-Z_]+):\s*(.*)$/)
  if (match) {
    const [, code, detail] = match
    return new ManagerConsolidationError(code as ManagerConsolidationErrorCode, detail || message || 'Something went wrong.')
  }
  return new ManagerConsolidationError('UNKNOWN', message || 'Something went wrong.')
}

export interface RepReportImportRecord {
  id: string
  managerId: string
  repReportId: string
  repReportUpdatedAt: string
  weekStartDate: string
  selectedFields: string[]
  importedContent: Partial<SalesRepReportSections>
  importedAt: string
}

interface RepReportImportRow {
  id: string
  manager_id: string
  rep_report_id: string
  rep_report_updated_at: string
  week_start_date: string
  selected_fields: string[]
  imported_content: unknown
  imported_at: string
}

function importRecordFromRow(row: RepReportImportRow): RepReportImportRecord {
  return {
    id: row.id,
    managerId: row.manager_id,
    repReportId: row.rep_report_id,
    repReportUpdatedAt: row.rep_report_updated_at,
    weekStartDate: row.week_start_date,
    selectedFields: row.selected_fields,
    importedContent: (row.imported_content ?? {}) as Partial<SalesRepReportSections>,
    importedAt: row.imported_at,
  }
}

// Manager-only. Re-verified entirely server-side: the target report must be
// approved+submitted, the caller must be the rep's CURRENTLY assigned
// manager, and the report's own week must match weekStartDate. Idempotent —
// calling this again with the exact same reportId/weekStartDate/fields
// selection (even in a different array order) returns the SAME existing
// record rather than creating a duplicate; a different selection, or a
// genuine revision of the source report since the last import, is recorded
// as its own new, separate record.
export async function importRepReportForConsolidation(
  repReportId: string,
  weekStartDate: string,
  selectedFields: SalesRepReportFieldKey[],
): Promise<RepReportImportRecord> {
  const { data, error } = await supabase.rpc('import_rep_report_for_consolidation', {
    p_rep_report_id: repReportId,
    p_week_start_date: weekStartDate,
    p_selected_fields: selectedFields,
  })
  if (error) throw parseRpcError(error.message)
  return importRecordFromRow(data as RepReportImportRow)
}
