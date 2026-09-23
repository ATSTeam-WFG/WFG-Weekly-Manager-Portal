import { useState, type ReactNode } from 'react'
import AdminSidebar, { type AdminDestination } from './AdminSidebar'
import './AdminShell.css'

export type { AdminDestination }

interface AdminShellProps {
  current: AdminDestination
  onNavigateDashboard: () => void
  onNavigateUserManagement: () => void
  onNavigateReportsAnalytics: () => void
  onNavigateWeeklySummary: () => void
  children: ReactNode
}

// Purely a layout wrapper — App.tsx remains the sole owner of which of the
// four admin destinations is showing (weeklySummaryOpen/reportsAnalyticsOpen/
// userManagementOpen, else Admin Dashboard) and of `children` itself, which
// is exactly the same element App.tsx already rendered before this shell
// existed. The only state this component owns is whether the off-canvas
// mobile nav is open — a pure UI concern, never a second navigation model.
export default function AdminShell({
  current,
  onNavigateDashboard,
  onNavigateUserManagement,
  onNavigateReportsAnalytics,
  onNavigateWeeklySummary,
  children,
}: AdminShellProps) {
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false)

  // Every navigation click also closes the mobile off-canvas panel, so
  // choosing a destination on a phone/tablet doesn't leave it open over the
  // newly-selected page.
  const handleNavigate = (action: () => void) => {
    action()
    setIsMobileNavOpen(false)
  }

  return (
    <div className="admin-shell">
      <button
        type="button"
        className="admin-shell-menu-btn"
        onClick={() => setIsMobileNavOpen(true)}
        aria-label="Open navigation menu"
      >
        <span aria-hidden="true">&#9776;</span> Menu
      </button>

      {isMobileNavOpen && <div className="admin-shell-scrim" onClick={() => setIsMobileNavOpen(false)} />}

      <div className={`admin-shell-sidebar-wrap ${isMobileNavOpen ? 'admin-shell-sidebar-wrap-open' : ''}`}>
        <AdminSidebar
          current={current}
          onNavigateDashboard={() => handleNavigate(onNavigateDashboard)}
          onNavigateUserManagement={() => handleNavigate(onNavigateUserManagement)}
          onNavigateReportsAnalytics={() => handleNavigate(onNavigateReportsAnalytics)}
          onNavigateWeeklySummary={() => handleNavigate(onNavigateWeeklySummary)}
        />
      </div>

      <div className="admin-shell-content">{children}</div>
    </div>
  )
}
