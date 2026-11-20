import { useEffect, useMemo, useState } from 'react'
import {
  fetchMyCurrentReps,
  fetchRepReport,
  fetchRepReportReviewHistory,
  fetchRepReportFeedback,
  addRepReportFeedback,
  RepReportError,
  type RepReport,
  type RepReportReviewHistoryEntry,
  type RepReportFeedbackEntry,
} from '../lib/repReportsService'
import { fetchProfilesByIds, type RepProfileSummary } from '../lib/repRosterService'
import { getReportingWeekByOffset } from '../utils/week'
import { deriveRepReportBucket, type RepReportBucket } from '../lib/repReportBucket'
import type { SalesRepReportSections } from '../types'
import './MyReps.css'

// Phase 1B's small, additive Manager-facing screen: see assigned reps'
// weekly status and leave optional feedback on a submitted report. This is
// deliberately NOT a replacement for Dashboard/AdminDashboard — it's a
// self-contained, droppable component (managerId + onBack only) that a
// caller navigates to alongside a manager's own report dashboard; wiring it
// into App.tsx's navigation happens in a separate step, out of scope here.
//
// Phase 3 (Manager Dashboard Enhancements) added the week selector and the
// summary counts below — both self-contained (weekOffset is local state,
// exactly like every other week-nav screen in this app — AdminDashboard,
// WeeklySummary, LeadershipReportCurrent/History all do the same), so
// nothing about this component's props or its caller changed.
//
// Beta feedback (2026-11-16): the Approve/Reject decision workflow is
// replaced by an optional, non-blocking "Provide Feedback" action (see
// ReportFeedbackPanel below). Status is now a plain 3-way
// not_started/draft/submitted split (deriveRepReportBucket,
// repReportBucket.ts) — review_status no longer gates or labels anything
// here. Existing historical review decisions are still visible (read-only,
// see ReportFeedbackPanel's "Past Decisions" section) — nothing was
// deleted, only the active decision UI.

interface MyRepsProps {
  managerId: string
  onBack: () => void
  // Additive, optional (2026-11-13) — when true, renders only the
  // search/filter row + table + feedback panel, for embedding inside the
  // Manager Dashboard overview (which already shows its own heading/KPI
  // summary above). onBack is still required and still wired by every
  // caller (the Team Reports destination still needs it); it is simply
  // never rendered/reachable in embedded mode. No fetch, feedback, or
  // permission logic changes based on this flag — purely a presentation
  // toggle.
  embedded?: boolean
}

interface RepRow {
  repId: string
  fullName: string | null
  email: string
  report: RepReport | null
}

type LoadState = 'loading' | 'error' | 'ready'

function getInitials(name: string | null): string {
  if (!name) return '?'
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
  return initials || '?'
}

function rowStatusLabel(report: RepReport | null): string {
  if (!report) return 'Not Started'
  if (report.status === 'draft') return 'Draft (not yet submitted)'
  return 'Submitted'
}

function rowStatusClass(report: RepReport | null): string {
  if (!report) return 'myreps-status-not-started'
  if (report.status === 'draft') return 'myreps-status-draft'
  return 'myreps-status-approved'
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function feedbackErrorMessage(err: unknown): string {
  if (err instanceof RepReportError) {
    switch (err.code) {
      case 'FEEDBACK_REQUIRED':
        return 'Please enter some feedback before sending.'
      case 'FORBIDDEN':
        return "You don't currently have permission to leave feedback on this rep's report."
      default:
        return err.message || 'Something went wrong while sending your feedback. Please try again.'
    }
  }
  return err instanceof Error ? err.message : 'Something went wrong while sending your feedback. Please try again.'
}

const SECTION_LIST_FIELDS: {
  key: 'accomplishments' | 'salesMetrics' | 'pipelineUpdates' | 'blockers' | 'nextWeekPriorities'
  label: string
}[] = [
  { key: 'accomplishments', label: 'Accomplishments' },
  { key: 'salesMetrics', label: 'Sales Metrics' },
  { key: 'pipelineUpdates', label: 'Pipeline Updates' },
  { key: 'blockers', label: 'Blockers' },
  { key: 'nextWeekPriorities', label: 'Next Week Priorities' },
]

export default function MyReps({ managerId, onBack, embedded = false }: MyRepsProps) {
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null)
  const [rows, setRows] = useState<RepRow[]>([])
  const [selectedRepId, setSelectedRepId] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [weekOffset, setWeekOffset] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | RepReportBucket>('all')

  const week = getReportingWeekByOffset(weekOffset)
  const isCurrentWeek = weekOffset === 0

  useEffect(() => {
    let active = true
    setLoadState('loading')
    setLoadErrorMessage(null)

    ;(async () => {
      try {
        const assignments = await fetchMyCurrentReps(managerId)
        if (!active) return

        if (assignments.length === 0) {
          setRows([])
          setLoadState('ready')
          return
        }

        const repIds = assignments.map((a) => a.repId)
        const [profiles, reports] = await Promise.all([
          fetchProfilesByIds(repIds),
          Promise.all(repIds.map((repId) => fetchRepReport(repId, week.weekStartDate))),
        ])
        if (!active) return

        const profileById = new Map<string, RepProfileSummary>(profiles.map((p) => [p.id, p]))
        const nextRows: RepRow[] = assignments.map((assignment, i) => {
          const profile = profileById.get(assignment.repId)
          return {
            repId: assignment.repId,
            fullName: profile?.fullName ?? null,
            email: profile?.email ?? '',
            report: reports[i],
          }
        })
        setRows(nextRows)
        setLoadState('ready')
      } catch (err) {
        if (!active) return
        setLoadErrorMessage(err instanceof Error ? err.message : 'Could not load your reps. Please try again.')
        setLoadState('error')
      }
    })()

    return () => {
      active = false
    }
  }, [managerId, week.weekStartDate, reloadToken])

  const handleRetry = () => setReloadToken((t) => t + 1)

  // Summary counts for the selected week — reuses deriveRepReportBucket
  // (see this file's header comment), now a plain 3-way
  // missing/draft/submitted rollup.
  const summaryCounts = rows.reduce(
    (acc, row) => {
      const bucket = deriveRepReportBucket(row.report)
      acc[bucket] += 1
      return acc
    },
    { missing: 0, draft: 0, submitted: 0 } as Record<RepReportBucket, number>,
  )

  // Additive, client-side only — search/filter never change which rows were
  // fetched (still every rep RLS already scoped to this Manager), only which
  // of those already-loaded rows are displayed.
  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return rows.filter((row) => {
      if (statusFilter !== 'all' && deriveRepReportBucket(row.report) !== statusFilter) return false
      if (!query) return true
      return (row.fullName ?? '').toLowerCase().includes(query) || row.email.toLowerCase().includes(query)
    })
  }, [rows, searchQuery, statusFilter])

  const selectedRow = rows.find((r) => r.repId === selectedRepId) ?? null

  return (
    <div className={embedded ? 'myreps-embedded' : 'myreps-page'}>
      {!embedded && (
        <div className="myreps-top-row">
          <div className="myreps-header-titles">
            <h1>My Reps</h1>
            <p className="myreps-header-subtitle">See this week's status for your assigned reps and leave feedback on what they've submitted.</p>
          </div>
          <div className="myreps-top-row-right">
            <button type="button" className="btn btn-secondary" onClick={onBack}>
              &larr; Back
            </button>
            <span className="week-selector-label">
              <button
                type="button"
                className="week-nav-btn"
                onClick={() => setWeekOffset((o) => o - 1)}
                aria-label="Previous reporting week"
              >
                &lsaquo;
              </button>
              <span className="myreps-week-label">
                Week of {week.label}
                {/* Always rendered (never conditionally omitted) so the
                    header/week-selector/Back button layout occupies the
                    exact same width whether the current week or a past week
                    is selected — only visibility toggles, via a new,
                    MyReps-scoped modifier class (myreps-week-current-badge-
                    hidden, in MyReps.css), never the shared, DO-NOT-MODIFY
                    .week-current-badge rule in AdminDashboard.css. */}
                <span className={`week-current-badge${isCurrentWeek ? '' : ' myreps-week-current-badge-hidden'}`}>Current</span>
              </span>
              <button
                type="button"
                className="week-nav-btn"
                onClick={() => setWeekOffset((o) => Math.min(0, o + 1))}
                disabled={isCurrentWeek}
                aria-label="Next reporting week"
              >
                &rsaquo;
              </button>
            </span>
          </div>
        </div>
      )}

      {embedded && <h2 className="myreps-embedded-heading">Assigned Sales Reps</h2>}

      {!embedded && loadState === 'ready' && rows.length > 0 && (
        <div className="myreps-summary-row">
          <div className="myreps-summary-card">
            <span className="myreps-summary-value">{rows.length}</span>
            <span className="myreps-summary-label">Total Assigned</span>
          </div>
          <div className="myreps-summary-card">
            <span className="myreps-summary-value">{summaryCounts.submitted}</span>
            <span className="myreps-summary-label">Submitted</span>
          </div>
          <div className="myreps-summary-card">
            <span className="myreps-summary-value">{summaryCounts.draft}</span>
            <span className="myreps-summary-label">In Progress</span>
          </div>
          <div className="myreps-summary-card">
            <span className="myreps-summary-value">{summaryCounts.missing}</span>
            <span className="myreps-summary-label">Missing</span>
          </div>
        </div>
      )}

      {loadState === 'loading' && <div className="myreps-loading">Loading your reps…</div>}

      {loadState === 'error' && (
        <div className="myreps-error-state">
          <p>{loadErrorMessage || 'Could not load your reps.'}</p>
          <button type="button" className="btn btn-secondary" onClick={handleRetry}>
            Retry
          </button>
        </div>
      )}

      {loadState === 'ready' && rows.length > 0 && (
        <div className="myreps-search-row">
          <input
            type="search"
            className="myreps-search-input"
            placeholder="Search by name or email"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search assigned reps by name or email"
          />
          <div className="myreps-filter-row">
            {(
              [
                { key: 'all', label: 'All' },
                { key: 'submitted', label: 'Submitted' },
                { key: 'draft', label: 'In Progress' },
                { key: 'missing', label: 'Missing' },
              ] as { key: 'all' | RepReportBucket; label: string }[]
            ).map((f) => (
              <button
                key={f.key}
                type="button"
                className={`myreps-filter-btn ${statusFilter === f.key ? 'active' : ''}`}
                onClick={() => setStatusFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {loadState === 'ready' &&
        (rows.length === 0 ? (
          <p className="myreps-empty-state">You have no reps currently assigned to you.</p>
        ) : filteredRows.length === 0 ? (
          <p className="myreps-empty-state">No reps match your search or filter.</p>
        ) : (
          <div className="myreps-table" role="table" aria-label="My Reps">
            <div className="myreps-table-header-row" role="row">
              <span role="columnheader">Rep</span>
              <span role="columnheader">This Week's Status</span>
              <span role="columnheader">Submitted</span>
              <span role="columnheader">Feedback</span>
            </div>
            {filteredRows.map((row) => {
              const hasReport = row.report !== null
              return (
                <div
                  key={row.repId}
                  className={`myreps-row ${hasReport ? 'myreps-row-reviewable' : ''}`}
                  role={hasReport ? 'button' : undefined}
                  tabIndex={hasReport ? 0 : undefined}
                  onClick={hasReport ? () => setSelectedRepId(row.repId) : undefined}
                  onKeyDown={
                    hasReport
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') setSelectedRepId(row.repId)
                        }
                      : undefined
                  }
                >
                  <div className="myreps-cell myreps-cell-rep" role="cell">
                    <span className="myreps-rep-avatar" aria-hidden="true">
                      {getInitials(row.fullName)}
                    </span>
                    <div className="myreps-rep-info">
                      <span className="myreps-rep-name">{row.fullName || 'Unnamed Rep'}</span>
                      <span className={`myreps-rep-email ${row.email ? '' : 'myreps-rep-email-missing'}`}>
                        {row.email || 'Email not available'}
                      </span>
                    </div>
                  </div>
                  <div className="myreps-cell" role="cell">
                    <span className={`myreps-status-badge ${rowStatusClass(row.report)}`}>{rowStatusLabel(row.report)}</span>
                  </div>
                  <div className="myreps-cell" role="cell">
                    {row.report?.submittedAt ? formatDateTime(row.report.submittedAt) : <span className="myreps-dash">—</span>}
                  </div>
                  <div className="myreps-cell" role="cell">
                    {hasReport ? <span className="myreps-view-link">View &amp; Feedback &rarr;</span> : <span className="myreps-dash">—</span>}
                  </div>
                </div>
              )
            })}
          </div>
        ))}

      {selectedRow && selectedRow.report && (
        <ReportFeedbackPanel
          repName={selectedRow.fullName || 'Unnamed Rep'}
          report={selectedRow.report}
          onClose={() => setSelectedRepId(null)}
        />
      )}
    </div>
  )
}

interface ReportFeedbackPanelProps {
  repName: string
  report: RepReport
  onClose: () => void
}

type PanelListState = 'loading' | 'error' | 'ready'

// Replaces the old Approve/Reject review panel. Feedback is optional
// and non-blocking — closing without sending anything is always allowed,
// and sending feedback never changes the report's status in any way (see
// add_rep_report_feedback's own SQL comment). Past approve/reject
// decisions, if any exist on this report from before this change, remain
// visible read-only below the feedback section — nothing historical was
// deleted.
function ReportFeedbackPanel({ repName, report, onClose }: ReportFeedbackPanelProps) {
  const [feedbackState, setFeedbackState] = useState<PanelListState>('loading')
  const [feedbackEntries, setFeedbackEntries] = useState<RepReportFeedbackEntry[]>([])
  const [historyState, setHistoryState] = useState<PanelListState>('loading')
  const [history, setHistory] = useState<RepReportReviewHistoryEntry[]>([])
  const [reloadToken, setReloadToken] = useState(0)
  const [feedbackText, setFeedbackText] = useState('')
  const [sending, setSending] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [sentNotice, setSentNotice] = useState(false)

  useEffect(() => {
    let active = true
    setFeedbackState('loading')
    fetchRepReportFeedback(report.id)
      .then((entries) => {
        if (!active) return
        setFeedbackEntries(entries)
        setFeedbackState('ready')
      })
      .catch(() => {
        if (!active) return
        setFeedbackState('error')
      })
    return () => {
      active = false
    }
  }, [report.id, reloadToken])

  useEffect(() => {
    let active = true
    setHistoryState('loading')
    fetchRepReportReviewHistory(report.id)
      .then((entries) => {
        if (!active) return
        setHistory(entries)
        setHistoryState('ready')
      })
      .catch(() => {
        if (!active) return
        setHistoryState('error')
      })
    return () => {
      active = false
    }
  }, [report.id])

  const trimmedFeedback = feedbackText.trim()
  const canSend = trimmedFeedback.length > 0 && !sending

  const handleSend = async () => {
    if (!canSend) return
    setSending(true)
    setActionError(null)
    setSentNotice(false)
    try {
      await addRepReportFeedback(report.id, trimmedFeedback)
      setFeedbackText('')
      setSentNotice(true)
      setReloadToken((t) => t + 1)
    } catch (err) {
      setActionError(feedbackErrorMessage(err))
    } finally {
      setSending(false)
    }
  }

  const content: SalesRepReportSections = report.content

  return (
    <div className="myreps-overlay" role="dialog" aria-modal="true" aria-label={`${repName}'s report`}>
      <div className="myreps-panel">
        <div className="myreps-panel-header">
          <h2>{repName}'s Report</h2>
          <button type="button" className="myreps-panel-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        <div className="myreps-panel-body">
          {SECTION_LIST_FIELDS.map(({ key, label }) => (
            <div className="myreps-section" key={key}>
              <h3>{label}</h3>
              {content[key].length === 0 ? (
                <p className="myreps-section-empty">No items provided.</p>
              ) : (
                <ul>
                  {content[key].map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}

          <div className="myreps-section">
            <h3>Manager Support Needed</h3>
            <p className="myreps-support-text">{content.managerSupportNeeded || 'No items provided.'}</p>
          </div>

          <div className="myreps-section myreps-review-history">
            <h3>Feedback</h3>
            {feedbackState === 'loading' && <p className="myreps-section-empty">Loading feedback…</p>}
            {feedbackState === 'error' && (
              <p className="myreps-section-empty">
                Could not load feedback.{' '}
                <button type="button" className="myreps-inline-retry" onClick={() => setReloadToken((t) => t + 1)}>
                  Retry
                </button>
              </p>
            )}
            {feedbackState === 'ready' &&
              (feedbackEntries.length === 0 ? (
                <p className="myreps-section-empty">No feedback left yet.</p>
              ) : (
                <ul className="myreps-history-list">
                  {feedbackEntries.map((entry) => (
                    <li key={entry.id} className="myreps-history-entry">
                      <span className="myreps-history-reason">{entry.feedback}</span>
                      <span className="myreps-history-date">{formatDateTime(entry.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              ))}
          </div>

          {/* Optional, never blocking — closing this panel without sending
              anything is always allowed, and this never changes
              report.status/reviewStatus. Available for a draft or a
              submitted report alike. */}
          <div className="myreps-section myreps-review-action">
            <h3>Provide Feedback (optional)</h3>
            <textarea
              className="myreps-reason-input"
              placeholder="Leave feedback for this rep (optional)"
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              rows={3}
              disabled={sending}
            />
            {actionError && <p className="myreps-action-error">{actionError}</p>}
            {sentNotice && !actionError && <p className="myreps-section-empty">Feedback sent.</p>}
            <div className="myreps-review-buttons">
              <button type="button" className="btn btn-primary myreps-approve-btn" disabled={!canSend} onClick={handleSend}>
                {sending ? 'Sending…' : 'Send Feedback'}
              </button>
            </div>
          </div>

          {history.length > 0 && (
            <div className="myreps-section myreps-review-history">
              <h3>Review History (Past Decisions)</h3>
              <p className="myreps-section-empty">
                These decisions were recorded before the approval workflow was replaced with feedback. They're kept here for reference only.
              </p>
              {historyState === 'loading' && <p className="myreps-section-empty">Loading…</p>}
              {historyState === 'error' && <p className="myreps-section-empty">Could not load past decisions.</p>}
              {historyState === 'ready' && (
                <ul className="myreps-history-list">
                  {history.map((entry) => (
                    <li key={entry.id} className={`myreps-history-entry myreps-history-${entry.reviewStatus}`}>
                      <span className="myreps-history-status">{entry.reviewStatus === 'approved' ? 'Approved' : 'Rejected'}</span>
                      <span className="myreps-history-reason">{entry.reason}</span>
                      <span className="myreps-history-date">{formatDateTime(entry.reviewedAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
