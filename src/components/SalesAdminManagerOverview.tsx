import { useEffect, useState } from 'react'
import {
  fetchSalesAdminOverview,
  deriveManagerDrillDown,
  type SalesAdminManagerOverviewRow,
  type SalesAdminRepDrillDownRow,
  type SalesAdminOverviewData,
} from '../lib/salesAdminRepVisibilityService'
import { getReportingWeekByOffset } from '../utils/week'
import { getInitials } from '../utils/initials'
import './SalesAdminManagerOverview.css'

// Phase 4 — Sales Admin "Reporting by Manager". Third destination in
// SalesAdminShell, alongside (never replacing) Sales Representatives and
// Sales Rep Reports. Strictly read-only: no approve/reject/assign control
// anywhere on this screen, matching SalesAdminReports.tsx's own established
// design principle. Week selection is local state, same pattern as
// AdminDashboard/MyReps/LeadershipReportCurrent/WeeklySummary all use.
const BUCKET_LABELS: Record<SalesAdminRepDrillDownRow['bucket'], string> = {
  missing: 'Missing',
  pending: 'Pending Review',
  approved: 'Approved',
  rejected: 'Needs Correction',
}

type LoadState = 'loading' | 'error' | 'ready'

export default function SalesAdminManagerOverview() {
  const [weekOffset, setWeekOffset] = useState(0)
  const week = getReportingWeekByOffset(weekOffset)
  const isCurrentWeek = weekOffset === 0

  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null)
  const [data, setData] = useState<SalesAdminOverviewData | null>(null)
  const [selected, setSelected] = useState<SalesAdminManagerOverviewRow | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let active = true
    setLoadState('loading')
    setLoadErrorMessage(null)
    setSelected(null)

    fetchSalesAdminOverview(week.weekStartDate).then((outcome) => {
      if (!active) return
      if (outcome.status !== 'ok') {
        setLoadErrorMessage(outcome.message)
        setLoadState('error')
        return
      }
      setData(outcome.data)
      setLoadState('ready')
    })

    return () => {
      active = false
    }
  }, [week.weekStartDate, reloadToken])

  const handleRetry = () => setReloadToken((t) => t + 1)

  const drillDown: SalesAdminRepDrillDownRow[] =
    selected && data ? deriveManagerDrillDown(selected.managerId, data.reps, data.reportByRepId) : []

  // Company-wide totals across the 10 real Managers — a separate figure
  // from each Manager's own row below, derived by summing them rather than
  // a second independent calculation.
  const totals = (data?.overview ?? []).reduce(
    (acc, row) => {
      acc.assigned += row.assignedCount
      acc.submitted += row.submittedCount
      acc.pending += row.pendingCount
      acc.approved += row.approvedCount
      acc.rejected += row.rejectedCount
      acc.missing += row.missingCount
      return acc
    },
    { assigned: 0, submitted: 0, pending: 0, approved: 0, rejected: 0, missing: 0 },
  )

  return (
    <div className="samo-page">
      <div className="samo-top-row">
        <div className="samo-header-titles">
          <h1>Reporting by Manager</h1>
          <p className="samo-header-subtitle">Read-only weekly Sales Rep reporting status, grouped by Manager, across all regions.</p>
        </div>
        <span className="week-selector-label">
          <button
            type="button"
            className="week-nav-btn"
            onClick={() => setWeekOffset((o) => o - 1)}
            aria-label="Previous reporting week"
          >
            &lsaquo;
          </button>
          <span className="samo-week-label">
            Week of {week.label}
            {isCurrentWeek && <span className="week-current-badge">Current</span>}
          </span>
          <button
            type="button"
            className="week-nav-btn"
            onClick={() => setWeekOffset((o) => Math.min(0, o + 1))}
            disabled={isCurrentWeek}
            aria-label="Next reporting week"
          >
            &rsaquo;
          </button>
        </span>
      </div>

      {loadState === 'loading' && <div className="samo-loading">Loading…</div>}

      {loadState === 'error' && (
        <div className="samo-error-state">
          <p>{loadErrorMessage || 'Could not load the reporting overview.'}</p>
          <button type="button" className="btn btn-secondary" onClick={handleRetry}>
            Retry
          </button>
        </div>
      )}

      {loadState === 'ready' && data && !selected && (
        <>
          <div className="samo-summary-row">
            <div className="samo-summary-card">
              <span className="samo-summary-value">{totals.assigned}</span>
              <span className="samo-summary-label">Total Assigned</span>
            </div>
            <div className="samo-summary-card">
              <span className="samo-summary-value">{totals.submitted}</span>
              <span className="samo-summary-label">Submitted</span>
            </div>
            <div className="samo-summary-card">
              <span className="samo-summary-value">{totals.pending}</span>
              <span className="samo-summary-label">Pending Review</span>
            </div>
            <div className="samo-summary-card">
              <span className="samo-summary-value">{totals.approved}</span>
              <span className="samo-summary-label">Approved</span>
            </div>
            <div className="samo-summary-card">
              <span className="samo-summary-value">{totals.rejected}</span>
              <span className="samo-summary-label">Needs Correction</span>
            </div>
            <div className="samo-summary-card">
              <span className="samo-summary-value">{totals.missing}</span>
              <span className="samo-summary-label">Missing</span>
            </div>
          </div>

          {data.overview.length === 0 ? (
            <p className="samo-empty-state">No real Managers found.</p>
          ) : (
            <div className="samo-table samo-table-overview" role="table" aria-label="Sales Rep reporting by Manager">
              <div className="samo-table-header-row samo-table-header-row-overview" role="row">
                <span role="columnheader">Manager</span>
                <span role="columnheader">Assigned Reps</span>
                <span role="columnheader">Submitted</span>
                <span role="columnheader">Pending</span>
                <span role="columnheader">Approved</span>
                <span role="columnheader">Needs Correction</span>
                <span role="columnheader">Missing</span>
              </div>
              {data.overview.map((row) => {
                const managerName = row.managerName ?? 'Unnamed Manager'
                return (
                  <div
                    key={row.managerId}
                    className="samo-row samo-row-overview samo-row-clickable"
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelected(row)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') setSelected(row)
                    }}
                  >
                    <div className="samo-cell samo-cell-person" role="cell">
                      <span className="samo-avatar" aria-hidden="true">
                        {getInitials(managerName)}
                      </span>
                      <div className="samo-person-info">
                        <span className="samo-person-name">{managerName}</span>
                        <span className="samo-person-email">{row.managerEmail}</span>
                      </div>
                    </div>
                    <div className="samo-cell samo-cell-count" role="cell" data-label="Assigned Reps">
                      {row.assignedCount}
                    </div>
                    <div className="samo-cell samo-cell-count" role="cell" data-label="Submitted">
                      {row.submittedCount}
                    </div>
                    <div className="samo-cell samo-cell-count" role="cell" data-label="Pending">
                      {row.pendingCount}
                    </div>
                    <div className="samo-cell samo-cell-count" role="cell" data-label="Approved">
                      {row.approvedCount}
                    </div>
                    <div className="samo-cell samo-cell-count" role="cell" data-label="Needs Correction">
                      {row.rejectedCount}
                    </div>
                    <div className="samo-cell samo-cell-count" role="cell" data-label="Missing">
                      {row.missingCount}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {loadState === 'ready' && selected && (
        <div className="samo-card">
          <button type="button" className="link-btn back-link" onClick={() => setSelected(null)}>
            ← Back to Reporting by Manager
          </button>
          <h2>{(selected.managerName ?? 'Unnamed Manager') + "'s Sales Reps"}</h2>
          <p className="samo-subtitle">Week of {week.label}</p>

          {drillDown.length === 0 ? (
            <p className="samo-empty-state">No Sales Reps currently assigned to this Manager.</p>
          ) : (
            <div className="samo-table" role="table" aria-label={`${selected.managerName ?? 'Unnamed Manager'}'s assigned Sales Reps`}>
              <div className="samo-table-header-row" role="row">
                <span role="columnheader">Sales Rep</span>
                <span role="columnheader">Status</span>
              </div>
              {drillDown.map((rep) => (
                <div key={rep.repId} className="samo-row" role="row">
                  <div className="samo-cell samo-cell-person" role="cell">
                    <span className="samo-avatar" aria-hidden="true">
                      {getInitials(rep.fullName)}
                    </span>
                    <div className="samo-person-info">
                      <span className="samo-person-name">{rep.fullName}</span>
                      <span className={`samo-person-email ${rep.email ? '' : 'samo-person-email-missing'}`}>
                        {rep.email || 'Email not available'}
                      </span>
                    </div>
                  </div>
                  <div className="samo-cell" role="cell">
                    <span className={`samo-status-badge samo-status-${rep.bucket}`}>{BUCKET_LABELS[rep.bucket]}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
