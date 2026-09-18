import { useEffect, useState } from 'react'
import StatusBadge from './StatusBadge'
import ReportContentView from './ReportContentView'
import { fetchWeekReport } from '../lib/reportsService'
import type { ReportContent, ReportStatus } from '../types'
import './ReportForm.css'
import './SubmittedReport.css'

function formatTimestamp(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

interface HistoricalReportViewProps {
  managerId: string
  weekStartDate: string
  weekLabel: string
  status: ReportStatus
  submittedAt: string | null
  onBack: () => void
}

export default function HistoricalReportView({
  managerId,
  weekStartDate,
  weekLabel,
  status,
  submittedAt,
  onBack,
}: HistoricalReportViewProps) {
  const [content, setContent] = useState<ReportContent | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)

    fetchWeekReport(managerId, weekStartDate).then((outcome) => {
      if (!active) return
      // Both 'not_found' and 'error' render the same existing "Could not
      // load this report." fallback below — unchanged behavior, just
      // adapted to fetchWeekReport's new outcome shape.
      setContent(outcome.status === 'found' ? outcome.report.content : null)
      setLoading(false)
    })

    return () => {
      active = false
    }
  }, [managerId, weekStartDate])

  return (
    <div className="report-form">
      <button className="link-btn back-link" onClick={onBack}>
        &larr; Back to Dashboard
      </button>

      <div className="report-form-heading">
        <div className="report-title-row">
          <h1>Weekly Manager Report</h1>
          <StatusBadge status={status} />
        </div>
        <p className="report-form-week">
          Week of {weekLabel}
          {status === 'submitted' && submittedAt ? ` · Submitted ${formatTimestamp(submittedAt)}` : ' · Not submitted'}
        </p>
      </div>

      {loading ? (
        <p className="report-loading">Loading report…</p>
      ) : content ? (
        <ReportContentView content={content} />
      ) : (
        <p className="report-loading">Could not load this report.</p>
      )}
    </div>
  )
}
