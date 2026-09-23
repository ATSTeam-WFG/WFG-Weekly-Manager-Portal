import { useEffect, useRef, type FormEvent } from 'react'
import './AddEmployeeModal.css'

interface AddEmployeeModalProps {
  isOpen: boolean
  fullName: string
  email: string
  onFullNameChange: (value: string) => void
  onEmailChange: (value: string) => void
  onSubmit: (e: FormEvent) => void
  onClose: () => void
  // Only ever reflects UserManagement.tsx's own `creatingAccount` state —
  // this component has no idea what "submitting" means beyond that flag.
  creating: boolean
  message: string | null
  messageIsError: boolean
}

// Purely presentational — every field value, the submit handler, and the
// create-account outcome message all live in UserManagement.tsx exactly as
// before. This component owns only the modal's own UI mechanics (backdrop,
// outside-click, Escape, focus-on-open, and the "don't close mid-submit"
// guard) around the SAME form/handler, never a second implementation of the
// account-creation flow.
export default function AddEmployeeModal({
  isOpen,
  fullName,
  email,
  onFullNameChange,
  onEmailChange,
  onSubmit,
  onClose,
  creating,
  message,
  messageIsError,
}: AddEmployeeModalProps) {
  const fullNameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) fullNameInputRef.current?.focus()
  }, [isOpen])

  // Escape closes the modal — but never while an account operation is
  // actively submitting, same guard as the backdrop/Cancel below.
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !creating) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, creating, onClose])

  if (!isOpen) return null

  const handleOverlayClick = () => {
    if (!creating) onClose()
  }

  return (
    <div className="um-modal-overlay" onClick={handleOverlayClick}>
      <div
        className="um-modal-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-employee-modal-title"
      >
        <div className="um-modal-header">
          <h2 id="add-employee-modal-title">Add Employee</h2>
          <button
            type="button"
            className="um-modal-close-btn"
            onClick={onClose}
            disabled={creating}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <form className="um-modal-form" onSubmit={onSubmit}>
          <p className="um-modal-helper">
            Enter the employee's name and WFG email to create their portal account with the shared temporary password.
          </p>

          <div className="um-modal-field">
            <label className="um-modal-label" htmlFor="invite-full-name">
              Full Name
            </label>
            <input
              id="invite-full-name"
              ref={fullNameInputRef}
              type="text"
              className="um-modal-input"
              value={fullName}
              onChange={(e) => onFullNameChange(e.target.value)}
              placeholder="Jane Manager"
              required
            />
          </div>

          <div className="um-modal-field">
            <label className="um-modal-label" htmlFor="invite-email">
              WFG Email
            </label>
            <input
              id="invite-email"
              type="email"
              className="um-modal-input"
              value={email}
              onChange={(e) => onEmailChange(e.target.value)}
              placeholder="jane.manager@wfgtitle.com"
              required
            />
          </div>

          {message && (
            <p className={messageIsError ? 'user-management-message-error' : 'user-management-message-success'}>
              {message}
            </p>
          )}

          <div className="um-modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={creating}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={creating}>
              {creating ? 'Creating…' : 'Create Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
