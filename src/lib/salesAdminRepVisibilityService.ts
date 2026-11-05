// Phase 4 — Sales Admin "Reporting by Manager". Pure aggregation over data
// already fetched through EXISTING, already-authorized-for-sales_admin
// paths — no new RLS policy, no new backend endpoint, no new SECURITY
// DEFINER function, and critically, NO direct client query against
// rep_manager_assignments at all (sales_admin has no RLS policy on that
// table — see fetchSalesReps()'s own doc comment and
// api/_lib/supabaseServiceClient.ts's listSalesReps(), which resolves
// currentManagerId/currentManagerName server-side via the service role,
// returned through the already-authenticateAdminOrSalesAdmin-gated
// /api/admin/users/list-sales-reps endpoint). This module only ever reads
// that already-resolved field — it never attempts its own assignment
// lookup.
//
// Mirrors src/lib/adminRepVisibilityService.ts's (Phase 2, Admin-only)
// shape closely, but swaps fetchAllCurrentAssignments() (which relies on
// the is_admin()-only rep_manager_assignments_select_admin policy — would
// silently return empty for sales_admin) for fetchSalesReps()'s own
// currentManagerId field. fetchAllRepReportsForWeek() is reused completely
// unchanged: it has no role check in code at all, so it already works for
// sales_admin via the separate, pre-existing rep_reports_select_sales_admin
// RLS policy (USING (is_sales_admin()), unconditional) — the same policy
// SalesAdminReports.tsx already depends on today.
import { fetchActiveManagers, fetchSalesReps, type SalesRep } from './salesRepManagementService'
import { fetchAllRepReportsForWeek, type RepReport } from './repReportsService'
import { deriveRepReportBucket, type RepReportBucket } from './repReportBucket'

export interface SalesAdminManagerOverviewRow {
  managerId: string
  managerName: string | null
  managerEmail: string
  assignedCount: number
  // Total ever submitted this week — pending + approved + rejected, not an
  // independent count. Mirrors AdminManagerRepOverview's own identity.
  submittedCount: number
  pendingCount: number
  approvedCount: number
  rejectedCount: number
  missingCount: number
}

export interface SalesAdminRepDrillDownRow {
  repId: string
  fullName: string
  email: string
  bucket: RepReportBucket
}

export interface SalesAdminOverviewData {
  overview: SalesAdminManagerOverviewRow[]
  // Carried alongside the overview so a drill-down selection can be derived
  // from data already in memory — see deriveManagerDrillDown below — rather
  // than issuing a second round of network calls per Manager selected.
  reps: SalesRep[]
  reportByRepId: Map<string, RepReport>
}

export type SalesAdminOverviewOutcome = { status: 'ok'; data: SalesAdminOverviewData } | { status: 'error'; message: string }

// A rep with no profileId yet (never completed first login — see
// SalesRep's own doc comment) cannot have a rep_reports row at all; treated
// as 'missing' here for the same reason deriveRepReportBucket treats a
// draft/nonexistent report as 'missing' — "nothing submitted" either way.
function bucketForRep(rep: SalesRep, reportByRepId: Map<string, RepReport>): RepReportBucket {
  if (!rep.profileId) return 'missing'
  return deriveRepReportBucket(reportByRepId.get(rep.profileId) ?? null)
}

export async function fetchSalesAdminOverview(weekStartDate: string): Promise<SalesAdminOverviewOutcome> {
  const [managers, repsOutcome, reports] = await Promise.all([
    fetchActiveManagers(),
    fetchSalesReps(),
    fetchAllRepReportsForWeek(weekStartDate),
  ])

  if (repsOutcome.status !== 'ok') {
    return { status: 'error', message: repsOutcome.message }
  }

  const reps = repsOutcome.reps
  const reportByRepId = new Map(reports.map((r) => [r.repId, r]))

  const repsByManagerId = new Map<string, SalesRep[]>()
  for (const rep of reps) {
    if (!rep.currentManagerId) continue
    const list = repsByManagerId.get(rep.currentManagerId) ?? []
    list.push(rep)
    repsByManagerId.set(rep.currentManagerId, list)
  }

  const overview: SalesAdminManagerOverviewRow[] = managers.map((manager) => {
    const managerReps = repsByManagerId.get(manager.id) ?? []
    let pendingCount = 0
    let approvedCount = 0
    let rejectedCount = 0
    let missingCount = 0

    for (const rep of managerReps) {
      const bucket = bucketForRep(rep, reportByRepId)
      if (bucket === 'pending') pendingCount++
      else if (bucket === 'approved') approvedCount++
      else if (bucket === 'rejected') rejectedCount++
      else missingCount++
    }

    return {
      managerId: manager.id,
      managerName: manager.fullName,
      managerEmail: manager.email,
      assignedCount: managerReps.length,
      submittedCount: pendingCount + approvedCount + rejectedCount,
      pendingCount,
      approvedCount,
      rejectedCount,
      missingCount,
    }
  })

  return { status: 'ok', data: { overview, reps, reportByRepId } }
}

// Pure, synchronous, no network call — the drill-down is derived entirely
// from data fetchSalesAdminOverview already loaded into memory.
export function deriveManagerDrillDown(managerId: string, reps: SalesRep[], reportByRepId: Map<string, RepReport>): SalesAdminRepDrillDownRow[] {
  return reps
    .filter((rep) => rep.currentManagerId === managerId)
    .map((rep): SalesAdminRepDrillDownRow => ({
      repId: rep.id,
      fullName: rep.fullName,
      email: rep.email,
      bucket: bucketForRep(rep, reportByRepId),
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName))
}
