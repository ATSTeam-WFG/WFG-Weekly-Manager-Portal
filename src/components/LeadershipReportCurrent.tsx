import { useEffect, useState } from 'react'
import wfgLogo from '../assets/wfg-logo.png'
import { fetchPersistedAnalysis, isAtsShapedSections } from '../lib/executiveSummaryService'
import {
  fetchLeadershipReportDraft,
  fetchPreviousLeadershipReportDraft,
  saveLeadershipReportDraft,
  LeadershipReportDraftError,
  type LeadershipReportDraft,
} from '../lib/leadershipReportDraftService'
import { computeAtsContentFingerprint } from '../lib/atsContentFingerprint'
import type { AtsReport } from '../lib/atsReport'
import type { ReportingWeek } from '../utils/week'
import { parseDateOnly } from '../utils/week'
import AtsReportView from './AtsReportView'
import AtsTopicsEditForm from './AtsTopicsEditForm'
import ConfirmDialog from './ConfirmDialog'
import './LeadershipReport.css'

type Mode = 'view' | 'edit'
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
type LeftTab = 'ats' | 'previous'

// Same toggle-a-body-class-around-window.print() pattern already
// established by ExecutiveAnalysisCard.tsx's printExecutiveAnalysisOnly —
// never a second print mechanism. Four independent classes (one per
// independently-printable Leadership Report target — ATS source, My
// Leadership Report draft, Previous Work, and History's own selected saved
// report) rather than one shared class. See print.css for the isolation
// rules these activate, and LeadershipReport.css for the always-mounted
// print-only mirrors (.lr-print-*-only, rendered below and in
// LeadershipReportHistory.tsx) that they reveal — each wired directly to
// its own report data rather than to whichever DOM pane happens to be
// visible, so printing is correct regardless of which left-column tab or
// edit/view mode is currently on screen.
const PRINT_LR_ATS_ONLY_CLASS = 'print-lr-ats-only'
const PRINT_LR_DRAFT_ONLY_CLASS = 'print-lr-draft-only'
const PRINT_LR_PREVIOUS_ONLY_CLASS = 'print-lr-previous-only'

// Safety-net only, mirroring ExecutiveAnalysisCard.tsx's identical constant
// — long enough to never interrupt a real print dialog still open; the
// cleanup itself is idempotent (safe to run twice).
const PRINT_MODE_FALLBACK_MS = 60_000

// Exported so LeadershipReportHistory.tsx can reuse this exact mechanism for
// its own "Print / Download Report" action (its own dedicated
// print-lr-history-only class) — the same cross-component reuse pattern
// already established by WeeklySummary.tsx importing
// printExecutiveAnalysisOnly directly from ExecutiveAnalysisCard.tsx, never
// a second, duplicated print implementation.
export function printWithScopedClass(className: string): void {
  document.body.classList.add(className)

  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    document.body.classList.remove(className)
    window.removeEventListener('afterprint', cleanup)
  }

  window.addEventListener('afterprint', cleanup)
  window.setTimeout(cleanup, PRINT_MODE_FALLBACK_MS)
  window.print()
}

function printLeadershipReportAtsOnly(): void {
  printWithScopedClass(PRINT_LR_ATS_ONLY_CLASS)
}

// Prints whatever is CURRENTLY displayed as "My Leadership Report" —
// draftReport, not baselineContent — so unsaved in-progress edits print
// exactly as shown, never silently saved or discarded by printing. See the
// always-mounted .lr-print-draft-only mirror below, which renders
// draftReport regardless of whether the on-screen pane is currently
// showing the edit form or the read-only view.
function printLeadershipReportDraftOnly(): void {
  printWithScopedClass(PRINT_LR_DRAFT_ONLY_CLASS)
}

// Prints the caller's own previous saved Leadership Report (previousDraft) —
// the exact same RLS-scoped read already used by the on-screen "Previous
// Work" tab, never re-fetched or re-derived for print. Strictly read-only:
// there is no save path for Previous Work at all.
function printLeadershipReportPreviousOnly(): void {
  printWithScopedClass(PRINT_LR_PREVIOUS_ONLY_CLASS)
}

interface LeadershipReportCurrentProps {
  week: ReportingWeek
  isCurrentWeek: boolean
  onPreviousWeek: () => void
  onNextWeek: () => void
  // Reports whether the right-side draft currently differs from what's
  // actually saved (or, if nothing is saved yet, from the fresh deep copy it
  // started as) — the parent (LeadershipReport.tsx) uses this to warn
  // before discarding it by switching to History.
  onDirtyChange: (isDirty: boolean) => void
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

// The Current workspace: independent week navigation, a left reference
// column (ATS Format / Previous Work tabs) and a right editable column (My
// Leadership Report). fetchPersistedAnalysis is still the same, unmodified
// read this app already uses for Executive Analysis — the left ATS tab's
// data path is completely untouched. Loading a saved draft (when one
// exists) takes priority over reseeding from the current ATS source, so an
// Admin's prior edits are never silently discarded by later ATS
// regeneration; no database row is created merely by viewing/unlocking/
// changing week — the first row is created only when Save Draft is
// explicitly clicked (handleSaveDraft below, the only call site of
// saveLeadershipReportDraft anywhere in this component).
export default function LeadershipReportCurrent({ week, isCurrentWeek, onPreviousWeek, onNextWeek, onDirtyChange }: LeadershipReportCurrentProps) {
  const [loading, setLoading] = useState(true)
  const [periodLabel, setPeriodLabel] = useState('')
  const [periodEndDate, setPeriodEndDate] = useState<string | null>(null)
  const [hasSource, setHasSource] = useState(false)
  const [sourceIsAtsShaped, setSourceIsAtsShaped] = useState(false)
  const [sourceReport, setSourceReport] = useState<AtsReport | null>(null)
  const [sourceAnalysisId, setSourceAnalysisId] = useState<string | null>(null)
  const [draftReport, setDraftReport] = useState<AtsReport | null>(null)
  // The content exactly as last loaded or last saved — compared against
  // draftReport to know whether there's anything unsaved to warn about
  // before discarding it. Never itself shown; a plain comparison baseline.
  const [baselineContent, setBaselineContent] = useState<AtsReport | null>(null)
  const [previousDraft, setPreviousDraft] = useState<LeadershipReportDraft | null>(null)
  const [leftTab, setLeftTab] = useState<LeftTab>('ats')
  const [mode, setMode] = useState<Mode>('view')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setLeftTab('ats')
    setMode('view')
    setSaveStatus('idle')
    setSaveError(null)
    setPreviousDraft(null)

    // Independent of whether this week's ATS source exists — "my previous
    // report" is about the CALLER's own saved history, not this week's
    // data. RLS (owner_id = auth.uid()) is what makes this "mine"; no
    // owner_id is ever passed or filtered here client-side.
    fetchPreviousLeadershipReportDraft(week.weekStartDate).then((previous) => {
      if (!active) return
      setPreviousDraft(previous)
    })

    fetchPersistedAnalysis('weekly', week.weekStartDate).then(async (persisted) => {
      if (!active) return

      setHasSource(persisted !== null)
      setPeriodLabel(persisted ? weekEndingLabel(persisted.periodEndDate) : '')
      setPeriodEndDate(persisted ? persisted.periodEndDate : null)

      const atsShaped = persisted !== null && isAtsShapedSections(persisted.sections)
      setSourceIsAtsShaped(atsShaped)

      if (persisted && isAtsShapedSections(persisted.sections)) {
        setSourceReport(persisted.sections)
        setSourceAnalysisId(persisted.id)

        // Merely opening the page/changing week must never create a row —
        // this is a plain read.
        const savedDraft = await fetchLeadershipReportDraft(week.weekStartDate)
        if (!active) return

        if (savedDraft) {
          setDraftReport(savedDraft.content)
          setBaselineContent(savedDraft.content)
        } else {
          // Deep copy, computed once per fetch — never re-derived from
          // sourceReport later, so nothing here can accidentally reintroduce
          // a shared reference on a subsequent render.
          const copy = deepCopyAtsReport(persisted.sections)
          setDraftReport(copy)
          setBaselineContent(copy)
        }
      } else {
        setSourceReport(null)
        setSourceAnalysisId(null)
        setDraftReport(null)
        setBaselineContent(null)
      }

      setLoading(false)
    })

    return () => {
      active = false
    }
  }, [week.weekStartDate])

  const isDirty = draftReport !== null && baselineContent !== null && JSON.stringify(draftReport) !== JSON.stringify(baselineContent)

  // Reported upward on every change so the parent can warn before a switch
  // to History would discard it (switching unmounts this component), and —
  // threaded further still, all the way to App.tsx — before a sidebar
  // navigation away from Leadership Report entirely would too.
  useEffect(() => {
    onDirtyChange(isDirty)
  }, [isDirty, onDirtyChange])

  // Standard browser reload/close protection — active only while isDirty,
  // and removed the instant it isn't (a save, a discard, or this component
  // unmounting all trigger the same cleanup). No custom message: modern
  // browsers show their own generic "leave site?" wording regardless of
  // e.returnValue's content, so none is depended on here. Nothing is ever
  // persisted — this is a live event listener only.
  useEffect(() => {
    if (!isDirty) return
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty])

  // Any further local edit invalidates the "Draft saved"/error status from a
  // previous save — showing a stale "Draft saved" alongside new unsaved
  // changes would be misleading.
  const handleDraftChange = (next: AtsReport) => {
    setDraftReport(next)
    setSaveStatus('idle')
    setSaveError(null)
  }

  const canSave = mode === 'edit' && draftReport !== null && sourceReport !== null && sourceAnalysisId !== null && periodEndDate !== null

  const handleSaveDraft = async () => {
    if (!canSave || saveStatus === 'saving' || !draftReport || !sourceReport || !sourceAnalysisId || !periodEndDate) return

    setSaveStatus('saving')
    setSaveError(null)

    try {
      // Fingerprint of the CURRENT left ATS source content — never
      // executive_analyses.source_fingerprint (see atsContentFingerprint.ts
      // for why that value can't reliably detect ATS content drift).
      const sourceAtsFingerprint = await computeAtsContentFingerprint(sourceReport)

      const saved = await saveLeadershipReportDraft({
        periodStartDate: week.weekStartDate,
        periodEndDate,
        periodLabel,
        sourceAnalysisId,
        sourceAtsFingerprint,
        content: draftReport,
      })

      setDraftReport(saved.content)
      setBaselineContent(saved.content)
      setSaveStatus('saved')
    } catch (err) {
      // Local edits are left exactly as they were — only the status/error
      // changes. Nothing here can destroy the Admin's unsaved work.
      setSaveError(err instanceof LeadershipReportDraftError ? err.message : 'Could not save the Leadership Report draft.')
      setSaveStatus('error')
    }
  }

  // Unsaved-edit protection: changing week silently overwrites draftReport
  // the moment the new week's fetch resolves (the effect above), so the
  // warning must happen BEFORE the parent's offset-changing callback is
  // ever invoked — if the person cancels, the week (and the prop) never
  // changes, and nothing is lost.
  //
  // A deferred "pending action" + rendered <ConfirmDialog>, not
  // window.confirm() — confirmed directly (window.confirm('test') in the
  // actual preview environment used for this app's manual QA) that the
  // native dialog silently resolves to false with NO visible UI there, so
  // it cannot satisfy "a visible confirmation must appear." isDirty itself
  // is completely unchanged; only how the choice is presented is different.
  const [pendingWeekAction, setPendingWeekAction] = useState<(() => void) | null>(null)

  const requestWeekChange = (action: () => void) => {
    if (!isDirty) {
      action()
      return
    }
    setPendingWeekAction(() => action)
  }

  const handlePreviousWeek = () => requestWeekChange(onPreviousWeek)
  const handleNextWeek = () => requestWeekChange(onNextWeek)

  return (
    <div className="lr-current">
      {pendingWeekAction && (
        <ConfirmDialog
          message="You have unsaved changes. If you continue, those changes will be lost. Continue?"
          onConfirm={() => {
            const action = pendingWeekAction
            setPendingWeekAction(null)
            action()
          }}
          onCancel={() => setPendingWeekAction(null)}
        />
      )}

      {/* Print-only letterhead — logo only, same convention as Weekly
          Summary/Reports & Analytics (AtsReportView's own heading below
          supplies the report title and week). Unconditionally display:none
          outside @media print (LeadershipReport.css), so it has zero
          on-screen effect. */}
      <div className="print-header">
        <img src={wfgLogo} alt="WFG" className="print-logo" />
      </div>

      <div className="lr-week-nav">
        <button type="button" className="lr-week-nav-btn" onClick={handlePreviousWeek} aria-label="Previous reporting week">
          &lsaquo; Previous
        </button>
        <span className="lr-week-label">
          Week of {week.label}
          {isCurrentWeek && <span className="week-current-badge">Current</span>}
        </span>
        <button
          type="button"
          className="lr-week-nav-btn"
          onClick={handleNextWeek}
          disabled={isCurrentWeek}
          aria-label="Next reporting week"
        >
          Next &rsaquo;
        </button>
      </div>

      {loading ? (
        <div className="admin-loading">Loading leadership report…</div>
      ) : (
        <div className="lr-columns">
          <div className="lr-col-reference">
            <div className="lr-ref-tabs" role="tablist" aria-label="Reference material">
              <button
                type="button"
                role="tab"
                aria-selected={leftTab === 'ats'}
                className={`lr-ref-tab ${leftTab === 'ats' ? 'lr-ref-tab-active' : ''}`}
                onClick={() => setLeftTab('ats')}
              >
                1&nbsp; ATS Format
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={leftTab === 'previous'}
                className={`lr-ref-tab ${leftTab === 'previous' ? 'lr-ref-tab-active' : ''}`}
                onClick={() => setLeftTab('previous')}
              >
                2&nbsp; Previous Work
              </button>
            </div>

            <div className="lr-pane lr-pane-source">
              {leftTab === 'ats' ? (
                <>
                  <div className="lr-pane-header">
                    <div>
                      <h2>ATS Format Report</h2>
                      <p className="lr-pane-subtitle">Read-only source</p>
                    </div>
                    {/* Prints the always-mounted .lr-print-ats-only mirror
                        (below), wired directly to sourceReport — never this
                        pane's own content, so it prints the current week's
                        ATS source regardless of which left tab is active.
                        Disabled whenever there's no valid ATS source to
                        print, matching the empty states in the pane body
                        below. */}
                    <button
                      type="button"
                      className="btn btn-secondary no-print"
                      onClick={printLeadershipReportAtsOnly}
                      disabled={!hasSource || !sourceIsAtsShaped || !sourceReport}
                      title={hasSource && sourceIsAtsShaped && sourceReport ? 'Print or save this week’s ATS Format Report as PDF' : 'No ATS report available to print for this week'}
                    >
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
                      // Strictly read-only: no edit affordance is ever
                      // rendered for this tab — the only way to guarantee an
                      // Admin can never modify the ATS source from this page.
                      <AtsReportView report={sourceReport} periodLabel={periodLabel} />
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="lr-pane-header">
                    <div>
                      <h2>My Previous Leadership Report</h2>
                      <p className="lr-pane-subtitle">{previousDraft ? previousDraft.periodLabel : 'Read-only reference'}</p>
                    </div>
                    {/* Rendered only when a previous saved report actually
                        exists — never a disabled placeholder, so an empty
                        Previous Work state can never expose a misleading
                        print action. Prints the always-mounted
                        .lr-print-previous-only mirror (below), wired
                        directly to previousDraft. */}
                    {previousDraft && (
                      <button
                        type="button"
                        className="btn btn-secondary no-print"
                        onClick={printLeadershipReportPreviousOnly}
                        title="Print or save this previous Leadership Report as PDF"
                      >
                        Print / Download Previous Report
                      </button>
                    )}
                  </div>

                  <div className="lr-pane-body">
                    {!previousDraft ? (
                      <div className="lr-empty-state">
                        <p>No previous report available.</p>
                      </div>
                    ) : (
                      // Strictly read-only — the caller's own saved history,
                      // fetched via a plain RLS-scoped read
                      // (fetchPreviousLeadershipReportDraft) that never
                      // accepts or filters by owner_id client-side, so it
                      // structurally cannot show another owner's report.
                      <AtsReportView report={previousDraft.content} periodLabel={previousDraft.periodLabel} />
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="lr-col-draft">
            <div className="lr-pane lr-pane-draft">
              <div className="lr-pane-header">
                <div>
                  <h2>My Leadership Report</h2>
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
                  {/* Persists via save_leadership_report_draft only (see
                      leadershipReportDraftService.ts) — never a direct table
                      write. Enabled only while editing and only once there is
                      draft content to save; disabled again while a save is
                      already in flight to prevent a duplicate concurrent
                      save. */}
                  <button
                    type="button"
                    className={`btn ${mode === 'edit' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => void handleSaveDraft()}
                    disabled={!canSave || saveStatus === 'saving'}
                    title={mode === 'edit' ? 'Save this Leadership Report draft' : 'Switch to Edit to save changes'}
                  >
                    Save Draft
                  </button>
                  {saveStatus === 'saving' && <span className="lr-save-status">Saving&hellip;</span>}
                  {saveStatus === 'saved' && <span className="lr-save-status lr-save-status-saved">Draft saved</span>}
                  {saveStatus === 'error' && (
                    <span className="lr-save-status lr-save-status-error">{saveError ?? 'Could not save.'}</span>
                  )}
                  {/* Prints the always-mounted .lr-print-draft-only mirror
                      (below), wired directly to draftReport — the CURRENT
                      visible content, including unsaved edits, regardless
                      of edit/view mode. Never calls saveLeadershipReportDraft;
                      printing can never create, modify, or discard a saved
                      draft row. */}
                  <button
                    type="button"
                    className={`btn ${mode === 'edit' ? 'btn-secondary' : 'btn-primary'} no-print`}
                    onClick={printLeadershipReportDraftOnly}
                    disabled={!draftReport}
                    title={draftReport ? 'Print or save My Leadership Report as PDF' : 'No Leadership Report content to print yet'}
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
                  // own CSS are completely untouched.
                  <div className="lr-edit-container">
                    <AtsTopicsEditForm report={draftReport} onChange={handleDraftChange} />
                  </div>
                ) : (
                  <AtsReportView report={draftReport} periodLabel={periodLabel} />
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Always-mounted print-only mirrors — hidden on screen (see
          LeadershipReport.css), revealed only while the matching body class
          from printLeadershipReportAtsOnly/printLeadershipReportDraftOnly is
          active. Wired directly to sourceReport/draftReport rather than
          reusing the on-screen panes above, so ATS print never depends on
          (or leaks) whichever left tab is currently selected, and draft
          print always reflects the current, possibly-unsaved content
          regardless of edit/view mode. Reuses AtsReportView unmodified —
          no duplicate report-formatting logic. */}
      {hasSource && sourceIsAtsShaped && sourceReport && (
        <div className="lr-print-ats-only">
          <AtsReportView report={sourceReport} periodLabel={periodLabel} />
        </div>
      )}
      {draftReport && (
        <div className="lr-print-draft-only">
          <AtsReportView report={draftReport} periodLabel={periodLabel} />
        </div>
      )}
      {previousDraft && (
        <div className="lr-print-previous-only">
          <AtsReportView report={previousDraft.content} periodLabel={previousDraft.periodLabel} />
        </div>
      )}
    </div>
  )
}
