// Reporting hierarchy & access phase (2026-11-24) — Gene Rebadow / Joey
// Grampa requirement: read-only visibility into every Sales Rep's
// SUBMITTED report across every Manager. Every function here is a plain,
// unfiltered-by-role client query — the new profiles_select_global_viewer
// / rep_manager_assignments_select_global_viewer /
// rep_reports_select_global_viewer RLS policies (gated by
// is_global_report_viewer()) are the ONLY thing that ever grants a row
// here. If global_report_viewer were ever false for the caller, every
// query below simply returns zero rows (default-deny) — this module
// never adds its own role check, exactly like
// salesAdminRepVisibilityService.ts's own rep_reports read already
// relies entirely on its own RLS policy, no role check in code.
import { supabase } from './supabaseClient'
import { fetchRepReport, type RepReport } from './repReportsService'

export interface GlobalReportManagerRow {
  managerId: string
  managerName: string | null
  managerEmail: string
  assignedCount: number
  submittedCount: number
}

export interface GlobalReportRepRow {
  repId: string
  fullName: string | null
  email: string
}

export async function fetchGlobalReportOverview(weekStartDate: string): Promise<GlobalReportManagerRow[]> {
  const [{ data: managers, error: managersError }, { data: assignments, error: assignmentsError }, { data: reports, error: reportsError }] =
    await Promise.all([
      supabase.from('profiles').select('id, full_name, email').eq('role', 'manager'),
      supabase.from('rep_manager_assignments').select('rep_id, manager_id').is('unassigned_at', null),
      supabase.from('rep_reports').select('rep_id, status').eq('week_start_date', weekStartDate),
    ])

  if (managersError || assignmentsError || reportsError) {
    console.error(
      'Failed to fetch global report overview:',
      managersError?.message ?? assignmentsError?.message ?? reportsError?.message,
    )
    return []
  }

  // Defensive, not load-bearing: RLS already guarantees `reports` contains
  // only status='submitted' rows for this caller — filtering again here
  // costs nothing and never trusts the server-side guarantee alone.
  const submittedRepIds = new Set((reports ?? []).filter((r) => r.status === 'submitted').map((r) => r.rep_id as string))

  const repIdsByManager = new Map<string, string[]>()
  for (const a of assignments ?? []) {
    const list = repIdsByManager.get(a.manager_id as string) ?? []
    list.push(a.rep_id as string)
    repIdsByManager.set(a.manager_id as string, list)
  }

  return (managers ?? []).map((m): GlobalReportManagerRow => {
    const repIds = repIdsByManager.get(m.id as string) ?? []
    return {
      managerId: m.id as string,
      managerName: m.full_name as string | null,
      managerEmail: m.email as string,
      assignedCount: repIds.length,
      submittedCount: repIds.filter((id) => submittedRepIds.has(id)).length,
    }
  })
}

// Only the reps who have ACTUALLY submitted for this manager/week — never
// a "missing/draft" breakdown, since this permission is scoped to
// completed reports only (see this file's own header comment).
export async function fetchGlobalReportSubmittedReps(managerId: string, weekStartDate: string): Promise<GlobalReportRepRow[]> {
  const [{ data: assignments, error: assignmentsError }, { data: reports, error: reportsError }] = await Promise.all([
    supabase.from('rep_manager_assignments').select('rep_id').eq('manager_id', managerId).is('unassigned_at', null),
    supabase.from('rep_reports').select('rep_id, status').eq('week_start_date', weekStartDate),
  ])

  if (assignmentsError || reportsError) {
    console.error('Failed to fetch global report submitted reps:', assignmentsError?.message ?? reportsError?.message)
    return []
  }

  const submittedRepIds = new Set((reports ?? []).filter((r) => r.status === 'submitted').map((r) => r.rep_id as string))
  const repIds = (assignments ?? []).map((a) => a.rep_id as string).filter((id) => submittedRepIds.has(id))
  if (repIds.length === 0) return []

  const { data: profiles, error: profilesError } = await supabase.from('profiles').select('id, full_name, email').in('id', repIds)
  if (profilesError) {
    console.error('Failed to fetch global report rep profiles:', profilesError.message)
    return []
  }
  return (profiles ?? []).map((p) => ({ repId: p.id as string, fullName: p.full_name as string | null, email: p.email as string }))
}

export async function fetchGlobalReportRepReport(repId: string, weekStartDate: string): Promise<RepReport | null> {
  return fetchRepReport(repId, weekStartDate)
}
