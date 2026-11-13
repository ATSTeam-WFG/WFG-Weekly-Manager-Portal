import { useEffect, useMemo, useState } from 'react'
import { getReportingWeekByOffset } from '../utils/week'
import { fetchManagerSalesRepReports, type ManagerSalesRepReport } from '../lib/managerSalesRepService'
import './ManagerPortalData.css'

const REPORT_STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'pending', label: 'Pending Review' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Needs Correction' },
  { value: 'draft', label: 'Draft' },
  { value: 'not-started', label: 'Not Started' },
  { value: 'unavailable', label: 'No report available' },
] as const

type ReportStatusFilter = (typeof REPORT_STATUS_OPTIONS)[number]['value']

function reportStatusKey(row: ManagerSalesRepReport, weekOffset: number): ReportStatusFilter {
  if (row.reportOutcome.status === 'error') return 'unavailable'
  if (row.reportOutcome.status === 'not_found') return weekOffset === 0 ? 'not-started' : 'unavailable'
  if (row.report?.status === 'draft') return 'draft'
  if (row.report?.reviewStatus === 'approved') return 'approved'
  if (row.report?.reviewStatus === 'rejected') return 'rejected'
  return 'pending'
}

function reportStatusLabel(row: ManagerSalesRepReport, weekOffset: number): string {
  const key = reportStatusKey(row, weekOffset)
  if (key === 'not-started') return 'Not Started'
  if (key === 'unavailable') return 'No report available under current access rules'
  if (key === 'draft') return 'Draft'
  if (key === 'approved') return 'Approved'
  if (key === 'rejected') return 'Needs Correction'
  return 'Submitted — Pending Review'
}

function formatSubmittedAt(value: string | null): string {
  return value
    ? new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '—'
}

function ReadOnlyReportContent({ row }: { row: ManagerSalesRepReport }) {
  if (!row.report) return null
  const sections: { title: string; bullets: string[] }[] = [
    { title: 'Accomplishments', bullets: row.report.content.accomplishments },
    { title: 'Sales Metrics', bullets: row.report.content.salesMetrics },
    { title: 'Pipeline Updates', bullets: row.report.content.pipelineUpdates },
    { title: 'Blockers / Challenges', bullets: row.report.content.blockers },
    { title: 'Next Week Priorities', bullets: row.report.content.nextWeekPriorities },
  ]

  return (
    <div className="manager-report-content">
      {sections.map((section) => (
        <section className="manager-report-section" key={section.title}>
          <h3>{section.title}</h3>
          {section.bullets.length === 0 ? (
            <p className="manager-report-empty">No response provided.</p>
          ) : (
            <ul>{section.bullets.map((bullet, index) => <li key={`${section.title}-${index}`}>{bullet}</li>)}</ul>
          )}
        </section>
      ))}
      <section className="manager-report-section">
        <h3>Manager Support Needed</h3>
        <p>{row.report.content.managerSupportNeeded || <span className="manager-report-empty">No response provided.</span>}</p>
      </section>
    </div>
  )
}

interface ManagerSalesRepReportsProps {
  onReviewReports: () => void
}

export default function ManagerSalesRepReports({ onReviewReports }: ManagerSalesRepReportsProps) {
  const [weekOffset, setWeekOffset] = useState(0)
  const [statusFilter, setStatusFilter] = useState<ReportStatusFilter>('all')
  const [rows, setRows] = useState<ManagerSalesRepReport[] | null>(null)
  const [selected, setSelected] = useState<ManagerSalesRepReport | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const week = getReportingWeekByOffset(weekOffset)
  const weekOptions = useMemo(() => Array.from({ length: 13 }, (_, index) => getReportingWeekByOffset(-index)), [])

  useEffect(() => {
    let active = true
    setRows(null)
    setSelected(null)
    setLoadError(null)
    fetchManagerSalesRepReports(week.weekStartDate).then((outcome) => {
      if (!active) return
      if (outcome.status === 'error') {
        setLoadError(outcome.message)
        return
      }
      setRows(outcome.reps)
    })
    return () => {
      active = false
    }
  }, [week.weekStartDate, reloadToken])

  const knownSubmitted = (rows ?? []).filter((row) => row.report?.status === 'submitted').length
  const drafts = (rows ?? []).filter((row) => row.report?.status === 'draft').length
  const notStarted = (rows ?? []).filter((row) => reportStatusKey(row, weekOffset) === 'not-started').length
  const visibleRows = (rows ?? []).filter((row) => {
    if (statusFilter === 'all') return true
    if (statusFilter === 'submitted') return row.report?.status === 'submitted'
    return reportStatusKey(row, weekOffset) === statusFilter
  })

  return (
    <div className="manager-sales-page">
      <div className="manager-sales-header">
        <div>
          <h1>Sales Rep Reports</h1>
          <p>Read-only status for your currently assigned Sales Reps. Historical content remains limited by existing report RLS.</p>
        </div>
        <div className="manager-sales-header-actions">
          <button type="button" className="btn btn-secondary" onClick={onReviewReports}>Review Reports</button>
          <label className="manager-sales-week-control">
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
      </div>

      <div className="manager-sales-kpis" aria-label={`Reporting summary for week of ${week.label}`}>
        <div className="manager-sales-kpi"><span>{(rows ?? []).length}</span><small>Total Assigned</small></div>
        <div className="manager-sales-kpi manager-sales-kpi-active"><span>{knownSubmitted}</span><small>Submitted</small></div>
        <div className="manager-sales-kpi manager-sales-kpi-draft"><span>{drafts}</span><small>Draft</small></div>
        <div className="manager-sales-kpi manager-sales-kpi-inactive"><span>{notStarted}</span><small>Not Started</small></div>
      </div>

      <section className="manager-sales-card" aria-labelledby="manager-rep-report-title">
        <div className="manager-sales-card-heading">
          <div>
            <h2 id="manager-rep-report-title">Week of {week.label}</h2>
            <p>Submitted reports open read-only. Use Review Reports for the existing Manager decision workflow.</p>
          </div>
          <label className="manager-sales-status-control">
            <span>Status</span>
            <select aria-label="Filter by report status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as ReportStatusFilter)}>
              {REPORT_STATUS_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>

        {loadError ? (
          <div className="manager-sales-error" role="alert">
            <p>{loadError}</p>
            <button type="button" className="btn btn-secondary" onClick={() => setReloadToken((token) => token + 1)}>Retry</button>
          </div>
        ) : rows === null ? (
          <div className="manager-sales-loading" role="status">Loading assigned Sales Rep reports…</div>
        ) : visibleRows.length === 0 ? (
          <p className="manager-sales-empty">{rows.length === 0 ? 'You have no Sales Reps currently assigned.' : 'No reports match this status filter.'}</p>
        ) : (
          <div className="manager-reports-table" role="table" aria-label="Assigned Sales Rep report status">
            <div className="manager-reports-header" role="row">
              <span role="columnheader">Sales Rep</span>
              <span role="columnheader">Reporting Week</span>
              <span role="columnheader">Report Status</span>
              <span role="columnheader">Submitted</span>
              <span role="columnheader">Report</span>
            </div>
            {visibleRows.map((row) => (
              <div className="manager-reports-row" role="row" key={row.repId}>
                <div className="manager-reports-cell manager-reports-person" role="cell" data-label="Sales Rep">
                  <strong>{row.fullName ?? 'Unnamed Sales Rep'}</strong>
                  <span>{row.email || 'Email not available'}</span>
                </div>
                <span className="manager-reports-cell" role="cell" data-label="Reporting Week">{week.label}</span>
                <span className="manager-reports-cell" role="cell" data-label="Report Status">
                  <span className={`manager-sales-status status-${reportStatusKey(row, weekOffset)}`}>
                    {reportStatusLabel(row, weekOffset)}
                  </span>
                </span>
                <span className="manager-reports-cell" role="cell" data-label="Submitted">
                  {row.report?.status === 'submitted' ? formatSubmittedAt(row.report.submittedAt) : '—'}
                </span>
                <span className="manager-reports-cell manager-reports-action" role="cell" data-label="Report">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={!row.report || row.report.status !== 'submitted'}
                    onClick={() => setSelected(row)}
                  >
                    View Report
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {selected?.report && selected.report.status === 'submitted' && (
        <div className="manager-report-overlay" role="presentation" onClick={() => setSelected(null)}>
          <section
            className="manager-report-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="manager-report-view-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="manager-report-dialog-header">
              <div>
                <span className="manager-report-readonly-label">Read-only report</span>
                <h2 id="manager-report-view-title">{selected.fullName ?? 'Sales Rep'} — Week of {week.label}</h2>
                <p>{selected.email} · {reportStatusLabel(selected, weekOffset)}</p>
                <p>{formatSubmittedAt(selected.report.submittedAt)}</p>
              </div>
              <button type="button" className="btn btn-secondary" onClick={() => setSelected(null)}>Close</button>
            </div>
            <ReadOnlyReportContent row={selected} />
          </section>
        </div>
      )}
    </div>
  )
}
