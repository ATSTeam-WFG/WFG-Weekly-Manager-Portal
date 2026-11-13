import StatusBadge from './StatusBadge'
import { getCurrentReportingWeek, getDaysUntilDeadline } from '../utils/week'
import { getManagerWriteLockReason, MANAGER_WRITE_LOCK_MESSAGES } from '../lib/managerEditLock'
import { isPastEasternCutoff } from '../utils/easternTime'
import type { ReportStatus } from '../types'
import './ManagerWeeklyReportCard.css'

interface ManagerWeeklyReportCardProps {
  status: ReportStatus
  statusLoaded: boolean
  statusLoadError: boolean
  onStart: () => void
  onContinue: () => void
  onEditSubmitted: () => void
}

// A compact version of Dashboard.tsx's own hero card, for the Manager
// Dashboard overview's "My Weekly Report" section. Deliberately NOT an
// extraction of Dashboard.tsx (which is shared with Admin-as-submitter and
// Sales Admin's own My Reports view, and is left untouched) — instead reuses
// the same underlying deadline/lock utilities (getManagerWriteLockReason,
// isPastEasternCutoff, getCurrentReportingWeek) Dashboard.tsx itself calls,
// so the actual business rule (the one real source of truth) is never
// duplicated, only its compact presentation here is new.
export default function ManagerWeeklyReportCard({
  status,
  statusLoaded,
  statusLoadError,
  onStart,
  onContinue,
  onEditSubmitted,
}: ManagerWeeklyReportCardProps) {
  const week = getCurrentReportingWeek()
  const daysLeft = getDaysUntilDeadline(week.fridayDate)
  const isPastDeadline = isPastEasternCutoff(15, 0)
  const isDueToday = !isPastDeadline && daysLeft <= 0

  const isNewReport = status === 'not_started'
  const lockReason = getManagerWriteLockReason(isNewReport)

  const actionLabel = status === 'not_started' ? 'Start Report' : status === 'draft' ? 'Continue Draft' : 'Edit Submitted Report'
  const onAction = status === 'not_started' ? onStart : status === 'draft' ? onContinue : onEditSubmitted

  return (
    <div className="mwrc-card">
      <div className="mwrc-top">
        <div>
          <span className="mwrc-label">My Weekly Report</span>
          <p className="mwrc-week">Week of {week.label}</p>
        </div>
        {!statusLoadError && statusLoaded && <StatusBadge status={status} />}
      </div>

      {statusLoadError ? (
        <p className="mwrc-message">We couldn&apos;t load your report status. Please refresh and try again.</p>
      ) : !statusLoaded ? (
        <p className="mwrc-message">Loading…</p>
      ) : lockReason ? (
        <p className="mwrc-message">{MANAGER_WRITE_LOCK_MESSAGES[lockReason]}</p>
      ) : (
        <div className="mwrc-action-row">
          <span className={`mwrc-deadline${isPastDeadline ? ' mwrc-deadline-passed' : ''}`}>
            {isPastDeadline ? 'Deadline passed' : isDueToday ? 'Due today' : `Due ${week.deadlineLabel}`}
          </span>
          <button type="button" className="btn btn-primary" onClick={onAction}>
            {actionLabel}
          </button>
        </div>
      )}
    </div>
  )
}
