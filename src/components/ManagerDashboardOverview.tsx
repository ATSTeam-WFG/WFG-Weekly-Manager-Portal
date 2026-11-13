import { useEffect, useState } from 'react'
import { fetchManagerOverview, type ManagerOverviewCounts } from '../lib/managerOverviewService'
import { getCurrentReportingWeek } from '../utils/week'
import ManagerWeeklyReportCard from './ManagerWeeklyReportCard'
import TeamStatusBar from './TeamStatusBar'
import MyReps from './MyReps'
import type { ReportStatus } from '../types'
import './ManagerDashboardOverview.css'

interface ManagerDashboardOverviewProps {
  managerId: string
  status: ReportStatus
  statusLoaded: boolean
  statusLoadError: boolean
  onStart: () => void
  onContinue: () => void
  onEditSubmitted: () => void
}

type LoadState = 'loading' | 'error' | 'ready'

function AssignedRepsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3" />
      <path d="M4 20c0-3 2.5-5 5-5s5 2 5 5" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M15.5 20c0-2.5 1-4 3-4.5" />
    </svg>
  )
}

function SubmittedIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 13l4 4L19 7" />
    </svg>
  )
}

function PendingIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  )
}

function NeedsCorrectionIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 9v4" />
      <path d="M12 16.5h.01" />
      <path d="M10.3 3.9L2.5 17.5c-.6 1 .1 2.3 1.3 2.3h16.4c1.2 0 1.9-1.3 1.3-2.3L13.7 3.9c-.6-1-2-1-2.6 0z" />
    </svg>
  )
}

// The Manager Dashboard's landing destination — everything on one page per
// the approved mockup: KPI overview, the Manager's own weekly report, a
// visual team-status summary, and the full Assigned Sales Reps roster
// (search/filter/review). Reuses fetchManagerOverview for the KPI/status
// data (the same fetchMyCurrentReps + fetchRepReport + deriveRepReportBucket
// building blocks MyReps.tsx's own summary row already relies on) and embeds
// MyReps itself (embedded mode) for the roster table, so the review/
// permission logic lives in exactly one place, never duplicated.
export default function ManagerDashboardOverview({
  managerId,
  status,
  statusLoaded,
  statusLoadError,
  onStart,
  onContinue,
  onEditSubmitted,
}: ManagerDashboardOverviewProps) {
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [counts, setCounts] = useState<ManagerOverviewCounts | null>(null)

  useEffect(() => {
    let active = true
    setLoadState('loading')
    const week = getCurrentReportingWeek()

    fetchManagerOverview(managerId, week.weekStartDate)
      .then((data) => {
        if (!active) return
        setCounts(data.counts)
        setLoadState('ready')
      })
      .catch(() => {
        if (!active) return
        setLoadState('error')
      })

    return () => {
      active = false
    }
  }, [managerId])

  return (
    <div className="mdo-page">
      <div className="mdo-header-titles">
        <h1>Dashboard</h1>
        <p className="mdo-header-subtitle">Your team's reporting status at a glance.</p>
      </div>

      {loadState === 'loading' && <div className="mdo-loading">Loading your team's status…</div>}

      {loadState === 'error' && <p className="mdo-error-state">Could not load your team's status. Please try again.</p>}

      {loadState === 'ready' && counts && (
        <>
          <div className="mdo-kpi-row">
            <div className="mdo-kpi-card mdo-kpi-card-total">
              <span className="mdo-kpi-icon" aria-hidden="true">
                <AssignedRepsIcon />
              </span>
              <div className="mdo-kpi-text">
                <span className="mdo-kpi-value">{counts.totalAssigned}</span>
                <span className="mdo-kpi-label">Assigned Sales Reps</span>
              </div>
            </div>
            <div className="mdo-kpi-card mdo-kpi-card-submitted">
              <span className="mdo-kpi-icon" aria-hidden="true">
                <SubmittedIcon />
              </span>
              <div className="mdo-kpi-text">
                <span className="mdo-kpi-value">{counts.submitted}</span>
                <span className="mdo-kpi-label">Submitted</span>
              </div>
            </div>
            <div className="mdo-kpi-card mdo-kpi-card-pending">
              <span className="mdo-kpi-icon" aria-hidden="true">
                <PendingIcon />
              </span>
              <div className="mdo-kpi-text">
                <span className="mdo-kpi-value">{counts.pending}</span>
                <span className="mdo-kpi-label">Pending</span>
              </div>
            </div>
            <div className="mdo-kpi-card mdo-kpi-card-rejected">
              <span className="mdo-kpi-icon" aria-hidden="true">
                <NeedsCorrectionIcon />
              </span>
              <div className="mdo-kpi-text">
                <span className="mdo-kpi-value">{counts.rejected}</span>
                <span className="mdo-kpi-label">Needs Correction</span>
              </div>
            </div>
          </div>

          <ManagerWeeklyReportCard
            status={status}
            statusLoaded={statusLoaded}
            statusLoadError={statusLoadError}
            onStart={onStart}
            onContinue={onContinue}
            onEditSubmitted={onEditSubmitted}
          />

          <TeamStatusBar counts={counts} />

          <MyReps managerId={managerId} onBack={() => {}} embedded />
        </>
      )}
    </div>
  )
}
