import { useEffect, useState } from 'react'
import { fetchManagerOverview, type ManagerOverviewCounts } from '../lib/managerOverviewService'
import { getCurrentReportingWeek } from '../utils/week'
import './ManagerDashboardOverview.css'

interface ManagerDashboardOverviewProps {
  managerId: string
}

type LoadState = 'loading' | 'error' | 'ready'

// The Manager Dashboard's landing destination — a glanceable KPI summary
// only (no table, no weekly-report action, no history): those live on their
// own dedicated nav destinations (My Reports / Team Reports / Report
// History respectively) so the same data is never shown twice on one
// screen. Reuses fetchManagerOverview (src/lib/managerOverviewService.ts),
// the same fetchMyCurrentReps + fetchRepReport + deriveRepReportBucket
// building blocks MyReps.tsx's own summary row already relies on — never a
// new query path, never a hardcoded count.
export default function ManagerDashboardOverview({ managerId }: ManagerDashboardOverviewProps) {
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
        <div className="mdo-kpi-row">
          <div className="mdo-kpi-card">
            <span className="mdo-kpi-value">{counts.totalAssigned}</span>
            <span className="mdo-kpi-label">Assigned Sales Reps</span>
          </div>
          <div className="mdo-kpi-card">
            <span className="mdo-kpi-value">{counts.submitted}</span>
            <span className="mdo-kpi-label">Submitted</span>
          </div>
          <div className="mdo-kpi-card">
            <span className="mdo-kpi-value">{counts.pending}</span>
            <span className="mdo-kpi-label">Pending</span>
          </div>
          <div className="mdo-kpi-card">
            <span className="mdo-kpi-value">{counts.rejected}</span>
            <span className="mdo-kpi-label">Needs Correction</span>
          </div>
        </div>
      )}
    </div>
  )
}
