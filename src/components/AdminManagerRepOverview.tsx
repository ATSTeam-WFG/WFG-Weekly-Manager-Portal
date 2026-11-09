import { useEffect, useState } from 'react'
import {
  fetchManagerRepOverview,
  fetchManagerRepDrillDown,
  type ManagerRepOverviewRow,
  type ManagerRepDrillDownRow,
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
interface AdminManagerRepOverviewProps {
  weekStartDate: string
  weekLabel: string
}

const BUCKET_LABELS: Record<ManagerRepDrillDownRow['bucket'], string> = {
  missing: 'Missing',
  pending: 'Pending Review',
  approved: 'Approved',
  rejected: 'Needs Correction',
}

export default function AdminManagerRepOverview({ weekStartDate, weekLabel }: AdminManagerRepOverviewProps) {
  const [rows, setRows] = useState<ManagerRepOverviewRow[]>([])
  const [loading, setLoading] = useState(true)

  const [selected, setSelected] = useState<ManagerRepOverviewRow | null>(null)
  const [drillDown, setDrillDown] = useState<ManagerRepDrillDownRow[]>([])
  const [drillDownLoading, setDrillDownLoading] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setSelected(null)

    fetchManagerRepOverview(weekStartDate).then((result) => {
      if (!active) return
      setRows(result)
      setLoading(false)
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
    setDrillDownLoading(true)

    fetchManagerRepDrillDown(selected.managerId, weekStartDate).then((result) => {
      if (!active) return
      setDrillDown(result)
      setDrillDownLoading(false)
    })

    return () => {
      active = false
    }
  }, [selected, weekStartDate])

  if (selected) {
    const managerName = selected.managerName ?? 'Unnamed Manager'
    return (
      <div className="amro-card">
        <button type="button" className="link-btn back-link" onClick={() => setSelected(null)}>
          ← Back to Sales Rep Reporting by Manager
        </button>
        <h2>{managerName}&apos;s Sales Reps</h2>
        <p className="amro-subtitle">Week of {weekLabel}</p>

        {drillDownLoading ? (
          <p className="amro-loading">Loading…</p>
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

      {loading ? (
        <p className="amro-loading">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="amro-empty">No real Managers found.</p>
      ) : (
        <div className="amro-table amro-table-overview" role="table" aria-label="Sales Rep reporting by Manager">
          <div className="amro-table-header-row amro-table-header-row-overview" role="row">
            <span role="columnheader">Manager</span>
            <span role="columnheader">Assigned Reps</span>
            <span role="columnheader">Submitted</span>
            <span role="columnheader">Pending</span>
            <span role="columnheader">Approved</span>
            <span role="columnheader">Needs Correction</span>
            <span role="columnheader">Missing</span>
          </div>
          {rows.map((row) => {
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
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
