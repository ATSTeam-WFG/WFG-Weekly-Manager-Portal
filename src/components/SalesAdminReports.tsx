import { useEffect, useMemo, useState } from 'react'
import { fetchSalesReps, type SalesRep } from '../lib/salesRepManagementService'
import { fetchRepReport, type RepReport } from '../lib/repReportsService'
import { getCurrentReportingWeek } from '../utils/week'
import type { SalesRepReportSections } from '../types'
import './SalesRepManagement.css'
import './SalesAdminManagerOverview.css'
import './MyReps.css'
import './SalesAdminReports.css'

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
//
// Visual pattern deliberately reuses two already-existing, already-styled
// conventions rather than inventing a new one: the KPI summary-card row
// (.samo-summary-row/.samo-summary-card, the exact classes
// SalesAdminManagerOverview.tsx — rendered directly below this component in
// the same Report Status panel — already uses) and the read-only report
// content viewer (.myreps-overlay/.myreps-panel/.myreps-section, the exact
// classes Manager's own My Reps review dialog uses), with its decision
// controls (Approve/Reject) deliberately omitted — this view never offers
// them. The search/filter row reuses SalesRepManagement.tsx's own
// .srm-controls/.srm-search/.srm-status-filter pattern.
interface ReportRow {
  rep: SalesRep
  report: RepReport | null
  reportSummary: string
}

type StatusBucket = 'not_started' | 'in_progress' | 'submitted'
type StatusFilter = 'all' | StatusBucket

const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'not_started', label: 'Not Started' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'submitted', label: 'Submitted' },
]

const SECTION_LIST_FIELDS: {
  key: 'accomplishments' | 'salesMetrics' | 'pipelineUpdates' | 'blockers' | 'nextWeekPriorities'
  label: string
}[] = [
  { key: 'accomplishments', label: 'Accomplishments' },
  { key: 'salesMetrics', label: 'Sales Metrics' },
  { key: 'pipelineUpdates', label: 'Pipeline Updates' },
  { key: 'blockers', label: 'Blockers' },
  { key: 'nextWeekPriorities', label: 'Next Week Priorities' },
]

function summarizeReport(report: RepReport | null): string {
  if (!report) return 'Not started'
  if (report.status === 'draft') return 'Draft'
  if (report.reviewStatus === 'pending') return 'Submitted — Pending Review'
  if (report.reviewStatus === 'approved') return 'Approved'
  return 'Rejected'
}

// Same three-way split the per-row summary already expresses — never a new
// or invented status, just a tally of the existing categories.
function bucketOf(report: RepReport | null): StatusBucket {
  if (!report) return 'not_started'
  if (report.status === 'draft') return 'in_progress'
  return 'submitted'
}

export default function SalesAdminReports() {
  const [rows, setRows] = useState<ReportRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [viewingRow, setViewingRow] = useState<ReportRow | null>(null)
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
          return { rep, report, reportSummary: summarizeReport(report) }
        }),
      )
      if (!active) return
      setRows(nextRows)
    })()
    return () => {
      active = false
    }
  }, [week.weekStartDate])

  const summaryCounts = useMemo(() => {
    const counts = { total: 0, not_started: 0, in_progress: 0, submitted: 0 }
    for (const row of rows ?? []) {
      counts.total += 1
      counts[bucketOf(row.report)] += 1
    }
    return counts
  }, [rows])

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return (rows ?? []).filter((row) => {
      if (statusFilter !== 'all' && bucketOf(row.report) !== statusFilter) return false
      if (!term) return true
      return row.rep.fullName.toLowerCase().includes(term) || row.rep.email.toLowerCase().includes(term)
    })
  }, [rows, search, statusFilter])

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
        <>
          <div className="samo-summary-row" aria-label="Sales Rep reporting summary">
            <div className="samo-summary-card">
              <span className="samo-summary-value">{summaryCounts.total}</span>
              <span className="samo-summary-label">Total Sales Reps</span>
            </div>
            <div className="samo-summary-card">
              <span className="samo-summary-value">{summaryCounts.not_started}</span>
              <span className="samo-summary-label">Not Started</span>
            </div>
            <div className="samo-summary-card">
              <span className="samo-summary-value">{summaryCounts.in_progress}</span>
              <span className="samo-summary-label">In Progress</span>
            </div>
            <div className="samo-summary-card">
              <span className="samo-summary-value">{summaryCounts.submitted}</span>
              <span className="samo-summary-label">Submitted</span>
            </div>
          </div>

          <div className="srm-controls">
            <input
              type="search"
              className="srm-search"
              placeholder="Search by name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search Sales Reps"
            />
            <select
              className="srm-status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              aria-label="Filter by reporting status"
            >
              {STATUS_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          {filteredRows.length === 0 ? (
            <p className="srm-empty-state">{(rows ?? []).length === 0 ? 'No Sales Reps found.' : 'No Sales Reps match this search or filter.'}</p>
          ) : (
            <div className="srm-table" role="table">
              <div className="srm-table-header-row" role="row">
                <span role="columnheader">Sales Rep</span>
                <span role="columnheader">Email</span>
                <span role="columnheader">Current Manager</span>
                <span role="columnheader">This Week's Status</span>
                <span role="columnheader">Actions</span>
              </div>
              {filteredRows.map((row) => (
                <div className="srm-row" role="row" key={row.rep.id}>
                  <div className="srm-row-main">
                    <span role="cell">{row.rep.fullName}</span>
                    <span role="cell">{row.rep.email}</span>
                    <span role="cell">{row.rep.currentManagerName ?? 'Unassigned'}</span>
                    <span role="cell">{row.reportSummary}</span>
                    <span role="cell">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={!row.report}
                        title={row.report ? undefined : 'No report started yet for this week.'}
                        onClick={() => setViewingRow(row)}
                      >
                        View
                      </button>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {viewingRow?.report && (
        <SalesAdminReportViewModal repName={viewingRow.rep.fullName} content={viewingRow.report.content} onClose={() => setViewingRow(null)} />
      )}
    </div>
  )
}

// Read-only content viewer — deliberately a stripped-down copy of MyReps.tsx's
// own report dialog body (same .myreps-* classes, same SECTION_LIST_FIELDS),
// with its audit-history section and its Approve/Reject decision controls
// both omitted entirely. Sales Admin has no review authority here at all;
// this only ever displays what the rep wrote.
function SalesAdminReportViewModal({
  repName,
  content,
  onClose,
}: {
  repName: string
  content: SalesRepReportSections
  onClose: () => void
}) {
  return (
    <div className="myreps-overlay" role="dialog" aria-modal="true" aria-label={`View ${repName}'s report`}>
      <div className="myreps-panel">
        <div className="myreps-panel-header">
          <h2>{repName}'s Report</h2>
          <button type="button" className="myreps-panel-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        <div className="myreps-panel-body">
          {SECTION_LIST_FIELDS.map(({ key, label }) => (
            <div className="myreps-section" key={key}>
              <h3>{label}</h3>
              {content[key].length === 0 ? (
                <p className="myreps-section-empty">No items provided.</p>
              ) : (
                <ul>
                  {content[key].map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}

          <div className="myreps-section">
            <h3>Manager Support Needed</h3>
            <p className="myreps-support-text">{content.managerSupportNeeded || 'No items provided.'}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
