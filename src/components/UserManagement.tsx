import { useEffect, useState, type FormEvent } from 'react'
import {
  fetchManagedUsers,
  createManagerAccount,
  createAccountForExistingEmployee,
  setUserActive,
  updateManagedEmployee,
  type ManagedUser,
} from '../lib/adminUserManagementService'
import AddEmployeeModal from './AddEmployeeModal'
import './StatusBadge.css'
import './UserManagement.css'

interface UserManagementProps {
  onBack: () => void
  // The signed-in Admin's own email — used only for the client-side
  // self-lockout defense in depth (disabling the role field when editing
  // your own row). The server independently re-verifies this itself from
  // the caller's own authenticated session; this prop is never trusted as
  // the actual safeguard.
  currentUserEmail: string | null
}

const STATUS_LABELS: Record<ManagedUser['status'], string> = {
  pending: 'Pending',
  awaiting_first_login: 'Awaiting First Login',
  active: 'Active',
  inactive: 'Inactive',
}

type StatusFilter = 'all' | ManagedUser['status']

const STATUS_FILTER_OPTIONS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'pending', label: 'Pending' },
  { key: 'awaiting_first_login', label: 'Awaiting First Login' },
  { key: 'inactive', label: 'Inactive' },
]

function createAccountPlaceholderMessage(status: string): string | null {
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
      return 'This email is already assigned an Admin role.'
    case 'inactive':
      return 'This employee is deactivated. Reactivate them before creating an account.'
    default:
      return 'Something went wrong creating the account. Please try again.'
  }
}

export default function UserManagement({ onBack, currentUserEmail }: UserManagementProps) {
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [loading, setLoading] = useState(true)
  // Holds the safe {code, message} from fetchManagedUsers's error outcome —
  // never raw Supabase/service-role detail (see FetchManagedUsersOutcome) —
  // so the failure actually shown on screen is specific enough to diagnose,
  // rather than one indistinguishable generic message for every cause.
  const [loadError, setLoadError] = useState<{ code: string; message: string } | null>(null)

  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [creatingAccount, setCreatingAccount] = useState(false)
  const [createAccountMessage, setCreateAccountMessage] = useState<string | null>(null)
  const [createAccountMessageIsError, setCreateAccountMessageIsError] = useState(false)

  const [rowActionEmail, setRowActionEmail] = useState<string | null>(null)
  const [rowMessage, setRowMessage] = useState<{ email: string; text: string; isError: boolean } | null>(null)

  // Edit Employee — identified throughout by the row's stable id, never by
  // email (email is one of the fields being edited).
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editFullName, setEditFullName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editRole, setEditRole] = useState<'manager' | 'admin'>('manager')
  const [editSubmitsWeeklyReport, setEditSubmitsWeeklyReport] = useState(false)
  const [savingEdit, setSavingEdit] = useState(false)
  const [editMessage, setEditMessage] = useState<{ id: string; text: string; isError: boolean } | null>(null)

  // Presentation-only, screen-side search/filter over the already-fetched
  // `users` array — no new query, no re-fetch. fetchManagedUsers() already
  // returns the complete list in one call (see adminUserManagementService.ts,
  // untouched), the same precondition ManagerReportsTable's own client-side
  // search/filter (Reports & Analytics) already relies on.
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const loadUsers = () => {
    setLoading(true)
    setLoadError(null)
    fetchManagedUsers().then((outcome) => {
      if (outcome.status === 'ok') {
        setUsers(outcome.users)
      } else {
        setLoadError({ code: outcome.code, message: outcome.message })
      }
      setLoading(false)
    })
  }

  useEffect(() => {
    loadUsers()
    // Runs once on mount only — every mutation below re-fetches explicitly
    // after it completes, rather than depending on any value here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Four KPI counts — derived strictly from the already-fetched `users`
  // array below, never hardcoded and never a separate fetch. Pending users
  // are counted in totalCount but have no KPI card of their own, per the
  // approved design.
  const totalCount = users.length
  const activeCount = users.filter((u) => u.status === 'active').length
  const awaitingFirstLoginCount = users.filter((u) => u.status === 'awaiting_first_login').length
  const inactiveCount = users.filter((u) => u.status === 'inactive').length

  const filteredUsers = users.filter((user) => {
    if (statusFilter !== 'all' && user.status !== statusFilter) return false
    const term = search.trim().toLowerCase()
    if (term.length === 0) return true
    return user.fullName.toLowerCase().includes(term) || user.email.toLowerCase().includes(term)
  })

  const handleOpenAddModal = () => {
    setCreateAccountMessage(null)
    setIsAddModalOpen(true)
  }

  // Never closes while an account operation is actively submitting — the
  // same guard the modal's own backdrop/Escape/Cancel all defer to.
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
    const outcome = await createManagerAccount(trimmedName, trimmedEmail)
    setCreatingAccount(false)

    const isSuccess = outcome.status === 'created'
    setCreateAccountMessageIsError(!isSuccess)
    setCreateAccountMessage(createAccountPlaceholderMessage(outcome.status))

    if (isSuccess) {
      setFullName('')
      setEmail('')
      loadUsers()
    }
  }

  const handleCreateAccountForExisting = async (user: ManagedUser) => {
    setRowActionEmail(user.email)
    setRowMessage(null)
    const outcome = await createAccountForExistingEmployee(user.email)
    setRowActionEmail(null)

    if (outcome.status === 'created') {
      setRowMessage({
        email: user.email,
        text: 'Account created. Send them their WFG email, the portal URL, and the temporary password through your usual internal channel.',
        isError: false,
      })
      loadUsers()
      return
    }
    const text =
      outcome.status === 'not_found'
        ? 'No matching approved employee was found.'
        : outcome.status === 'already_registered'
          ? 'This person already has a portal account.'
          : outcome.status === 'already_created'
            ? 'An account has already been created for this person and is awaiting their first login.'
            : outcome.status === 'inactive'
              ? 'This employee is deactivated. Reactivate them before creating an account.'
              : 'Could not create the account. Please try again.'
    setRowMessage({ email: user.email, text, isError: true })
  }

  const handleToggleActive = async (user: ManagedUser) => {
    const nextActive = user.status === 'inactive'
    setRowActionEmail(user.email)
    setRowMessage(null)
    const outcome = await setUserActive(user.email, nextActive)
    setRowActionEmail(null)

    if (outcome.status === 'ok') {
      loadUsers()
      return
    }
    setRowMessage({ email: user.email, text: 'Could not update this user. Please try again.', isError: true })
  }

  const isEditingSelf =
    editingId !== null &&
    !!currentUserEmail &&
    users.find((u) => u.id === editingId)?.email.trim().toLowerCase() === currentUserEmail.trim().toLowerCase()

  const handleStartEdit = (user: ManagedUser) => {
    setEditingId(user.id)
    setEditFullName(user.fullName)
    setEditEmail(user.email)
    setEditRole(user.role)
    setEditSubmitsWeeklyReport(user.submitsWeeklyReport)
    setEditMessage(null)
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    setEditMessage(null)
  }

  const handleSaveEdit = async (e: FormEvent, user: ManagedUser) => {
    e.preventDefault()
    setEditMessage(null)

    const trimmedName = editFullName.trim()
    const trimmedEmail = editEmail.trim()
    if (!trimmedName || !trimmedEmail) {
      setEditMessage({ id: user.id, text: 'A name and email are required.', isError: true })
      return
    }

    setSavingEdit(true)
    const outcome = await updateManagedEmployee(user.id, trimmedName, trimmedEmail, editRole, editSubmitsWeeklyReport)
    setSavingEdit(false)

    if (outcome.status === 'ok') {
      setEditingId(null)
      loadUsers()
      return
    }
    const text =
      outcome.status === 'not_found'
        ? 'This employee could not be found. Please refresh and try again.'
        : outcome.status === 'invalid_domain'
          ? 'Only approved @wfgtitle.com email addresses can be used.'
          : outcome.status === 'email_conflict'
            ? 'That email address is already in use by another portal account.'
            : outcome.status === 'self_role_change_blocked'
              ? 'You cannot remove your own Admin access.'
              : outcome.status === 'auth_identity_unresolved'
                ? 'This account was created before we could safely verify its sign-in identity. Name, role, and weekly-report settings can still be edited, but the email cannot be changed until this is resolved — please contact support.'
                : outcome.status === 'partial_failure'
                  ? 'Something went wrong while saving this change and it may be incomplete. Do NOT retry — please contact support before making any further changes to this employee.'
                  : 'Could not save these changes. Please try again.'
    setEditMessage({ id: user.id, text, isError: true })
  }

  return (
    <div className="user-management">
      <button type="button" className="link-btn back-link" onClick={onBack}>
        &larr; Back to Admin Dashboard
      </button>

      <div className="um-header">
        <div className="um-header-titles">
          <h1>User Management</h1>
          <p className="um-header-subtitle">Manage employee access, roles, and weekly reporting permissions.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={handleOpenAddModal}>
          + Add Employee
        </button>
      </div>

      {loading ? (
        <div className="um-loading">Loading users…</div>
      ) : loadError ? (
        <p className="user-management-message-error">
          Could not load the user list: {loadError.message} (Error: {loadError.code}). Please refresh and try again.
        </p>
      ) : (
        <>
          <div className="um-kpi-row">
            <div className="um-kpi-card um-kpi-card-total">
              <span className="um-kpi-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="9" cy="8" r="3" />
                  <path d="M4 20c0-3 2.5-5 5-5s5 2 5 5" />
                  <circle cx="17" cy="9" r="2.5" />
                  <path d="M15.5 20c0-2.5 1-4 3-4.5" />
                </svg>
              </span>
              <div className="um-kpi-text">
                <span className="um-kpi-value">{totalCount}</span>
                <span className="um-kpi-label">Total Users</span>
              </div>
            </div>
            <div className="um-kpi-card um-kpi-card-active">
              <span className="um-kpi-icon" aria-hidden="true">
                &#10003;
              </span>
              <div className="um-kpi-text">
                <span className="um-kpi-value">{activeCount}</span>
                <span className="um-kpi-label">Active</span>
              </div>
            </div>
            <div className="um-kpi-card um-kpi-card-awaiting">
              <span className="um-kpi-icon" aria-hidden="true">
                &#8987;
              </span>
              <div className="um-kpi-text">
                <span className="um-kpi-value">{awaitingFirstLoginCount}</span>
                <span className="um-kpi-label">Awaiting First Login</span>
              </div>
            </div>
            <div className="um-kpi-card um-kpi-card-inactive">
              <span className="um-kpi-icon" aria-hidden="true">
                &#9675;
              </span>
              <div className="um-kpi-text">
                <span className="um-kpi-value">{inactiveCount}</span>
                <span className="um-kpi-label">Inactive</span>
              </div>
            </div>
          </div>

          <div className="um-controls">
            <input
              type="search"
              className="um-search"
              placeholder="Search employees by name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search employees"
            />
            <select
              className="um-status-filter"
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

          {filteredUsers.length === 0 ? (
            <p className="um-empty-state">
              {users.length === 0 ? 'No users found yet.' : 'No employees match this search/filter.'}
            </p>
          ) : (
            <div className="um-table" role="table" aria-label="Employees">
              <div className="um-table-header-row" role="row">
                <span role="columnheader">Employee</span>
                <span role="columnheader">Role</span>
                <span role="columnheader">Weekly Report</span>
                <span role="columnheader">Status</span>
                <span role="columnheader">Actions</span>
              </div>
              {filteredUsers.map((user) =>
                editingId === user.id ? (
                  <div className="um-row um-row-editing" role="row" key={user.id}>
                    <form className="user-management-edit-form" onSubmit={(e) => handleSaveEdit(e, user)}>
                      <div className="user-management-edit-fields">
                        <div className="user-management-field">
                          <label className="um-field-label" htmlFor={`edit-full-name-${user.id}`}>
                            Full Name
                          </label>
                          <input
                            id={`edit-full-name-${user.id}`}
                            type="text"
                            className="um-field-input"
                            value={editFullName}
                            onChange={(e) => setEditFullName(e.target.value)}
                            required
                          />
                        </div>
                        <div className="user-management-field">
                          <label className="um-field-label" htmlFor={`edit-email-${user.id}`}>
                            Email
                          </label>
                          <input
                            id={`edit-email-${user.id}`}
                            type="email"
                            className="um-field-input"
                            value={editEmail}
                            onChange={(e) => setEditEmail(e.target.value)}
                            required
                          />
                        </div>
                        <div className="user-management-field">
                          <label className="um-field-label" htmlFor={`edit-role-${user.id}`}>
                            Portal Role
                          </label>
                          <select
                            id={`edit-role-${user.id}`}
                            className="um-field-input"
                            value={editRole}
                            onChange={(e) => setEditRole(e.target.value as 'manager' | 'admin')}
                            disabled={isEditingSelf}
                          >
                            <option value="manager">Manager</option>
                            <option value="admin">Admin</option>
                          </select>
                          {isEditingSelf && (
                            <span className="user-management-field-note">You cannot change your own role.</span>
                          )}
                        </div>
                        <div className="user-management-field user-management-field-checkbox">
                          <label className="um-field-label" htmlFor={`edit-submits-${user.id}`}>
                            <input
                              id={`edit-submits-${user.id}`}
                              type="checkbox"
                              checked={editSubmitsWeeklyReport}
                              onChange={(e) => setEditSubmitsWeeklyReport(e.target.checked)}
                            />
                            Submits Weekly Report
                          </label>
                        </div>
                      </div>
                      {editMessage && editMessage.id === user.id && (
                        <p className={editMessage.isError ? 'user-management-message-error' : 'user-management-message-success'}>
                          {editMessage.text}
                        </p>
                      )}
                      <div className="user-management-edit-actions">
                        <button type="submit" className="btn btn-primary" disabled={savingEdit}>
                          {savingEdit ? 'Saving…' : 'Save Changes'}
                        </button>
                        <button type="button" className="btn btn-secondary" onClick={handleCancelEdit} disabled={savingEdit}>
                          Cancel
                        </button>
                      </div>
                    </form>
                  </div>
                ) : (
                  <div className="um-row" role="row" key={user.id}>
                    <div className="um-cell um-cell-employee" role="cell">
                      <span className="um-employee-name">{user.fullName}</span>
                      <span className="um-employee-email">{user.email}</span>
                    </div>
                    <div className="um-cell" role="cell">
                      <span className={`status-badge role-badge role-${user.role}`}>
                        {user.role === 'admin' ? 'Admin' : 'Manager'}
                      </span>
                    </div>
                    <div className="um-cell" role="cell">
                      {user.submitsWeeklyReport ? (
                        <span className="status-badge um-weekly-badge">Required</span>
                      ) : (
                        <span className="um-weekly-dash">&mdash;</span>
                      )}
                    </div>
                    <div className="um-cell" role="cell">
                      <span className={`status-badge user-status-badge user-status-${user.status}`}>
                        {STATUS_LABELS[user.status]}
                      </span>
                    </div>
                    <div className="um-cell um-cell-actions" role="cell">
                      {user.status === 'pending' && (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={rowActionEmail === user.email}
                          onClick={() => handleCreateAccountForExisting(user)}
                        >
                          Create Account
                        </button>
                      )}
                      {user.role === 'manager' && (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={rowActionEmail === user.email}
                          onClick={() => handleToggleActive(user)}
                        >
                          {user.status === 'inactive' ? 'Reactivate' : 'Deactivate'}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={rowActionEmail === user.email}
                        onClick={() => handleStartEdit(user)}
                      >
                        Edit
                      </button>
                    </div>
                    {rowMessage && rowMessage.email === user.email && (
                      <p
                        className={`um-row-message ${rowMessage.isError ? 'user-management-message-error' : 'user-management-message-success'}`}
                      >
                        {rowMessage.text}
                      </p>
                    )}
                  </div>
                ),
              )}
            </div>
          )}
        </>
      )}

      <AddEmployeeModal
        isOpen={isAddModalOpen}
        fullName={fullName}
        email={email}
        onFullNameChange={setFullName}
        onEmailChange={setEmail}
        onSubmit={handleCreateAccountSubmit}
        onClose={handleCloseAddModal}
        creating={creatingAccount}
        message={createAccountMessage}
        messageIsError={createAccountMessageIsError}
      />
    </div>
  )
}
