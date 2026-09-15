import { useState } from 'react'
import StatusBadge from './StatusBadge'
import type { ReminderTarget } from '../lib/reminderService'
import type { ReportingWeek } from '../utils/week'
import './ReminderPanel.css'

interface ReminderPanelProps {
  managers: ReminderTarget[]
  week: ReportingWeek
  isPastDeadline: boolean
  onClose: () => void
}

function buildReminderMessage(manager: ReminderTarget, week: ReportingWeek, isPastDeadline: boolean): string {
  const firstName = manager.fullName.split(' ')[0] || manager.fullName
  const deadlinePhrase = isPastDeadline ? `was due ${week.deadlineLabel}` : `is due ${week.deadlineLabel}`
  const closingPhrase = isPastDeadline
    ? 'please submit it as soon as possible'
    : 'please submit it before the deadline'
  const statusPhrase =
    manager.status === 'draft'
      ? `I can see you've started your report, but it hasn't been submitted yet — ${closingPhrase}.`
      : `It looks like your report hasn't been started yet — ${closingPhrase}.`

  return `Hi ${firstName},\n\nThis is a friendly reminder that your Weekly Manager Report for the week of ${week.label} ${deadlinePhrase}. ${statusPhrase}\n\nThank you!`
}

// Per-card, per-field transient copy feedback. Keyed as `${managerId}:${field}`
// so each of the two Copy buttons on each card has its own independent
// "Copied!" / "Couldn't copy" state — copying on one card/field never
// affects any other's displayed state.
type CopyField = 'email' | 'message'
type CopyState = 'copied' | 'error'

function copyKey(managerId: string, field: CopyField): string {
  return `${managerId}:${field}`
}

const COPY_FEEDBACK_MS = 1500

export default function ReminderPanel({ managers, week, isPastDeadline, onClose }: ReminderPanelProps) {
  const [copyStates, setCopyStates] = useState<Record<string, CopyState>>({})

  const isBulk = managers.length > 1

  // Manual-copy only — this never calls any API and never sends anything.
  // A clipboard failure (unsupported browser, insecure context, permission
  // denial) is caught here and only affects this one button's own feedback
  // state; it never throws, never affects any other card, and never
  // disables the rest of the panel.
  async function handleCopy(text: string, key: string) {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard API unavailable')
      }
      await navigator.clipboard.writeText(text)
      setCopyStates((prev) => ({ ...prev, [key]: 'copied' }))
    } catch {
      setCopyStates((prev) => ({ ...prev, [key]: 'error' }))
    } finally {
      window.setTimeout(() => {
        setCopyStates((prev) => {
          if (prev[key] === undefined) return prev
          const next = { ...prev }
          delete next[key]
          return next
        })
      }, COPY_FEEDBACK_MS)
    }
  }

  function copyButtonLabel(key: string, defaultLabel: string): string {
    if (copyStates[key] === 'copied') return 'Copied!'
    if (copyStates[key] === 'error') return "Couldn't copy"
    return defaultLabel
  }

  return (
    <div className="reminder-overlay" onClick={onClose}>
      <div className="reminder-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="reminder-panel-header">
          <h2>{isBulk ? `Review Reminders (${managers.length})` : 'Reminder Preview'}</h2>
          <button type="button" className="reminder-close-btn" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        <div className="reminder-panel-meta">
          <span>Week of {week.label}</span>
          <span className={`reminder-deadline-pill ${isPastDeadline ? 'passed' : ''}`}>
            {isPastDeadline ? 'Deadline passed' : `Due ${week.deadlineLabel}`}
          </span>
        </div>

        <div className="reminder-list">
          {managers.map((manager) => {
            const message = buildReminderMessage(manager, week, isPastDeadline)
            const emailKey = copyKey(manager.id, 'email')
            const messageKey = copyKey(manager.id, 'message')

            return (
              <div className="reminder-card" key={manager.id}>
                <div className="reminder-card-header">
                  <span className="reminder-card-name">{manager.fullName}</span>
                  <StatusBadge status={manager.status} />
                </div>
                <p className={`reminder-card-email ${manager.email ? '' : 'reminder-card-email-missing'}`}>
                  To: {manager.email || 'Email not available'}
                </p>
                <p className="reminder-message">{message}</p>
                <div className="reminder-card-actions">
                  <button
                    type="button"
                    className="btn btn-secondary reminder-copy-btn"
                    onClick={() => manager.email && handleCopy(manager.email, emailKey)}
                    disabled={!manager.email}
                  >
                    {copyButtonLabel(emailKey, 'Copy Email')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary reminder-copy-btn"
                    onClick={() => handleCopy(message, messageKey)}
                  >
                    {copyButtonLabel(messageKey, 'Copy Message')}
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        <div className="reminder-panel-footer">
          <p className="reminder-disabled-note">
            Automatic sending is not enabled — copy the email and message for each manager and send it yourself.
          </p>
          <div className="reminder-panel-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
