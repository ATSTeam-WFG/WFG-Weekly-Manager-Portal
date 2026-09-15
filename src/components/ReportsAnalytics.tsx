import { useEffect, useMemo, useState } from 'react'
import { fetchManagersForWeek, fetchWeeklySummary, type ManagerSummary, type WeeklySummaryData } from '../lib/adminService'
import { fetchPeriodReportStats, type PeriodReportStats, type PendingManager } from '../lib/reportsAnalyticsService'
import ExecutiveAnalysisCard from './ExecutiveAnalysisCard'
import ReportContentView from './ReportContentView'
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

  const handlePrint = () => {
    window.print()
  }

  const total = managers.length
  const submitted = managers.filter((m) => m.status === 'submitted').length
  const draft = managers.filter((m) => m.status === 'draft').length
  const notStarted = managers.filter((m) => m.status === 'not_started').length
  const weeklyCompletionPct = total > 0 ? Math.round((submitted / total) * 100) : 0

  // Weekly derives its pending list locally from the same `managers` fetch
  // already used for the stats above (fetchManagersForWeek) — kept separate
  // from the multi-period pipeline so Weekly stays byte-for-byte driven by
  // the same proven function the Admin Dashboard uses, with zero drift.
  const weeklyPendingManagers: PendingManager[] = managers
    .filter((m) => m.status !== 'submitted')
    .map((m) => ({ managerId: m.id, managerName: m.fullName, status: m.status === 'draft' ? 'draft' : 'not_started' }))

  const pendingManagers = period === 'weekly' ? weeklyPendingManagers : periodStats?.pendingManagers ?? []

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

      <div className="admin-heading">
        <div>
          <h1>Reports &amp; Analytics</h1>
        </div>
        <button type="button" className="btn btn-secondary no-print" onClick={handlePrint}>
          Print / Export PDF
        </button>
      </div>

      <p className="ra-eyebrow no-print">Reporting Period</p>
      <div className="report-period-row no-print" role="group" aria-label="Report period">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`report-period-btn ${period === p.key ? 'active' : ''}`}
            onClick={() => handleSelectPeriod(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="week-selector reports-week-selector">
        <button type="button" className="week-nav-btn no-print" onClick={handlePrevious} aria-label="Previous period">
          &larr;
        </button>
        <span className="week-selector-label">
          {range.rangeLabel}
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

      {loading ? (
        <div className="admin-loading">Loading report…</div>
      ) : (
        <>
          <p className="ra-eyebrow">Summary Statistics</p>
          {period === 'weekly' ? (
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
                <span className="admin-stat-value">{weeklyCompletionPct}%</span>
                <span className="admin-stat-label">Completion</span>
              </div>
            </div>
          ) : periodStats ? (
            <div className="admin-stats-grid period-stats-grid">
              <div className="admin-stat-card">
                <span className="admin-stat-value">{periodStats.uniqueManagers}</span>
                <span className="admin-stat-label">Total Managers</span>
              </div>
              <div className="admin-stat-card">
                <span className="admin-stat-value">{periodStats.expectedReports}</span>
                <span className="admin-stat-label">Expected Reports</span>
              </div>
              <div className="admin-stat-card">
                <span className="admin-stat-value admin-stat-submitted">{periodStats.submittedReports}</span>
                <span className="admin-stat-label">Submitted Reports</span>
              </div>
              <div className="admin-stat-card">
                <span className="admin-stat-value admin-stat-draft">{periodStats.draftReports}</span>
                <span className="admin-stat-label">Draft Reports</span>
              </div>
              <div className="admin-stat-card">
                <span className="admin-stat-value admin-stat-not-started">{periodStats.missingReports}</span>
                <span className="admin-stat-label">Missing Reports</span>
              </div>
              <div className="admin-stat-card">
                <span className="admin-stat-value">{periodStats.completionPct}%</span>
                <span className="admin-stat-label">Completion</span>
              </div>
            </div>
          ) : null}

          <p className="ra-eyebrow">Submission Status</p>
          {pendingManagers.length === 0 ? (
            <div className="ra-pending-complete">
              Every manager has submitted for this period — nothing pending.
            </div>
          ) : (
            <div className="ra-pending-card">
              <p className="ra-pending-intro">
                {pendingManagers.length} manager{pendingManagers.length === 1 ? '' : 's'} still pending for this
                period:
              </p>
              <ul className="ra-pending-list">
                {pendingManagers.map((m) => (
                  <li className="ra-pending-item" key={m.managerId}>
                    <span className="ra-pending-name">{m.managerName}</span>
                    <span className={`ra-pending-tag ra-pending-tag-${m.status}`}>
                      {m.status === 'draft' ? 'Draft' : 'Not Started'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="ra-eyebrow">Consolidated Report Content</p>
          {period === 'weekly' ? (
            !weeklyData || weeklyData.entries.length === 0 ? (
              <div className="admin-empty-state">No submitted reports for this period yet.</div>
            ) : (
              // Grouped per manager, not per section — a legacy submission
              // has four sections and a V2 submission has five different
              // ones, so there is no longer one shared section list to group
              // by across every manager. ReportContentView renders each
              // manager's own content in whichever format they submitted.
              <div className="weekly-summary-manager-list">
                {weeklyData.entries.map((entry) => (
                  <div className="weekly-summary-manager-block" key={entry.managerId}>
                    <h2 className="weekly-summary-entry-name">{entry.managerName}</h2>
                    <ReportContentView content={entry.content} />
                  </div>
                ))}
              </div>
            )
          ) : periodStats && periodStats.entries.length > 0 ? (
            periodStats.entries.map((entry) => (
              <div className="period-manager-block" key={entry.managerId}>
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
        </>
      )}

      {!loading && AI_EXECUTIVE_SUMMARY_ENABLED && (
        // No separate "AI Executive Analysis" eyebrow here (unlike the
        // sections above) — ExecutiveAnalysisCard already renders its own
        // "AI Executive Analysis" <h2>, so an eyebrow above it would just
        // duplicate that heading.
        <ExecutiveAnalysisCard
          periodKey={period}
          offset={offset}
          weekStartDates={range.weekStartDates}
          periodStartDate={toISODate(range.periodStart)}
        />
      )}
    </div>
  )
}
