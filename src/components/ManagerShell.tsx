import { useState } from 'react'
import Dashboard from './Dashboard'
import MyReps from './MyReps'
import ManagerDashboardOverview from './ManagerDashboardOverview'
import ManagerReportHistoryPage from './ManagerReportHistoryPage'
import type { ManagerReportHistoryEntry } from '../lib/reportsService'
import type { ReportStatus } from '../types'
import './ManagerShell.css'

type ManagerDestination = 'dashboard' | 'my-reports' | 'team-reports' | 'report-history'

const NAV_ITEMS: { key: ManagerDestination; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'my-reports', label: 'My Reports' },
  { key: 'team-reports', label: 'Team Reports' },
  { key: 'report-history', label: 'Report History' },
]

interface ManagerShellProps {
  managerId: string
  status: ReportStatus
  statusLoaded: boolean
  statusLoadError: boolean
  reminderDismissed: boolean
  onDismissReminder: () => void
  onStart: () => void
  onContinue: () => void
  onEditSubmitted: () => void
  onViewHistoryEntry: (entry: ManagerReportHistoryEntry) => void
}

// A plain Manager's whole browsing experience (role === 'manager') — only
// ever rendered while App.tsx's view state is 'dashboard'; starting,
// continuing, or editing a report, or opening a history entry, still
// unmounts this (via the same onStart/onContinue/onEditSubmitted/
// onViewHistoryEntry handlers App.tsx already owned) in favor of the
// existing full-screen ReportForm/SubmittedReport/HistoricalReportView flow,
// exactly as before this redesign — only the browsing/idle state changed.
// My Reports and Team Reports reuse the existing, unmodified Dashboard.tsx
// and MyReps.tsx components as-is (Dashboard.tsx is shared with Admin/Sales
// Admin's own "My Reports" views and is deliberately left untouched).
export default function ManagerShell({
  managerId,
  status,
  statusLoaded,
  statusLoadError,
  reminderDismissed,
  onDismissReminder,
  onStart,
  onContinue,
  onEditSubmitted,
  onViewHistoryEntry,
}: ManagerShellProps) {
  const [destination, setDestination] = useState<ManagerDestination>('dashboard')

  return (
    <div className="manager-shell">
      <nav className="manager-shell-nav" aria-label="Manager Dashboard">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`manager-shell-nav-item${destination === item.key ? ' manager-shell-nav-item-active' : ''}`}
            onClick={() => setDestination(item.key)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="manager-shell-content">
        {destination === 'dashboard' ? (
          <ManagerDashboardOverview managerId={managerId} />
        ) : destination === 'my-reports' ? (
          <Dashboard
            status={status}
            managerId={managerId}
            statusLoaded={statusLoaded}
            statusLoadError={statusLoadError}
            reminderDismissed={reminderDismissed}
            onDismissReminder={onDismissReminder}
            onStart={onStart}
            onContinue={onContinue}
            onEditSubmitted={onEditSubmitted}
            onViewHistoryEntry={onViewHistoryEntry}
          />
        ) : destination === 'team-reports' ? (
          <MyReps managerId={managerId} onBack={() => setDestination('dashboard')} />
        ) : (
          <ManagerReportHistoryPage managerId={managerId} onViewHistoryEntry={onViewHistoryEntry} />
        )}
      </div>
    </div>
  )
}
