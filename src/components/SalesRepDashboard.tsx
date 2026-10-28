import { useEffect, useState } from 'react'
import SalesRepReportForm from './SalesRepReportForm'
import {
  fetchRepReport,
  fetchRepReportHistory,
  fetchRepReportReviewHistory,
  saveSalesRepReportDraft,
  submitSalesRepReport,
  resubmitRejectedSalesRepReport,
  RepReportError,
  type RepReport,
  type RepReportReviewHistoryEntry,
} from '../lib/repReportsService'
import { isRepSubmissionPastCutoff } from '../lib/repReportLock'
import { getCurrentReportingWeek, getReportingWeekFromStartDate } from '../utils/week'
import { EMPTY_SALES_REP_REPORT_SECTIONS, type SalesRepReportSections } from '../types'
import './SalesRepDashboard.css'

interface SalesRepDashboardProps {
  repId: string
  // Optional, matching the shape of the Header.tsx/NoProfile.tsx sign-out
  // prop already used elsewhere in this codebase (`onSignOut: () => void`,
  // wired to a plain button) — omitted entirely from this self-contained
  // component when the caller doesn't supply one, rather than rendering a
  // dead button.
  onSignOut?: () => void
}

type RepReportState = 'not_started' | 'draft' | 'pending' | 'approved' | 'rejected'

function deriveReportState(report: RepReport | null): RepReportState {
  if (!report) return 'not_started'
  if (report.status === 'draft') return 'draft'
  if (report.reviewStatus === 'approved') return 'approved'
  if (report.reviewStatus === 'rejected') return 'rejected'
  return 'pending'
}

// Mirrors ReportForm.tsx's own `isSubmitting`-gated pattern — a report is
// editable via saveSalesRepReportDraft in exactly two states (see
// repReportsService.ts's own state-machine comments): a fresh 'not_started'
// (the draft row doesn't exist yet) / 'draft' report, or a 'rejected'
// submitted report being corrected. 'pending' and 'approved' are never
// editable.
function isEditableState(state: RepReportState): boolean {
  return state === 'not_started' || state === 'draft' || state === 'rejected'
}

const STATE_LABELS: Record<RepReportState, string> = {
  not_started: 'Not Started',
  draft: 'Draft Saved',
  pending: 'Submitted — Pending Review',
  approved: 'Approved',
  rejected: 'Needs Correction',
}

export default function SalesRepDashboard({ repId, onSignOut }: SalesRepDashboardProps) {
  const week = getCurrentReportingWeek()
  const isPastDeadline = isRepSubmissionPastCutoff()

  const [report, setReport] = useState<RepReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  const [rejectionReason, setRejectionReason] = useState<string | null>(null)

  const [history, setHistory] = useState<RepReport[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyLoadError, setHistoryLoadError] = useState(false)

  // Explicit, not purely derived from status — lets a rep step back out of
  // the correction form (via the form's own Back link) to the compact
  // Rejected summary card without losing track of the underlying status.
  // Defaults to true for a freshly-loaded Rejected report, per the product
  // requirement that a rejected report should land the rep directly in the
  // correction form rather than behind an extra click (see this file's
  // header comment / the task's "Rejected (banner + SalesRepReportForm in
  // correction mode)" state description).
  const [editing, setEditing] = useState(false)

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitFailureMessage, setSubmitFailureMessage] = useState<string | null>(null)

  const [reloadToken, setReloadToken] = useState(0)
  const retryLoad = () => setReloadToken((t) => t + 1)

  useEffect(() => {
    let active = true
    setLoading(true)
    setLoadError(false)

    fetchRepReport(repId, week.weekStartDate)
      .then(async (result) => {
        if (!active) return
        setReport(result)
        const state = deriveReportState(result)
        if (state === 'rejected') {
          // The rejection reason is NOT stored directly on the rejected
          // report row's own current-reason field once resubmitted — it
          // lives in the append-only review history. The last entry with
          // reviewStatus 'rejected' is the current, still-unresolved reason
          // (see repReportsService.ts's fetchRepReportReviewHistory doc
          // comment: oldest first, so this is the LAST 'rejected' entry).
          const entries = await fetchRepReportReviewHistory(result!.id)
          if (!active) return
          const lastRejected = [...entries].reverse().find((e: RepReportReviewHistoryEntry) => e.reviewStatus === 'rejected')
          setRejectionReason(lastRejected?.reason ?? null)
          setEditing(true)
        } else {
          setRejectionReason(null)
        }
      })
      .catch(() => {
        if (!active) return
        setLoadError(true)
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [repId, week.weekStartDate, reloadToken])

  useEffect(() => {
    let active = true
    setHistoryLoading(true)
    setHistoryLoadError(false)

    fetchRepReportHistory(repId)
      .then((result) => {
        if (!active) return
        setHistory(result)
      })
      .catch(() => {
        if (!active) return
        setHistoryLoadError(true)
      })
      .finally(() => {
        if (active) setHistoryLoading(false)
      })

    return () => {
      active = false
    }
  }, [repId, reloadToken])

  const reportState = deriveReportState(report)

  // The only two write paths into saveSalesRepReportDraft this component
  // ever uses: creating the very first draft row (report === null, 'not
  // started') and editing an existing draft or rejected row. Both funnel
  // through the same RPC — see repReportsService.ts — the distinction here
  // is purely about what's already in local state.
  const handleSaveDraft = async (data: SalesRepReportSections): Promise<void> => {
    try {
      const updated = await saveSalesRepReportDraft(week.weekStartDate, data)
      setReport(updated)
    } catch (err) {
      // Re-thrown unconditionally so SalesRepReportForm's own useAutosave
      // (isLockedError/status handling) sees the failure too — this
      // component is not the only place that needs to react to it. A
      // REP_STATUS_REGRESSION_BLOCKED error is already turned into a
      // friendly, persistent inline message by SalesRepReportForm itself;
      // nothing further to surface here for that specific code.
      if (err instanceof RepReportError && err.code !== 'REP_STATUS_REGRESSION_BLOCKED') {
        console.error('Failed to save sales rep report draft:', err.message)
      }
      throw err
    }
  }

  const handleSubmit = async (data: SalesRepReportSections): Promise<void> => {
    setIsSubmitting(true)
    setSubmitFailureMessage(null)
    try {
      // Persist any final edits first (saveSalesRepReportDraft never changes
      // status/reviewStatus — see repReportsService.ts), THEN transition
      // lifecycle state via the correct RPC for the CURRENT state: a fresh
      // draft/not-started report submits via submitSalesRepReport, while a
      // rejected report must go through resubmitRejectedSalesRepReport
      // instead (submitSalesRepReport would reject it — draft -> submitted
      // only, never rejected -> submitted).
      await saveSalesRepReportDraft(week.weekStartDate, data)
      const updated =
        reportState === 'rejected' ? await resubmitRejectedSalesRepReport(week.weekStartDate) : await submitSalesRepReport(week.weekStartDate)
      setReport(updated)
      setRejectionReason(null)
      setEditing(false)
      retryLoad()
    } catch (err) {
      if (err instanceof RepReportError) {
        if (err.code === 'SUBMISSION_DEADLINE_PASSED') {
          setSubmitFailureMessage('The deadline has passed. Contact your admin to request an exception.')
        } else if (err.code === 'REP_STATUS_REGRESSION_BLOCKED') {
          setSubmitFailureMessage('This report can no longer be edited.')
        } else {
          setSubmitFailureMessage(err.message)
        }
      } else {
        setSubmitFailureMessage('Something went wrong submitting your report. Please try again.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const startEditing = () => {
    setSubmitFailureMessage(null)
    setEditing(true)
  }

  const backToSummary = () => {
    setEditing(false)
  }

  if (loading) {
    return (
      <div className="sales-rep-dashboard-page">
        <p className="rep-dashboard-loading">Loading your report…</p>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="sales-rep-dashboard-page">
        <div className="rep-dashboard-error">
          <p>We couldn&apos;t load your report. Please try again.</p>
          <button className="btn btn-secondary" onClick={retryLoad}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (editing && isEditableState(reportState)) {
    return (
      <div className="sales-rep-dashboard-page">
        <SalesRepReportForm
          initialData={report?.content ?? EMPTY_SALES_REP_REPORT_SECTIONS}
          weekLabel={week.label}
          deadlineLabel={week.deadlineLabel}
          isPastDeadline={isPastDeadline}
          isRejectedCorrection={reportState === 'rejected'}
          rejectionReason={rejectionReason}
          onBack={backToSummary}
          onSaveDraft={handleSaveDraft}
          onSubmit={handleSubmit}
          isSubmitting={isSubmitting}
          submitFailureMessage={submitFailureMessage}
        />
      </div>
    )
  }

  const actionLabel = reportState === 'not_started' ? 'Start This Week’s Report' : reportState === 'draft' ? 'Continue Draft' : 'Resume Correction'

  return (
    <div className="sales-rep-dashboard-page">
      <div className="rep-dashboard-heading">
        <div>
          <h1>My Weekly Report</h1>
          <p className="rep-dashboard-subtitle">Your weekly report and recent submissions</p>
        </div>
        <div className="rep-dashboard-heading-right">
          <span className="rep-dashboard-week">Week of {week.label}</span>
          {onSignOut && (
            <button type="button" className="sign-out-btn" onClick={onSignOut}>
              Sign Out
            </button>
          )}
        </div>
      </div>

      <div className="rep-hero-card">
        <div className="rep-hero-top">
          <span className="rep-hero-week-label">This Week&apos;s Report</span>
          <span className={`rep-status-badge rep-status-${reportState}`}>{STATE_LABELS[reportState]}</span>
        </div>

        <div className="rep-hero-deadline-block">
          <p className="rep-hero-deadline">
            Due <strong>{week.deadlineLabel}</strong>
          </p>
          {isPastDeadline && <span className="rep-hero-deadline-passed">Deadline passed</span>}
        </div>

        {reportState === 'rejected' && (
          <div className="rep-rejection-summary-banner" role="alert">
            <p className="rep-rejection-summary-title">Your manager requested changes</p>
            {rejectionReason && <p className="rep-rejection-summary-reason">{rejectionReason}</p>}
          </div>
        )}

        {isPastDeadline && isEditableState(reportState) && (
          <p className="rep-deadline-notice">
            The Friday 2:00 PM Eastern deadline has passed. You can still save a draft; submitting now requires an
            admin-authorized exception.
          </p>
        )}

        {isEditableState(reportState) ? (
          <div className="rep-hero-action">
            <button className="btn btn-primary btn-large" onClick={startEditing}>
              {actionLabel}
            </button>
          </div>
        ) : reportState === 'pending' ? (
          <p className="rep-hero-readonly-note">
            Your report was submitted{report?.submittedAt ? ` on ${new Date(report.submittedAt).toLocaleDateString()}` : ''} and is
            awaiting your manager&apos;s review.
          </p>
        ) : (
          <p className="rep-hero-readonly-note">
            Approved{report?.reviewedAt ? ` on ${new Date(report.reviewedAt).toLocaleDateString()}` : ''}. Nice work!
          </p>
        )}
      </div>

      {(reportState === 'pending' || reportState === 'approved') && report && (
        <ReadOnlyReportSummary content={report.content} />
      )}

      <div className="rep-history-card">
        <h2>Report History</h2>
        {historyLoading ? (
          <p className="rep-history-empty">Loading…</p>
        ) : historyLoadError ? (
          <div className="rep-history-error">
            <p>We couldn&apos;t load your report history.</p>
            <button className="btn btn-secondary" onClick={retryLoad}>
              Retry
            </button>
          </div>
        ) : history.length === 0 ? (
          <p className="rep-history-empty">No previous reports yet.</p>
        ) : (
          // Minimal, read-only rows — no click-through to a detail view yet.
          // Known gap, deferred to Phase 1C: a rep cannot drill into a past
          // week's full content or review history from here, only see its
          // status at a glance.
          <ul className="rep-history-list">
            {history.map((entry) => {
              const entryWeek = getReportingWeekFromStartDate(entry.weekStartDate)
              const entryState = deriveReportState(entry)
              return (
                <li key={entry.id} className="rep-history-row">
                  <span className="rep-history-week">{entryWeek.label}</span>
                  <span className={`rep-status-badge rep-status-${entryState}`}>{STATE_LABELS[entryState]}</span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

// Read-only rendering for a Pending/Approved report — no editing controls,
// just the content as last saved/submitted. Deliberately simple (plain
// lists/paragraphs, no BulletListInput) since nothing here is ever edited.
function ReadOnlyReportSummary({ content }: { content: SalesRepReportSections }) {
  const sections: { title: string; bullets: string[] }[] = [
    { title: 'Accomplishments', bullets: content.accomplishments },
    { title: 'Sales Metrics', bullets: content.salesMetrics },
    { title: 'Pipeline Updates', bullets: content.pipelineUpdates },
    { title: 'Blockers / Challenges', bullets: content.blockers },
    { title: 'Next Week Priorities', bullets: content.nextWeekPriorities },
  ]

  return (
    <div className="rep-readonly-card">
      {sections.map((section) => (
        <div className="rep-readonly-section" key={section.title}>
          <p className="rep-readonly-section-label">{section.title}</p>
          {section.bullets.length === 0 ? (
            <p className="rep-readonly-empty">No response provided.</p>
          ) : (
            <ul className="rep-readonly-bullets">
              {section.bullets.map((bullet, i) => (
                <li key={i}>{bullet}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <div className="rep-readonly-section">
        <p className="rep-readonly-section-label">Manager Support Needed</p>
        <p className="rep-readonly-text">
          {content.managerSupportNeeded || <span className="rep-readonly-empty">No response provided.</span>}
        </p>
      </div>
    </div>
  )
}
