import { useState, type ReactNode } from 'react'
import Dashboard from './Dashboard'
import MyReps from './MyReps'
import ManagerDashboardOverview from './ManagerDashboardOverview'
import ManagerReportHistoryPage from './ManagerReportHistoryPage'
import type { ManagerReportHistoryEntry } from '../lib/reportsService'
import type { ReportStatus } from '../types'
import './ManagerShell.css'

type ManagerDestination = 'dashboard' | 'my-reports' | 'team-reports' | 'report-history'

// Same restrained icon style/viewBox conventions as AdminSidebar.tsx's own
// icon set (reused here rather than inventing a new visual system) — a
// fresh, small set of glyphs since this sidebar's four destinations don't
// map onto AdminSidebar's own six.
function DashboardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  )
}

function DocumentIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M9 12h6" />
      <path d="M9 16h6" />
      <path d="M9 8h3" />
    </svg>
  )
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3" />
      <path d="M4 20c0-3 2.5-5 5-5s5 2 5 5" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M15.5 20c0-2.5 1-4 3-4.5" />
    </svg>
  )
}

function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
      <path d="M3 12a9 9 0 0 1 3-6.7" />
    </svg>
  )
}

const NAV_ITEMS: { key: ManagerDestination; label: string; icon: ReactNode }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: <DashboardIcon /> },
  { key: 'my-reports', label: 'My Reports', icon: <DocumentIcon /> },
  { key: 'team-reports', label: 'Team Reports', icon: <UsersIcon /> },
  { key: 'report-history', label: 'Report History', icon: <HistoryIcon /> },
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
            aria-current={destination === item.key ? 'page' : undefined}
          >
            <span className="manager-shell-nav-icon" aria-hidden="true">
              {item.icon}
            </span>
            <span className="manager-shell-nav-label">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="manager-shell-content">
        {destination === 'dashboard' ? (
          <ManagerDashboardOverview
            managerId={managerId}
            status={status}
            statusLoaded={statusLoaded}
            statusLoadError={statusLoadError}
            onStart={onStart}
            onContinue={onContinue}
            onEditSubmitted={onEditSubmitted}
          />
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
