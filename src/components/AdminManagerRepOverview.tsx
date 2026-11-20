import { useEffect, useMemo, useState } from 'react'
import {
  fetchManagerRepOverview,
  fetchManagerRepDrillDown,
  type ManagerRepOverviewRow,
  type ManagerRepDrillDownRow,
  type RepReportBucket,
} from '../lib/adminRepVisibilityService'
import { getInitials } from '../utils/initials'
import './AdminManagerRepOverview.css'

// Phase 2 — Leadership Dashboard Manager-to-Sales-Rep visibility. A
// self-contained addition dropped into AdminDashboard.tsx alongside (never
// inside) the existing Managers table: it shares that table's week
// (weekStartDate/weekLabel props, same ReportingWeek the existing
// Previous/Next navigation already drives) but has its own, completely
// separate data source (rep_manager_assignments/rep_reports, never the
// `reports` table the existing Managers table reads) and its own local
// drill-down state. The existing Managers table/onSelectManager/
// ManagerReportView flow is entirely untouched by this component.
//
// 2026-11-18 redesign — the wide six-column table became a compact,
// responsive manager list where each Manager's Sales Reps expand inline
// (accordion-style, several may be open at once) instead of navigating to
// a separate full-page view. fetchManagerRepOverview/
// fetchManagerRepDrillDown (adminRepVisibilityService.ts) are completely
// unchanged — same data, same authorization, only the presentation layer
// changed. No Sales Rep data is invented here: every field rendered comes
// straight from those two existing, already-authorized functions.
interface AdminManagerRepOverviewProps {
  weekStartDate: string
  weekLabel: string
}

type LoadState = 'loading' | 'error' | 'ready'
type StatusFilter = 'all' | RepReportBucket

// Beta feedback (2026-11-16): collapsed from the old
// missing/pending/approved/rejected labels to a plain 3-way split —
// review_status no longer gates or labels anything.
const BUCKET_LABELS: Record<ManagerRepDrillDownRow['bucket'], string> = {
  missing: 'Not Started',
  draft: 'In Progress',
  submitted: 'Submitted',
}

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'draft', label: 'In Progress' },
  { key: 'missing', label: 'Missing' },
]

function completionPctOf(row: ManagerRepOverviewRow): number {
  return row.assignedCount > 0 ? Math.round((row.submittedCount / row.assignedCount) * 100) : 0
}

interface DrillDownState {
  loadState: LoadState
  rows: ManagerRepDrillDownRow[]
}

export default function AdminManagerRepOverview({ weekStartDate, weekLabel }: AdminManagerRepOverviewProps) {
  const [rows, setRows] = useState<ManagerRepOverviewRow[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')

  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  // Several Managers may be expanded at once — each tracked independently
  // by id, so expanding one never collapses another. Drill-down results
  // are cached per Manager (keyed by id) so collapsing and re-expanding the
  // same Manager within the same week never re-fetches.
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set())
  const [drillDowns, setDrillDowns] = useState<Record<string, DrillDownState>>({})

  useEffect(() => {
    let active = true
    setLoadState('loading')
    setExpandedIds(new Set())
    setDrillDowns({})

    fetchManagerRepOverview(weekStartDate)
      .then((result) => {
        if (!active) return
        setRows(result)
        setLoadState('ready')
      })
      .catch(() => {
        if (!active) return
        setLoadState('error')
      })

    return () => {
      active = false
    }
  }, [weekStartDate])

  function toggleExpanded(row: ManagerRepOverviewRow) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(row.managerId)) {
        next.delete(row.managerId)
      } else {
        next.add(row.managerId)
      }
      return next
    })

    if (drillDowns[row.managerId]) return

    setDrillDowns((prev) => ({ ...prev, [row.managerId]: { loadState: 'loading', rows: [] } }))
    fetchManagerRepDrillDown(row.managerId, weekStartDate)
      .then((result) => {
        setDrillDowns((prev) => ({ ...prev, [row.managerId]: { loadState: 'ready', rows: result } }))
      })
      .catch(() => {
        setDrillDowns((prev) => ({ ...prev, [row.managerId]: { loadState: 'error', rows: [] } }))
      })
  }

  // Real totals, folded from the same rows already fetched above — never a
  // second query, never a hardcoded mockup figure.
  const totals = rows.reduce(
    (acc, row) => {
      acc.assigned += row.assignedCount
      acc.submitted += row.submittedCount
      acc.draft += row.draftCount
      acc.missing += row.missingCount
      return acc
    },
    { assigned: 0, submitted: 0, draft: 0, missing: 0 },
  )
  const overallCompletionPct = totals.assigned > 0 ? Math.round((totals.submitted / totals.assigned) * 100) : 0

  // Manager-level filter: "show managers who currently have at least one
  // rep in this bucket" — the only sensible reading of a per-status filter
  // over a list whose entries are Managers, not individual reps.
  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return rows.filter((row) => {
      if (statusFilter !== 'all') {
        const bucketCount = statusFilter === 'submitted' ? row.submittedCount : statusFilter === 'draft' ? row.draftCount : row.missingCount
        if (bucketCount === 0) return false
      }
      if (!query) return true
      return (row.managerName ?? '').toLowerCase().includes(query) || row.managerEmail.toLowerCase().includes(query)
    })
  }, [rows, searchQuery, statusFilter])

  return (
    <div className="amro-card">
      <h2>Sales Rep Reporting</h2>
      <p className="amro-subtitle">Week of {weekLabel}</p>

      {loadState === 'loading' && <p className="amro-loading">Loading…</p>}

      {loadState === 'error' && <p className="amro-empty">Could not load Sales Rep reporting. Please try again.</p>}

      {loadState === 'ready' && rows.length === 0 && <p className="amro-empty">No real Managers found.</p>}

      {loadState === 'ready' && rows.length > 0 && (
        <>
          <div className="amro-summary-row">
            <div className="amro-summary-card">
              <span className="amro-summary-value">{totals.assigned}</span>
              <span className="amro-summary-label">Assigned</span>
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
            <div className="amro-filter-row">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={`amro-filter-btn ${statusFilter === f.key ? 'active' : ''}`}
                  onClick={() => setStatusFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {filteredRows.length === 0 ? (
            <p className="amro-empty">No Managers match your search or filter.</p>
          ) : (
            <ul className="amro-manager-list" aria-label="Sales Rep reporting by Manager">
              {filteredRows.map((row) => {
                const managerName = row.managerName ?? 'Unnamed Manager'
                const isExpanded = expandedIds.has(row.managerId)
                const panelId = `amro-panel-${row.managerId}`
                const pct = completionPctOf(row)
                const submittedPct = row.assignedCount > 0 ? (row.submittedCount / row.assignedCount) * 100 : 0
                const draftPct = row.assignedCount > 0 ? (row.draftCount / row.assignedCount) * 100 : 0
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

                    <div className="amro-progress-track" role="presentation">
                      <span className="amro-progress-segment amro-progress-submitted" style={{ width: `${submittedPct}%` }} />
                      <span className="amro-progress-segment amro-progress-draft" style={{ width: `${draftPct}%` }} />
                    </div>
                    <p className="amro-progress-caption">
                      {row.submittedCount} submitted · {row.draftCount} in progress · {row.missingCount} missing
                    </p>

                    {isExpanded && (
                      <div id={panelId} role="region" aria-label={`${managerName}'s assigned Sales Reps`} className="amro-expanded">
                        {!drillDown || drillDown.loadState === 'loading' ? (
                          <p className="amro-loading">Loading…</p>
                        ) : drillDown.loadState === 'error' ? (
                          <p className="amro-empty">Could not load this Manager&apos;s Sales Reps. Please try again.</p>
                        ) : drillDown.rows.length === 0 ? (
                          <p className="amro-empty">No Sales Reps currently assigned to this Manager.</p>
                        ) : (
                          <ul className="amro-rep-list">
                            {drillDown.rows.map((rep) => {
                              const repName = rep.fullName ?? 'Unnamed Rep'
                              return (
                                <li key={rep.repId} className="amro-rep-row">
                                  <span className="amro-cell-person">
                                    <span className="amro-avatar amro-avatar-sm" aria-hidden="true">
                                      {getInitials(repName)}
                                    </span>
                                    <span className="amro-person-info">
                                      <span className="amro-person-name">{repName}</span>
                                      <span className={`amro-person-email ${rep.email ? '' : 'amro-person-email-missing'}`}>
                                        {rep.email || 'Email not available'}
                                      </span>
                                    </span>
                                  </span>
                                  <span className={`amro-status-badge amro-status-${rep.bucket}`}>{BUCKET_LABELS[rep.bucket]}</span>
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
