import { useEffect, useMemo, useState } from 'react'
import { fetchManagerAssignedSalesReps, type ManagerAssignedSalesRep } from '../lib/managerSalesRepService'
import './ManagerPortalData.css'

interface ManagerMySalesRepsProps {
  managerName: string
  onReviewReports: () => void
}

type ManagerRosterStatus = 'all' | 'active' | 'inactive' | 'unavailable'

const STATUS_OPTIONS: { value: ManagerRosterStatus; label: string }[] = [
  { value: 'all', label: 'All account statuses' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'unavailable', label: 'Status unavailable' },
]

export default function ManagerMySalesReps({ managerName, onReviewReports }: ManagerMySalesRepsProps) {
  const [reps, setReps] = useState<ManagerAssignedSalesRep[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<ManagerRosterStatus>('all')

  useEffect(() => {
    let active = true
    setLoading(true)
    setLoadError(null)
    fetchManagerAssignedSalesReps().then((outcome) => {
      if (!active) return
      if (outcome.status === 'error') {
        setLoadError(outcome.message)
        setReps([])
      } else {
        setReps(outcome.reps)
      }
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [reloadToken])

  const filteredReps = useMemo(() => {
    const term = search.trim().toLowerCase()
    return reps.filter((rep) => {
      const status: ManagerRosterStatus = rep.isActive === null ? 'unavailable' : rep.isActive ? 'active' : 'inactive'
      if (statusFilter !== 'all' && status !== statusFilter) return false
      if (!term) return true
      return `${rep.fullName ?? ''} ${rep.email}`.toLowerCase().includes(term)
    })
  }, [reps, search, statusFilter])

  const activeCount = reps.filter((rep) => rep.isActive === true).length
  const inactiveCount = reps.filter((rep) => rep.isActive === false).length

  return (
    <div className="manager-sales-page">
      <div className="manager-sales-header">
        <div>
          <h1>My Sales Reps</h1>
          <p>Sales Reps currently assigned to {managerName}. Access is limited to your current assignments.</p>
        </div>
        <div className="manager-sales-header-actions">
          <button type="button" className="btn btn-secondary" onClick={onReviewReports}>
            Review Reports
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled
            title="Manager-specific account provisioning is pending backend authorization approval."
          >
            + Add Sales Rep
          </button>
        </div>
      </div>

      <div className="manager-action-notice" role="note">
        <strong>Account changes are not enabled yet.</strong> Add, Edit, Deactivate, Reactivate, and Remove Assignment remain disabled until Manager-scoped backend permissions and the onboarding assignment flow are reviewed and approved. Deactivate/Reactivate changes account access globally, not just this Manager relationship, and needs explicit product approval.
      </div>

      {loading ? (
        <div className="manager-sales-loading" role="status">Loading your assigned Sales Reps…</div>
      ) : loadError ? (
        <div className="manager-sales-error" role="alert">
          <p>{loadError}</p>
          <button type="button" className="btn btn-secondary" onClick={() => setReloadToken((token) => token + 1)}>Retry</button>
        </div>
      ) : (
        <>
          <div className="manager-sales-kpis" aria-label="My Sales Reps account summary">
            <div className="manager-sales-kpi"><span>{reps.length}</span><small>Currently Assigned</small></div>
            <div className="manager-sales-kpi manager-sales-kpi-active"><span>{activeCount}</span><small>Active</small></div>
            <div className="manager-sales-kpi manager-sales-kpi-inactive"><span>{inactiveCount}</span><small>Inactive</small></div>
          </div>

          <div className="manager-sales-controls">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="manager-sales-search"
              placeholder="Search assigned Sales Reps…"
              aria-label="Search assigned Sales Reps"
            />
            <select
              className="manager-sales-filter"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as ManagerRosterStatus)}
              aria-label="Filter by account status"
            >
              {STATUS_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
            </select>
          </div>

          {filteredReps.length === 0 ? (
            <p className="manager-sales-empty">
              {reps.length === 0 ? 'You have no Sales Reps currently assigned.' : 'No assigned Sales Reps match this search or status filter.'}
            </p>
          ) : (
            <div className="manager-sales-table" role="table" aria-label="My currently assigned Sales Reps">
              <div className="manager-sales-table-header" role="row">
                <span role="columnheader">Sales Rep</span>
                <span role="columnheader">Account Status</span>
                <span role="columnheader">Assigned Manager</span>
                <span role="columnheader">Onboarding</span>
                <span role="columnheader">Actions</span>
              </div>
              {filteredReps.map((rep) => (
                <div className="manager-sales-row" role="row" key={rep.repId}>
                  <div className="manager-sales-cell manager-sales-person" role="cell" data-label="Sales Rep">
                    <strong>{rep.fullName ?? 'Unnamed Sales Rep'}</strong>
                    <span>{rep.email || 'Email not available'}</span>
                  </div>
                  <div className="manager-sales-cell" role="cell" data-label="Account Status">
                    <span className={`manager-sales-status ${rep.isActive === null ? 'status-unavailable' : rep.isActive ? 'status-active' : 'status-inactive'}`}>
                      {rep.isActive === null ? 'Unavailable' : rep.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className="manager-sales-cell" role="cell" data-label="Assigned Manager">{managerName}</div>
                  <div className="manager-sales-cell" role="cell" data-label="Onboarding">
                    {rep.onboardingStatus === 'complete' ? 'Complete' : 'Unavailable'}
                  </div>
                  <div className="manager-sales-cell manager-sales-actions" role="cell" data-label="Actions">
                    <button type="button" className="btn btn-secondary" disabled title="Manager-scoped profile editing is pending approval.">Edit</button>
                    <button type="button" className="btn btn-secondary" disabled title="Manager-scoped account activation is pending approval.">
                      {rep.isActive ? 'Deactivate' : 'Reactivate'}
                    </button>
                    <button type="button" className="btn btn-secondary" disabled title="Manager-scoped unassignment is pending approval.">Remove Assignment</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
