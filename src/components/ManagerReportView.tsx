import { useEffect, useState } from 'react'
import StatusBadge from './StatusBadge'
import ReportContentView from './ReportContentView'
import { fetchManagerReportSections, type ManagerSummary } from '../lib/adminService'
import { supabase } from '../lib/supabaseClient'
import type { ReportContent } from '../types'
import './ReportForm.css'
import './ManagerReportView.css'

function formatSubmittedAt(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

interface ManagerReportViewProps {
  manager: ManagerSummary
  weekStartDate: string
  weekLabel: string
  onBack: () => void
}

export default function ManagerReportView({ manager, weekStartDate, weekLabel, onBack }: ManagerReportViewProps) {
  const [content, setContent] = useState<ReportContent | null>(null)
  const [loading, setLoading] = useState(manager.status === 'submitted')

  useEffect(() => {
    if (manager.status !== 'submitted') return

    let active = true
    setLoading(true)

    fetchManagerReportSections(supabase, manager.id, weekStartDate).then((result) => {
      if (!active) return
      setContent(result)
      setLoading(false)
    })

    return () => {
      active = false
    }
  }, [manager.id, manager.status, weekStartDate])

  return (
    <div className="report-form">
      <button className="link-btn back-link" onClick={onBack}>
        &larr; Back to Admin Dashboard
      </button>

      <div className="report-form-heading">
        <div className="manager-view-top">
          <h1>{manager.fullName}</h1>
          <StatusBadge status={manager.status} />
        </div>
        <p className="report-form-week">
          Week of {weekLabel}
          {manager.submittedAt ? ` · Submitted ${formatSubmittedAt(manager.submittedAt)}` : ' · No submission yet'}
          {manager.status === 'submitted' && manager.submissionSource && (
            <span className="submission-source-tag">
              {' '}
              · {manager.submissionSource === 'automatic' ? 'Submitted automatically' : 'Submitted manually'}
            </span>
          )}
        </p>
      </div>

      {manager.status === 'submitted' ? (
        loading ? (
          <div className="manager-empty-state">Loading report…</div>
        ) : content ? (
          <ReportContentView content={content} />
        ) : (
          <div className="manager-empty-state">Could not load this report.</div>
        )
      ) : (
        <div className="manager-empty-state">
          {manager.status === 'draft'
            ? 'This manager has a draft in progress. It has not been submitted yet.'
            : 'This manager has not started their report for this week.'}
        </div>
      )}
    </div>
  )
}
