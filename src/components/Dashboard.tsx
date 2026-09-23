import { useEffect, useState } from 'react'
import StatusBadge from './StatusBadge'
import { fetchReportHistory, type ManagerReportHistoryEntry } from '../lib/reportsService'
import { getCurrentReportingWeek, getDaysUntilDeadline } from '../utils/week'
import { getManagerWriteLockReason, MANAGER_WRITE_LOCK_MESSAGES } from '../lib/managerEditLock'
import { isPastEasternCutoff } from '../utils/easternTime'
import type { ReportStatus } from '../types'
import './Dashboard.css'

interface DashboardProps {
  status: ReportStatus
  managerId: string
  statusLoaded: boolean
  // True only when the most recent fetch of this manager/week's report
  // genuinely failed (a Supabase/network error) — never true for a real
  // "no report exists yet" result. Checked before `status` is used for
  // anything in the hero card below, so a failed fetch can never render as
  // "Not Started": `status` may still hold a stale or default value, but
  // it's never trusted while this is true.
  statusLoadError: boolean
  reminderDismissed: boolean
  onDismissReminder: () => void
  onStart: () => void
  onContinue: () => void
  onEditSubmitted: () => void
  onViewHistoryEntry: (entry: ManagerReportHistoryEntry) => void
}

export default function Dashboard({
  status,
  managerId,
  statusLoaded,
  statusLoadError,
  reminderDismissed,
  onDismissReminder,
  onStart,
  onContinue,
  onEditSubmitted,
  onViewHistoryEntry,
}: DashboardProps) {
  const week = getCurrentReportingWeek()
  const daysLeft = getDaysUntilDeadline(week.fridayDate)
  // getDaysUntilDeadline is calendar-day granularity only (it returns 0 for
  // all of Friday, from 12:00 AM through 11:59 PM) — it was never meant to
  // answer "has the 3:00 PM deadline itself passed". That real, time-of-day
  // question is answered by isPastEasternCutoff, the same DST-safe check
  // the 4:00 PM manager write lock and the "late edit window" notice below
  // already use.
  const isPastDeadline = isPastEasternCutoff(15, 0)
  const isDueToday = !isPastDeadline && daysLeft <= 0

  const [history, setHistory] = useState<ManagerReportHistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)

  useEffect(() => {
    let active = true
    setHistoryLoading(true)

    fetchReportHistory(managerId, week.weekStartDate).then((result) => {
      if (!active) return
      setHistory(result)
      setHistoryLoading(false)
    })

    return () => {
      active = false
    }
  }, [managerId, week.weekStartDate])

  // A report row already exists once status is 'draft' or 'submitted' —
  // only 'not_started' means "no row yet", i.e. a genuinely new report.
  // Still passed through to getManagerWriteLockReason for call-signature
  // stability, even though a new vs. existing report no longer changes the
  // lock decision itself — see managerEditLock.ts.
  const isNewReport = status === 'not_started'
  // null = fully open; 'edit_locked' = past 4:00 PM, nothing can be written
  // regardless of status (new or existing). See src/lib/managerEditLock.ts
  // for the shared decision logic — the same function the service-layer
  // guard and (independently) the database trigger use, so all three layers
  // agree on the same instant.
  const lockReason = getManagerWriteLockReason(isNewReport)
  // Shown for EVERY status, including Not Started — a manager who starts
  // their report during the 3:00-3:59 PM grace period needs the same
  // "until 4:00 PM ET" notice an existing draft already gets, since the
  // same single cutoff now applies to both. The 3:00 PM threshold here is
  // the START of that window (unchanged) — only the final lock at the end
  // of the window moved from 3:30 PM to 4:00 PM.
  const inLateEditWindow = lockReason === null && isPastEasternCutoff(15, 0)

  const actionLabel =
    status === 'not_started' ? 'Start Report' : status === 'draft' ? 'Continue Draft' : 'Edit Submitted Report'
  const onAction = status === 'not_started' ? onStart : status === 'draft' ? onContinue : onEditSubmitted

  const showReminder =
    lockReason === null && statusLoaded && !statusLoadError && !reminderDismissed && status !== 'submitted'

  return (
    <div className="dashboard-page">
      <div className="md-page-heading">
        <div className="md-page-heading-text">
          <h1>Dashboard</h1>
          <p className="md-page-subtitle">Your weekly report and recent submissions</p>
        </div>
        <span className="md-page-week">Week of {week.label}</span>
      </div>

      {showReminder && (
        <div className="reminder-banner" role="status">
          <div className="reminder-banner-text">
            <p className="reminder-banner-title">
              {status === 'draft'
                ? 'Weekly Manager Report not yet submitted'
                : 'Weekly Manager Report not started'}
            </p>
            <p className="reminder-banner-subtitle">
              {status === 'draft'
                ? 'You have a draft saved, but it hasn’t been submitted yet'
                : 'This week’s report hasn’t been started yet'}{' '}
              &mdash; it&apos;s due Friday at 3:00 PM ET.
            </p>
          </div>
          <div className="reminder-banner-actions">
            <button
              type="button"
              className="btn btn-secondary reminder-banner-btn"
              onClick={status === 'draft' ? onContinue : onStart}
            >
              {status === 'draft' ? 'Continue Report' : 'Start Report'}
            </button>
            <button
              type="button"
              className="reminder-dismiss-btn"
              onClick={onDismissReminder}
              aria-label="Dismiss reminder"
              title="Dismiss reminder"
            >
              &times;
            </button>
          </div>
        </div>
      )}

      <div className="hero-card">
        <div className="hero-card-top">
          <span className="hero-week-label">This Week&apos;s Report</span>
          {/* Suppressed on a load failure — `status` may still hold a
              stale or default value, and showing it (even "Not Started")
              would misrepresent an unknown status as a known one. */}
          {!statusLoadError && <StatusBadge status={status} />}
        </div>

        <div className="hero-deadline-block">
          <p className="hero-deadline">
            Due <strong>{week.deadlineLabel}</strong>
          </p>
          <span className="hero-days-left">
            {isPastDeadline ? 'Deadline passed' : isDueToday ? 'Due today' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} remaining`}
          </span>
        </div>

        {statusLoadError ? (
          <p className="hero-lock-message">We couldn&apos;t load your report status. Please refresh and try again.</p>
        ) : lockReason ? (
          <p className="hero-lock-message">{MANAGER_WRITE_LOCK_MESSAGES[lockReason]}</p>
        ) : (
          <div className="hero-action">
            <button className="btn btn-primary btn-large" onClick={onAction}>
              {actionLabel}
            </button>
            {inLateEditWindow && <p className="hero-late-window-notice">You can still edit this report until 4:00 PM ET.</p>}
          </div>
        )}

        {!lockReason && !statusLoadError && <p className="hero-tip">Tip: Check in with your team before submitting this report.</p>}
      </div>

      <div className="history-card">
        <h2>Report History</h2>
        {historyLoading ? (
          <p className="history-empty">Loading…</p>
        ) : history.length === 0 ? (
          <p className="history-empty">No previous reports yet.</p>
        ) : (
          <ul className="history-list">
            {history.map((entry) => (
              <li
                key={entry.weekStartDate}
                className="history-row"
                role="button"
                tabIndex={0}
                onClick={() => onViewHistoryEntry(entry)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onViewHistoryEntry(entry)
                }}
              >
                <span className="history-week">{entry.weekLabel}</span>
                <div className="history-row-right">
                  <StatusBadge status={entry.status} />
                  <span className="history-row-view" aria-hidden="true">
                    View
                    <svg className="history-row-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
