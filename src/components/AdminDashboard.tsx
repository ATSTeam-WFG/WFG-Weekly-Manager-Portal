import { useEffect, useState } from 'react'
import StatusBadge from './StatusBadge'
import ReminderPanel from './ReminderPanel'
import { fetchManagersForWeek, type ManagerSummary } from '../lib/adminService'
import { supabase } from '../lib/supabaseClient'
import { getDaysUntilDeadline, type ReportingWeek } from '../utils/week'
import { REMINDER_ACTIONS_ENABLED } from '../config/featureFlags'
import './AdminDashboard.css'

interface AdminDashboardProps {
  week: ReportingWeek
  isCurrentWeek: boolean
  onPreviousWeek: () => void
  onNextWeek: () => void
  onSelectManager: (manager: ManagerSummary) => void
  onOpenWeeklySummary: () => void
  onOpenReportsAnalytics: () => void
  onOpenUserManagement: () => void
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

function getStatusDetail(manager: ManagerSummary): string {
  if (manager.status === 'submitted') {
    return manager.submittedAt ? `Submitted ${formatSubmittedAt(manager.submittedAt)}` : 'Submitted'
  }
  if (manager.status === 'draft') {
    return 'In progress — not yet submitted'
  }
  return 'No report started yet'
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
  onOpenWeeklySummary,
  onOpenReportsAnalytics,
  onOpenUserManagement,
}: AdminDashboardProps) {
  const [managers, setManagers] = useState<ManagerSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterKey>('all')
  const [reminderTarget, setReminderTarget] = useState<ManagerSummary[] | null>(null)

  const daysLeft = getDaysUntilDeadline(week.fridayDate)
  const isPastDeadline = daysLeft <= 0

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
  const needsAttention = draft + notStarted
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
    <div className="admin-dashboard">
      <div className="admin-heading">
        <div className="admin-heading-top">
          <h1>Admin Dashboard</h1>
          <div className="admin-heading-actions">
            <button type="button" className="btn btn-secondary user-management-btn" onClick={onOpenUserManagement}>
              User Management
            </button>
            <button type="button" className="btn btn-secondary reports-analytics-btn" onClick={onOpenReportsAnalytics}>
              Reports &amp; Analytics
            </button>
            <button type="button" className="btn btn-secondary weekly-summary-btn" onClick={onOpenWeeklySummary}>
              Weekly Summary
            </button>
          </div>
        </div>

        <div className="week-selector">
          <button
            type="button"
            className="week-nav-btn"
            onClick={onPreviousWeek}
            aria-label="Previous reporting week"
          >
            &larr;
          </button>
          <span className="week-selector-label">
            Week of {week.label}
            {isCurrentWeek && <span className="week-current-badge">Current</span>}
          </span>
          <button
            type="button"
            className="week-nav-btn"
            onClick={onNextWeek}
            disabled={isCurrentWeek}
            aria-label="Next reporting week"
          >
            &rarr;
          </button>
        </div>
      </div>

      {loading ? (
        <div className="admin-loading">Loading managers…</div>
      ) : (
        <>
          <div className="admin-stats-grid">
            <div className="admin-stat-card">
              <span className="admin-stat-value">{total}</span>
              <span className="admin-stat-label">Total Managers</span>
            </div>
            <div className="admin-stat-card">
              <span className="admin-stat-value admin-stat-submitted">{submitted}</span>
              <span className="admin-stat-label">Submitted</span>
            </div>
            <div className="admin-stat-card">
              <span className="admin-stat-value admin-stat-draft">{draft}</span>
              <span className="admin-stat-label">Draft</span>
            </div>
            <div className="admin-stat-card">
              <span className="admin-stat-value admin-stat-not-started">{notStarted}</span>
              <span className="admin-stat-label">Not Started</span>
            </div>
            <div className="admin-stat-card">
              <span className="admin-stat-value admin-stat-attention">{needsAttention}</span>
              <span className="admin-stat-label">Pending</span>
            </div>
            <div className="admin-stat-card">
              <span className="admin-stat-value">{completionPct}%</span>
              <span className="admin-stat-label">Completion</span>
            </div>
          </div>

          <div className="admin-deadline-row">
            <span>Due {week.deadlineLabel}</span>
            <span className="admin-days-left">
              {isPastDeadline ? 'Deadline passed' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} remaining`}
            </span>
          </div>

          <div className="manager-list-card">
            <div className="manager-list-header">
              <h2>Managers</h2>
              {REMINDER_ACTIONS_ENABLED && needsAttention > 0 && (
                <button
                  type="button"
                  className="btn btn-secondary manager-bulk-remind-btn"
                  onClick={() => setReminderTarget(managers.filter((m) => m.status !== 'submitted'))}
                >
                  Prepare Reminders ({needsAttention})
                </button>
              )}
            </div>

            <div className="manager-filter-row" role="group" aria-label="Filter managers by status">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={`manager-filter-btn ${filter === f.key ? 'active' : ''}`}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                  <span className="manager-filter-count">{filterCounts[f.key]}</span>
                </button>
              ))}
            </div>

            {managers.length === 0 ? (
              <p className="admin-empty-state">No manager profiles found yet.</p>
            ) : filteredManagers.length === 0 ? (
              <p className="admin-empty-state">No managers match this filter.</p>
            ) : (
              <ul className="manager-list">
                {filteredManagers.map((manager) => (
                  <li
                    key={manager.id}
                    className={`manager-row ${manager.status !== 'submitted' ? 'needs-attention' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectManager(manager)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') onSelectManager(manager)
                    }}
                  >
                    <div className="manager-row-main">
                      <span className="manager-name">{manager.fullName}</span>
                      <span className={`manager-email ${manager.email ? '' : 'manager-email-missing'}`}>
                        {manager.email || 'Email not available'}
                      </span>
                      <span className="manager-status-detail">
                        {getStatusDetail(manager)}
                        {getSubmissionSourceLabel(manager) && (
                          <span className="submission-source-tag"> · {getSubmissionSourceLabel(manager)}</span>
                        )}
                      </span>
                    </div>
                    <StatusBadge status={manager.status} />
                    {REMINDER_ACTIONS_ENABLED && manager.status !== 'submitted' && (
                      <button
                        type="button"
                        className="manager-remind-btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          setReminderTarget([manager])
                        }}
                      >
                        Remind
                      </button>
                    )}
                    <span className="manager-row-action">
                      {manager.status === 'submitted' ? 'View Report' : 'View'} &rarr;
                    </span>
                  </li>
                ))}
              </ul>
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
