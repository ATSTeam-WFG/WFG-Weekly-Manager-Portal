import { useEffect, useMemo, useState } from 'react'
import { fetchActiveManagers, fetchSalesReps, type ActiveManager, type SalesRep } from '../lib/salesRepManagementService'
import { fetchRepReportsForWeek, type RepReport } from '../lib/repReportsService'
import { getReportingWeekByOffset } from '../utils/week'
import './SalesRepManagement.css'

interface ReportRow {
  rep: SalesRep
  report: RepReport | null
}

type StatusFilter = 'all' | 'submitted' | 'pending' | 'approved' | 'rejected' | 'draft' | 'not-started'

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'pending', label: 'Pending review' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Needs correction' },
  { value: 'draft', label: 'Draft' },
  { value: 'not-started', label: 'Not started' },
]

function statusKey(report: RepReport | null): Exclude<StatusFilter, 'all'> {
  if (!report) return 'not-started'
  if (report.status === 'draft') return 'draft'
  if (report.reviewStatus === 'approved') return 'approved'
  if (report.reviewStatus === 'rejected') return 'rejected'
  return 'pending'
}

function statusLabel(report: RepReport | null): string {
  if (!report) return 'Not Started'
  if (report.status === 'draft') return 'Draft'
  if (report.reviewStatus === 'approved') return 'Approved'
  if (report.reviewStatus === 'rejected') return 'Needs Correction'
  return 'Submitted — Pending Review'
}

function submittedAtLabel(value: string | null): string {
  return value
    ? new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'Submitted'
}

function ReportContent({ report }: { report: RepReport }) {
  const sections: { title: string; bullets: string[] }[] = [
    { title: 'Accomplishments', bullets: report.content.accomplishments },
    { title: 'Sales Metrics', bullets: report.content.salesMetrics },
    { title: 'Pipeline Updates', bullets: report.content.pipelineUpdates },
    { title: 'Blockers / Challenges', bullets: report.content.blockers },
    { title: 'Next Week Priorities', bullets: report.content.nextWeekPriorities },
  ]

  return (
    <div className="sar-report-content">
      {sections.map((section) => (
        <section className="sar-report-section" key={section.title}>
          <h3>{section.title}</h3>
          {section.bullets.length === 0 ? (
            <p className="sar-report-empty">No response provided.</p>
          ) : (
            <ul>{section.bullets.map((bullet, index) => <li key={`${section.title}-${index}`}>{bullet}</li>)}</ul>
          )}
        </section>
      ))}
      <section className="sar-report-section">
        <h3>Manager Support Needed</h3>
        <p>{report.content.managerSupportNeeded || <span className="sar-report-empty">No response provided.</span>}</p>
      </section>
    </div>
  )
}

// Read-only Sales Admin dashboard. Roster data comes from the existing
// authenticated list-sales-reps endpoint; report rows come from the normal
// Supabase client under rep_reports_select_sales_admin RLS. No assignment
// table is queried directly and no review/approval RPC is imported here.
export default function SalesAdminReports() {
  const [weekOffset, setWeekOffset] = useState(0)
  const [rows, setRows] = useState<ReportRow[] | null>(null)
  const [managers, setManagers] = useState<ActiveManager[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [managerFilter, setManagerFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [selectedRow, setSelectedRow] = useState<ReportRow | null>(null)
  const week = getReportingWeekByOffset(weekOffset)
  const weekOptions = useMemo(() => Array.from({ length: 13 }, (_, index) => getReportingWeekByOffset(-index)), [])

  useEffect(() => {
    let active = true
    setRows(null)
    setLoadError(null)
    setSelectedRow(null)
    ;(async () => {
      const [repsOutcome, activeManagers] = await Promise.all([fetchSalesReps(), fetchActiveManagers()])
      if (!active) return
      setManagers(activeManagers)
      if (repsOutcome.status !== 'ok') {
        setLoadError(repsOutcome.message)
        return
      }
      const reportsOutcome = await fetchRepReportsForWeek(week.weekStartDate)
      if (!active) return
      if (reportsOutcome.status !== 'ok') {
        setLoadError(reportsOutcome.message)
        return
      }
      const reportByRepId = new Map(reportsOutcome.reports.map((report) => [report.repId, report]))
      setRows(repsOutcome.reps.map((rep) => ({ rep, report: rep.profileId ? reportByRepId.get(rep.profileId) ?? null : null })))
    })()
    return () => {
      active = false
    }
  }, [week.weekStartDate, reloadToken])

  const managerOptions = useMemo(() => {
    const byId = new Map<string, string>()
    for (const manager of managers) {
      byId.set(manager.id, manager.fullName ?? 'Unnamed Manager')
    }
    for (const { rep } of rows ?? []) {
      if (rep.currentManagerId) byId.set(rep.currentManagerId, rep.currentManagerName ?? 'Unnamed Manager')
    }
    return Array.from(byId, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [managers, rows])

  const summary = useMemo(() => {
    const allRows = rows ?? []
    return {
      total: allRows.length,
      submitted: allRows.filter(({ report }) => report?.status === 'submitted').length,
      draft: allRows.filter(({ report }) => report?.status === 'draft').length,
      notStarted: allRows.filter(({ report }) => !report).length,
    }
  }, [rows])

  const managerSummary = useMemo(() => {
    const byManager = new Map<
      string,
      { managerId: string; managerName: string; total: number; submitted: number; pending: number; approved: number; rejected: number; draft: number; notStarted: number }
    >()
    for (const manager of managers) {
      byManager.set(manager.id, {
        managerId: manager.id,
        managerName: manager.fullName ?? 'Unnamed Manager',
        total: 0,
        submitted: 0,
        pending: 0,
        approved: 0,
        rejected: 0,
        draft: 0,
        notStarted: 0,
      })
    }
    for (const { rep, report } of rows ?? []) {
      const managerId = rep.currentManagerId ?? 'unassigned'
      const managerName = rep.currentManagerId ? rep.currentManagerName ?? 'Unnamed Manager' : 'Unassigned'
      const bucket = byManager.get(managerId) ?? {
        managerId,
        managerName,
        total: 0,
        submitted: 0,
        pending: 0,
        approved: 0,
        rejected: 0,
        draft: 0,
        notStarted: 0,
      }
      bucket.total += 1
      if (report?.status === 'submitted') {
        bucket.submitted += 1
        if (report.reviewStatus === 'approved') bucket.approved += 1
        else if (report.reviewStatus === 'rejected') bucket.rejected += 1
        else bucket.pending += 1
      }
      else if (report?.status === 'draft') bucket.draft += 1
      else bucket.notStarted += 1
      byManager.set(managerId, bucket)
    }
    return Array.from(byManager.values()).sort((a, b) => a.managerName.localeCompare(b.managerName))
  }, [managers, rows])

  const visibleRows = (rows ?? []).filter(({ rep, report }) => {
    if (managerFilter !== 'all' && rep.currentManagerId !== managerFilter) return false
    if (statusFilter === 'all') return true
    if (statusFilter === 'submitted') return report?.status === 'submitted'
    return statusKey(report) === statusFilter
  })

  return (
    <div className="sales-admin-reports">
      <div className="sar-header">
        <div className="sar-header-titles">
          <h1>Report Status</h1>
          <p className="sar-subtitle">Read-only weekly Sales Rep reporting progress and manager-level totals.</p>
        </div>
        <label className="sar-week-control">
          <span>Reporting week</span>
          <select aria-label="Filter by reporting week" value={weekOffset} onChange={(event) => setWeekOffset(Number(event.target.value))}>
            {weekOptions.map((option, index) => (
              <option key={option.weekStartDate} value={-index}>
                {index === 0 ? `Current week · ${option.label}` : option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="sar-kpi-row" aria-label={`Reporting summary for week of ${week.label}`}>
        <div className="sar-kpi-card"><span className="sar-kpi-value">{summary.total}</span><span className="sar-kpi-label">Total Sales Reps</span></div>
        <div className="sar-kpi-card sar-kpi-submitted"><span className="sar-kpi-value">{summary.submitted}</span><span className="sar-kpi-label">Submitted</span></div>
        <div className="sar-kpi-card sar-kpi-draft"><span className="sar-kpi-value">{summary.draft}</span><span className="sar-kpi-label">Draft</span></div>
        <div className="sar-kpi-card sar-kpi-missing"><span className="sar-kpi-value">{summary.notStarted}</span><span className="sar-kpi-label">Not Started</span></div>
      </div>

      {loadError ? (
        <div className="sar-error-state" role="alert">
          <p>{loadError}</p>
          <button type="button" className="btn btn-secondary" onClick={() => setReloadToken((token) => token + 1)}>Retry</button>
        </div>
      ) : rows === null ? (
        <div className="sar-loading" role="status">Loading report status…</div>
      ) : (
        <>
          <section className="sar-card" aria-labelledby="sar-rep-reports-heading">
            <div className="sar-card-heading">
              <div>
                <h2 id="sar-rep-reports-heading">Sales Rep Reports</h2>
                <p>Week of {week.label}. Submitted reports open in read-only mode; review remains the assigned Manager&apos;s responsibility.</p>
              </div>
              <div className="sar-filters">
                <label>
                  <span>Manager</span>
                  <select aria-label="Filter by Manager" value={managerFilter} onChange={(event) => setManagerFilter(event.target.value)}>
                    <option value="all">All Managers</option>
                    {managerOptions.map((manager) => <option key={manager.id} value={manager.id}>{manager.name}</option>)}
                  </select>
                </label>
                <label>
                  <span>Status</span>
                  <select aria-label="Filter by report status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
                    {STATUS_FILTERS.map((filter) => <option key={filter.value} value={filter.value}>{filter.label}</option>)}
                  </select>
                </label>
              </div>
            </div>

            {visibleRows.length === 0 ? (
              <p className="sar-empty-state">{rows.length === 0 ? 'No Sales Reps found.' : 'No reports match the selected filters.'}</p>
            ) : (
              <div className="sar-table" role="table" aria-label="Sales Rep report status">
                <div className="sar-table-header" role="row">
                  <span role="columnheader">Sales Rep</span><span role="columnheader">Assigned Manager</span>
                  <span role="columnheader">Reporting Week</span><span role="columnheader">Report Status</span><span role="columnheader">Report</span>
                </div>
                {visibleRows.map((row) => (
                  <div className="sar-table-row" role="row" key={row.rep.id}>
                    <div className="sar-cell sar-cell-rep" role="cell" data-label="Sales Rep">
                      <strong>{row.rep.fullName}</strong><span>{row.rep.email}</span>
                    </div>
                    <div className="sar-cell" role="cell" data-label="Assigned Manager">{row.rep.currentManagerName ?? 'Unassigned'}</div>
                    <div className="sar-cell" role="cell" data-label="Reporting Week">{week.label}</div>
                    <div className="sar-cell" role="cell" data-label="Report Status">
                      <span className={`sar-status sar-status-${statusKey(row.report)}`}>{statusLabel(row.report)}</span>
                    </div>
                    <div className="sar-cell sar-cell-action" role="cell" data-label="Report">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={!row.report || row.report.status !== 'submitted'}
                        onClick={() => setSelectedRow(row)}
                      >
                        View Report
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="sar-card sar-manager-card" aria-labelledby="sar-manager-summary-heading">
            <div className="sar-card-heading sar-manager-heading">
              <div>
                <h2 id="sar-manager-summary-heading">Reporting by Manager</h2>
                <p>Sales Rep status totals grouped by current Manager assignment for the selected week.</p>
              </div>
            </div>
            {managerSummary.length === 0 ? (
              <p className="sar-empty-state">No manager reporting data is available.</p>
            ) : (
              <div className="sar-table sar-manager-table" role="table" aria-label="Reporting status by Manager">
                <div className="sar-manager-header" role="row">
                  <span role="columnheader">Manager</span><span role="columnheader">Assigned Reps</span>
                  <span role="columnheader">Submitted</span><span role="columnheader">Pending</span>
                  <span role="columnheader">Approved</span><span role="columnheader">Needs Correction</span>
                  <span role="columnheader">Draft</span><span role="columnheader">Not Started</span>
                </div>
                {managerSummary.map((manager) => (
                  <div className="sar-manager-row" role="row" key={manager.managerId}>
                    <span role="cell" data-label="Manager">{manager.managerName}</span>
                    <span role="cell" data-label="Assigned Reps">{manager.total}</span>
                    <span role="cell" data-label="Submitted">{manager.submitted}</span>
                    <span role="cell" data-label="Pending">{manager.pending}</span>
                    <span role="cell" data-label="Approved">{manager.approved}</span>
                    <span role="cell" data-label="Needs Correction">{manager.rejected}</span>
                    <span role="cell" data-label="Draft">{manager.draft}</span>
                    <span role="cell" data-label="Not Started">{manager.notStarted}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {selectedRow?.report && (
        <div className="sar-detail-overlay" role="presentation" onClick={() => setSelectedRow(null)}>
          <section
            className="sar-detail-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sar-detail-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sar-detail-header">
              <div>
                <span className="sar-readonly-label">Read-only report</span>
                <h2 id="sar-detail-title">{selectedRow.rep.fullName}</h2>
                <p>{selectedRow.rep.email} · Week of {week.label} · {statusLabel(selectedRow.report)}</p>
                <p>{submittedAtLabel(selectedRow.report.submittedAt)}</p>
              </div>
              <button type="button" className="btn btn-secondary" onClick={() => setSelectedRow(null)}>Close</button>
            </div>
            <ReportContent report={selectedRow.report} />
          </section>
        </div>
      )}
    </div>
  )
}
