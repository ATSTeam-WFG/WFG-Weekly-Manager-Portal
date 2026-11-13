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
// Admin is authorized for. All reuse existing, already-built components/
// services as-is (SalesRepManagement with restricted=true; SalesAdminReports
// and SalesAdminManagerOverview, which themselves only reuse existing,
// already-authorized fetch functions — no new endpoint, no new RLS policy,
// no new SECURITY DEFINER function for any of them).
//
// Structure intentionally matches the original markup exactly (plain nav
// buttons, no ARIA tab/tabpanel roles, destination content rendered
// directly — no wrapping <div> per destination) — this file previously,
// briefly, picked up extra structure from a differently-styled draft that
// was never the approved visual target; restored here to minimize
// deviation from the original to exactly what the three-destination
// reorganization requires. See SalesAdminManagerOverview.css's own
// .samo-page comment for the one real (CSS, not markup) difference this
// reorganization required: that component's own page-level max-width/
// margin/padding was removed since it's no longer ever a standalone page.
export default function SalesAdminShell({ onOpenManagerReporting }: SalesAdminShellProps) {
  const [destination, setDestination] = useState<SalesAdminDestination>('user-management')

  return (
    <div className="sales-admin-shell">
      <nav className="sales-admin-shell-nav">
        <button
          type="button"
          className={`sales-admin-shell-nav-item${destination === 'user-management' ? ' sales-admin-shell-nav-item-active' : ''}`}
          onClick={() => setDestination('user-management')}
        >
          User Management
        </button>
        <button
          type="button"
          className={`sales-admin-shell-nav-item${destination === 'report-status' ? ' sales-admin-shell-nav-item-active' : ''}`}
          onClick={() => setDestination('report-status')}
        >
          Report Status
        </button>
        {onOpenManagerReporting && (
          <button
            type="button"
            className="sales-admin-shell-nav-item"
            onClick={onOpenManagerReporting}
          >
            My Reports
          </button>
        )}
      </nav>

      {destination === 'user-management' ? (
        <SalesRepManagement onBack={() => setDestination('report-status')} restricted />
      ) : (
        <>
          <SalesAdminReports />
          <SalesAdminManagerOverview />
        </>
      )}
    </div>
  )
}
