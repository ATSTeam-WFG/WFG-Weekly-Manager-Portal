import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  fetchSalesReps,
  fetchActiveManagers,
  inviteSalesRep,
  assignSalesRep,
  unassignSalesRep,
  grantLateSubmissionException,
  RepReportError,
  type SalesRep,
  type ActiveManager,
} from '../lib/salesRepManagementService'
import './StatusBadge.css'
import './SalesRepManagement.css'

// Admin-only Sales Rep provisioning screen — Phase 1B. A completely
// separate, parallel surface from UserManagement.tsx (Manager/Admin
// roster): same house UI conventions (KPI row, filter/search controls,
// div-based semantic table, per-row action/message pattern), but its own
// component, its own service module, its own API routes. Not wired into
// App.tsx's navigation — that happens in a separate step outside this
// component's own scope; this is just the screen itself.
interface SalesRepManagementProps {
  onBack: () => void
}

const STATUS_LABELS: Record<SalesRep['status'], string> = {
  pending: 'Pending',
  awaiting_first_login: 'Awaiting First Login',
  active: 'Active',
  inactive: 'Inactive',
}

type StatusFilter = 'all' | SalesRep['status']

const STATUS_FILTER_OPTIONS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'pending', label: 'Pending' },
  { key: 'awaiting_first_login', label: 'Awaiting First Login' },
  { key: 'inactive', label: 'Inactive' },
]

function inviteOutcomeMessage(status: string): string {
  switch (status) {
    case 'created':
      return 'Account created. Send them their WFG email, the portal URL, and the temporary password through your usual internal channel.'
    case 'already_created':
      return 'An account has already been created for this person and is awaiting their first login.'
    case 'already_registered':
      return 'This person already has a portal account.'
    case 'invalid_domain':
      return 'Only approved @wfgtitle.com email addresses can be added.'
    case 'role_conflict':
      return 'This email is already assigned a Manager or Admin role.'
    case 'inactive':
      return 'This employee is deactivated. Reactivate them before creating an account.'
    default:
      return 'Something went wrong creating the account. Please try again.'
  }
}

// Friendly, per-code messages for the RPC's own RepReportError — mirrors how
// UserManagement.tsx maps its own outcome statuses to messages.
function lateExceptionErrorMessage(err: unknown): string {
  if (err instanceof RepReportError) {
    switch (err.code) {
      case 'NOT_FOUND':
        return 'No report exists yet for this rep and week — an exception can only be granted once a draft or submission exists for that week.'
      case 'REASON_REQUIRED':
        return 'A reason is required to grant a late submission exception.'
      case 'FORBIDDEN':
        return 'You do not have permission to grant this exception.'
      default:
        return err.message || 'Could not grant the exception. Please try again.'
    }
  }
  return 'Could not grant the exception. Please try again.'
}

export default function SalesRepManagement({ onBack }: SalesRepManagementProps) {
  const [reps, setReps] = useState<SalesRep[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<{ code: string; message: string } | null>(null)
  const [managers, setManagers] = useState<ActiveManager[]>([])

  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [creatingAccount, setCreatingAccount] = useState(false)
  const [createAccountMessage, setCreateAccountMessage] = useState<string | null>(null)
  const [createAccountMessageIsError, setCreateAccountMessageIsError] = useState(false)
  const fullNameInputRef = useRef<HTMLInputElement>(null)

  const [rowActionId, setRowActionId] = useState<string | null>(null)
  const [rowMessage, setRowMessage] = useState<{ id: string; text: string; isError: boolean } | null>(null)

  // Grant Late Submission Exception — one expandable control per rep.
  const [expandedExceptionRepId, setExpandedExceptionRepId] = useState<string | null>(null)
  const [exceptionWeekStartDate, setExceptionWeekStartDate] = useState('')
  const [exceptionReason, setExceptionReason] = useState('')
  const [grantingException, setGrantingException] = useState(false)
  const [exceptionMessage, setExceptionMessage] = useState<{ id: string; text: string; isError: boolean } | null>(null)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const loadReps = () => {
    setLoading(true)
    setLoadError(null)
    fetchSalesReps().then((outcome) => {
      if (outcome.status === 'ok') {
        setReps(outcome.reps)
      } else {
        setLoadError({ code: outcome.code, message: outcome.message })
      }
      setLoading(false)
    })
  }

  useEffect(() => {
    loadReps()
    fetchActiveManagers().then(setManagers)
    // Runs once on mount only — every mutation below re-fetches explicitly
    // after it completes, rather than depending on any value here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (isAddModalOpen) fullNameInputRef.current?.focus()
  }, [isAddModalOpen])

  const totalCount = reps.length
  const activeCount = reps.filter((r) => r.status === 'active').length
  const awaitingFirstLoginCount = reps.filter((r) => r.status === 'awaiting_first_login').length
  const unassignedCount = reps.filter((r) => r.status === 'active' && !r.currentManagerId).length

  const filteredReps = reps.filter((rep) => {
    if (statusFilter !== 'all' && rep.status !== statusFilter) return false
    const term = search.trim().toLowerCase()
    if (term.length === 0) return true
    return rep.fullName.toLowerCase().includes(term) || rep.email.toLowerCase().includes(term)
  })

  const handleOpenAddModal = () => {
    setCreateAccountMessage(null)
    setIsAddModalOpen(true)
  }

  const handleCloseAddModal = () => {
    if (creatingAccount) return
    setIsAddModalOpen(false)
  }

  const handleCreateAccountSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setCreateAccountMessage(null)

    const trimmedName = fullName.trim()
    const trimmedEmail = email.trim()
    if (!trimmedName || !trimmedEmail) {
      setCreateAccountMessageIsError(true)
      setCreateAccountMessage('A name and email are required.')
      return
    }

    setCreatingAccount(true)
    const outcome = await inviteSalesRep(trimmedName, trimmedEmail)
    setCreatingAccount(false)

    const isSuccess = outcome.status === 'created'
    setCreateAccountMessageIsError(!isSuccess)
    setCreateAccountMessage(inviteOutcomeMessage(outcome.status))

    if (isSuccess) {
      setFullName('')
      setEmail('')
      loadReps()
    }
  }

  const handleAssignManager = async (rep: SalesRep, managerId: string) => {
    if (!rep.profileId) return
    setRowActionId(rep.id)
    setRowMessage(null)
    try {
      if (managerId === '') {
        await unassignSalesRep(rep.profileId)
      } else {
        await assignSalesRep(rep.profileId, managerId)
      }
      loadReps()
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Could not update this rep\'s manager. Please try again.'
      setRowMessage({ id: rep.id, text, isError: true })
    } finally {
      setRowActionId(null)
    }
  }

  const handleToggleException = (rep: SalesRep) => {
    if (expandedExceptionRepId === rep.id) {
      setExpandedExceptionRepId(null)
      return
    }
    setExpandedExceptionRepId(rep.id)
    setExceptionWeekStartDate('')
    setExceptionReason('')
    setExceptionMessage(null)
  }

  const handleGrantException = async (e: FormEvent, rep: SalesRep) => {
    e.preventDefault()
    if (!rep.profileId) return
    setExceptionMessage(null)

    if (!exceptionWeekStartDate || !exceptionReason.trim()) {
      setExceptionMessage({ id: rep.id, text: 'A week start date and reason are both required.', isError: true })
      return
    }

    setGrantingException(true)
    try {
      await grantLateSubmissionException(rep.profileId, exceptionWeekStartDate, exceptionReason.trim())
      setGrantingException(false)
      setExceptionMessage({ id: rep.id, text: 'Late submission exception granted.', isError: false })
      setExceptionWeekStartDate('')
      setExceptionReason('')
    } catch (err) {
      setGrantingException(false)
      setExceptionMessage({ id: rep.id, text: lateExceptionErrorMessage(err), isError: true })
    }
  }

  return (
    <div className="sales-rep-management">
      <button type="button" className="link-btn back-link" onClick={onBack}>
        &larr; Back to Admin Dashboard
      </button>

      <div className="srm-header">
        <div className="srm-header-titles">
          <h1>Sales Rep Management</h1>
          <p className="srm-header-subtitle">Add sales reps, assign them to a manager, and grant reporting exceptions.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={handleOpenAddModal}>
          + Add Sales Rep
        </button>
      </div>

      {loading ? (
        <div className="srm-loading">Loading sales reps…</div>
      ) : loadError ? (
        <p className="sales-rep-management-message-error">
          Could not load the sales rep list: {loadError.message} (Error: {loadError.code}). Please refresh and try again.
        </p>
      ) : (
        <>
          <div className="srm-kpi-row">
            <div className="srm-kpi-card srm-kpi-card-total">
              <span className="srm-kpi-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="9" cy="8" r="3" />
                  <path d="M4 20c0-3 2.5-5 5-5s5 2 5 5" />
                  <circle cx="17" cy="9" r="2.5" />
                  <path d="M15.5 20c0-2.5 1-4 3-4.5" />
                </svg>
              </span>
              <div className="srm-kpi-text">
                <span className="srm-kpi-value">{totalCount}</span>
                <span className="srm-kpi-label">Total Sales Reps</span>
              </div>
            </div>
            <div className="srm-kpi-card srm-kpi-card-active">
              <span className="srm-kpi-icon" aria-hidden="true">
                &#10003;
              </span>
              <div className="srm-kpi-text">
                <span className="srm-kpi-value">{activeCount}</span>
                <span className="srm-kpi-label">Active</span>
              </div>
            </div>
            <div className="srm-kpi-card srm-kpi-card-awaiting">
              <span className="srm-kpi-icon" aria-hidden="true">
                &#8987;
              </span>
              <div className="srm-kpi-text">
                <span className="srm-kpi-value">{awaitingFirstLoginCount}</span>
                <span className="srm-kpi-label">Awaiting First Login</span>
              </div>
            </div>
            <div className="srm-kpi-card srm-kpi-card-unassigned">
              <span className="srm-kpi-icon" aria-hidden="true">
                &#9675;
              </span>
              <div className="srm-kpi-text">
                <span className="srm-kpi-value">{unassignedCount}</span>
                <span className="srm-kpi-label">Unassigned</span>
              </div>
            </div>
          </div>

          <div className="srm-controls">
            <input
              type="search"
              className="srm-search"
              placeholder="Search sales reps by name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search sales reps"
            />
            <select
              className="srm-status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              aria-label="Filter by status"
            >
              {STATUS_FILTER_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {filteredReps.length === 0 ? (
            <p className="srm-empty-state">{reps.length === 0 ? 'No sales reps found yet.' : 'No sales reps match this search/filter.'}</p>
          ) : (
            <div className="srm-table" role="table" aria-label="Sales Reps">
              <div className="srm-table-header-row" role="row">
                <span role="columnheader">Sales Rep</span>
                <span role="columnheader">Status</span>
                <span role="columnheader">Manager</span>
                <span role="columnheader">Actions</span>
              </div>
              {filteredReps.map((rep) => (
                <div className="srm-row" role="row" key={rep.id}>
                  <div className="srm-row-main">
                    <div className="srm-cell srm-cell-rep" role="cell">
                      <span className="srm-rep-name">{rep.fullName}</span>
                      <span className="srm-rep-email">{rep.email}</span>
                    </div>
                    <div className="srm-cell" role="cell">
                      <span className={`status-badge srm-status-badge srm-status-${rep.status}`}>{STATUS_LABELS[rep.status]}</span>
                    </div>
                    <div className="srm-cell srm-cell-manager" role="cell">
                      {rep.profileId ? (
                        <select
                          className="srm-manager-select"
                          value={rep.currentManagerId ?? ''}
                          disabled={rowActionId === rep.id}
                          onChange={(e) => handleAssignManager(rep, e.target.value)}
                          aria-label={`Assign manager for ${rep.fullName}`}
                        >
                          <option value="">Unassigned</option>
                          {managers.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.fullName ?? m.id}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="srm-manager-disabled" title="This rep hasn't completed onboarding yet — they must sign in and set up their profile before a manager can be assigned.">
                          Not yet available
                        </span>
                      )}
                    </div>
                    <div className="srm-cell srm-cell-actions" role="cell">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={!rep.profileId}
                        title={rep.profileId ? undefined : "This rep hasn't completed onboarding yet."}
                        onClick={() => handleToggleException(rep)}
                      >
                        {expandedExceptionRepId === rep.id ? 'Close' : 'Grant Late Exception'}
                      </button>
                    </div>
                  </div>

                  {rowMessage && rowMessage.id === rep.id && (
                    <p className={`srm-row-message ${rowMessage.isError ? 'sales-rep-management-message-error' : 'sales-rep-management-message-success'}`}>
                      {rowMessage.text}
                    </p>
                  )}

                  {expandedExceptionRepId === rep.id && (
                    <form className="srm-exception-form" onSubmit={(e) => handleGrantException(e, rep)}>
                      <div className="srm-exception-fields">
                        <div className="srm-exception-field">
                          <label className="srm-field-label" htmlFor={`exception-week-${rep.id}`}>
                            Week Start Date
                          </label>
                          <input
                            id={`exception-week-${rep.id}`}
                            type="date"
                            className="srm-field-input"
                            value={exceptionWeekStartDate}
                            onChange={(e) => setExceptionWeekStartDate(e.target.value)}
                            required
                          />
                        </div>
                        <div className="srm-exception-field srm-exception-field-reason">
                          <label className="srm-field-label" htmlFor={`exception-reason-${rep.id}`}>
                            Reason
                          </label>
                          <textarea
                            id={`exception-reason-${rep.id}`}
                            className="srm-field-textarea"
                            value={exceptionReason}
                            onChange={(e) => setExceptionReason(e.target.value)}
                            placeholder="Why is a late submission being allowed?"
                            required
                          />
                        </div>
                      </div>
                      {exceptionMessage && exceptionMessage.id === rep.id && (
                        <p
                          className={
                            exceptionMessage.isError ? 'sales-rep-management-message-error' : 'sales-rep-management-message-success'
                          }
                        >
                          {exceptionMessage.text}
                        </p>
                      )}
                      <div className="srm-exception-actions">
                        <button type="submit" className="btn btn-primary" disabled={grantingException}>
                          {grantingException ? 'Granting…' : 'Grant Exception'}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {isAddModalOpen && (
        <div className="srm-modal-overlay" onClick={handleCloseAddModal}>
          <div
            className="srm-modal-panel"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-sales-rep-modal-title"
          >
            <div className="srm-modal-header">
              <h2 id="add-sales-rep-modal-title">Add Sales Rep</h2>
              <button type="button" className="srm-modal-close-btn" onClick={handleCloseAddModal} disabled={creatingAccount} aria-label="Close">
                &times;
              </button>
            </div>

            <form className="srm-modal-form" onSubmit={handleCreateAccountSubmit}>
              <p className="srm-modal-helper">
                Enter the sales rep's name and WFG email to create their portal account with the shared temporary password.
              </p>

              <div className="srm-modal-field">
                <label className="srm-modal-label" htmlFor="invite-rep-full-name">
                  Full Name
                </label>
                <input
                  id="invite-rep-full-name"
                  ref={fullNameInputRef}
                  type="text"
                  className="srm-modal-input"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Jane Rep"
                  required
                />
              </div>

              <div className="srm-modal-field">
                <label className="srm-modal-label" htmlFor="invite-rep-email">
                  WFG Email
                </label>
                <input
                  id="invite-rep-email"
                  type="email"
                  className="srm-modal-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="jane.rep@wfgtitle.com"
                  required
                />
              </div>

              {createAccountMessage && (
                <p className={createAccountMessageIsError ? 'sales-rep-management-message-error' : 'sales-rep-management-message-success'}>
                  {createAccountMessage}
                </p>
              )}

              <div className="srm-modal-actions">
                <button type="button" className="btn btn-secondary" onClick={handleCloseAddModal} disabled={creatingAccount}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={creatingAccount}>
                  {creatingAccount ? 'Creating…' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
