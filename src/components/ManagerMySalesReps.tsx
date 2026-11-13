import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  fetchManagerAssignedSalesReps,
  inviteOwnSalesRep,
  editOwnSalesRep,
  removeOwnAssignment,
  MANAGER_ACCOUNT_ACTIONS_UI_ENABLED,
  type ManagerAssignedSalesRep,
} from '../lib/managerSalesRepService'
import './ManagerPortalData.css'
import './SalesRepManagement.css'

interface ManagerMySalesRepsProps {
  managerName: string
  onReviewReports: () => void
}

function inviteOutcomeMessage(outcome: Awaited<ReturnType<typeof inviteOwnSalesRep>>): string {
  switch (outcome.status) {
    case 'ok':
      return 'Invitation sent. Once they complete their first sign-in, they will automatically appear in your roster below — no further action is needed from you.'
    case 'pending_conflict':
      return outcome.message
    case 'already_registered':
      return 'This person already has a portal account.'
    case 'invalid_domain':
      return 'Only approved @wfgtitle.com email addresses can be added.'
    case 'role_conflict':
      return 'This email is already assigned a Manager or Admin role.'
    case 'inactive':
      return 'This employee is deactivated. Contact an Admin before inviting them.'
    default:
      return 'Something went wrong sending this invitation. Please try again.'
  }
}

function editErrorMessage(status: Exclude<Awaited<ReturnType<typeof editOwnSalesRep>>['status'], 'ok' | 'pending_verification'>): string {
  switch (status) {
    case 'not_found':
      return 'This Sales Rep could not be found. Refresh and try again.'
    case 'forbidden':
      return 'This Sales Rep is no longer assigned to you. Refresh your roster and try again.'
    case 'invalid_domain':
      return 'Only approved @wfgtitle.com email addresses can be used.'
    case 'email_conflict':
      return 'That email address is already in use by another portal account.'
    case 'auth_identity_unresolved':
      return 'This account’s sign-in identity could not be safely verified. The email was not changed; contact support.'
    case 'partial_failure':
      return 'This change may be incomplete. Do not retry; contact support for reconciliation.'
    default:
      return 'Could not save this Sales Rep. Please try again.'
  }
}

function removeAssignmentErrorMessage(status: Exclude<Awaited<ReturnType<typeof removeOwnAssignment>>['status'], 'ok'>): string {
  switch (status) {
    case 'not_found':
      return 'This Sales Rep is no longer assigned to you — your roster may already be out of date. Refresh and try again.'
    case 'invalid_rep':
      return 'This profile is not a Sales Rep.'
    default:
      return 'Could not remove this assignment. Please try again.'
  }
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

  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [addFullName, setAddFullName] = useState('')
  const [addEmail, setAddEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteMessage, setInviteMessage] = useState<{ text: string; isError: boolean } | null>(null)
  const addFullNameInputRef = useRef<HTMLInputElement>(null)

  const [editingRep, setEditingRep] = useState<ManagerAssignedSalesRep | null>(null)
  const [editFullName, setEditFullName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [editMessage, setEditMessage] = useState<{ text: string; isError: boolean } | null>(null)

  const [pendingRemoval, setPendingRemoval] = useState<ManagerAssignedSalesRep | null>(null)
  const [removingAssignment, setRemovingAssignment] = useState(false)

  const [rowMessage, setRowMessage] = useState<{ repId: string; text: string; isError: boolean } | null>(null)

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

  useEffect(() => {
    if (isAddModalOpen) addFullNameInputRef.current?.focus()
  }, [isAddModalOpen])

  const handleOpenAddModal = () => {
    setAddFullName('')
    setAddEmail('')
    setInviteMessage(null)
    setIsAddModalOpen(true)
  }

  const handleCloseAddModal = () => {
    if (inviting) return
    setIsAddModalOpen(false)
  }

  const handleInviteSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const trimmedName = addFullName.trim()
    const trimmedEmail = addEmail.trim()
    if (!trimmedName || !trimmedEmail) {
      setInviteMessage({ text: 'A name and email are required.', isError: true })
      return
    }
    setInviting(true)
    setInviteMessage(null)
    const outcome = await inviteOwnSalesRep(trimmedName, trimmedEmail)
    setInviting(false)
    setInviteMessage({ text: inviteOutcomeMessage(outcome), isError: outcome.status !== 'ok' })
    if (outcome.status === 'ok') {
      setAddFullName('')
      setAddEmail('')
    }
  }

  const handleOpenEdit = (rep: ManagerAssignedSalesRep) => {
    setEditingRep(rep)
    setEditFullName(rep.fullName ?? '')
    setEditEmail(rep.email)
    setEditMessage(null)
  }

  const handleCloseEdit = () => {
    if (savingEdit) return
    setEditingRep(null)
    setEditMessage(null)
  }

  const handleSaveEdit = async (event: FormEvent) => {
    event.preventDefault()
    if (!editingRep) return
    const fullNameValue = editFullName.trim()
    const emailValue = editEmail.trim()
    if (!fullNameValue || !emailValue) {
      setEditMessage({ text: 'A name and email are required.', isError: true })
      return
    }
    setSavingEdit(true)
    const outcome = await editOwnSalesRep(editingRep.repId, fullNameValue, emailValue)
    setSavingEdit(false)
    if (outcome.status === 'ok') {
      setEditingRep(null)
      setEditMessage(null)
      setReloadToken((token) => token + 1)
      return
    }
    if (outcome.status === 'pending_verification') {
      setEditMessage({
        text: 'Name saved. A verification link was sent to the new email address — the sign-in email will not change until it is confirmed.',
        isError: false,
      })
      setReloadToken((token) => token + 1)
      return
    }
    setEditMessage({ text: editErrorMessage(outcome.status), isError: true })
  }

  const handleConfirmRemoveAssignment = async () => {
    if (!pendingRemoval) return
    const rep = pendingRemoval
    setRemovingAssignment(true)
    const outcome = await removeOwnAssignment(rep.repId)
    setRemovingAssignment(false)
    setPendingRemoval(null)
    if (outcome.status === 'ok') {
      setRowMessage({ repId: rep.repId, text: 'Manager assignment removed. The Sales Rep account and report history remain unchanged.', isError: false })
      setReloadToken((token) => token + 1)
    } else {
      setRowMessage({ repId: rep.repId, text: removeAssignmentErrorMessage(outcome.status), isError: true })
    }
  }

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
          {MANAGER_ACCOUNT_ACTIONS_UI_ENABLED ? (
            <button type="button" className="btn btn-primary" onClick={handleOpenAddModal}>
              + Add Sales Rep
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled
              title="Manager-specific account provisioning is pending backend authorization approval."
            >
              + Add Sales Rep
            </button>
          )}
        </div>
      </div>

      <div className="manager-action-notice" role="note">
        {MANAGER_ACCOUNT_ACTIONS_UI_ENABLED ? (
          <>
            <strong>Deactivate and Reactivate are not available here.</strong> Add, Edit, and Remove Assignment are enabled for your account. Deactivating or reactivating a Sales Rep's account changes their access globally, not just your Manager relationship — that remains an Admin-only action.
          </>
        ) : (
          <>
            <strong>Account changes are not enabled yet.</strong> Add, Edit, Deactivate, Reactivate, and Remove Assignment remain disabled until Manager-scoped backend permissions and the onboarding assignment flow are reviewed and approved. Deactivate/Reactivate changes account access globally, not just this Manager relationship, and needs explicit product approval.
          </>
        )}
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
                    {MANAGER_ACCOUNT_ACTIONS_UI_ENABLED ? (
                      <>
                        <button type="button" className="btn btn-secondary" onClick={() => handleOpenEdit(rep)}>Edit</button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled
                          title="Deactivating or reactivating a Sales Rep's account remains an Admin-only action."
                        >
                          {rep.isActive ? 'Deactivate' : 'Reactivate'}
                        </button>
                        <button type="button" className="btn btn-secondary" onClick={() => setPendingRemoval(rep)}>Remove Assignment</button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="btn btn-secondary" disabled title="Manager-scoped profile editing is pending approval.">Edit</button>
                        <button type="button" className="btn btn-secondary" disabled title="Manager-scoped account activation is pending approval.">
                          {rep.isActive ? 'Deactivate' : 'Reactivate'}
                        </button>
                        <button type="button" className="btn btn-secondary" disabled title="Manager-scoped unassignment is pending approval.">Remove Assignment</button>
                      </>
                    )}
                  </div>
                  {rowMessage && rowMessage.repId === rep.repId && (
                    <p
                      className={rowMessage.isError ? 'sales-rep-management-message-error' : 'sales-rep-management-message-success'}
                      role={rowMessage.isError ? 'alert' : 'status'}
                    >
                      {rowMessage.text}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {MANAGER_ACCOUNT_ACTIONS_UI_ENABLED && isAddModalOpen && (
        <div className="srm-modal-overlay" onClick={handleCloseAddModal}>
          <div
            className="srm-modal-panel"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-own-sales-rep-modal-title"
          >
            <div className="srm-modal-header">
              <h2 id="add-own-sales-rep-modal-title">Add Sales Rep</h2>
              <button type="button" className="srm-modal-close-btn" onClick={handleCloseAddModal} disabled={inviting} aria-label="Close">
                &times;
              </button>
            </div>
            <form className="srm-modal-form" onSubmit={handleInviteSubmit}>
              <p className="srm-modal-helper">
                Enter the sales rep's name and WFG email. They'll be sent an invitation, and once they complete their first sign-in they will
                automatically be assigned to you.
              </p>
              <div className="srm-modal-field">
                <label className="srm-modal-label" htmlFor="manager-invite-rep-full-name">Full Name</label>
                <input
                  id="manager-invite-rep-full-name"
                  ref={addFullNameInputRef}
                  type="text"
                  className="srm-modal-input"
                  value={addFullName}
                  onChange={(event) => setAddFullName(event.target.value)}
                  placeholder="Jane Rep"
                  required
                />
              </div>
              <div className="srm-modal-field">
                <label className="srm-modal-label" htmlFor="manager-invite-rep-email">WFG Email</label>
                <input
                  id="manager-invite-rep-email"
                  type="email"
                  className="srm-modal-input"
                  value={addEmail}
                  onChange={(event) => setAddEmail(event.target.value)}
                  placeholder="jane.rep@wfgtitle.com"
                  required
                />
              </div>
              {inviteMessage && (
                <p className={inviteMessage.isError ? 'sales-rep-management-message-error' : 'sales-rep-management-message-success'} role={inviteMessage.isError ? 'alert' : 'status'}>
                  {inviteMessage.text}
                </p>
              )}
              <div className="srm-modal-actions">
                <button type="button" className="btn btn-secondary" onClick={handleCloseAddModal} disabled={inviting}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={inviting}>{inviting ? 'Sending…' : 'Send Invitation'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {MANAGER_ACCOUNT_ACTIONS_UI_ENABLED && editingRep && (
        <div className="srm-modal-overlay" onClick={handleCloseEdit}>
          <div
            className="srm-modal-panel"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-own-sales-rep-modal-title"
          >
            <div className="srm-modal-header">
              <h2 id="edit-own-sales-rep-modal-title">Edit Sales Rep</h2>
              <button type="button" className="srm-modal-close-btn" onClick={handleCloseEdit} disabled={savingEdit} aria-label="Close">
                &times;
              </button>
            </div>
            <form className="srm-modal-form" onSubmit={handleSaveEdit}>
              <p className="srm-modal-helper">
                Changing the email sends a verification link to the new address — the sign-in email does not change until that link is confirmed.
              </p>
              <div className="srm-modal-field">
                <label className="srm-modal-label" htmlFor="manager-edit-rep-full-name">Full Name</label>
                <input
                  id="manager-edit-rep-full-name"
                  type="text"
                  className="srm-modal-input"
                  value={editFullName}
                  onChange={(event) => setEditFullName(event.target.value)}
                  required
                />
              </div>
              <div className="srm-modal-field">
                <label className="srm-modal-label" htmlFor="manager-edit-rep-email">WFG Email</label>
                <input
                  id="manager-edit-rep-email"
                  type="email"
                  className="srm-modal-input"
                  value={editEmail}
                  onChange={(event) => setEditEmail(event.target.value)}
                  required
                />
              </div>
              {editMessage && (
                <p className={editMessage.isError ? 'sales-rep-management-message-error' : 'sales-rep-management-message-success'} role={editMessage.isError ? 'alert' : 'status'}>
                  {editMessage.text}
                </p>
              )}
              <div className="srm-modal-actions">
                <button type="button" className="btn btn-secondary" onClick={handleCloseEdit} disabled={savingEdit}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={savingEdit}>{savingEdit ? 'Saving…' : 'Save Changes'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {MANAGER_ACCOUNT_ACTIONS_UI_ENABLED && pendingRemoval && (
        <div className="srm-modal-overlay" role="presentation" onClick={() => !removingAssignment && setPendingRemoval(null)}>
          <div
            className="srm-confirm-panel"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="remove-assignment-title"
            aria-describedby="remove-assignment-message"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="remove-assignment-title">Remove Manager Assignment</h2>
            <p id="remove-assignment-message">
              Remove {pendingRemoval.fullName ?? 'this Sales Rep'}'s assignment to you? Their account and historical reports will remain unchanged.
            </p>
            <div className="srm-modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setPendingRemoval(null)} disabled={removingAssignment}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={handleConfirmRemoveAssignment} disabled={removingAssignment}>
                {removingAssignment ? 'Removing…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
