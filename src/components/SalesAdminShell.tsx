import { useState } from 'react'
import SalesRepManagement from './SalesRepManagement'
import SalesAdminReports from './SalesAdminReports'
import SalesAdminManagerOverview from './SalesAdminManagerOverview'
import './SalesAdminShell.css'

type SalesAdminDestination = 'sales-reps' | 'reports' | 'by-manager'

// Sales Admin's entire experience — a small, dedicated shell, deliberately
// NOT AdminShell/AdminSidebar (which has no per-item permission mechanism:
// every one of its six destinations — Admin Dashboard, User Management,
// Reports & Analytics, Weekly Summary, Leadership Report, Video Creation —
// is gated by a single top-level isAdmin boolean in App.tsx, not filterable
// per role). Rather than parameterize that shared component under time
// pressure and risk any of those six leaking into a restricted role's view,
// this is a new, minimal nav that can only ever show the screens Sales
// Admin is authorized for. All three reuse existing, already-built
// components/services as-is (SalesRepManagement with restricted=true;
// SalesAdminReports and SalesAdminManagerOverview, which themselves only
// reuse existing, already-authorized fetch functions — no new endpoint, no
// new RLS policy, no new SECURITY DEFINER function for any of the three).
export default function SalesAdminShell() {
  const [destination, setDestination] = useState<SalesAdminDestination>('sales-reps')

  return (
    <div className="sales-admin-shell">
      <nav className="sales-admin-shell-nav">
        <button
          type="button"
          className={`sales-admin-shell-nav-item${destination === 'sales-reps' ? ' sales-admin-shell-nav-item-active' : ''}`}
          onClick={() => setDestination('sales-reps')}
        >
          Sales Representatives
        </button>
        <button
          type="button"
          className={`sales-admin-shell-nav-item${destination === 'reports' ? ' sales-admin-shell-nav-item-active' : ''}`}
          onClick={() => setDestination('reports')}
        >
          Sales Rep Reports
        </button>
        <button
          type="button"
          className={`sales-admin-shell-nav-item${destination === 'by-manager' ? ' sales-admin-shell-nav-item-active' : ''}`}
          onClick={() => setDestination('by-manager')}
        >
          Reporting by Manager
        </button>
      </nav>

      {destination === 'sales-reps' ? (
        <SalesRepManagement onBack={() => setDestination('reports')} restricted />
      ) : destination === 'reports' ? (
        <SalesAdminReports />
      ) : (
        <SalesAdminManagerOverview />
      )}
    </div>
  )
}
