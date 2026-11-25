import { useEffect, useState } from 'react'
import SalesRepReportForm from './SalesRepReportForm'
import SalesRepTeamReports from './SalesRepTeamReports'
import {
  fetchRepReport,
  fetchRepReportHistory,
  fetchRepReportFeedback,
  fetchMyCurrentManagerAssignment,
  saveSalesRepReportDraft,
  submitSalesRepReport,
  RepReportError,
  type RepReport,
  type RepReportFeedbackEntry,
} from '../lib/repReportsService'
import { fetchProfilesByIds, type RepProfileSummary } from '../lib/repRosterService'
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

// Beta feedback (2026-11-16): collapsed from the old
// not_started/draft/pending/approved/rejected 5-state machine (gated by
// review_status) to a plain 3-way split (gated by status alone) —
// review_status no longer gates anything. A submitted report is editable
// the same way a draft is, up until the shared deadline lock (see
// isEditableState below).
type RepReportState = 'not_started' | 'draft' | 'submitted'

function deriveReportState(report: RepReport | null): RepReportState {
  if (!report) return 'not_started'
  if (report.status === 'draft') return 'draft'
  return 'submitted'
}

// Every state is editable now — the only real gate is the deadline lock
// (isPastDeadline, checked separately at each call site below), exactly
// mirroring Dashboard.tsx's Manager-side model (state never changes
// editability, only the cutoff does).
const STATE_LABELS: Record<RepReportState, string> = {
  not_started: 'Not Started',
  draft: 'Draft Saved',
  submitted: 'Submitted',
}

export default function SalesRepDashboard({ repId, onSignOut }: SalesRepDashboardProps) {
  const week = getCurrentReportingWeek()
  const isPastDeadline = isRepSubmissionPastCutoff()

  const [report, setReport] = useState<RepReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  const [feedbackEntries, setFeedbackEntries] = useState<RepReportFeedbackEntry[]>([])

  const [history, setHistory] = useState<RepReport[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyLoadError, setHistoryLoadError] = useState(false)

  // Explicit, not purely derived from status — lets a rep step back out of
  // the edit form (via the form's own Back link) to the summary card
  // without losing track of the underlying status.
  const [editing, setEditing] = useState(false)

  // Reporting hierarchy & access phase (2026-11-24) — a simple two-tab nav
  // (no sidebar shell needed, this dashboard has always been a single
  // scrolling page). Switching tabs never interrupts an in-progress edit:
  // the "Team Reports" tab is only offered from the main summary view,
  // the same place "editing" itself can only be entered from.
  const [view, setView] = useState<'my-report' | 'team-reports'>('my-report')

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitFailureMessage, setSubmitFailureMessage] = useState<string | null>(null)

  const [reloadToken, setReloadToken] = useState(0)
  const retryLoad = () => setReloadToken((t) => t + 1)

  // Manager identity — kept entirely separate from the report-loading
  // effects below (own loading/error state) since it's informational, never
  // blocking: a failure here should never prevent the rep from seeing or
  // working on their own report.
  const [manager, setManager] = useState<RepProfileSummary | null>(null)
  const [managerLoading, setManagerLoading] = useState(true)

  useEffect(() => {
    let active = true
    setManagerLoading(true)

    fetchMyCurrentManagerAssignment(repId)
      .then(async (assignment) => {
        if (!active) return
        if (!assignment) {
          setManager(null)
          return
        }
        const profiles = await fetchProfilesByIds([assignment.managerId])
        if (!active) return
        setManager(profiles[0] ?? null)
      })
      .catch(() => {
        if (active) setManager(null)
      })
      .finally(() => {
        if (active) setManagerLoading(false)
      })

    return () => {
      active = false
    }
  }, [repId, reloadToken])

  useEffect(() => {
    let active = true
    setLoading(true)
    setLoadError(false)

    fetchRepReport(repId, week.weekStartDate)
      .then(async (result) => {
        if (!active) return
        setReport(result)
        if (result) {
          const entries = await fetchRepReportFeedback(result.id)
          if (!active) return
          setFeedbackEntries(entries)
        } else {
          setFeedbackEntries([])
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

  // The write path into saveSalesRepReportDraft for a brand-new/still-draft
  // report (report === null or status === 'draft'). Beta feedback
  // (2026-11-16): the SAME RPC now also handles a content-only edit to an
  // already-submitted report — see handleSaveChanges below, which calls it
  // too; the server tells the two cases apart by the row's current status,
  // never by anything this client sends.
  const handleSaveDraft = async (data: SalesRepReportSections): Promise<void> => {
    try {
      const updated = await saveSalesRepReportDraft(week.weekStartDate, data)
      setReport(updated)
    } catch (err) {
      // Re-thrown unconditionally so SalesRepReportForm's own useAutosave
      // (isLockedError/status handling) sees the failure too — this
      // component is not the only place that needs to react to it.
      if (err instanceof RepReportError && err.code !== 'EDIT_LOCKED') {
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
      // draft -> submitted via submitSalesRepReport.
      await saveSalesRepReportDraft(week.weekStartDate, data)
      const updated = await submitSalesRepReport(week.weekStartDate)
      setReport(updated)
      setEditing(false)
      retryLoad()
    } catch (err) {
      if (err instanceof RepReportError) {
        if (err.code === 'SUBMISSION_DEADLINE_PASSED') {
          setSubmitFailureMessage('The deadline has passed. Contact your admin to request an exception.')
        } else if (err.code === 'EDIT_LOCKED') {
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

  // Beta feedback (2026-11-16): a content-only edit to an already-submitted
  // report. Never calls submitSalesRepReport — the report is already
  // submitted, and that RPC only transitions a 'draft' row, so calling it
  // again here would just raise NOT_FOUND. saveSalesRepReportDraft itself
  // preserves status/submitted_at/first_submitted_at/review_status when
  // the existing row is already submitted (see its own updated comment in
  // repReportsService.ts).
  const handleSaveChanges = async (data: SalesRepReportSections): Promise<void> => {
    try {
      const updated = await saveSalesRepReportDraft(week.weekStartDate, data)
      setReport(updated)
    } catch (err) {
      if (err instanceof RepReportError && err.code !== 'EDIT_LOCKED') {
        console.error('Failed to save sales rep report changes:', err.message)
      }
      throw err
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

  if (editing) {
    const isEditingSubmitted = reportState === 'submitted'
    return (
      <div className="sales-rep-dashboard-page">
        <SalesRepReportForm
          initialData={report?.content ?? EMPTY_SALES_REP_REPORT_SECTIONS}
          weekLabel={week.label}
          deadlineLabel={week.deadlineLabel}
          isPastDeadline={isPastDeadline}
          isEditingSubmitted={isEditingSubmitted}
          onBack={backToSummary}
          onSaveDraft={handleSaveDraft}
          onSubmit={handleSubmit}
          onSaveChanges={handleSaveChanges}
          isSubmitting={isSubmitting}
          submitFailureMessage={submitFailureMessage}
        />
      </div>
    )
  }

  // Beta feedback (2026-11-16): every state offers an edit action now — the
  // only real gate is the shared deadline lock (isPastDeadline), not
  // status. Mirrors Dashboard.tsx's Manager-side action-label pattern.
  const actionLabel = reportState === 'not_started' ? 'Start This Week’s Report' : reportState === 'draft' ? 'Continue Draft' : 'Edit Report'

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

      <div className="rep-tabs" role="tablist" aria-label="Sales Rep sections">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'my-report'}
          className={`rep-tab ${view === 'my-report' ? 'rep-tab-active' : ''}`}
          onClick={() => setView('my-report')}
        >
          My Weekly Report
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'team-reports'}
          className={`rep-tab ${view === 'team-reports' ? 'rep-tab-active' : ''}`}
          onClick={() => setView('team-reports')}
        >
          Team Reports
        </button>
      </div>

      {view === 'team-reports' ? (
        <SalesRepTeamReports repId={repId} weekStartDate={week.weekStartDate} weekLabel={week.label} />
      ) : (
        <>
      <div className="rep-manager-card">
        <span className="rep-manager-card-label">Your Manager</span>
        {managerLoading ? (
          <p className="rep-manager-card-loading">Loading…</p>
        ) : manager ? (
          <p className="rep-manager-card-details">
            <span className="rep-manager-card-name">{manager.fullName ?? 'Unnamed Manager'}</span>
            <span className="rep-manager-card-email">{manager.email}</span>
          </p>
        ) : (
          <p className="rep-manager-card-empty">Manager not assigned yet</p>
        )}
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

        {feedbackEntries.length > 0 && (
          <div className="rep-rejection-summary-banner" role="status">
            <p className="rep-rejection-summary-title">Feedback from your manager</p>
            {feedbackEntries.map((entry) => (
              <p className="rep-rejection-summary-reason" key={entry.id}>
                {entry.feedback}
              </p>
            ))}
          </div>
        )}

        {isPastDeadline ? (
          <p className="rep-deadline-notice">Editing is closed for this reporting week.</p>
        ) : (
          <div className="rep-hero-action">
            <button className="btn btn-primary btn-large" onClick={startEditing}>
              {actionLabel}
            </button>
          </div>
        )}

        {reportState === 'submitted' && (
          <p className="rep-hero-readonly-note">
            Submitted{report?.submittedAt ? ` on ${new Date(report.submittedAt).toLocaleDateString()}` : ''}. Feedback is optional and
            never blocks you from editing it again before the deadline.
          </p>
        )}
      </div>

      {reportState === 'submitted' && report && <ReadOnlyReportSummary content={report.content} />}

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
        </>
      )}
    </div>
  )
}

// Read-only rendering for a Pending/Approved report — no editing controls,
// just the content as last saved/submitted. Deliberately simple (plain
// lists/paragraphs, no BulletListInput) since nothing here is ever edited.
// Exported for reuse by SalesRepTeamReports.tsx (viewing a teammate's
// submitted report needs the identical read-only rendering, never a
// second implementation that could drift).
export function ReadOnlyReportSummary({ content }: { content: SalesRepReportSections }) {
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
