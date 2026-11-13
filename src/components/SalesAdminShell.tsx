import { useState } from 'react'
import SalesRepManagement from './SalesRepManagement'
import SalesAdminReports from './SalesAdminReports'
import SalesAdminManagerOverview from './SalesAdminManagerOverview'
import './SalesAdminShell.css'

type SalesAdminDestination = 'user-management' | 'report-status'

interface SalesAdminShellProps {
  // Additive, optional — undefined for every Sales Admin except a
  // dual-role one explicitly flagged manager_reporting_enabled = true (see
  // src/App.tsx's hasManagerReporting). When provided, renders one extra
  // nav item ("My Reports") that hands control back up to App.tsx to
  // switch the whole top-level view to that account's own Weekly Manager
  // Report workspace — this component itself never fetches or renders
  // anything Manager-related, keeping User Management and Report Status
  // (the two existing destinations) completely untouched and still
  // unavailable to every other Sales Admin.
  onOpenManagerReporting?: () => void
}

// Sales Admin's entire experience — a small, dedicated shell, deliberately
// NOT AdminShell/AdminSidebar (which has no per-item permission mechanism:
// every one of its six destinations — Admin Dashboard, User Management,
// Reports & Analytics, Weekly Summary, Leadership Report, Video Creation —
// is gated by a single top-level isAdmin boolean in App.tsx, not filterable
// per role). Rather than parameterize that shared component under time
// pressure and risk any of those six leaking into a restricted role's view,
// this is a new, minimal nav that can only ever show the screens Sales
// Admin is authorized for.
//
// User Management reuses SalesRepManagement in its existing restricted
// mode, unchanged — same component, same layout conventions (KPI row,
// filter/search, semantic table) the Super Admin's own User Management
// screen already follows, per that component's own header comment.
//
// Report Status stacks TWO existing, untouched components vertically,
// rather than as separate tabs: SalesAdminReports (the per-Sales-Rep
// report-status dashboard — not-started/draft/submitted/approved/rejected,
// across every Manager) above, and SalesAdminManagerOverview ("Reporting
// by Manager" — Sales Rep totals and reporting-status counts grouped by
// Manager, with drill-down) below. Both are read-only, reuse existing
// already-authorized fetch functions, and introduce no new endpoint or
// database policy.
export default function SalesAdminShell({ onOpenManagerReporting }: SalesAdminShellProps) {
  const [destination, setDestination] = useState<SalesAdminDestination>('user-management')

  return (
    <div className="sales-admin-shell">
      <nav className="sales-admin-shell-nav" role="tablist" aria-label="Sales Admin dashboard">
        <button
          type="button"
          role="tab"
          id="sales-admin-tab-user-management"
          aria-controls="sales-admin-panel-user-management"
          aria-selected={destination === 'user-management'}
          className={`sales-admin-shell-nav-item${destination === 'user-management' ? ' sales-admin-shell-nav-item-active' : ''}`}
          onClick={() => setDestination('user-management')}
        >
          User Management
        </button>
        <button
          type="button"
          role="tab"
          id="sales-admin-tab-report-status"
          aria-controls="sales-admin-panel-report-status"
          aria-selected={destination === 'report-status'}
          className={`sales-admin-shell-nav-item${destination === 'report-status' ? ' sales-admin-shell-nav-item-active' : ''}`}
          onClick={() => setDestination('report-status')}
        >
          Report Status
        </button>
        {onOpenManagerReporting && (
          <button
            type="button"
            id="sales-admin-tab-my-reports"
            className="sales-admin-shell-nav-item"
            onClick={onOpenManagerReporting}
          >
            My Reports
          </button>
        )}
      </nav>

      {destination === 'user-management' ? (
        <div id="sales-admin-panel-user-management" role="tabpanel" aria-labelledby="sales-admin-tab-user-management">
          <SalesRepManagement onBack={() => setDestination('report-status')} restricted />
        </div>
      ) : destination === 'report-status' ? (
        <div id="sales-admin-panel-report-status" role="tabpanel" aria-labelledby="sales-admin-tab-report-status">
          <SalesAdminReports />
          <SalesAdminManagerOverview />
        </div>
      ) : null}
    </div>
  )
}
