import { useEffect, useMemo, useState } from 'react'
import { fetchManagersForWeek, fetchWeeklySummary, type ManagerSummary, type WeeklySummaryData } from '../lib/adminService'
import { fetchPeriodReportStats, type PeriodReportStats } from '../lib/reportsAnalyticsService'
import ExecutiveAnalysisCard, { printExecutiveAnalysisOnly } from './ExecutiveAnalysisCard'
import ReportContentView from './ReportContentView'
import SubmissionStatusCard from './SubmissionStatusCard'
import ManagerReportsTable, { type ManagerReportRow } from './ManagerReportsTable'
import ExportPrintMenu from './ExportPrintMenu'
import { supabase } from '../lib/supabaseClient'
import wfgLogo from '../assets/wfg-logo.png'
import { getPeriodRange, type ReportPeriodKey } from '../utils/reportPeriods'
import { toISODate } from '../utils/week'
import { AI_EXECUTIVE_SUMMARY_ENABLED } from '../config/featureFlags'
import './AdminDashboard.css'
import './WeeklySummary.css'
import './SubmittedReport.css'
import './ReportsAnalytics.css'

const PERIODS: { key: ReportPeriodKey; label: string }[] = [
  { key: 'weekly', label: 'Weekly' },
  { key: 'bi-weekly', label: 'Bi-Weekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'quarterly', label: 'Quarterly' },
  { key: 'half-yearly', label: 'Half-Yearly' },
  { key: 'yearly', label: 'Yearly' },
]

const INITIAL_OFFSETS: Record<ReportPeriodKey, number> = {
  weekly: 0,
  'bi-weekly': 0,
  monthly: 0,
  quarterly: 0,
  'half-yearly': 0,
  yearly: 0,
}

// Mirrors the exact pattern already established by
// ExecutiveAnalysisCard.tsx's printExecutiveAnalysisOnly: toggle a
// narrowly-scoped body class, call the existing native window.print(), and
// reliably clean the class up via 'afterprint' with a fallback timeout —
// never a second print mechanism, never a new dependency.
const PRINT_WEEKLY_SUMMARY_ONLY_CLASS = 'print-weekly-summary-only'
const PRINT_MANAGER_REPORTS_ONLY_CLASS = 'print-manager-reports-only'
const PRINT_MODE_FALLBACK_MS = 60_000

function printWithScopedClass(className: string, extraCleanup?: () => void): void {
  document.body.classList.add(className)

  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    document.body.classList.remove(className)
    extraCleanup?.()
    window.removeEventListener('afterprint', cleanup)
  }

  window.addEventListener('afterprint', cleanup)
  window.setTimeout(cleanup, PRINT_MODE_FALLBACK_MS)
  window.print()
}

function printWeeklySummaryOnly(): void {
  printWithScopedClass(PRINT_WEEKLY_SUMMARY_ONLY_CLASS)
}

// Filters the always-in-DOM print-only report content (see
// `.ra-print-report-content` below) down to just the selected managers via
// a dynamically-injected stylesheet keyed off each block's own
// `data-manager-id` — removed again by the same cleanup as the body class,
// so nothing lingers after printing.
function printManagerReportsOnly(selectedManagerIds: string[]): void {
  const styleEl = document.createElement('style')
  const excludeSelectors = selectedManagerIds.map((id) => `:not([data-manager-id="${CSS.escape(id)}"])`).join('')
  styleEl.textContent = `@media print { body.${PRINT_MANAGER_REPORTS_ONLY_CLASS} [data-manager-id]${excludeSelectors} { display: none !important; } }`
  document.head.appendChild(styleEl)

  printWithScopedClass(PRINT_MANAGER_REPORTS_ONLY_CLASS, () => styleEl.remove())
}

function printCompleteLeadershipReport(): void {
  window.print()
}

function formatGeneratedDate(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

interface ReportsAnalyticsProps {
  onBack: () => void
}

export default function ReportsAnalytics({ onBack }: ReportsAnalyticsProps) {
  const [period, setPeriod] = useState<ReportPeriodKey>('weekly')
  const [offsets, setOffsets] = useState<Record<ReportPeriodKey, number>>(INITIAL_OFFSETS)
  const offset = offsets[period]
  const periodLabel = PERIODS.find((p) => p.key === period)?.label ?? ''

  // Pure function of (period, offset) — reused by both the display and the
  // data fetch below, so what's shown always matches what was queried.
  const range = useMemo(() => getPeriodRange(period, offset), [period, offset])

  const [managers, setManagers] = useState<ManagerSummary[]>([])
  const [weeklyData, setWeeklyData] = useState<WeeklySummaryData | null>(null)
  const [periodStats, setPeriodStats] = useState<PeriodReportStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)

    if (period === 'weekly') {
      const weekStartDate = range.weekStartDates[0]
      Promise.all([fetchManagersForWeek(supabase, weekStartDate), fetchWeeklySummary(supabase, weekStartDate)]).then(
        ([managersResult, summaryResult]) => {
          if (!active) return
          setManagers(managersResult)
          setWeeklyData(summaryResult)
          setLoading(false)
        },
      )
    } else {
      fetchPeriodReportStats(supabase, range.weekStartDates).then((stats) => {
        if (!active) return
        setPeriodStats(stats)
        setLoading(false)
      })
    }

    return () => {
      active = false
    }
    // range is derived solely from [period, offset], so depending on those is sufficient.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, offset])

  const handleSelectPeriod = (key: ReportPeriodKey) => {
    setPeriod(key)
  }

  const handlePrevious = () => {
    setOffsets((prev) => ({ ...prev, [period]: prev[period] - 1 }))
  }

  const handleNext = () => {
    setOffsets((prev) => ({ ...prev, [period]: Math.min(0, prev[period] + 1) }))
  }

  // A single per-manager row, for whichever period is selected — the one
  // source of truth both SubmissionStatusCard's counts and
  // ManagerReportsTable's rows are derived from, so the two never disagree.
  // Built entirely from data already fetched above; no new queries.
  const managerRows: ManagerReportRow[] = useMemo(() => {
    if (period === 'weekly') {
      return managers.map((m) => ({ managerId: m.id, managerName: m.fullName, status: m.status }))
    }
    if (!periodStats) return []

    const pendingByManager = new Map(periodStats.pendingManagers.map((p) => [p.managerId, p.status]))
    const rows = new Map<string, ManagerReportRow>()

    for (const entry of periodStats.entries) {
      rows.set(entry.managerId, {
        managerId: entry.managerId,
        managerName: entry.managerName,
        // A manager can appear in `entries` (submitted at least one week)
        // AND in `pendingManagers` (not every week submitted) at once —
        // pending status takes precedence since the period isn't fully done.
        status: pendingByManager.get(entry.managerId) ?? 'submitted',
      })
    }
    for (const pending of periodStats.pendingManagers) {
      if (!rows.has(pending.managerId)) {
        rows.set(pending.managerId, { managerId: pending.managerId, managerName: pending.managerName, status: pending.status })
      }
    }

    return Array.from(rows.values()).sort((a, b) => a.managerName.localeCompare(b.managerName))
  }, [period, managers, periodStats])

  const submittedCount = managerRows.filter((r) => r.status === 'submitted').length
  const draftRows = managerRows.filter((r) => r.status === 'draft')
  const notStartedRows = managerRows.filter((r) => r.status === 'not_started')

  const renderReportContent = (managerId: string) => {
    if (period === 'weekly') {
      const entry = weeklyData?.entries.find((e) => e.managerId === managerId)
      if (!entry) return <p className="admin-empty-state">No submitted report for this period yet.</p>
      return <ReportContentView content={entry.content} />
    }
    const entry = periodStats?.entries.find((e) => e.managerId === managerId)
    if (!entry || entry.weeks.length === 0) {
      return <p className="admin-empty-state">No submitted report for this period yet.</p>
    }
    return (
      <>
        {entry.weeks.map((weekEntry) => (
          <div className="period-week-block" key={weekEntry.weekStartDate}>
            <p className="period-week-label">Week of {weekEntry.weekLabel}</p>
            <ReportContentView content={weekEntry.content} />
          </div>
        ))}
      </>
    )
  }

  return (
    <div className="admin-dashboard reports-analytics-page">
      <button type="button" className="link-btn back-link no-print" onClick={onBack}>
        &larr; Back to Admin Dashboard
      </button>

      <div className="print-header">
        <img src={wfgLogo} alt="WFG" className="print-logo" />
        <div>
          <h1 className="print-title">{periodLabel} Manager Report</h1>
          <p className="print-week">{range.rangeLabel}</p>
          <p className="print-generated">Generated {formatGeneratedDate(new Date())}</p>
        </div>
      </div>

      <div className="ra-header-titles">
        <h1>Reports &amp; Analytics</h1>
        <p className="ra-header-subtitle">Turning insights into progress for a stronger WFG.</p>
      </div>

      {/* Full content-width toolbar: a three-column grid (auto 1fr auto) —
          the period dropdown left-aligned, the date-navigation group
          centered in the middle column, and Export/Print right-aligned.
          Its own row (not sharing space with the title above) so its left
          and right edges can align with the content/cards below. */}
      <div className="ra-period-toolbar">
        <select
          id="report-period-select"
          className="ra-period-select no-print"
          aria-label="Reporting period"
          value={period}
          onChange={(e) => handleSelectPeriod(e.target.value as ReportPeriodKey)}
        >
          {PERIODS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>

        <div className="ra-period-nav">
          <button type="button" className="week-nav-btn no-print" onClick={handlePrevious} aria-label="Previous period">
            &larr;
          </button>
          <span className="week-selector-label">
            {/* Presentation-only: reportPeriods.ts's own rangeLabel (used
                everywhere else, including the print letterhead above) is
                untouched — only this compact toolbar's displayed text drops
                the redundant "Week of " prefix for the Weekly period. */}
            {period === 'weekly' ? range.rangeLabel.replace(/^Week of /, '') : range.rangeLabel}
            {range.isCurrent && <span className="week-current-badge">Current</span>}
          </span>
          <button
            type="button"
            className="week-nav-btn no-print"
            onClick={handleNext}
            disabled={range.isCurrent}
            aria-label="Next period"
          >
            &rarr;
          </button>
        </div>

        <ExportPrintMenu
          managers={managerRows.map((r) => ({ id: r.managerId, name: r.managerName }))}
          weeklySummaryAvailable={period === 'weekly'}
          onExecutiveAnalysisOnly={printExecutiveAnalysisOnly}
          onWeeklySummaryOnly={printWeeklySummaryOnly}
          onManagerReportsOnly={printManagerReportsOnly}
          onCompleteLeadershipReport={printCompleteLeadershipReport}
        />
      </div>

      {loading ? (
        <div className="admin-loading">Loading report…</div>
      ) : (
        <>
          {/* Four compact KPI tiles — a quick-scan summary. The detailed
              legend/counts for the exact same numbers still appear in
              SubmissionStatusCard below; these tiles are presentation only
              and read from the SAME managerRows-derived counts, never a
              second computation. Total Managers has no percentage of its
              own — it IS the denominator the other three percentages use. */}
          <div className="ra-kpi-row">
            <div className="ra-kpi-card ra-kpi-card-total">
              <span className="ra-kpi-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="9" cy="8" r="3" />
                  <path d="M4 20c0-3 2.5-5 5-5s5 2 5 5" />
                  <circle cx="17" cy="9" r="2.5" />
                  <path d="M15.5 20c0-2.5 1-4 3-4.5" />
                </svg>
              </span>
              <div className="ra-kpi-text">
                <span className="ra-kpi-value">{managerRows.length}</span>
                <span className="ra-kpi-label">Total Managers</span>
              </div>
            </div>
            <div className="ra-kpi-card ra-kpi-card-submitted">
              <span className="ra-kpi-icon" aria-hidden="true">
                &#10003;
              </span>
              <div className="ra-kpi-text">
                <span className="ra-kpi-value">{submittedCount}</span>
                <span className="ra-kpi-label">Submitted</span>
              </div>
              {managerRows.length > 0 && (
                <span className="ra-kpi-pct">{Math.round((submittedCount / managerRows.length) * 100)}%</span>
              )}
            </div>
            <div className="ra-kpi-card ra-kpi-card-draft">
              <span className="ra-kpi-icon" aria-hidden="true">
                &#9998;
              </span>
              <div className="ra-kpi-text">
                <span className="ra-kpi-value">{draftRows.length}</span>
                <span className="ra-kpi-label">Draft</span>
              </div>
              {managerRows.length > 0 && (
                <span className="ra-kpi-pct">{Math.round((draftRows.length / managerRows.length) * 100)}%</span>
              )}
            </div>
            <div className="ra-kpi-card ra-kpi-card-not-started">
              <span className="ra-kpi-icon" aria-hidden="true">
                &#9675;
              </span>
              <div className="ra-kpi-text">
                <span className="ra-kpi-value">{notStartedRows.length}</span>
                <span className="ra-kpi-label">Not Started</span>
              </div>
              {managerRows.length > 0 && (
                <span className="ra-kpi-pct">{Math.round((notStartedRows.length / managerRows.length) * 100)}%</span>
              )}
            </div>
          </div>

          <SubmissionStatusCard
            submittedCount={submittedCount}
            draftCount={draftRows.length}
            notStartedCount={notStartedRows.length}
            draftNames={draftRows.map((r) => r.managerName)}
            notStartedNames={notStartedRows.map((r) => r.managerName)}
          />

          {AI_EXECUTIVE_SUMMARY_ENABLED && (
            // No separate "Executive Analysis" eyebrow here — the card
            // already renders its own heading. showPrintButton=false since
            // this page's own unified Export/Print menu already offers the
            // identical "Executive Analysis only" action, via the same
            // exported printExecutiveAnalysisOnly function — never a second
            // print implementation.
            <ExecutiveAnalysisCard
              periodKey={period}
              offset={offset}
              weekStartDates={range.weekStartDates}
              periodStartDate={toISODate(range.periodStart)}
              showPrintButton={false}
            />
          )}

          <div className="ra-manager-reports-header">
            <div className="ra-manager-reports-heading-row">
              <p className="ra-eyebrow">Manager Reports</p>
              {/* Derived from the same managerRows the KPI tiles/Submission
                  Status above already use — never a separate count, never
                  hardcoded, always current for whichever period/offset is
                  selected. */}
              <span className="ra-manager-reports-total">{managerRows.length} Managers</span>
            </div>
            <p className="ra-manager-reports-subtitle">View and manage individual manager reports for this period.</p>
          </div>
          <ManagerReportsTable rows={managerRows} renderReportContent={renderReportContent} />
        </>
      )}

      {/* Print-only "Manager Reports" section heading — screen-hidden (see
          ReportsAnalytics.css). This is intentionally a SEPARATE element
          from the on-screen .ra-manager-reports-header above (which is
          unconditionally hidden from every print mode): as a direct child
          of .reports-analytics-page not named in print.css's
          weekly-summary-only/manager-reports-only/executive-analysis-only
          allow-lists, it's automatically excluded from those three modes
          and only ever appears in Complete Leadership Report, immediately
          followed by the actual report content below it. */}
      <h2 className="ra-print-manager-reports-heading">Manager Reports</h2>

      {/* Always in the DOM (never conditionally mounted) so every print mode
          — including a Complete Leadership Report printed while the
          interactive table above is showing a filtered/collapsed view —
          reflects the full, current data. Hidden on screen; see
          ReportsAnalytics.css. Each manager block carries data-manager-id
          so printManagerReportsOnly can selectively show only the chosen
          managers via an injected stylesheet. */}
      <div className="ra-print-report-content">
        {period === 'weekly' ? (
          !weeklyData || weeklyData.entries.length === 0 ? (
            <div className="admin-empty-state">No submitted reports for this period yet.</div>
          ) : (
            <div className="weekly-summary-manager-list">
              {weeklyData.entries.map((entry) => (
                <div className="weekly-summary-manager-block" data-manager-id={entry.managerId} key={entry.managerId}>
                  <h2 className="weekly-summary-entry-name">{entry.managerName}</h2>
                  <ReportContentView content={entry.content} />
                </div>
              ))}
            </div>
          )
        ) : periodStats && periodStats.entries.length > 0 ? (
          periodStats.entries.map((entry) => (
            <div className="period-manager-block" data-manager-id={entry.managerId} key={entry.managerId}>
              <h2 className="period-manager-name">{entry.managerName}</h2>
              {entry.weeks.map((weekEntry) => (
                <div className="period-week-block" key={weekEntry.weekStartDate}>
                  <p className="period-week-label">Week of {weekEntry.weekLabel}</p>
                  <ReportContentView content={weekEntry.content} />
                </div>
              ))}
            </div>
          ))
        ) : (
          <div className="admin-empty-state">No submitted reports for this period yet.</div>
        )}
      </div>
    </div>
  )
}
