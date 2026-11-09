import { useCallback, useEffect, useState } from 'react'
import {
  fetchMyCurrentReps,
  fetchRepReport,
  fetchRepReportReviewHistory,
  reviewSalesRepReport,
  RepReportError,
  type RepReport,
  type RepReportReviewHistoryEntry,
} from '../lib/repReportsService'
import { fetchProfilesByIds, type RepProfileSummary } from '../lib/repRosterService'
import { getReportingWeekByOffset } from '../utils/week'
import { deriveRepReportBucket, type RepReportBucket } from '../lib/repReportBucket'
import type { SalesRepReportSections } from '../types'
import './MyReps.css'

// Phase 1B's small, additive Manager-facing screen: see assigned reps'
// weekly status and review (approve/reject) a submitted report. This is
// deliberately NOT a replacement for Dashboard/AdminDashboard — it's a
// self-contained, droppable component (managerId + onBack only) that a
// caller navigates to alongside a manager's own report dashboard; wiring it
// into App.tsx's navigation happens in a separate step, out of scope here.
//
// Phase 3 (Manager Dashboard Enhancements) added the week selector and the
// summary counts below — both self-contained (weekOffset is local state,
// exactly like every other week-nav screen in this app — AdminDashboard,
// WeeklySummary, LeadershipReportCurrent/History all do the same), so
// nothing about this component's props or its caller changed. The summary
// counts reuse deriveRepReportBucket from repReportBucket.ts (the exact
// same function src/components/AdminManagerRepOverview.tsx's Leadership
// Dashboard rollup uses), so a given Manager's numbers here and on the
// Leadership Dashboard's drill-down always agree — never two independent
// calculations of the same thing.

interface MyRepsProps {
  managerId: string
  onBack: () => void
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

// A rep with no report yet this week (fetchRepReport returned null) shows
// "Not Started" and is never clickable — nothing exists to review. A
// 'draft' report is shown (a manager CAN see a draft per
// rep_reports_select_assigned_manager) but is also never clickable for
// review: review_rep_report itself rejects a non-submitted report with
// INVALID_STATE, so no review action is ever offered for one here.
function rowStatusLabel(report: RepReport | null): string {
  if (!report) return 'Not Started'
  if (report.status === 'draft') return 'Draft (not yet submitted)'
  if (report.reviewStatus === 'approved') return 'Approved'
  if (report.reviewStatus === 'rejected') return 'Rejected'
  return 'Submitted — Pending Review'
}

function rowStatusClass(report: RepReport | null): string {
  if (!report) return 'myreps-status-not-started'
  if (report.status === 'draft') return 'myreps-status-draft'
  if (report.reviewStatus === 'approved') return 'myreps-status-approved'
  if (report.reviewStatus === 'rejected') return 'myreps-status-rejected'
  return 'myreps-status-pending'
}

// The single gate for "can this row be opened for review" — a report must
// exist AND currently be submitted. Re-reviewing/revising an
// already-approved or already-rejected decision is explicitly supported
// (reviewSalesRepReport appends to history rather than erroring) and is
// still allowed here, since the report's status stays 'submitted' through
// every review/re-review; only a 'draft' report is excluded.
function isReviewable(report: RepReport | null): report is RepReport {
  return report !== null && report.status === 'submitted'
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

function reviewErrorMessage(err: unknown): string {
  if (err instanceof RepReportError) {
    switch (err.code) {
      case 'REASON_REQUIRED':
        return 'Please provide a reason before submitting your decision.'
      case 'INVALID_STATE':
        return "This report is no longer submitted, so it can't be reviewed right now."
      case 'FORBIDDEN':
        return "You don't currently have permission to review this rep's reports."
      default:
        return err.message || 'Something went wrong while recording your decision. Please try again.'
    }
  }
  return err instanceof Error ? err.message : 'Something went wrong while recording your decision. Please try again.'
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

export default function MyReps({ managerId, onBack }: MyRepsProps) {
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null)
  const [rows, setRows] = useState<RepRow[]>([])
  const [selectedRepId, setSelectedRepId] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [weekOffset, setWeekOffset] = useState(0)

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
  // (see this file's header comment) rather than rowStatusLabel/
  // rowStatusClass below: those two intentionally stay more granular
  // (distinguishing "not started" from "draft, never submitted") for the
  // per-row display, while the summary only needs the 4-bucket rollup that
  // matches the Leadership Dashboard's own counts for this same Manager.
  const summaryCounts = rows.reduce(
    (acc, row) => {
      const bucket = deriveRepReportBucket(row.report)
      acc[bucket] += 1
      return acc
    },
    { missing: 0, pending: 0, approved: 0, rejected: 0 } as Record<RepReportBucket, number>,
  )
  const submittedCount = summaryCounts.pending + summaryCounts.approved + summaryCounts.rejected

  const selectedRow = rows.find((r) => r.repId === selectedRepId) ?? null

  const handleReviewed = useCallback((updated: RepReport) => {
    setRows((prev) => prev.map((r) => (r.repId === updated.repId ? { ...r, report: updated } : r)))
  }, [])

  return (
    <div className="myreps-page">
      <div className="myreps-top-row">
        <div className="myreps-header-titles">
          <h1>My Reps</h1>
          <p className="myreps-header-subtitle">See this week's status for your assigned reps and review what they've submitted.</p>
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
              {isCurrentWeek && <span className="week-current-badge">Current</span>}
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

      {loadState === 'ready' && rows.length > 0 && (
        <div className="myreps-summary-row">
          <div className="myreps-summary-card">
            <span className="myreps-summary-value">{rows.length}</span>
            <span className="myreps-summary-label">Total Assigned</span>
          </div>
          <div className="myreps-summary-card">
            <span className="myreps-summary-value">{submittedCount}</span>
            <span className="myreps-summary-label">Submitted</span>
          </div>
          <div className="myreps-summary-card">
            <span className="myreps-summary-value">{summaryCounts.pending}</span>
            <span className="myreps-summary-label">Pending Review</span>
          </div>
          <div className="myreps-summary-card">
            <span className="myreps-summary-value">{summaryCounts.approved}</span>
            <span className="myreps-summary-label">Approved</span>
          </div>
          <div className="myreps-summary-card">
            <span className="myreps-summary-value">{summaryCounts.rejected}</span>
            <span className="myreps-summary-label">Needs Correction</span>
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

      {loadState === 'ready' &&
        (rows.length === 0 ? (
          <p className="myreps-empty-state">You have no reps currently assigned to you.</p>
        ) : (
          <div className="myreps-table" role="table" aria-label="My Reps">
            <div className="myreps-table-header-row" role="row">
              <span role="columnheader">Rep</span>
              <span role="columnheader">This Week's Status</span>
              <span role="columnheader">Submitted</span>
              <span role="columnheader">Review</span>
            </div>
            {rows.map((row) => {
              const reviewable = isReviewable(row.report)
              return (
                <div
                  key={row.repId}
                  className={`myreps-row ${reviewable ? 'myreps-row-reviewable' : ''}`}
                  role={reviewable ? 'button' : undefined}
                  tabIndex={reviewable ? 0 : undefined}
                  onClick={reviewable ? () => setSelectedRepId(row.repId) : undefined}
                  onKeyDown={
                    reviewable
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
                    {reviewable ? <span className="myreps-view-link">Review &rarr;</span> : <span className="myreps-dash">—</span>}
                  </div>
                </div>
              )
            })}
          </div>
        ))}

      {selectedRow && isReviewable(selectedRow.report) && (
        <ReportReviewPanel
          repName={selectedRow.fullName || 'Unnamed Rep'}
          report={selectedRow.report}
          onClose={() => setSelectedRepId(null)}
          onReviewed={handleReviewed}
        />
      )}
    </div>
  )
}

interface ReportReviewPanelProps {
  repName: string
  report: RepReport
  onClose: () => void
  onReviewed: (updated: RepReport) => void
}

type HistoryState = 'loading' | 'error' | 'ready'

function ReportReviewPanel({ repName, report, onClose, onReviewed }: ReportReviewPanelProps) {
  const [historyState, setHistoryState] = useState<HistoryState>('loading')
  const [history, setHistory] = useState<RepReportReviewHistoryEntry[]>([])
  const [historyReloadToken, setHistoryReloadToken] = useState(0)
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState<'approved' | 'rejected' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

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
  }, [report.id, historyReloadToken])

  // Client-side convenience only — a mandatory, non-empty reason before the
  // button is even enabled. The server independently enforces
  // REASON_REQUIRED regardless, so this never substitutes for that check.
  const trimmedReason = reason.trim()
  const canSubmit = trimmedReason.length > 0 && submitting === null

  const handleDecision = async (decision: 'approved' | 'rejected') => {
    if (!canSubmit) return
    setSubmitting(decision)
    setActionError(null)
    try {
      const updated = await reviewSalesRepReport(report.id, decision, trimmedReason)
      onReviewed(updated)
      setReason('')
      setHistoryReloadToken((t) => t + 1)
    } catch (err) {
      setActionError(reviewErrorMessage(err))
    } finally {
      setSubmitting(null)
    }
  }

  const content: SalesRepReportSections = report.content

  return (
    <div className="myreps-overlay" role="dialog" aria-modal="true" aria-label={`Review ${repName}'s report`}>
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
            <h3>Review History</h3>
            {historyState === 'loading' && <p className="myreps-section-empty">Loading review history…</p>}
            {historyState === 'error' && (
              <p className="myreps-section-empty">
                Could not load review history.{' '}
                <button type="button" className="myreps-inline-retry" onClick={() => setHistoryReloadToken((t) => t + 1)}>
                  Retry
                </button>
              </p>
            )}
            {historyState === 'ready' &&
              (history.length === 0 ? (
                <p className="myreps-section-empty">No review decisions recorded yet.</p>
              ) : (
                <ul className="myreps-history-list">
                  {history.map((entry) => (
                    <li key={entry.id} className={`myreps-history-entry myreps-history-${entry.reviewStatus}`}>
                      <span className="myreps-history-status">{entry.reviewStatus === 'approved' ? 'Approved' : 'Rejected'}</span>
                      <span className="myreps-history-reason">{entry.reason}</span>
                      <span className="myreps-history-date">{formatDateTime(entry.reviewedAt)}</span>
                    </li>
                  ))}
                </ul>
              ))}
          </div>

          {/* Review controls (Approve/Reject) only ever render here, inside
              ReportReviewPanel — and ReportReviewPanel itself is only ever
              mounted by MyReps when status === 'submitted' (see
              isReviewable above and its use gating <ReportReviewPanel>), so
              a 'draft' report can never reach this block. Re-reviewing an
              already-approved/rejected decision is intentionally still
              allowed (status stays 'submitted' through every revision). */}
          {report.status === 'submitted' && (
            <div className="myreps-section myreps-review-action">
              <h3>Your Decision</h3>
              <textarea
                className="myreps-reason-input"
                placeholder="Reason for your decision (required)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                disabled={submitting !== null}
              />
              {actionError && <p className="myreps-action-error">{actionError}</p>}
              <div className="myreps-review-buttons">
                <button
                  type="button"
                  className="btn btn-secondary myreps-reject-btn"
                  disabled={!canSubmit}
                  onClick={() => handleDecision('rejected')}
                >
                  {submitting === 'rejected' ? 'Rejecting…' : 'Reject'}
                </button>
                <button
                  type="button"
                  className="btn btn-primary myreps-approve-btn"
                  disabled={!canSubmit}
                  onClick={() => handleDecision('approved')}
                >
                  {submitting === 'approved' ? 'Approving…' : 'Approve'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
