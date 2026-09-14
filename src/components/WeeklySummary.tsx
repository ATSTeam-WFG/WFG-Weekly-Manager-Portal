import { useEffect, useState } from 'react'
import wfgLogo from '../assets/wfg-logo.png'
import { fetchWeeklySummary, type WeeklySummaryData } from '../lib/adminService'
import { supabase } from '../lib/supabaseClient'
import ExecutiveAnalysisCard from './ExecutiveAnalysisCard'
import ReportContentView from './ReportContentView'
import type { ReportingWeek } from '../utils/week'
import { AI_EXECUTIVE_SUMMARY_ENABLED } from '../config/featureFlags'
import './AdminDashboard.css'
import './SubmittedReport.css'
import './WeeklySummary.css'

interface WeeklySummaryProps {
  week: ReportingWeek
  weekOffset: number
  onBack: () => void
}

export default function WeeklySummary({ week, weekOffset, onBack }: WeeklySummaryProps) {
  const [data, setData] = useState<WeeklySummaryData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)

    fetchWeeklySummary(supabase, week.weekStartDate).then((result) => {
      if (!active) return
      setData(result)
      setLoading(false)
    })

    return () => {
      active = false
    }
  }, [week.weekStartDate])

  const handlePrint = () => {
    window.print()
  }

  return (
    <div className="weekly-summary">
      <button type="button" className="link-btn back-link no-print" onClick={onBack}>
        &larr; Back to Admin Dashboard
      </button>

      <div className="print-header">
        <img src={wfgLogo} alt="WFG" className="print-logo" />
        <div>
          <h1 className="print-title">Weekly Manager Summary</h1>
          <p className="print-week">Week of {week.label}</p>
        </div>
      </div>

      <div className="weekly-summary-heading">
        <div>
          <h1>Weekly Summary</h1>
          <p className="weekly-summary-week">Week of {week.label}</p>
        </div>
        <button type="button" className="btn btn-secondary no-print" onClick={handlePrint}>
          Print / Export PDF
        </button>
      </div>

      {loading ? (
        <div className="admin-loading">Loading summary…</div>
      ) : data ? (
        <>
          <div className="weekly-summary-stats">
            <div className="admin-stat-card">
              <span className="admin-stat-value">{data.totalManagers}</span>
              <span className="admin-stat-label">Total Managers</span>
            </div>
            <div className="admin-stat-card">
              <span className="admin-stat-value admin-stat-submitted">{data.submittedCount}</span>
              <span className="admin-stat-label">Submitted</span>
            </div>
            <div className="admin-stat-card">
              <span className="admin-stat-value">{data.completionPct}%</span>
              <span className="admin-stat-label">Completion</span>
            </div>
          </div>

          {AI_EXECUTIVE_SUMMARY_ENABLED && (
            <ExecutiveAnalysisCard
              periodKey="weekly"
              offset={weekOffset}
              weekStartDates={[week.weekStartDate]}
              periodStartDate={week.weekStartDate}
            />
          )}

          {data.entries.length === 0 ? (
            <div className="weekly-summary-empty">
              No managers have submitted a report for this week yet.
            </div>
          ) : (
            // Grouped per manager (not per section) — a legacy submission has
            // four sections and a V2 submission has five different ones, so
            // there is no longer one shared section list to group by across
            // every manager. ReportContentView renders each manager's own
            // content in whichever format they actually submitted.
            <div className="weekly-summary-manager-list">
              {data.entries.map((entry) => (
                <div className="weekly-summary-manager-block" key={entry.managerId}>
                  <h2 className="weekly-summary-entry-name">{entry.managerName}</h2>
                  <ReportContentView content={entry.content} />
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="weekly-summary-empty">Could not load the weekly summary.</div>
      )}
    </div>
  )
}
