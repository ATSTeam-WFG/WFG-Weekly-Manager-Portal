import { useEffect, useMemo, useState } from 'react'
import wfgLogo from '../assets/wfg-logo.png'
import { fetchManagersForWeek, fetchWeeklySummary, type ManagerSummary, type WeeklySummaryData } from '../lib/adminService'
import { supabase } from '../lib/supabaseClient'
import ExecutiveAnalysisCard, { printExecutiveAnalysisOnly } from './ExecutiveAnalysisCard'
import SubmittedManagerCard from './SubmittedManagerCard'
import ReportContentView from './ReportContentView'
import AtsReportView from './AtsReportView'
import PrintReportMenu from './PrintReportMenu'
import { printWithScopedClass } from './LeadershipReportCurrent'
import {
  fetchPersistedAnalysis,
  isAtsShapedSections,
  REPORTING_ANALYSIS_SECTIONS,
  type PersistedExecutiveAnalysis,
  type ReportingAnalysisSections,
} from '../lib/executiveSummaryService'
import type { ReportingWeek } from '../utils/week'
import { parseDateOnly } from '../utils/week'
import { AI_EXECUTIVE_SUMMARY_ENABLED } from '../config/featureFlags'
import './AdminDashboard.css'
import './SubmittedReport.css'
import './WeeklySummary.css'

// Consolidated print — Present Week Summary (the KPI overview) + every
// submitted manager's own weekly report + the Executive Summary, all for
// the SAME selected week — see print.css for the actual isolation rules.
// Leadership Report is NOT part of this report; it is a separate feature
// with its own print actions (LeadershipReportCurrent.tsx/
// LeadershipReportHistory.tsx). Reuses printWithScopedClass directly from
// LeadershipReportCurrent.tsx — the same cross-component toggle-body-class-
// around-window.print() mechanism every other print action in this app
// already uses, never a second, duplicated implementation.
const PRINT_CONSOLIDATED_REPORT_ONLY_CLASS = 'print-consolidated-report-only'

// "Week Ending [date]" — the exact same wording/format
// ExecutiveAnalysisCard.tsx's own (unexported) buildAtsPeriodLabel produces
// for a 'weekly' period analysis, replicated here (not imported, since that
// helper isn't exported) so this print-only Executive Summary reads
// identically to the on-screen Executive Analysis card.
function formatWeeklyAnalysisPeriodLabel(periodEndDate: string): string {
  return `Week Ending ${parseDateOnly(periodEndDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
}

function printConsolidatedReportOnly(): void {
  printWithScopedClass(PRINT_CONSOLIDATED_REPORT_ONLY_CLASS)
}

interface WeeklySummaryProps {
  week: ReportingWeek
  weekOffset: number
  isCurrentWeek: boolean
  onPreviousWeek: () => void
  onNextWeek: () => void
  onBack: () => void
}

export default function WeeklySummary({ week, weekOffset, isCurrentWeek, onPreviousWeek, onNextWeek, onBack }: WeeklySummaryProps) {
  const [data, setData] = useState<WeeklySummaryData | null>(null)
  // Fetched purely to read each manager's own submitted_at — the exact same
  // call (and the exact same fetchManagersForWeek/fetchWeeklySummary pairing)
  // ReportsAnalytics.tsx already makes for its own weekly mode. adminService.ts
  // itself is untouched; WeeklySummaryEntry still has no timestamp field.
  const [managers, setManagers] = useState<ManagerSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedManagerId, setExpandedManagerId] = useState<string | null>(null)
  // For the consolidated print option's Executive Summary part only — a
  // plain read via the SAME fetchPersistedAnalysis every other Executive
  // Analysis consumer uses (ExecutiveAnalysisCard.tsx,
  // LeadershipReportCurrent.tsx), keyed to THIS SAME week prop. A separate
  // read from the on-screen ExecutiveAnalysisCard instance above (which
  // fetches internally) rather than sharing its state, so this file never
  // has to reach into that component's internals — both reads are
  // read-only and hit the same existing table/RPC, never a write, and
  // never trigger generation merely by existing.
  const [printAnalysis, setPrintAnalysis] = useState<PersistedExecutiveAnalysis | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setExpandedManagerId(null)

    Promise.all([fetchWeeklySummary(supabase, week.weekStartDate), fetchManagersForWeek(supabase, week.weekStartDate)]).then(
      ([summaryResult, managersResult]) => {
        if (!active) return
        setData(summaryResult)
        setManagers(managersResult)
        setLoading(false)
      },
    )

    return () => {
      active = false
    }
  }, [week.weekStartDate])

  useEffect(() => {
    let active = true
    setPrintAnalysis(null)

    fetchPersistedAnalysis('weekly', week.weekStartDate).then((analysis) => {
      if (!active) return
      setPrintAnalysis(analysis)
    })

    return () => {
      active = false
    }
  }, [week.weekStartDate])

  // Not Started is derived, never fetched separately or hardcoded — the
  // same totalManagers/submittedCount fetchWeeklySummary already returns.
  const notStartedCount = data ? data.totalManagers - data.submittedCount : 0

  const submittedAtByManagerId = useMemo(() => new Map(managers.map((m) => [m.id, m.submittedAt])), [managers])

  const handleToggleManager = (managerId: string) => {
    setExpandedManagerId((prev) => (prev === managerId ? null : managerId))
  }

  return (
    <div className="weekly-summary">
      <button type="button" className="link-btn back-link no-print" onClick={onBack}>
        &larr; Back to Admin Dashboard
      </button>

      {/* Print-only letterhead — logo only. This block is unconditionally
          display:none outside @media print (WeeklySummary.css), so it is
          never visible on screen; the change here has zero on-screen
          effect. It previously also repeated a "Weekly Manager Summary" /
          "Week of ..." title, which was redundant with — and inconsistent
          with — AtsReportView's own "WFG Weekly Leadership Update / Week
          Ending [date]" heading rendered inside the Executive Analysis
          card below it: printing Weekly Summary produced three stacked
          title blocks (this one, the AI-Generated Analysis badge, and the
          ATS heading) before any real content. Removed here so
          AtsReportView's own heading is the single report header, per the
          approved leadership print structure. */}
      <div className="print-header">
        <img src={wfgLogo} alt="WFG" className="print-logo" />
      </div>

      <div className="weekly-summary-heading">
        <div>
          <h1>Present Week Summary</h1>
          {/* Independent week navigation (own state in App.tsx, separate
              from Admin Dashboard's adminWeekOffset) — mirrors Admin
              Dashboard's own Previous/Next pattern exactly (same
              Math.min(0, offset+1) future-week clamp, same
              disabled={isCurrentWeek}), under new page-scoped classes per
              this app's established convention (compare .adp-week-nav,
              .lr-week-nav). Approved content/layout below this line is
              otherwise unchanged. */}
          <div className="ws-week-nav">
            <button type="button" className="ws-week-nav-btn" onClick={onPreviousWeek} aria-label="Previous reporting week">
              &lsaquo; Previous
            </button>
            <span className="ws-week-label">
              Week of {week.label}
              {isCurrentWeek && <span className="week-current-badge">Current</span>}
            </span>
            <button
              type="button"
              className="ws-week-nav-btn"
              onClick={onNextWeek}
              disabled={isCurrentWeek}
              aria-label="Next reporting week"
            >
              Next &rsaquo;
            </button>
          </div>
        </div>
        {/* Print Summary reuses printExecutiveAnalysisOnly exactly as
            before (print.css's print-executive-analysis-only rule,
            unchanged) — the KPI row and individual submitted manager
            reports are still excluded, and this option's output is
            byte-for-byte what the old single "Print Present Week Summary"
            button already produced. Print Consolidated Report is the
            expanded three-part document for this SAME selected week: Part 1
            Present Week Summary (the KPI overview below), Part 2 every
            submitted manager's own report, Part 3 the Executive Summary —
            Leadership Report is a separate feature and is never part of
            this printout. See print.css's print-consolidated-report-only
            rule and the always-mounted print-only blocks below. */}
        <PrintReportMenu
          label="Print"
          options={[
            { label: 'Print Summary', onSelect: printExecutiveAnalysisOnly },
            { label: 'Print Consolidated Report', onSelect: printConsolidatedReportOnly },
          ]}
        />
      </div>

      {loading ? (
        <div className="admin-loading">Loading summary…</div>
      ) : data ? (
        <>
          {/* Print-only — hidden on screen (WeeklySummary.css), shown only
              under print-consolidated-report-only (print.css) as the
              consolidated report's Part 1 label. */}
          <p className="ws-eyebrow ws-consolidated-part-label">Present Week Summary</p>
          {/* Four KPI cards, visually consistent with Reports & Analytics'
              own .ra-kpi-row/.ra-kpi-card — but under new, Weekly-Summary-
              scoped class names (ws-kpi-*) rather than reusing .admin-stat-card
              (still relied on, unmodified, by AdminDashboard.tsx) or
              .ra-kpi-card (Reports & Analytics only). This is also exactly
              Part 1 ("Present Week Summary") of the consolidated print —
              the KPI overview, not the Executive Analysis card (which is
              Part 3, "Executive Summary", printed separately below). */}
          <div className="ws-kpi-row">
            <div className="ws-kpi-card ws-kpi-card-total">
              <span className="ws-kpi-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="9" cy="8" r="3" />
                  <path d="M4 20c0-3 2.5-5 5-5s5 2 5 5" />
                  <circle cx="17" cy="9" r="2.5" />
                  <path d="M15.5 20c0-2.5 1-4 3-4.5" />
                </svg>
              </span>
              <div className="ws-kpi-text">
                <span className="ws-kpi-value">{data.totalManagers}</span>
                <span className="ws-kpi-label">Total Managers</span>
              </div>
            </div>
            <div className="ws-kpi-card ws-kpi-card-submitted">
              <span className="ws-kpi-icon" aria-hidden="true">
                &#10003;
              </span>
              <div className="ws-kpi-text">
                <span className="ws-kpi-value">{data.submittedCount}</span>
                <span className="ws-kpi-label">Submitted</span>
              </div>
            </div>
            <div className="ws-kpi-card ws-kpi-card-completion">
              <div className="ws-kpi-text">
                <span className="ws-kpi-value">{data.completionPct}%</span>
                <span className="ws-kpi-label">Completion</span>
              </div>
            </div>
            <div className="ws-kpi-card ws-kpi-card-not-started">
              <span className="ws-kpi-icon" aria-hidden="true">
                &#9675;
              </span>
              <div className="ws-kpi-text">
                <span className="ws-kpi-value">{notStartedCount}</span>
                <span className="ws-kpi-label">Not Started</span>
              </div>
            </div>
          </div>

          {AI_EXECUTIVE_SUMMARY_ENABLED && (
            <>
              {/* Labels the shared ExecutiveAnalysisCard's persisted weekly
                  ATS analysis as the consolidated, leadership-facing portion
                  of Weekly Summary — presentation only, reusing the exact
                  same persisted artifact and rendering (AtsReportView) that
                  Reports & Analytics still refers to as "Executive
                  Analysis". No second AI generation/persistence path is
                  introduced, and the card's own internal heading/behavior
                  are unchanged. */}
              <p className="ws-eyebrow">Consolidated Weekly Summary</p>
              {/* This on-screen instance of ExecutiveAnalysisCard is never
                  itself part of the consolidated print (see print.css —
                  .executive-summary-section is no longer exempted under
                  print-consolidated-report-only). Printing's own Part 3
                  "Executive Summary" is the separate, always-mounted
                  print-only block near the end of this file, fetched
                  independently via printAnalysis so it never depends on
                  this card's on-screen mode/edit state. showPrintButton=false
                  hides this card's own standalone
                  "Print Executive Analysis" button — the single "Print
                  Weekly Summary" action above already prints the complete
                  page, including this card's current content. The prop
                  already existed for exactly this purpose (see Reports &
                  Analytics' own use of it); ExecutiveAnalysisCard.tsx/.css
                  themselves are untouched. */}
              <ExecutiveAnalysisCard
                periodKey="weekly"
                offset={weekOffset}
                weekStartDates={[week.weekStartDate]}
                periodStartDate={week.weekStartDate}
                showPrintButton={false}
              />
            </>
          )}

          <div className="ws-manager-reports-header">
            <p className="ws-eyebrow">Submitted Manager Reports</p>
            <span className="ws-manager-reports-count">
              ({data.submittedCount} of {data.totalManagers})
            </span>
          </div>

          {data.entries.length === 0 ? (
            <div className="weekly-summary-empty">
              No managers have submitted a report for this week yet.
            </div>
          ) : (
            // Only actual entries from fetchWeeklySummary (already filtered to
            // status = 'submitted' — see adminService.ts, untouched) are ever
            // rendered here. No Not Started/draft placeholder rows are
            // invented; a manager who hasn't submitted simply never appears.
            <div className="ws-manager-list">
              {data.entries.map((entry) => (
                <SubmittedManagerCard
                  key={entry.managerId}
                  managerId={entry.managerId}
                  managerName={entry.managerName}
                  submittedAt={submittedAtByManagerId.get(entry.managerId) ?? null}
                  content={entry.content}
                  isExpanded={expandedManagerId === entry.managerId}
                  onToggle={() => handleToggleManager(entry.managerId)}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="weekly-summary-empty">Could not load the weekly summary.</div>
      )}

      {/* Always-mounted, hidden on screen (WeeklySummary.css) — the
          Consolidated Report's Part 2 (every submitted manager's own
          report for THIS SAME week), revealed only under
          print-consolidated-report-only (print.css), with a page break
          before it. Built from the SAME data.entries fetchWeeklySummary
          already loaded above — no second fetch, no duplicate stored data.
          Each manager renders via ReportContentView, the same shared
          read-only renderer SubmittedManagerCard/HistoricalReportView/
          ManagerReportView already use — purely static content, no edit
          controls, no buttons of any kind. If there are no submitted
          reports for this week, a plain message is shown instead; this
          mirrors the SAME data.entries check the on-screen list above
          already makes, so the two can never disagree about whether any
          manager submitted. */}
      <div className="ws-consolidated-manager-reports">
        <p className="ws-eyebrow ws-consolidated-part-label">Manager Reports</p>
        {!data || data.entries.length === 0 ? (
          <p className="ws-consolidated-empty-note">No submitted manager reports are available for this week.</p>
        ) : (
          data.entries.map((entry) => (
            <div key={entry.managerId} className="ws-consolidated-manager-report">
              <h3 className="ws-consolidated-manager-name">{entry.managerName}</h3>
              <ReportContentView content={entry.content} />
            </div>
          ))
        )}
      </div>

      {/* Consolidated Report's Part 3 (Executive Summary) — the existing
          Executive Analysis content for THIS SAME week, via a separate
          read-only fetch (printAnalysis, above) independent of the
          on-screen ExecutiveAnalysisCard instance's own state/mode, so
          printing never depends on whether that card is currently
          collapsed/expanded/mid-edit on screen. Renders the exact same two
          shapes ExecutiveAnalysisCard itself renders (ATS via AtsReportView,
          legacy via the shared REPORTING_ANALYSIS_SECTIONS titles) — never
          a third, independently-maintained rendering. This fetch is
          strictly read-only: it can never create or trigger generation of
          an analysis merely by existing or being printed. */}
      <div className="ws-consolidated-executive-summary">
        <p className="ws-eyebrow ws-consolidated-part-label">Executive Summary</p>
        {!printAnalysis ? (
          <p className="ws-consolidated-empty-note">No Executive Summary is available for this week.</p>
        ) : isAtsShapedSections(printAnalysis.sections) ? (
          <AtsReportView report={printAnalysis.sections} periodLabel={formatWeeklyAnalysisPeriodLabel(printAnalysis.periodEndDate)} />
        ) : (
          REPORTING_ANALYSIS_SECTIONS.map((section) => (
            <div className="executive-summary-block" key={section.key}>
              <h3>{section.title}</h3>
              <p className="report-readonly-text">{(printAnalysis.sections as ReportingAnalysisSections)[section.key]}</p>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
