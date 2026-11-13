import { fetchMyCurrentReps, fetchRepReport, type RepReport } from './repReportsService'
import { fetchProfilesByIds, type RepProfileSummary } from './repRosterService'
import { deriveRepReportBucket, type RepReportBucket } from './repReportBucket'

// Single shared fetch for every Manager-role screen that needs "my assigned
// reps, this week's reports" — ManagerDashboardOverview's KPI cards and
// MyReps.tsx's own table both call this, so there is exactly one query
// shape and one source of truth, never two independent copies computing the
// same thing differently. Mirrors MyReps.tsx's own previous inline fetch
// (fetchMyCurrentReps + fetchRepReport per rep + fetchProfilesByIds)
// unchanged — this is purely that logic factored out, not a new workflow.
export interface ManagerRepRow {
  repId: string
  fullName: string | null
  email: string
  report: RepReport | null
  bucket: RepReportBucket
}

export interface ManagerOverviewCounts {
  totalAssigned: number
  submitted: number
  pending: number
  approved: number
  rejected: number
  missing: number
}

export interface ManagerOverviewData {
  rows: ManagerRepRow[]
  counts: ManagerOverviewCounts
}

function emptyCounts(): ManagerOverviewCounts {
  return { totalAssigned: 0, submitted: 0, pending: 0, approved: 0, rejected: 0, missing: 0 }
}

export async function fetchManagerOverview(managerId: string, weekStartDate: string): Promise<ManagerOverviewData> {
  const assignments = await fetchMyCurrentReps(managerId)

  if (assignments.length === 0) {
    return { rows: [], counts: emptyCounts() }
  }

  const repIds = assignments.map((a) => a.repId)
  const [profiles, reports] = await Promise.all([
    fetchProfilesByIds(repIds),
    Promise.all(repIds.map((repId) => fetchRepReport(repId, weekStartDate))),
  ])

  const profileById = new Map<string, RepProfileSummary>(profiles.map((p) => [p.id, p]))

  const rows: ManagerRepRow[] = assignments.map((assignment, i) => {
    const profile = profileById.get(assignment.repId)
    const report = reports[i]
    return {
      repId: assignment.repId,
      fullName: profile?.fullName ?? null,
      email: profile?.email ?? '',
      report,
      bucket: deriveRepReportBucket(report),
    }
  })

  const counts = rows.reduce((acc, row) => {
    acc.totalAssigned += 1
    if (row.bucket === 'missing') {
      acc.missing += 1
    } else {
      acc.submitted += 1
      if (row.bucket === 'pending') acc.pending += 1
      else if (row.bucket === 'approved') acc.approved += 1
      else if (row.bucket === 'rejected') acc.rejected += 1
    }
    return acc
  }, emptyCounts())

  return { rows, counts }
}
