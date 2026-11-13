import { useEffect, useMemo, useState } from 'react'
import { fetchSalesReps, type SalesRep } from '../lib/salesRepManagementService'
import { fetchRepReport, type RepReport } from '../lib/repReportsService'
import { getCurrentReportingWeek } from '../utils/week'
import { getInitials } from '../utils/initials'
import type { SalesRepReportSections } from '../types'
import './AdminDashboard.css'
import './StatusBadge.css'
import './MyReps.css'
import './SalesAdminReports.css'

// Sales Admin's read-only view of every Sales Rep's current-week report
// status, across ALL managers (not assignment-scoped, unlike the Manager's
// own My Reps screen). Deliberately read-only: no approve/reject action
// exists here at all — review_rep_report remains is_assigned_manager_of()
// OR is_admin() only, server-side, completely unaffected by this screen —
// this component simply never offers the action, matching the requirement
// that Sales Admin must never approve, reject, or modify report status. It
// also never offers a reminder action — that is an Admin/Manager-only
// capability for their own direct reports, not a Sales Admin one.
//
// Reuses fetchSalesReps() (the same Admin/Sales-Admin-shared
// list-sales-reps.ts endpoint SalesRepManagement.tsx already uses) and
// fetchRepReport() (the same RLS-scoped read Manager's My Reps uses) rather
// than introducing a new endpoint or table shape.
//
// Visually, this screen reuses AdminDashboard.tsx's own classes directly
// (.adp-kpi-row/.adp-kpi-card, .adp-filter-row/.adp-filter-btn,
// .adp-table/.adp-row/.adp-cell-manager/.adp-manager-avatar/
// .adp-view-link) — the exact Super Admin dashboard this was asked to
// match — rather than a new design. The five-column grid
// (.adp-table-header-row/.adp-row) is reused with its exact proportions;
// the two columns Managers don't have an equivalent of (Reminder, which
// Sales Admin has no authority to send; Report, repurposed below) are
// filled with Current Manager and Submitted instead, so Sales-Rep-specific
// information occupies the same column rhythm the reference uses.
// StatusBadge.css's .status-badge/.status-* color classes are reused for
// this screen's own badge (not the <StatusBadge> component itself, whose
// built-in labels — "Draft Saved" — are phrased for the person who owns
// the draft, not an admin observing someone else's).
interface ReportRow {
  rep: SalesRep
  report: RepReport | null
}

type StatusBucket = 'not_started' | 'draft' | 'submitted'
type StatusFilter = 'all' | StatusBucket

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'draft', label: 'In Progress' },
  { key: 'not_started', label: 'Not Started' },
]

const STATUS_BADGE_LABEL: Record<StatusBucket, string> = {
  not_started: 'Not Started',
  draft: 'In Progress',
  submitted: 'Submitted',
}

// Same three-way split used for the KPI cards and filter pills. A report
// that has moved past 'draft' (pending/approved/rejected review) is still
// 'submitted' for this purpose — review outcome detail is shown as a
// secondary line under the row's timestamp instead, never a new bucket.
function bucketOf(report: RepReport | null): StatusBucket {
  if (!report) return 'not_started'
  if (report.status === 'draft') return 'draft'
  return 'submitted'
}

function reviewSubLabel(report: RepReport): string | null {
  if (report.reviewStatus === 'pending') return 'Pending Review'
  if (report.reviewStatus === 'approved') return 'Approved'
  if (report.reviewStatus === 'rejected') return 'Needs Correction'
  return null
}

function formatSubmittedAt(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

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

export default function SalesAdminReports() {
  const [rows, setRows] = useState<ReportRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filter, setFilter] = useState<StatusFilter>('all')
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
          return { rep, report }
        }),
      )
      if (!active) return
      setRows(nextRows)
    })()
    return () => {
      active = false
    }
  }, [week.weekStartDate])

  const total = (rows ?? []).length
  const submitted = (rows ?? []).filter((r) => bucketOf(r.report) === 'submitted').length
  const draft = (rows ?? []).filter((r) => bucketOf(r.report) === 'draft').length
  const notStarted = (rows ?? []).filter((r) => bucketOf(r.report) === 'not_started').length
  const completionPct = total > 0 ? Math.round((submitted / total) * 100) : 0

  const filterCounts: Record<StatusFilter, number> = { all: total, submitted, draft, not_started: notStarted }

  const filteredRows = useMemo(() => {
    return (rows ?? []).filter((row) => filter === 'all' || bucketOf(row.report) === filter)
  }, [rows, filter])

  return (
    <div className="sales-admin-reports">
      <div className="adp-top-row">
        <div className="adp-header-titles">
          <h1>Sales Rep Reports</h1>
          <p className="adp-header-subtitle">Read-only status for every Sales Rep's week of {week.label}. Reviewing and approving reports remains the assigned Manager's responsibility.</p>
        </div>
      </div>

      {loadError && <p className="admin-empty-state">{loadError}</p>}

      {rows === null && !loadError ? (
        <p>Loading…</p>
      ) : (
        <div className="adp-managers-card">
          <div className="adp-kpi-row">
            <div className="adp-kpi-card adp-kpi-card-total">
              <span className="adp-kpi-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="9" cy="8" r="3" />
                  <path d="M4 20c0-3 2.5-5 5-5s5 2 5 5" />
                  <circle cx="17" cy="9" r="2.5" />
                  <path d="M15.5 20c0-2.5 1-4 3-4.5" />
                </svg>
              </span>
              <div className="adp-kpi-text">
                <span className="adp-kpi-value">{total}</span>
                <span className="adp-kpi-label">Total Sales Reps</span>
              </div>
            </div>
            <div className="adp-kpi-card adp-kpi-card-submitted">
              <span className="adp-kpi-icon" aria-hidden="true">&#10003;</span>
              <div className="adp-kpi-text">
                <span className="adp-kpi-value">{submitted}</span>
                <span className="adp-kpi-label">Submitted</span>
              </div>
            </div>
            <div className="adp-kpi-card adp-kpi-card-draft">
              <span className="adp-kpi-icon" aria-hidden="true">&#9998;</span>
              <div className="adp-kpi-text">
                <span className="adp-kpi-value">{draft}</span>
                <span className="adp-kpi-label">In Progress</span>
              </div>
            </div>
            <div className="adp-kpi-card adp-kpi-card-not-started">
              <span className="adp-kpi-icon" aria-hidden="true">&#9675;</span>
              <div className="adp-kpi-text">
                <span className="adp-kpi-value">{notStarted}</span>
                <span className="adp-kpi-label">Not Started</span>
              </div>
            </div>
            <div className="adp-kpi-card adp-kpi-card-completion">
              <span className="adp-kpi-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M8 12.5l2.5 2.5L16 9" />
                </svg>
              </span>
              <div className="adp-kpi-text">
                <span className="adp-kpi-value">{completionPct}%</span>
                <span className="adp-kpi-label">Completion</span>
              </div>
            </div>
          </div>

          <div className="adp-managers-header">
            <h2>Sales Reps</h2>
          </div>

          <div className="adp-filter-row" role="group" aria-label="Filter Sales Reps by status">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className={`adp-filter-btn ${filter === f.key ? 'active' : ''}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
                <span className="adp-filter-count">{filterCounts[f.key]}</span>
              </button>
            ))}
          </div>

          {filteredRows.length === 0 ? (
            <p className="admin-empty-state">{(rows ?? []).length === 0 ? 'No Sales Reps found.' : 'No Sales Reps match this filter.'}</p>
          ) : (
            <div className="adp-table" role="table" aria-label="Sales Reps">
              <div className="adp-table-header-row" role="row">
                <span role="columnheader">Sales Rep</span>
                <span role="columnheader">Status</span>
                <span role="columnheader">Current Manager</span>
                <span role="columnheader">Submitted</span>
                <span role="columnheader">Report</span>
              </div>
              {filteredRows.map(({ rep, report }) => {
                const bucket = bucketOf(report)
                const subLabel = report ? reviewSubLabel(report) : null
                return (
                  <div className="adp-row" role="row" key={rep.id}>
                    <div className="adp-cell adp-cell-manager" role="cell">
                      <span className="adp-manager-avatar" aria-hidden="true">{getInitials(rep.fullName)}</span>
                      <div className="adp-manager-info">
                        <span className="manager-name">{rep.fullName}</span>
                        <span className="manager-email">{rep.email}</span>
                      </div>
                    </div>
                    <div className="adp-cell" role="cell">
                      <span className={`status-badge status-${bucket}`}>{STATUS_BADGE_LABEL[bucket]}</span>
                    </div>
                    <div className="adp-cell" role="cell">
                      <span>{rep.currentManagerName ?? 'Unassigned'}</span>
                    </div>
                    <div className="adp-cell adp-cell-submitted" role="cell">
                      {report?.submittedAt ? (
                        <>
                          <span className="adp-submitted-at">{formatSubmittedAt(report.submittedAt)}</span>
                          {subLabel && <span className="submission-source-tag">{subLabel}</span>}
                        </>
                      ) : (
                        <span className="adp-dash">—</span>
                      )}
                    </div>
                    <div className="adp-cell" role="cell">
                      {report ? (
                        <button type="button" className="adp-view-link-btn" onClick={() => setViewingRow({ rep, report })}>
                          View Report &rarr;
                        </button>
                      ) : (
                        <span className="adp-dash">—</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
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
