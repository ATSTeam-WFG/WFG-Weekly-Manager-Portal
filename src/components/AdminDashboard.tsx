import { useEffect, useState } from 'react'
import StatusBadge from './StatusBadge'
import ReminderPanel from './ReminderPanel'
import { fetchManagersForWeek, type ManagerSummary } from '../lib/adminService'
import { getReminderTargets, type ReminderTarget } from '../lib/reminderService'
import { supabase } from '../lib/supabaseClient'
import { getDaysUntilDeadline, type ReportingWeek } from '../utils/week'
import { isPastEasternCutoff } from '../utils/easternTime'
import { getInitials } from '../utils/initials'
import './AdminDashboard.css'

interface AdminDashboardProps {
  week: ReportingWeek
  isCurrentWeek: boolean
  onPreviousWeek: () => void
  onNextWeek: () => void
  onSelectManager: (manager: ManagerSummary) => void
  // Present only for a dual-role admin submitter — an Admin who also
  // submits their own weekly report — see profile.submitsWeeklyReport in
  // App.tsx. Omitted entirely for a plain Admin, so the button never
  // renders for one. Not a sidebar destination, so this is the only
  // navigation prop this component still needs — User Management/Reports &
  // Analytics/Weekly Summary navigation now lives entirely in
  // AdminSidebar/AdminShell (see App.tsx), so those three props were
  // removed rather than left unused.
  onOpenMyReport?: () => void
}

type FilterKey = 'all' | 'submitted' | 'draft' | 'not_started' | 'needs_attention'

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'draft', label: 'Draft' },
  { key: 'not_started', label: 'Not Started' },
  { key: 'needs_attention', label: 'Pending' },
]

function formatSubmittedAt(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function getSubmissionSourceLabel(manager: ManagerSummary): string | null {
  if (manager.status !== 'submitted' || !manager.submissionSource) return null
  return manager.submissionSource === 'automatic' ? 'Submitted automatically' : 'Submitted manually'
}

function matchesFilter(manager: ManagerSummary, filter: FilterKey): boolean {
  if (filter === 'all') return true
  if (filter === 'needs_attention') return manager.status !== 'submitted'
  return manager.status === filter
}

export default function AdminDashboard({
  week,
  isCurrentWeek,
  onPreviousWeek,
  onNextWeek,
  onSelectManager,
  onOpenMyReport,
}: AdminDashboardProps) {
  const [managers, setManagers] = useState<ManagerSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterKey>('all')
  const [reminderTarget, setReminderTarget] = useState<ReminderTarget[] | null>(null)

  const daysLeft = getDaysUntilDeadline(week.fridayDate)
  // getDaysUntilDeadline is calendar-day granularity only (it returns 0 for
  // all of Friday, from 12:00 AM through 11:59 PM) — it was never meant to
  // answer "has the 3:00 PM deadline itself passed". That real, time-of-day
  // question is answered by isPastEasternCutoff, the same DST-safe check
  // the 4:00 PM manager write lock and the "late edit window" notice
  // already use elsewhere in this app.
  const isPastDeadline = isPastEasternCutoff(15, 0)
  const isDueToday = !isPastDeadline && daysLeft <= 0

  useEffect(() => {
    let active = true
    setLoading(true)

    fetchManagersForWeek(supabase, week.weekStartDate).then((result) => {
      if (!active) return
      setManagers(result)
      setLoading(false)
    })

    return () => {
      active = false
    }
  }, [week.weekStartDate])

  const total = managers.length
  const submitted = managers.filter((m) => m.status === 'submitted').length
  const draft = managers.filter((m) => m.status === 'draft').length
  const notStarted = managers.filter((m) => m.status === 'not_started').length
  // The single canonical "who is pending a reminder" selection — reused
  // as-is for the Pending filter count, the bulk Prepare Reminders button,
  // and the ReminderPanel payload, so there is only ever one
  // recipient-selection implementation in the app (see
  // src/lib/reminderService.ts). Pending has no KPI card of its own below
  // (it's mathematically draft+notStarted, already shown separately), but
  // this value and everything it drives is completely unchanged.
  const pendingReminderTargets = getReminderTargets(managers)
  const needsAttention = pendingReminderTargets.length
  const completionPct = total > 0 ? Math.round((submitted / total) * 100) : 0

  const filterCounts: Record<FilterKey, number> = {
    all: total,
    submitted,
    draft,
    not_started: notStarted,
    needs_attention: needsAttention,
  }

  const filteredManagers = managers.filter((m) => matchesFilter(m, filter))

  return (
    <div className="admin-dashboard-page">
      <div className="adp-top-row">
        <div className="adp-header-titles">
          <h1>Admin Dashboard</h1>
          <p className="adp-header-subtitle">Monitor weekly reporting progress and follow up with managers.</p>
        </div>

        <div className="adp-top-row-right">
          {onOpenMyReport && (
            <button type="button" className="btn btn-secondary my-report-btn" onClick={onOpenMyReport}>
              My Weekly Report
            </button>
          )}

          <div className="adp-week-nav">
            <button type="button" className="adp-week-nav-btn" onClick={onPreviousWeek} aria-label="Previous reporting week">
              &lsaquo; Previous
            </button>
            <span className="adp-week-label">
              Week of {week.label}
              {isCurrentWeek && <span className="week-current-badge">Current</span>}
            </span>
            <button
              type="button"
              className="adp-week-nav-btn"
              onClick={onNextWeek}
              disabled={isCurrentWeek}
              aria-label="Next reporting week"
            >
              Next &rsaquo;
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="adp-loading">Loading managers…</div>
      ) : (
        <>
          <div className="adp-kpi-row">
            <div className="adp-kpi-card adp-kpi-card-total">
              <span className="adp-kpi-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="9" cy="8" r="3" />
                  <path d="M4 20c0-3 2.5-5 5-5s5 2 5 5" />
                  <circle cx="17" cy="9" r="2.5" />
                  <path d="M15.5 20c0-2.5 1-4 3-4.5" />
                </svg>
              </span>
              <div className="adp-kpi-text">
                <span className="adp-kpi-value">{total}</span>
                <span className="adp-kpi-label">Total Managers</span>
              </div>
            </div>
            <div className="adp-kpi-card adp-kpi-card-submitted">
              <span className="adp-kpi-icon" aria-hidden="true">
                &#10003;
              </span>
              <div className="adp-kpi-text">
                <span className="adp-kpi-value">{submitted}</span>
                <span className="adp-kpi-label">Submitted</span>
              </div>
            </div>
            <div className="adp-kpi-card adp-kpi-card-draft">
              <span className="adp-kpi-icon" aria-hidden="true">
                &#9998;
              </span>
              <div className="adp-kpi-text">
                <span className="adp-kpi-value">{draft}</span>
                <span className="adp-kpi-label">Draft</span>
              </div>
            </div>
            <div className="adp-kpi-card adp-kpi-card-not-started">
              <span className="adp-kpi-icon" aria-hidden="true">
                &#9675;
              </span>
              <div className="adp-kpi-text">
                <span className="adp-kpi-value">{notStarted}</span>
                <span className="adp-kpi-label">Not Started</span>
              </div>
            </div>
            <div className="adp-kpi-card adp-kpi-card-completion">
              <span className="adp-kpi-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M8 12.5l2.5 2.5L16 9" />
                </svg>
              </span>
              <div className="adp-kpi-text">
                <span className="adp-kpi-value">{completionPct}%</span>
                <span className="adp-kpi-label">Completion</span>
              </div>
            </div>
          </div>

          <div className="adp-deadline-strip">
            <span className="adp-deadline-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="5" width="18" height="16" rx="2" />
                <path d="M16 3v4M8 3v4M3 10h18" />
              </svg>
            </span>
            <span className="adp-deadline-label">Friday Deadline</span>
            <span className="adp-deadline-divider" aria-hidden="true" />
            <span className="adp-deadline-value">Due {week.deadlineLabel}</span>
            <span className="adp-deadline-status">
              {isPastDeadline ? 'Deadline passed' : isDueToday ? 'Due today' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} remaining`}
            </span>
          </div>

          <div className="adp-managers-card">
            <div className="adp-managers-header">
              <h2>Managers</h2>
              {needsAttention > 0 && (
                <button
                  type="button"
                  className="btn btn-secondary manager-bulk-remind-btn"
                  onClick={() => setReminderTarget(pendingReminderTargets)}
                >
                  Prepare Reminders ({needsAttention})
                </button>
              )}
            </div>

            <div className="adp-filter-row" role="group" aria-label="Filter managers by status">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={`adp-filter-btn ${filter === f.key ? 'active' : ''}`}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                  <span className="adp-filter-count">{filterCounts[f.key]}</span>
                </button>
              ))}
            </div>

            {managers.length === 0 ? (
              <p className="admin-empty-state">No manager profiles found yet.</p>
            ) : filteredManagers.length === 0 ? (
              <p className="admin-empty-state">No managers match this filter.</p>
            ) : (
              <div className="adp-table" role="table" aria-label="Managers">
                <div className="adp-table-header-row" role="row">
                  <span role="columnheader">Manager</span>
                  <span role="columnheader">Submission Status</span>
                  <span role="columnheader">Submitted</span>
                  <span role="columnheader">Reminder</span>
                  <span role="columnheader">Report</span>
                </div>
                {filteredManagers.map((manager) => (
                  <div
                    key={manager.id}
                    className={`adp-row ${manager.status !== 'submitted' ? 'adp-row-needs-attention' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectManager(manager)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') onSelectManager(manager)
                    }}
                  >
                    <div className="adp-cell adp-cell-manager" role="cell">
                      <span className="adp-manager-avatar" aria-hidden="true">
                        {getInitials(manager.fullName)}
                      </span>
                      <div className="adp-manager-info">
                        <span className="manager-name">{manager.fullName}</span>
                        <span className={`manager-email ${manager.email ? '' : 'manager-email-missing'}`}>
                          {manager.email || 'Email not available'}
                        </span>
                      </div>
                    </div>
                    <div className="adp-cell" role="cell">
                      <StatusBadge status={manager.status} />
                    </div>
                    <div className="adp-cell adp-cell-submitted" role="cell">
                      {manager.status === 'submitted' ? (
                        <>
                          <span className="adp-submitted-at">
                            {manager.submittedAt ? formatSubmittedAt(manager.submittedAt) : '—'}
                          </span>
                          {getSubmissionSourceLabel(manager) && (
                            <span className="submission-source-tag">{getSubmissionSourceLabel(manager)}</span>
                          )}
                        </>
                      ) : (
                        <span className="adp-dash">—</span>
                      )}
                    </div>
                    <div className="adp-cell" role="cell">
                      {manager.status !== 'submitted' ? (
                        <button
                          type="button"
                          className="manager-remind-btn"
                          onClick={(e) => {
                            e.stopPropagation()
                            setReminderTarget(getReminderTargets([manager]))
                          }}
                        >
                          <span className="manager-remind-dot" aria-hidden="true" />
                          Reminder needed
                        </button>
                      ) : (
                        <span className="adp-dash">—</span>
                      )}
                    </div>
                    <div className="adp-cell" role="cell">
                      <span className="adp-view-link">{manager.status === 'submitted' ? 'View Report' : 'View'} &rarr;</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {reminderTarget && (
        <ReminderPanel
          managers={reminderTarget}
          week={week}
          isPastDeadline={isPastDeadline}
          onClose={() => setReminderTarget(null)}
        />
      )}
    </div>
  )
}
