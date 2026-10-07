import { useEffect, useMemo, useState } from 'react'
import wfgLogo from '../assets/wfg-logo.png'
import { fetchManagersForWeek, fetchWeeklySummary, type ManagerSummary, type WeeklySummaryData } from '../lib/adminService'
import { supabase } from '../lib/supabaseClient'
import ExecutiveAnalysisCard, { printExecutiveAnalysisOnly } from './ExecutiveAnalysisCard'
import SubmittedManagerCard from './SubmittedManagerCard'
import PrintReportMenu from './PrintReportMenu'
import { printWithScopedClass } from './LeadershipReportCurrent'
import { fetchLeadershipReportDraft } from '../lib/leadershipReportDraftService'
import { isLeadershipReportContent, type LeadershipReportContent } from '../lib/leadershipReportContent'
import LeadershipReportFormView from './LeadershipReportFormView'
import type { ReportingWeek } from '../utils/week'
import { AI_EXECUTIVE_SUMMARY_ENABLED } from '../config/featureFlags'
import './AdminDashboard.css'
import './SubmittedReport.css'
import './WeeklySummary.css'

// Consolidated print — reveals the SAME .executive-summary-section Part 1
// already renders, plus the always-mounted Leadership Report mirror below
// (see print.css for the actual isolation rules). Reuses
// printWithScopedClass directly from LeadershipReportCurrent.tsx — the
// same cross-component toggle-body-class-around-window.print() mechanism
// every other print action in this app already uses, never a second,
// duplicated implementation.
const PRINT_CONSOLIDATED_REPORT_ONLY_CLASS = 'print-consolidated-report-only'

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
  // For the consolidated print option's Leadership Report half only — read
  // via the EXACT same RLS-scoped fetchLeadershipReportDraft every other
  // Leadership Report read already uses, keyed to THIS SAME week prop, so
  // it structurally cannot show a different week's (or another owner's)
  // report. Never the previous week (fetchPreviousLeadershipReportDraft is
  // not imported here) — only ever this page's own currently selected
  // week. A legacy (pre-rebuild) shaped draft is treated the same as "none
  // saved" below (null) rather than rendered via the old viewer, since the
  // new consolidated report's Leadership Report half is specifically the
  // new WFG Weekly Leadership Update presentation.
  const [leadershipDraftContent, setLeadershipDraftContent] = useState<LeadershipReportContent | null>(null)

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
    setLeadershipDraftContent(null)

    fetchLeadershipReportDraft(week.weekStartDate).then((draft) => {
      if (!active) return
      setLeadershipDraftContent(draft && isLeadershipReportContent(draft.content) ? draft.content : null)
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
            button already produced. Print Consolidated Report is the new
            option: Part 1 is this SAME executive-summary-section content,
            Part 2 is this same week's Leadership Report (read-only,
            graceful "No Leadership Report available" if none exists) — see
            print.css's print-consolidated-report-only rule and the
            always-mounted mirror below. */}
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
          {/* Four KPI cards, visually consistent with Reports & Analytics'
              own .ra-kpi-row/.ra-kpi-card — but under new, Weekly-Summary-
              scoped class names (ws-kpi-*) rather than reusing .admin-stat-card
              (still relied on, unmodified, by AdminDashboard.tsx) or
              .ra-kpi-card (Reports & Analytics only). */}
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
              {/* Print-only — hidden on screen (WeeklySummary.css), shown
                  only under print-consolidated-report-only (print.css) as
                  the "PART 1" section label distinguishing this report from
                  the Leadership Report mirror below, since AtsReportView's
                  own heading ("WFG Weekly Leadership Update") is the exact
                  same generic document title both reports share — without
                  this label the two parts would print back-to-back with
                  what looks like a duplicate title. */}
              <p className="ws-eyebrow ws-consolidated-part-label">Present Week Summary</p>
              {/* showPrintButton=false hides this card's own standalone
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
          Consolidated Report's "PART 2" (Leadership Report), revealed only
          under print-consolidated-report-only (print.css), with a page
          break before it. Wired to leadershipDraftContent, which is fetched
          above for THIS SAME week.weekStartDate only — never the previous
          week, never another owner's row. Reuses LeadershipReportFormView
          unmodified: no edit controls, no textareas, no Add/Remove/Save
          buttons can ever appear here, because this component never
          imports LeadershipReportForm (the editable one) at all. A missing
          or legacy-shaped draft shows a plain, honest message instead of
          silently substituting different content or crashing. */}
      <div className="ws-consolidated-leadership-mirror">
        {leadershipDraftContent ? (
          <LeadershipReportFormView content={leadershipDraftContent} />
        ) : (
          <p className="ws-consolidated-leadership-missing">No Leadership Report available for this week.</p>
        )}
      </div>
    </div>
  )
}
