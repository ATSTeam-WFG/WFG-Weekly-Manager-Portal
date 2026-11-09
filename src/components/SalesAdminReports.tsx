import { useEffect, useState } from 'react'
import { fetchSalesReps, type SalesRep } from '../lib/salesRepManagementService'
import { fetchRepReport } from '../lib/repReportsService'
import { getCurrentReportingWeek } from '../utils/week'
import './SalesRepManagement.css'

// Sales Admin's read-only view of every Sales Rep's current-week report
// status, across ALL managers (not assignment-scoped, unlike the Manager's
// own My Reps screen). Deliberately read-only: no approve/reject action
// exists here at all — review_rep_report remains is_assigned_manager_of()
// OR is_admin() only, server-side, completely unaffected by this screen —
// this component simply never offers the action, matching the requirement
// that Sales Admin must never approve, reject, or modify report status.
//
// Reuses fetchSalesReps() (the same Admin/Sales-Admin-shared
// list-sales-reps.ts endpoint SalesRepManagement.tsx already uses) and
// fetchRepReport() (the same RLS-scoped read Manager's My Reps uses) rather
// than introducing a new endpoint or table shape.
interface ReportRow {
  rep: SalesRep
  reportSummary: string
  submittedAt: string | null
}

function summarizeReport(report: Awaited<ReturnType<typeof fetchRepReport>>): string {
  if (!report) return 'Not started'
  if (report.status === 'draft') return 'Draft'
  if (report.reviewStatus === 'pending') return 'Submitted — Pending Review'
  if (report.reviewStatus === 'approved') return 'Approved'
  return 'Rejected'
}

export default function SalesAdminReports() {
  const [rows, setRows] = useState<ReportRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const week = getCurrentReportingWeek()

  useEffect(() => {
    let active = true
    setRows(null)
    setLoadError(null)
    ;(async () => {
      const outcome = await fetchSalesReps()
      if (!active) return
      if (outcome.status !== 'ok') {
        setLoadError(outcome.message)
        return
      }
      const nextRows = await Promise.all(
        outcome.reps.map(async (rep) => {
          const report = rep.profileId ? await fetchRepReport(rep.profileId, week.weekStartDate) : null
          return { rep, reportSummary: summarizeReport(report), submittedAt: report?.submittedAt ?? null }
        }),
      )
      if (!active) return
      setRows(nextRows)
    })()
    return () => {
      active = false
    }
  }, [week.weekStartDate])

  return (
    <div className="sales-admin-reports">
      <div className="srm-header">
        <div className="srm-header-titles">
          <h1>Sales Rep Reports</h1>
          <p className="srm-header-subtitle">Read-only status for every Sales Rep's week of {week.label}. Reviewing and approving reports remains the assigned Manager's responsibility.</p>
        </div>
      </div>

      {loadError && <p className="sales-rep-management-message-error">{loadError}</p>}

      {rows === null && !loadError ? (
        <p>Loading…</p>
      ) : (
        <div className="srm-table" role="table">
          <div className="srm-table-header-row" role="row">
            <span role="columnheader">Sales Rep</span>
            <span role="columnheader">Email</span>
            <span role="columnheader">Current Manager</span>
            <span role="columnheader">This Week's Status</span>
          </div>
          {(rows ?? []).map(({ rep, reportSummary }) => (
            <div className="srm-row" role="row" key={rep.id}>
              <div className="srm-row-main">
                <span role="cell">{rep.fullName}</span>
                <span role="cell">{rep.email}</span>
                <span role="cell">{rep.currentManagerName ?? 'Unassigned'}</span>
                <span role="cell">{reportSummary}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
