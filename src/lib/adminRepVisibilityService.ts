// Phase 2 — Leadership Dashboard Manager-to-Sales-Rep visibility. Pure
// aggregation over data this app already fetches elsewhere: the real
// Manager roster (fetchActiveManagers, already allowlist-filtered to the 10
// verified real Managers and already used by the Sales Rep assignment
// dropdown), every active rep-manager assignment, and every rep_reports row
// for the selected week. No new table, no new RPC, no new RLS policy — see
// fetchAllCurrentAssignments/fetchAllRepReportsForWeek in
// repReportsService.ts for the RLS reasoning (both rely entirely on the
// pre-existing is_admin() SELECT policies).
import { fetchActiveManagers } from './salesRepManagementService'
import { fetchAllCurrentAssignments, fetchAllRepReportsForWeek, fetchMyCurrentReps, fetchRepReport } from './repReportsService'
import { fetchProfilesByIds } from './repRosterService'
import { deriveRepReportBucket, type RepReportBucket } from './repReportBucket'

export type { RepReportBucket }

export interface ManagerRepOverviewRow {
  managerId: string
  managerName: string | null
  managerEmail: string
  assignedCount: number
  // Total ever submitted this week — the sum of pending + approved +
  // rejected, NOT a bucket mutually exclusive from them (a report keeps
  // status='submitted' forever once first submitted, even after rejection
  // — see rep_reports_submission_governance.sql). Reported as its own
  // figure per the Phase 2 requirement, alongside the pending/approved/
  // rejected breakdown of that same total.
  submittedCount: number
  pendingCount: number
  approvedCount: number
  rejectedCount: number
  missingCount: number
}

// One bulk fetch (3 parallel queries, independent of how many Managers or
// Reps exist) rather than one query per Manager — see
// fetchAllCurrentAssignments/fetchAllRepReportsForWeek's own doc comments.
export async function fetchManagerRepOverview(weekStartDate: string): Promise<ManagerRepOverviewRow[]> {
  const [managers, assignments, reports] = await Promise.all([
    fetchActiveManagers(),
    fetchAllCurrentAssignments(),
    fetchAllRepReportsForWeek(weekStartDate),
  ])

  const reportByRepId = new Map(reports.map((r) => [r.repId, r]))
  const repIdsByManagerId = new Map<string, string[]>()
  for (const assignment of assignments) {
    const list = repIdsByManagerId.get(assignment.managerId) ?? []
    list.push(assignment.repId)
    repIdsByManagerId.set(assignment.managerId, list)
  }

  return managers.map((manager): ManagerRepOverviewRow => {
    const repIds = repIdsByManagerId.get(manager.id) ?? []
    let pendingCount = 0
    let approvedCount = 0
    let rejectedCount = 0
    let missingCount = 0

    for (const repId of repIds) {
      const bucket = deriveRepReportBucket(reportByRepId.get(repId) ?? null)
      if (bucket === 'pending') pendingCount++
      else if (bucket === 'approved') approvedCount++
      else if (bucket === 'rejected') rejectedCount++
      else missingCount++
    }

    return {
      managerId: manager.id,
      managerName: manager.fullName,
      managerEmail: manager.email,
      assignedCount: repIds.length,
      submittedCount: pendingCount + approvedCount + rejectedCount,
      pendingCount,
      approvedCount,
      rejectedCount,
      missingCount,
    }
  })
}

export interface ManagerRepDrillDownRow {
  repId: string
  fullName: string | null
  email: string
  bucket: RepReportBucket
}

// A single Manager's handful of reps (never more than a few, confirmed by
// the real 10-Manager/33-Rep roster) — small enough that per-rep
// fetchRepReport calls are simpler and clearer than reusing the bulk
// fetchAllRepReportsForWeek a second time, and this reuses
// fetchMyCurrentReps/fetchRepReport/fetchProfilesByIds completely
// unchanged (all three already RLS-permit an Admin to read any Manager's
// assignments/any Rep's report/any Rep's profile).
export async function fetchManagerRepDrillDown(managerId: string, weekStartDate: string): Promise<ManagerRepDrillDownRow[]> {
  const assignments = await fetchMyCurrentReps(managerId)
  if (assignments.length === 0) return []

  const [profiles, reports] = await Promise.all([
    fetchProfilesByIds(assignments.map((a) => a.repId)),
    Promise.all(assignments.map((a) => fetchRepReport(a.repId, weekStartDate))),
  ])

  const profileByRepId = new Map(profiles.map((p) => [p.id, p]))

  return assignments
    .map((assignment, index): ManagerRepDrillDownRow => {
      const profile = profileByRepId.get(assignment.repId)
      return {
        repId: assignment.repId,
        fullName: profile?.fullName ?? null,
        email: profile?.email ?? '',
        bucket: deriveRepReportBucket(reports[index]),
      }
    })
    .sort((a, b) => (a.fullName ?? '').localeCompare(b.fullName ?? ''))
}
