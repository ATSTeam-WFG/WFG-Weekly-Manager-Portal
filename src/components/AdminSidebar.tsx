import type { ReactNode } from 'react'
import './AdminSidebar.css'

// The four (and only four) shared-shell destinations — ManagerReportView and
// the dual-role admin's own "My Weekly Report" view are deliberately NOT
// part of this union, since neither is ever reachable while this sidebar is
// showing (see App.tsx's render branching).
export type AdminDestination = 'dashboard' | 'user-management' | 'reports-analytics' | 'weekly-summary'

interface AdminSidebarProps {
  current: AdminDestination
  onNavigateDashboard: () => void
  onNavigateUserManagement: () => void
  onNavigateReportsAnalytics: () => void
  onNavigateWeeklySummary: () => void
}

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

// The same restrained "people" glyph already used for the Total
// Managers/Total Users KPI cards elsewhere in this app — reused here rather
// than inventing a new icon.
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

function ChartIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20V10" />
      <path d="M11 20V4" />
      <path d="M18 20v-7" />
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

// Purely decorative — an abstract layered-landscape treatment (CSS
// shapes/gradients only, no image asset or external dependency) plus the
// existing WFG brand copy. aria-hidden so it never appears to assistive
// technology, and CSS hides it entirely at short viewport heights and
// whenever the sidebar is in its off-canvas mobile/tablet mode (see
// AdminSidebar.css), so it can never crowd out or interfere with actual
// navigation.
function SidebarDecoration() {
  return (
    <div className="admin-sidebar-decoration" aria-hidden="true">
      <div className="admin-sidebar-landscape">
        <span className="admin-sidebar-hill admin-sidebar-hill-back" />
        <span className="admin-sidebar-hill admin-sidebar-hill-mid" />
        <span className="admin-sidebar-hill admin-sidebar-hill-front" />
      </div>
      <p className="admin-sidebar-decoration-words">
        People
        <br />
        Knowledge
        <br />
        Possibilities
      </p>
      <p className="admin-sidebar-decoration-tagline">Together We Close More</p>
    </div>
  )
}

// Presentational only — App.tsx remains the sole owner of navigation state
// (weeklySummaryOpen/reportsAnalyticsOpen/userManagementOpen). This
// component never introduces routing or a second navigation-state model; it
// only renders the four destinations and calls whichever handler its parent
// supplied.
export default function AdminSidebar({
  current,
  onNavigateDashboard,
  onNavigateUserManagement,
  onNavigateReportsAnalytics,
  onNavigateWeeklySummary,
}: AdminSidebarProps) {
  const items: { key: AdminDestination; label: string; onClick: () => void; icon: ReactNode }[] = [
    { key: 'dashboard', label: 'Admin Dashboard', onClick: onNavigateDashboard, icon: <DashboardIcon /> },
    { key: 'user-management', label: 'User Management', onClick: onNavigateUserManagement, icon: <UsersIcon /> },
    { key: 'reports-analytics', label: 'Reports & Analytics', onClick: onNavigateReportsAnalytics, icon: <ChartIcon /> },
    { key: 'weekly-summary', label: 'Weekly Summary', onClick: onNavigateWeeklySummary, icon: <DocumentIcon /> },
  ]

  return (
    <nav className="admin-sidebar" aria-label="Admin navigation">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className={`admin-sidebar-item ${current === item.key ? 'admin-sidebar-item-active' : ''}`}
          onClick={item.onClick}
          aria-current={current === item.key ? 'page' : undefined}
        >
          <span className="admin-sidebar-icon" aria-hidden="true">
            {item.icon}
          </span>
          <span className="admin-sidebar-label">{item.label}</span>
        </button>
      ))}
      <SidebarDecoration />
    </nav>
  )
}
