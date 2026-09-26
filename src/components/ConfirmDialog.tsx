import './ConfirmDialog.css'

interface ConfirmDialogProps {
  message: string
  onConfirm: () => void
  onCancel: () => void
}

// A minimal, dependency-free confirm/cancel modal — reused wherever this
// app needs a visible "are you sure" prompt instead of window.confirm().
// window.confirm() was tried first for the Leadership Report unsaved-edit
// guards; it was replaced here only after directly confirming (via
// window.confirm('test') in the actual preview environment used for this
// app's manual QA) that it silently resolves to false with NO visible
// dialog at all in that environment — a real inability of the native
// dialog to satisfy "a visible confirmation must appear," not a stylistic
// preference for a custom one.
//
// Title is fixed ("Unsaved Changes") rather than a prop — every current
// caller's own `message` describes the same "you have unsaved changes"
// situation, just worded slightly differently per call site; the title
// makes that generic enough to not need per-caller customization.
export default function ConfirmDialog({ message, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div
      className="confirm-dialog-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel()
      }}
    >
      <div className="confirm-dialog-card">
        <h2 id="confirm-dialog-title" className="confirm-dialog-title">
          Unsaved Changes
        </h2>
        <p className="confirm-dialog-message">{message}</p>
        <div className="confirm-dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} autoFocus>
            Continue
          </button>
        </div>
      </div>
    </div>
  )
}
