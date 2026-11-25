import { useEffect, useMemo, useState } from 'react'
import {
  fetchGlobalReportOverview,
  fetchGlobalReportSubmittedReps,
  fetchGlobalReportRepReport,
  type GlobalReportManagerRow,
  type GlobalReportRepRow,
} from '../lib/globalReportViewerService'
import type { RepReport } from '../lib/repReportsService'
import { ReadOnlyReportSummary } from './SalesRepDashboard'
import { getInitials } from '../utils/initials'
import { getCurrentReportingWeek } from '../utils/week'
// Reused as-is for visual consistency with the Admin's own equivalent
// view (amro- prefixed classes) — "prefer reusing existing authorized
// report views rather than creating duplicate dashboards" taken literally
// at the styling layer too, not just the data layer.
import './AdminManagerRepOverview.css'

type LoadState = 'loading' | 'error' | 'ready'

interface DrillDownState {
  loadState: LoadState
  reps: GlobalReportRepRow[]
}

// Reporting hierarchy & access phase (2026-11-24) — Gene Rebadow / Joey
// Grampa's global, read-only, completed-reports-only view. Mounted inside
// whichever shell the caller already uses (ManagerShell/SalesAdminShell),
// gated entirely by profile.globalReportViewerEnabled — see
// globalReportViewerService.ts's own header comment for why this
// component can never show more than that flag (and the RLS policies it
// gates) allow, regardless of anything this component does or doesn't do.
export default function GlobalReportOverview() {
  const week = getCurrentReportingWeek()
  const [rows, setRows] = useState<GlobalReportManagerRow[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [searchQuery, setSearchQuery] = useState('')

  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set())
  const [drillDowns, setDrillDowns] = useState<Record<string, DrillDownState>>({})
  const [viewingRep, setViewingRep] = useState<GlobalReportRepRow | null>(null)
  const [viewingReport, setViewingReport] = useState<RepReport | null>(null)
  const [viewingLoadState, setViewingLoadState] = useState<LoadState>('loading')

  useEffect(() => {
    let active = true
    setLoadState('loading')
    fetchGlobalReportOverview(week.weekStartDate)
      .then((result) => {
        if (!active) return
        setRows(result)
        setLoadState('ready')
      })
      .catch(() => {
        if (active) setLoadState('error')
      })
    return () => {
      active = false
    }
  }, [week.weekStartDate])

  function toggleExpanded(row: GlobalReportManagerRow) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(row.managerId)) next.delete(row.managerId)
      else next.add(row.managerId)
      return next
    })
    if (drillDowns[row.managerId]) return
    setDrillDowns((prev) => ({ ...prev, [row.managerId]: { loadState: 'loading', reps: [] } }))
    fetchGlobalReportSubmittedReps(row.managerId, week.weekStartDate)
      .then((reps) => setDrillDowns((prev) => ({ ...prev, [row.managerId]: { loadState: 'ready', reps } })))
      .catch(() => setDrillDowns((prev) => ({ ...prev, [row.managerId]: { loadState: 'error', reps: [] } })))
  }

  function openRep(rep: GlobalReportRepRow) {
    setViewingRep(rep)
    setViewingLoadState('loading')
    fetchGlobalReportRepReport(rep.repId, week.weekStartDate)
      .then((report) => {
        setViewingReport(report)
        setViewingLoadState('ready')
      })
      .catch(() => setViewingLoadState('error'))
  }

  const totals = rows.reduce(
    (acc, r) => {
      acc.assigned += r.assignedCount
      acc.submitted += r.submittedCount
      return acc
    },
    { assigned: 0, submitted: 0 },
  )
  const overallCompletionPct = totals.assigned > 0 ? Math.round((totals.submitted / totals.assigned) * 100) : 0

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return rows
    return rows.filter(
      (r) => (r.managerName ?? '').toLowerCase().includes(query) || r.managerEmail.toLowerCase().includes(query),
    )
  }, [rows, searchQuery])

  if (viewingRep) {
    const name = viewingRep.fullName ?? 'Unnamed Rep'
    return (
      <div className="amro-card">
        <button type="button" className="link-btn back-link" onClick={() => setViewingRep(null)}>
          ← Back to All Sales Rep Reports
        </button>
        <h2>{name}&apos;s Report</h2>
        <p className="amro-subtitle">Week of {week.label} · read-only</p>
        {viewingLoadState === 'loading' ? (
          <p className="amro-loading">Loading…</p>
        ) : viewingLoadState === 'error' || !viewingReport ? (
          <p className="amro-empty">Could not load this report.</p>
        ) : (
          <ReadOnlyReportSummary content={viewingReport.content} />
        )}
      </div>
    )
  }

  return (
    <div className="amro-card">
      <h2>All Sales Rep Reports</h2>
      <p className="amro-subtitle">Week of {week.label} · read-only, completed reports only, across every Manager</p>

      {loadState === 'loading' && <p className="amro-loading">Loading…</p>}
      {loadState === 'error' && <p className="amro-empty">Could not load reports. Please try again.</p>}
      {loadState === 'ready' && rows.length === 0 && <p className="amro-empty">No Managers found.</p>}

      {loadState === 'ready' && rows.length > 0 && (
        <>
          <div className="amro-summary-row">
            <div className="amro-summary-card">
              <span className="amro-summary-value">{totals.assigned}</span>
              <span className="amro-summary-label">Total Sales Reps</span>
            </div>
            <div className="amro-summary-card">
              <span className="amro-summary-value">{totals.submitted}</span>
              <span className="amro-summary-label">Submitted</span>
            </div>
            <div className="amro-summary-card">
              <span className="amro-summary-value">{overallCompletionPct}%</span>
              <span className="amro-summary-label">Completion Rate</span>
            </div>
          </div>

          <div className="amro-search-row">
            <input
              type="search"
              className="amro-search-input"
              placeholder="Search by manager name or email"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search Managers by name or email"
            />
          </div>

          {filteredRows.length === 0 ? (
            <p className="amro-empty">No Managers match your search.</p>
          ) : (
            <ul className="amro-manager-list" aria-label="All Sales Rep reports, by Manager">
              {filteredRows.map((row) => {
                const managerName = row.managerName ?? 'Unnamed Manager'
                const isExpanded = expandedIds.has(row.managerId)
                const panelId = `gro-panel-${row.managerId}`
                const pct = row.assignedCount > 0 ? Math.round((row.submittedCount / row.assignedCount) * 100) : 0
                const drillDown = drillDowns[row.managerId]

                return (
                  <li key={row.managerId} className="amro-manager-item">
                    <button
                      type="button"
                      className="amro-manager-toggle"
                      aria-expanded={isExpanded}
                      aria-controls={panelId}
                      onClick={() => toggleExpanded(row)}
                    >
                      <span className="amro-cell-person">
                        <span className="amro-avatar" aria-hidden="true">
                          {getInitials(managerName)}
                        </span>
                        <span className="amro-person-info">
                          <span className="amro-person-name">{managerName}</span>
                          <span className="amro-person-email">{row.managerEmail}</span>
                        </span>
                      </span>
                      <span className="amro-manager-stats">
                        <span className="amro-stat">
                          <strong>{row.assignedCount}</strong> Assigned
                        </span>
                        <span className="amro-stat">
                          <strong>{row.submittedCount}</strong> Submitted
                        </span>
                        <span className="amro-stat amro-stat-pct">{pct}%</span>
                        <svg
                          className={`amro-chevron ${isExpanded ? 'amro-chevron-expanded' : ''}`}
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </span>
                    </button>

                    {isExpanded && (
                      <div id={panelId} role="region" aria-label={`${managerName}'s submitted reports`} className="amro-expanded">
                        {!drillDown || drillDown.loadState === 'loading' ? (
                          <p className="amro-loading">Loading…</p>
                        ) : drillDown.loadState === 'error' ? (
                          <p className="amro-empty">Could not load this Manager&apos;s reports. Please try again.</p>
                        ) : drillDown.reps.length === 0 ? (
                          <p className="amro-empty">No submitted reports yet this week.</p>
                        ) : (
                          <ul className="amro-rep-list">
                            {drillDown.reps.map((rep) => {
                              const repName = rep.fullName ?? 'Unnamed Rep'
                              return (
                                <li key={rep.repId} className="amro-rep-row">
                                  <span className="amro-cell-person">
                                    <span className="amro-avatar amro-avatar-sm" aria-hidden="true">
                                      {getInitials(repName)}
                                    </span>
                                    <span className="amro-person-info">
                                      <span className="amro-person-name">{repName}</span>
                                      <span className="amro-person-email">{rep.email}</span>
                                    </span>
                                  </span>
                                  <button type="button" className="btn btn-secondary" onClick={() => openRep(rep)}>
                                    View
                                  </button>
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
