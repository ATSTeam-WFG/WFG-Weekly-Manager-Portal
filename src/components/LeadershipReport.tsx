import { useEffect, useState } from 'react'
import { fetchPersistedAnalysis, isAtsShapedSections } from '../lib/executiveSummaryService'
import type { AtsReport } from '../lib/atsReport'
import type { ReportingWeek } from '../utils/week'
import { parseDateOnly } from '../utils/week'
import AtsReportView from './AtsReportView'
import AtsTopicsEditForm from './AtsTopicsEditForm'
import './LeadershipReport.css'

type Mode = 'view' | 'edit'

interface LeadershipReportProps {
  week: ReportingWeek
  isCurrentWeek: boolean
  onPreviousWeek: () => void
  onNextWeek: () => void
}

// Leadership Report is weekly-only (no bi-weekly/monthly/etc.), so this
// always reads as "Week Ending [date]" — no periodKey branching needed,
// unlike ExecutiveAnalysisCard's own buildAtsPeriodLabel. Uses parseDateOnly
// (week.ts), never `new Date(dateOnlyString)` — see the production
// off-by-one bug that fix addressed; periodEndDate is a date-only value.
function weekEndingLabel(periodEndDate: string): string {
  return `Week Ending ${parseDateOnly(periodEndDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
}

// A genuine deep copy — new topic objects and new bullet arrays, never a
// shared reference back to the source ATS analysis. This is what guarantees
// "editing the right-side local copy must never modify the left-side ATS
// report": there is no path, even an indirect one, from a mutation of this
// copy back to the object fetchPersistedAnalysis returned.
function deepCopyAtsReport(report: AtsReport): AtsReport {
  return {
    openingParagraph: report.openingParagraph,
    topics: report.topics.map((topic) => ({
      title: topic.title,
      statusSummary: topic.statusSummary,
      bullets: [...topic.bullets],
      next: topic.next,
    })),
  }
}

// Phase 1: page shell + read-only ATS source + a local-only editable draft.
// No persistence, no new Supabase table, no new RPC — fetchPersistedAnalysis
// is the same, unmodified read this app already uses for Executive
// Analysis. Save Draft / Download-Print are intentionally disabled controls
// here (Phase 2/3 work — see their own inline comments) so this phase can
// be reviewed as a pure visual/structural change with zero write paths.
export default function LeadershipReport({ week, isCurrentWeek, onPreviousWeek, onNextWeek }: LeadershipReportProps) {
  const [loading, setLoading] = useState(true)
  const [periodLabel, setPeriodLabel] = useState('')
  const [hasSource, setHasSource] = useState(false)
  const [sourceIsAtsShaped, setSourceIsAtsShaped] = useState(false)
  const [sourceReport, setSourceReport] = useState<AtsReport | null>(null)
  const [draftReport, setDraftReport] = useState<AtsReport | null>(null)
  const [mode, setMode] = useState<Mode>('view')

  useEffect(() => {
    let active = true
    setLoading(true)
    setMode('view')

    fetchPersistedAnalysis('weekly', week.weekStartDate).then((persisted) => {
      if (!active) return

      setHasSource(persisted !== null)
      setPeriodLabel(persisted ? weekEndingLabel(persisted.periodEndDate) : '')

      const atsShaped = persisted !== null && isAtsShapedSections(persisted.sections)
      setSourceIsAtsShaped(atsShaped)

      if (persisted && isAtsShapedSections(persisted.sections)) {
        setSourceReport(persisted.sections)
        // Deep copy, computed once per fetch — never re-derived from
        // sourceReport later, so nothing here can accidentally reintroduce
        // a shared reference on a subsequent render.
        setDraftReport(deepCopyAtsReport(persisted.sections))
      } else {
        setSourceReport(null)
        setDraftReport(null)
      }

      setLoading(false)
    })

    return () => {
      active = false
    }
  }, [week.weekStartDate])

  return (
    <div className="leadership-report-page">
      {/* No "Back to Admin Dashboard" link here, deliberately — the
          persistent Admin sidebar already provides navigation, and a
          second, redundant way back was flagged as visual clutter. Every
          other admin destination still has its own back-link; this page is
          the one intentional exception. */}
      <div className="lr-header">
        <div className="lr-header-titles">
          <h1>Leadership Report</h1>
          <p className="lr-header-subtitle">Review the ATS source and prepare the final leadership report.</p>
        </div>

        {/* Leadership Report owns its own week offset (see App.tsx) —
            deliberately independent from Admin Dashboard/Weekly Summary's
            shared adminWeekOffset, so navigating weeks elsewhere in the
            app can never shift the week an Admin is mid-edit on here. */}
        <div className="lr-week-nav">
          <button type="button" className="lr-week-nav-btn" onClick={onPreviousWeek} aria-label="Previous reporting week">
            &lsaquo; Previous
          </button>
          <span className="lr-week-label">
            Week of {week.label}
            {isCurrentWeek && <span className="week-current-badge">Current</span>}
          </span>
          <button
            type="button"
            className="lr-week-nav-btn"
            onClick={onNextWeek}
            disabled={isCurrentWeek}
            aria-label="Next reporting week"
          >
            Next &rsaquo;
          </button>
        </div>
      </div>

      {loading ? (
        <div className="admin-loading">Loading leadership report…</div>
      ) : (
        <div className="lr-panes">
          <div className="lr-pane lr-pane-source">
            <div className="lr-pane-header">
              <div>
                <h2>ATS Format Report</h2>
                <p className="lr-pane-subtitle">Read-only source</p>
              </div>
              {/* Phase 1: present but non-functional. TODO(Phase 3): wire up
                  an independent "Print / Download ATS Report" action —
                  reusing the existing print-body-class pattern
                  (ExecutiveAnalysisCard.tsx's printExecutiveAnalysisOnly),
                  scoped to a new .leadership-report-page print rule. Not
                  built yet — never call window.print() from a disabled
                  control. */}
              <button type="button" className="btn btn-secondary" disabled title="Print / Download will be available in a later phase">
                Print / Download ATS Report
              </button>
            </div>

            <div className="lr-pane-body">
              {!hasSource ? (
                <div className="lr-empty-state">
                  <p>No ATS report has been generated for this week yet.</p>
                  <p className="lr-empty-state-hint">Generate the weekly ATS report from Weekly Summary first, then return here.</p>
                </div>
              ) : !sourceIsAtsShaped || !sourceReport ? (
                <div className="lr-empty-state">
                  <p>This week&apos;s saved analysis is not in the ATS format Leadership Report requires.</p>
                  <p className="lr-empty-state-hint">
                    Regenerate this week&apos;s analysis from Weekly Summary to bring it into the current ATS format.
                  </p>
                </div>
              ) : (
                // Strictly read-only: no edit affordance is ever rendered
                // for this pane, in either mode — the only way to guarantee
                // an Admin can never modify the ATS source from this page.
                <AtsReportView report={sourceReport} periodLabel={periodLabel} />
              )}
            </div>
          </div>

          <div className="lr-pane lr-pane-draft">
            <div className="lr-pane-header">
              <div>
                <h2>Leadership Report</h2>
                <p className="lr-pane-subtitle">Editable Draft</p>
              </div>
              <div className="lr-pane-actions">
                {draftReport && mode === 'view' && (
                  <button type="button" className="btn btn-secondary" onClick={() => setMode('edit')}>
                    Edit
                  </button>
                )}
                {draftReport && mode === 'edit' && (
                  <button type="button" className="btn btn-secondary" onClick={() => setMode('view')}>
                    Done Editing
                  </button>
                )}
                {/* Phase 1: disabled — no persistence/database write exists
                    yet. TODO(Phase 2): a save_leadership_report_draft RPC,
                    one row per reporting week, never overwritten by ATS
                    regeneration (see the investigation report this phase
                    followed). Styled as the primary (terracotta) action
                    while editing — btn-secondary in view mode, since there
                    is nothing to save until a change is in progress — so
                    the visual hierarchy already matches what Phase 2 will
                    make functionally true, without implementing it yet. */}
                <button
                  type="button"
                  className={`btn ${mode === 'edit' ? 'btn-primary' : 'btn-secondary'}`}
                  disabled
                  title="Save Draft persistence is Phase 2 work"
                >
                  Save Draft
                </button>
                {/* Phase 1: disabled. TODO(Phase 3): an independent
                    "Print / Download Leadership Report" action, printing
                    only the last-saved draft (once Save Draft exists),
                    following the same established print-body-class
                    pattern used elsewhere in this app. Primary in view
                    mode (the natural "finish" action once there's nothing
                    left to edit); secondary while editing, since Save
                    Draft is the more relevant action at that point. */}
                <button
                  type="button"
                  className={`btn ${mode === 'edit' ? 'btn-secondary' : 'btn-primary'}`}
                  disabled
                  title="Print / Download will be available in a later phase"
                >
                  Print / Download Report
                </button>
              </div>
            </div>

            <div className="lr-pane-body">
              {!draftReport ? (
                <div className="lr-empty-state">
                  <p>The Leadership Report starts from this week&apos;s ATS source.</p>
                  <p className="lr-empty-state-hint">Once an ATS report exists for this week, its content will appear here to customize.</p>
                </div>
              ) : mode === 'edit' ? (
                // Page-level container only — AtsTopicsEditForm.tsx and its
                // own CSS are completely untouched. This just gives the
                // editing surface some breathing room and a light frame
                // (echoing .lr-pane-draft's own terracotta top accent)
                // distinct from the raw pane background, so it reads as
                // "the document you're editing" rather than a bare form
                // dropped onto the page.
                <div className="lr-edit-container">
                  <AtsTopicsEditForm report={draftReport} onChange={setDraftReport} />
                </div>
              ) : (
                <AtsReportView report={draftReport} periodLabel={periodLabel} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
