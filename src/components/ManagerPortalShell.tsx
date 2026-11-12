import type { ReactNode } from 'react'
import './ManagerPortalShell.css'

export type ManagerDestination = 'dashboard' | 'my-sales-reps' | 'sales-rep-reports'

interface ManagerPortalShellProps {
  current: ManagerDestination
  onNavigate: (destination: ManagerDestination) => void
  dashboard: ReactNode
  mySalesReps: ReactNode
  salesRepReports: ReactNode
}

const DESTINATIONS: { key: ManagerDestination; label: string }[] = [
  { key: 'dashboard', label: 'Manager Dashboard' },
  { key: 'my-sales-reps', label: 'My Sales Reps' },
  { key: 'sales-rep-reports', label: 'Sales Rep Reports' },
]

export default function ManagerPortalShell({ current, onNavigate, dashboard, mySalesReps, salesRepReports }: ManagerPortalShellProps) {
  const panels: Record<ManagerDestination, ReactNode> = {
    dashboard,
    'my-sales-reps': mySalesReps,
    'sales-rep-reports': salesRepReports,
  }

  return (
    <div className="manager-portal-shell">
      <nav className="manager-portal-tabs" role="tablist" aria-label="Manager portal">
        {DESTINATIONS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`manager-tab-${key}`}
            aria-controls={`manager-panel-${key}`}
            aria-selected={current === key}
            className={`manager-portal-tab${current === key ? ' manager-portal-tab-active' : ''}`}
            onClick={() => onNavigate(key)}
          >
            {label}
          </button>
        ))}
      </nav>
      {DESTINATIONS.map(({ key }) => (
        <section
          key={key}
          id={`manager-panel-${key}`}
          className="manager-portal-panel"
          role="tabpanel"
          aria-labelledby={`manager-tab-${key}`}
          tabIndex={0}
          hidden={current !== key}
        >
          {panels[key]}
        </section>
      ))}
    </div>
  )
}
