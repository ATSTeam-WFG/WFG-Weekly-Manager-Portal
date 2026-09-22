import { useState } from 'react'
import type { ReportStatus } from '../types'
import StatusBadge from './StatusBadge'
import './ManagerReportsTable.css'

export interface ManagerReportRow {
  managerId: string
  managerName: string
  status: ReportStatus
}

type StatusFilter = 'all' | ReportStatus

const STATUS_FILTER_OPTIONS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All Statuses' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'draft', label: 'Draft' },
  { key: 'not_started', label: 'Not Started' },
]

// Default compact row count on screen — never a hardcoded manager count,
// only ever a cap on how many of the (dynamically-sized) filtered rows are
// shown at once. Search/status filtering always operate over the complete
// `rows` array passed in below, and bypass this cap entirely while active.
const COMPACT_ROW_LIMIT = 8

interface ManagerReportsTableProps {
  rows: ManagerReportRow[]
  // Renders a manager's report content on demand — only called for the
  // single currently-expanded row, so the parent never has to pre-render
  // every manager's full content just for this on-screen table. Returns
  // null while nothing is available to show (e.g. no submission yet).
  renderReportContent: (managerId: string) => React.ReactNode
}

// Compact, searchable replacement for the old always-expanded manager
// report blocks — one row per manager (Manager | Status | Action), with a
// single row's content expandable in place rather than navigating away.
// Never fetches anything itself — `rows` and `renderReportContent` are
// entirely derived from data the page already has.
export default function ManagerReportsTable({ rows, renderReportContent }: ManagerReportsTableProps) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [expandedManagerId, setExpandedManagerId] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  // Always computed over the COMPLETE `rows` array — never over an
  // already-capped subset — so search/status filtering can never miss a
  // manager just because they'd otherwise fall past the compact row limit.
  const filteredRows = rows.filter((row) => {
    if (statusFilter !== 'all' && row.status !== statusFilter) return false
    if (search.trim().length === 0) return true
    return row.managerName.toLowerCase().includes(search.trim().toLowerCase())
  })

  // While actively searching/filtering, the compact cap is bypassed
  // entirely — every match is shown, never artificially limited to 8.
  const isFiltering = search.trim().length > 0 || statusFilter !== 'all'
  const visibleRows = isFiltering || showAll ? filteredRows : filteredRows.slice(0, COMPACT_ROW_LIMIT)
  const hasMoreThanCompactLimit = !isFiltering && filteredRows.length > COMPACT_ROW_LIMIT

  const handleToggleRow = (managerId: string) => {
    setExpandedManagerId((prev) => (prev === managerId ? null : managerId))
  }

  // The entire interactive table is a screen-only convenience — printing
  // always uses the separate, always-in-DOM print-content block the parent
  // page renders alongside this (see ReportsAnalytics.tsx's
  // `ra-print-report-content`), which shows every selected manager's full
  // content regardless of this table's search/filter/expand state.
  return (
    <div className="ra-manager-table-wrap no-print">
      <div className="ra-manager-table-controls">
        <input
          type="search"
          className="ra-manager-search"
          placeholder="Search managers…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search managers"
        />
        <select
          className="ra-manager-status-filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          aria-label="Filter by status"
        >
          {STATUS_FILTER_OPTIONS.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {filteredRows.length === 0 ? (
        <div className="admin-empty-state">No managers match this search/filter.</div>
      ) : (
        <>
          <div className="ra-manager-table" role="table">
            <div className="ra-manager-table-header" role="row">
              <span role="columnheader">Manager</span>
              <span role="columnheader">Status</span>
              <span role="columnheader">Action</span>
            </div>
            {visibleRows.map((row) => {
              const isExpanded = expandedManagerId === row.managerId
              return (
                <div className="ra-manager-table-row-group" key={row.managerId}>
                  <div className="ra-manager-table-row" role="row">
                    <span className="ra-manager-table-name" role="cell">
                      {row.managerName}
                    </span>
                    <span role="cell">
                      <StatusBadge status={row.status} />
                    </span>
                    <span role="cell">
                      <button type="button" className="ra-manager-view-btn" onClick={() => handleToggleRow(row.managerId)}>
                        {isExpanded ? 'Hide Report' : 'View Report'}
                      </button>
                    </span>
                  </div>
                  {isExpanded && (
                    <div className="ra-manager-table-expanded">{renderReportContent(row.managerId)}</div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Only relevant when nothing is being searched/filtered — the cap
              itself is bypassed entirely while isFiltering is true, so
              there is nothing to toggle in that state. */}
          {!isFiltering && (hasMoreThanCompactLimit || showAll) && (
            <div className="ra-manager-table-toggle-row">
              {showAll ? (
                <button type="button" className="ra-manager-table-toggle" onClick={() => setShowAll(false)}>
                  Show fewer &uarr;
                </button>
              ) : (
                <button type="button" className="ra-manager-table-toggle" onClick={() => setShowAll(true)}>
                  View all {filteredRows.length} managers &darr;
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
