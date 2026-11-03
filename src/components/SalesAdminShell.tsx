import { useState } from 'react'
import SalesRepManagement from './SalesRepManagement'
import SalesAdminReports from './SalesAdminReports'
import './SalesAdminShell.css'

type SalesAdminDestination = 'sales-reps' | 'reports'

// Sales Admin's entire experience — a small, dedicated shell, deliberately
// NOT AdminShell/AdminSidebar (which has no per-item permission mechanism:
// every one of its six destinations — Admin Dashboard, User Management,
// Reports & Analytics, Weekly Summary, Leadership Report, Video Creation —
// is gated by a single top-level isAdmin boolean in App.tsx, not filterable
// per role). Rather than parameterize that shared component under time
// pressure and risk any of those six leaking into a restricted role's view,
// this is a new, minimal, two-destination nav that can only ever show the
// two screens Sales Admin is authorized for. Both screens reuse existing,
// already-built components as-is (SalesRepManagement with restricted=true;
// SalesAdminReports, which itself only reuses existing fetch functions).
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
      </nav>

      {destination === 'sales-reps' ? (
        <SalesRepManagement onBack={() => setDestination('reports')} restricted />
      ) : (
        <SalesAdminReports />
      )}
    </div>
  )
}
