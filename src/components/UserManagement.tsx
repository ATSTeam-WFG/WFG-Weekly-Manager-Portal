import { useEffect, useState, type FormEvent } from 'react'
import {
  fetchManagedUsers,
  createManagerAccount,
  createAccountForExistingEmployee,
  setUserActive,
  type ManagedUser,
} from '../lib/adminUserManagementService'
import './StatusBadge.css'
import './UserManagement.css'

interface UserManagementProps {
  onBack: () => void
}

const STATUS_LABELS: Record<ManagedUser['status'], string> = {
  pending: 'Pending',
  awaiting_first_login: 'Awaiting First Login',
  active: 'Active',
  inactive: 'Inactive',
}

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

export default function UserManagement({ onBack }: UserManagementProps) {
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [loading, setLoading] = useState(true)
  // Holds the safe {code, message} from fetchManagedUsers's error outcome —
  // never raw Supabase/service-role detail (see FetchManagedUsersOutcome) —
  // so the failure actually shown on screen is specific enough to diagnose,
  // rather than one indistinguishable generic message for every cause.
  const [loadError, setLoadError] = useState<{ code: string; message: string } | null>(null)

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [creatingAccount, setCreatingAccount] = useState(false)
  const [createAccountMessage, setCreateAccountMessage] = useState<string | null>(null)
  const [createAccountMessageIsError, setCreateAccountMessageIsError] = useState(false)

  const [rowActionEmail, setRowActionEmail] = useState<string | null>(null)
  const [rowMessage, setRowMessage] = useState<{ email: string; text: string; isError: boolean } | null>(null)

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

  return (
    <div className="user-management">
      <button type="button" className="link-btn back-link" onClick={onBack}>
        &larr; Back to Admin Dashboard
      </button>

      <div className="user-management-heading">
        <h1>User Management</h1>
      </div>

      <div className="user-management-add-card">
        <h2>Add Manager</h2>
        <p className="user-management-add-helper">
          Enter the employee's name and WFG email to create their portal account with the shared temporary password.
        </p>
        <form className="user-management-add-form" onSubmit={handleCreateAccountSubmit}>
          <div className="user-management-add-fields">
            <div className="user-management-field">
              <label className="login-label" htmlFor="invite-full-name">
                Full Name
              </label>
              <input
                id="invite-full-name"
                type="text"
                className="login-input"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Jane Manager"
                required
              />
            </div>
            <div className="user-management-field">
              <label className="login-label" htmlFor="invite-email">
                WFG Email
              </label>
              <input
                id="invite-email"
                type="email"
                className="login-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jane.manager@wfgtitle.com"
                required
              />
            </div>
          </div>
          {createAccountMessage && (
            <p className={createAccountMessageIsError ? 'user-management-message-error' : 'user-management-message-success'}>
              {createAccountMessage}
            </p>
          )}
          <button type="submit" className="btn btn-primary" disabled={creatingAccount}>
            {creatingAccount ? 'Creating…' : 'Create Account'}
          </button>
        </form>
      </div>

      <div className="user-management-list-card">
        <h2>Portal Users</h2>
        {loading ? (
          <p className="admin-loading">Loading users…</p>
        ) : loadError ? (
          <p className="user-management-message-error">
            Could not load the user list: {loadError.message} (Error: {loadError.code}). Please refresh and try again.
          </p>
        ) : users.length === 0 ? (
          <p className="admin-empty-state">No users found yet.</p>
        ) : (
          <ul className="user-management-list">
            {users.map((user) => (
              <li key={user.email} className="user-management-row">
                <div className="user-management-row-main">
                  <span className="user-management-name">{user.fullName}</span>
                  <span className="user-management-email">{user.email}</span>
                </div>
                <span className={`status-badge role-badge role-${user.role}`}>
                  {user.role === 'admin' ? 'Admin' : 'Manager'}
                </span>
                <span className={`status-badge user-status-badge user-status-${user.status}`}>
                  {STATUS_LABELS[user.status]}
                </span>
                {user.submitsWeeklyReport && (
                  <span className="status-badge submits-report-badge" title="This person submits their own weekly report">
                    Submits Weekly Report
                  </span>
                )}
                <div className="user-management-row-actions">
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
                </div>
                {rowMessage && rowMessage.email === user.email && (
                  <p className={rowMessage.isError ? 'user-management-message-error' : 'user-management-message-success'}>
                    {rowMessage.text}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
