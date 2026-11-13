import { useState } from 'react'
import SalesRepManagement from './SalesRepManagement'
import SalesAdminReports from './SalesAdminReports'
import './SalesAdminShell.css'

type SalesAdminDestination = 'sales-reps' | 'reports'

interface SalesAdminShellProps {
  // Additive, optional — undefined for every Sales Admin except a
  // dual-role one explicitly flagged manager_reporting_enabled = true (see
  // src/App.tsx's hasManagerReporting). When provided, renders one extra
  // nav item that hands control back up to App.tsx to switch the whole
  // top-level view to that account's own Manager Reporting workspace —
  // this component itself never fetches or renders anything
  // Manager-related, keeping Sales Rep roster/assignment management (the
  // two existing tabs) completely untouched and still unavailable to every
  // other Sales Admin.
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
// Admin is authorized for. Both tabs reuse existing, already-authorized
// workflows: SalesRepManagement is restricted, while SalesAdminReports
// reads rep reports under the existing Sales Admin RLS policy. No privileged
// endpoint or new database policy is introduced by this shell.
export default function SalesAdminShell({ onOpenManagerReporting }: SalesAdminShellProps) {
  const [destination, setDestination] = useState<SalesAdminDestination>('sales-reps')

  return (
    <div className="sales-admin-shell">
      <nav className="sales-admin-shell-nav" role="tablist" aria-label="Sales Admin dashboard">
        <button
          type="button"
          role="tab"
          id="sales-admin-tab-reps"
          aria-controls="sales-admin-panel-reps"
          aria-selected={destination === 'sales-reps'}
          className={`sales-admin-shell-nav-item${destination === 'sales-reps' ? ' sales-admin-shell-nav-item-active' : ''}`}
          onClick={() => setDestination('sales-reps')}
        >
          Sales Representatives
        </button>
        <button
          type="button"
          role="tab"
          id="sales-admin-tab-reports"
          aria-controls="sales-admin-panel-reports"
          aria-selected={destination === 'reports'}
          className={`sales-admin-shell-nav-item${destination === 'reports' ? ' sales-admin-shell-nav-item-active' : ''}`}
          onClick={() => setDestination('reports')}
        >
          Report Status
        </button>
        {onOpenManagerReporting && (
          <button
            type="button"
            id="sales-admin-tab-manager-reporting"
            className="sales-admin-shell-nav-item"
            onClick={onOpenManagerReporting}
          >
            Manager Reporting
          </button>
        )}
      </nav>

      {destination === 'sales-reps' ? (
        <div id="sales-admin-panel-reps" role="tabpanel" aria-labelledby="sales-admin-tab-reps">
          <SalesRepManagement onBack={() => setDestination('reports')} restricted />
        </div>
      ) : destination === 'reports' ? (
        <div id="sales-admin-panel-reports" role="tabpanel" aria-labelledby="sales-admin-tab-reports">
          <SalesAdminReports />
        </div>
      ) : null}
    </div>
  )
}
