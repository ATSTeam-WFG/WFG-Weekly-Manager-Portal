import { useEffect, useState } from 'react'
import StatusBadge from './StatusBadge'
import { fetchReportHistory, type ManagerReportHistoryEntry } from '../lib/reportsService'
import { getCurrentReportingWeek } from '../utils/week'
import './Dashboard.css'

interface ManagerReportHistoryPageProps {
  managerId: string
  onViewHistoryEntry: (entry: ManagerReportHistoryEntry) => void
}

type LoadState = 'loading' | 'ready'

// A standalone "Report History" nav destination — the same past-weeks list
// Dashboard.tsx already embeds inline (both call fetchReportHistory with
// the same beforeWeekStartDate = the current week, so the two never
// disagree), reusing Dashboard.css's existing .history-card/.history-list
// classes rather than inventing new ones. Dashboard.tsx itself is shared by
// Admin-as-submitter and Sales Admin's My Reports and is intentionally left
// untouched — this is a new, separate component, not an extraction of it.
export default function ManagerReportHistoryPage({ managerId, onViewHistoryEntry }: ManagerReportHistoryPageProps) {
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [history, setHistory] = useState<ManagerReportHistoryEntry[]>([])
  const week = getCurrentReportingWeek()

  useEffect(() => {
    let active = true
    setLoadState('loading')

    fetchReportHistory(managerId, week.weekStartDate).then((result) => {
      if (!active) return
      setHistory(result)
      setLoadState('ready')
    })

    return () => {
      active = false
    }
  }, [managerId, week.weekStartDate])

  return (
    <div className="dashboard-page">
      <div className="md-page-heading">
        <div className="md-page-heading-text">
          <h1>Report History</h1>
          <p className="md-page-subtitle">Your previously submitted weekly reports</p>
        </div>
      </div>

      <div className="history-card">
        {loadState === 'loading' ? (
          <p className="history-empty">Loading…</p>
        ) : history.length === 0 ? (
          <p className="history-empty">No previous reports yet.</p>
        ) : (
          <ul className="history-list">
            {history.map((entry) => (
              <li
                key={entry.weekStartDate}
                className="history-row"
                role="button"
                tabIndex={0}
                onClick={() => onViewHistoryEntry(entry)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onViewHistoryEntry(entry)
                }}
              >
                <span className="history-week">{entry.weekLabel}</span>
                <div className="history-row-right">
                  <StatusBadge status={entry.status} />
                  <span className="history-row-view" aria-hidden="true">
                    View
                    <svg className="history-row-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
