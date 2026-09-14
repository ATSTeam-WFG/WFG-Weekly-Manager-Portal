import { useEffect } from 'react'
import StatusBadge from './StatusBadge'
import type { ManagerSummary } from '../lib/adminService'
import type { ReportingWeek } from '../utils/week'
import './ReminderPanel.css'

interface ReminderPanelProps {
  managers: ManagerSummary[]
  week: ReportingWeek
  isPastDeadline: boolean
  onClose: () => void
}

function buildReminderMessage(manager: ManagerSummary, week: ReportingWeek, isPastDeadline: boolean): string {
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

export default function ReminderPanel({ managers, week, isPastDeadline, onClose }: ReminderPanelProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const isBulk = managers.length > 1

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
          {managers.map((manager) => (
            <div className="reminder-card" key={manager.id}>
              <div className="reminder-card-header">
                <span className="reminder-card-name">{manager.fullName}</span>
                <StatusBadge status={manager.status} />
              </div>
              <p className={`reminder-card-email ${manager.email ? '' : 'reminder-card-email-missing'}`}>
                To: {manager.email || 'Email not available'}
              </p>
              <p className="reminder-message">{buildReminderMessage(manager, week, isPastDeadline)}</p>
            </div>
          ))}
        </div>

        <div className="reminder-panel-footer">
          <p className="reminder-disabled-note">Email sending is not connected yet.</p>
          <div className="reminder-panel-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Close
            </button>
            <button type="button" className="btn btn-primary" disabled>
              {isBulk ? `Send ${managers.length} Reminders` : 'Send Reminder'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
