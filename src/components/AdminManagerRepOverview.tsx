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
// 2026-11-13 enhancement — summary cards, search/filter, and a Completion %
// column were added here, in the component only: fetchManagerRepOverview/
// fetchManagerRepDrillDown (adminRepVisibilityService.ts) are completely
// unchanged, so the one real counting/permission logic this whole feature
// depends on is never duplicated or re-derived. Summary totals and
// Completion % are folded from the SAME rows this component already
// fetched — never a second query, never hardcoded. Search/filter are local,
// client-side state, independent of the weekStartDate/weekLabel props, so
// changing weeks (driven entirely by AdminDashboard's own nav, outside this
// component) never resets them.
interface AdminManagerRepOverviewProps {
  weekStartDate: string
  weekLabel: string
}

type LoadState = 'loading' | 'error' | 'ready'
type StatusFilter = 'all' | RepReportBucket

const BUCKET_LABELS: Record<ManagerRepDrillDownRow['bucket'], string> = {
  missing: 'Missing',
  pending: 'Pending Review',
  approved: 'Approved',
  rejected: 'Needs Correction',
}

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending Review' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Needs Correction' },
  { key: 'missing', label: 'Missing' },
]

function completionPctOf(row: ManagerRepOverviewRow): number {
  return row.assignedCount > 0 ? Math.round((row.submittedCount / row.assignedCount) * 100) : 0
}

export default function AdminManagerRepOverview({ weekStartDate, weekLabel }: AdminManagerRepOverviewProps) {
  const [rows, setRows] = useState<ManagerRepOverviewRow[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')

  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const [selected, setSelected] = useState<ManagerRepOverviewRow | null>(null)
  const [drillDown, setDrillDown] = useState<ManagerRepDrillDownRow[]>([])
  const [drillDownLoadState, setDrillDownLoadState] = useState<LoadState>('loading')

  useEffect(() => {
    let active = true
    setLoadState('loading')
    setSelected(null)

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

  useEffect(() => {
    if (!selected) {
      setDrillDown([])
      return
    }
    let active = true
    setDrillDownLoadState('loading')

    fetchManagerRepDrillDown(selected.managerId, weekStartDate)
      .then((result) => {
        if (!active) return
        setDrillDown(result)
        setDrillDownLoadState('ready')
      })
      .catch(() => {
        if (!active) return
        setDrillDownLoadState('error')
      })

    return () => {
      active = false
    }
  }, [selected, weekStartDate])

  // Real totals, folded from the same rows already fetched above — never a
  // second query, never a hardcoded mockup figure.
  const totals = rows.reduce(
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

  // Manager-level filter: "show managers who currently have at least one
  // rep in this bucket" — the only sensible reading of a per-status filter
  // over a table whose rows are Managers, not individual reps.
  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return rows.filter((row) => {
      if (statusFilter !== 'all') {
        const bucketCount =
          statusFilter === 'pending' ? row.pendingCount : statusFilter === 'approved' ? row.approvedCount : statusFilter === 'rejected' ? row.rejectedCount : row.missingCount
        if (bucketCount === 0) return false
      }
      if (!query) return true
      return (row.managerName ?? '').toLowerCase().includes(query) || row.managerEmail.toLowerCase().includes(query)
    })
  }, [rows, searchQuery, statusFilter])

  if (selected) {
    const managerName = selected.managerName ?? 'Unnamed Manager'
    return (
      <div className="amro-card">
        <button type="button" className="link-btn back-link" onClick={() => setSelected(null)}>
          ← Back to Sales Rep Reporting by Manager
        </button>
        <h2>{managerName}&apos;s Sales Reps</h2>
        <p className="amro-subtitle">Week of {weekLabel}</p>

        {drillDownLoadState === 'loading' ? (
          <p className="amro-loading">Loading…</p>
        ) : drillDownLoadState === 'error' ? (
          <p className="amro-empty">Could not load this Manager&apos;s Sales Reps. Please try again.</p>
        ) : drillDown.length === 0 ? (
          <p className="amro-empty">No Sales Reps currently assigned to this Manager.</p>
        ) : (
          <div className="amro-table" role="table" aria-label={`${managerName}'s assigned Sales Reps`}>
            <div className="amro-table-header-row" role="row">
              <span role="columnheader">Sales Rep</span>
              <span role="columnheader">Status</span>
            </div>
            {drillDown.map((rep) => {
              const repName = rep.fullName ?? 'Unnamed Rep'
              return (
                <div key={rep.repId} className="amro-row" role="row">
                  <div className="amro-cell amro-cell-person" role="cell">
                    <span className="amro-avatar" aria-hidden="true">
                      {getInitials(repName)}
                    </span>
                    <div className="amro-person-info">
                      <span className="amro-person-name">{repName}</span>
                      <span className={`amro-person-email ${rep.email ? '' : 'amro-person-email-missing'}`}>
                        {rep.email || 'Email not available'}
                      </span>
                    </div>
                  </div>
                  <div className="amro-cell" role="cell">
                    <span className={`amro-status-badge amro-status-${rep.bucket}`}>{BUCKET_LABELS[rep.bucket]}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="amro-card">
      <h2>Sales Rep Reporting by Manager</h2>
      <p className="amro-subtitle">Week of {weekLabel}</p>

      {loadState === 'loading' && <p className="amro-loading">Loading…</p>}

      {loadState === 'error' && <p className="amro-empty">Could not load Sales Rep reporting by Manager. Please try again.</p>}

      {loadState === 'ready' && rows.length === 0 && <p className="amro-empty">No real Managers found.</p>}

      {loadState === 'ready' && rows.length > 0 && (
        <>
          <div className="amro-summary-row">
            <div className="amro-summary-card">
              <span className="amro-summary-value">{totals.assigned}</span>
              <span className="amro-summary-label">Total Assigned</span>
            </div>
            <div className="amro-summary-card">
              <span className="amro-summary-value">{totals.submitted}</span>
              <span className="amro-summary-label">Submitted</span>
            </div>
            <div className="amro-summary-card">
              <span className="amro-summary-value">{totals.pending}</span>
              <span className="amro-summary-label">Pending Review</span>
            </div>
            <div className="amro-summary-card">
              <span className="amro-summary-value">{totals.approved}</span>
              <span className="amro-summary-label">Approved</span>
            </div>
            <div className="amro-summary-card">
              <span className="amro-summary-value">{totals.rejected}</span>
              <span className="amro-summary-label">Needs Correction</span>
            </div>
            <div className="amro-summary-card">
              <span className="amro-summary-value">{totals.missing}</span>
              <span className="amro-summary-label">Missing</span>
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
            <div className="amro-table-scroll">
              <div className="amro-table amro-table-overview" role="table" aria-label="Sales Rep reporting by Manager">
                <div className="amro-table-header-row amro-table-header-row-overview" role="row">
                  <span role="columnheader">Manager</span>
                  <span role="columnheader">Assigned Reps</span>
                  <span role="columnheader">Submitted</span>
                  <span role="columnheader">Pending</span>
                  <span role="columnheader">Approved</span>
                  <span role="columnheader">Needs Correction</span>
                  <span role="columnheader">Missing</span>
                  <span role="columnheader">Completion</span>
                </div>
                {filteredRows.map((row) => {
                  const managerName = row.managerName ?? 'Unnamed Manager'
                  return (
                    <div
                      key={row.managerId}
                      className="amro-row amro-row-overview amro-row-clickable"
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelected(row)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') setSelected(row)
                      }}
                    >
                      <div className="amro-cell amro-cell-person" role="cell">
                        <span className="amro-avatar" aria-hidden="true">
                          {getInitials(managerName)}
                        </span>
                        <div className="amro-person-info">
                          <span className="amro-person-name">{managerName}</span>
                          <span className="amro-person-email">{row.managerEmail}</span>
                        </div>
                      </div>
                      <div className="amro-cell amro-cell-count" role="cell" data-label="Assigned Reps">
                        {row.assignedCount}
                      </div>
                      <div className="amro-cell amro-cell-count" role="cell" data-label="Submitted">
                        {row.submittedCount}
                      </div>
                      <div className="amro-cell amro-cell-count" role="cell" data-label="Pending">
                        {row.pendingCount}
                      </div>
                      <div className="amro-cell amro-cell-count" role="cell" data-label="Approved">
                        {row.approvedCount}
                      </div>
                      <div className="amro-cell amro-cell-count" role="cell" data-label="Needs Correction">
                        {row.rejectedCount}
                      </div>
                      <div className="amro-cell amro-cell-count" role="cell" data-label="Missing">
                        {row.missingCount}
                      </div>
                      <div className="amro-cell amro-cell-count" role="cell" data-label="Completion">
                        {completionPctOf(row)}%
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
