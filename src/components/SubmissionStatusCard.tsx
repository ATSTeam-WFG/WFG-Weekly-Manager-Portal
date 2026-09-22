import { useState } from 'react'
import './SubmissionStatusCard.css'

interface SubmissionStatusCardProps {
  submittedCount: number
  draftCount: number
  notStartedCount: number
  draftNames: string[]
  notStartedNames: string[]
}

// Compact replacement for the old always-expanded pending-manager pill list.
// Collapsed by default — the counts/percentage/progress bar alone answer
// "how are we doing" at a glance; expanding groups the actual names by
// status instead of repeating a status badge next to every person.
//
// The expanded detail list is always rendered in the DOM (never
// conditionally mounted) — only its on-screen visibility depends on
// `expanded`, so a print (e.g. "Complete Leadership Report") still shows
// the full pending detail even if the card happens to be collapsed on
// screen at that moment. This mirrors the same print-only-content pattern
// already used by ExecutiveAnalysisCard's saved/edit content.
export default function SubmissionStatusCard({
  submittedCount,
  draftCount,
  notStartedCount,
  draftNames,
  notStartedNames,
}: SubmissionStatusCardProps) {
  const [expanded, setExpanded] = useState(false)

  const total = submittedCount + draftCount + notStartedCount
  const pendingCount = draftCount + notStartedCount
  const completionPct = total > 0 ? Math.round((submittedCount / total) * 100) : 0
  const hasDetail = draftNames.length > 0 || notStartedNames.length > 0

  return (
    <div className="ra-status-card">
      <div className="ra-status-top-row">
        <h3 className="ra-status-title">Submission Status</h3>
        <span className="ra-status-progress-label">{completionPct}% Complete</span>
      </div>

      <p className="ra-status-pending-sentence">
        {pendingCount === 0
          ? 'Every manager has submitted for this period.'
          : `${pendingCount} manager${pendingCount === 1 ? '' : 's'} still pending for this period`}
      </p>

      <div className="ra-status-progress-track">
        <div className="ra-status-progress-fill" style={{ width: `${completionPct}%` }} />
      </div>

      <div className="ra-status-summary">
        {/* A compact legend, not the large stat tiles — those now live in
            the separate summary cards above this card on the page. */}
        <div className="ra-status-legend">
          <span className="ra-status-legend-item">
            <span className="ra-status-dot ra-status-dot-submitted" aria-hidden="true" />
            Submitted <strong>{submittedCount}</strong>
          </span>
          <span className="ra-status-legend-item">
            <span className="ra-status-dot ra-status-dot-draft" aria-hidden="true" />
            Draft <strong>{draftCount}</strong>
          </span>
          <span className="ra-status-legend-item">
            <span className="ra-status-dot ra-status-dot-not-started" aria-hidden="true" />
            Not Started <strong>{notStartedCount}</strong>
          </span>
        </div>

        {hasDetail && (
          <button
            type="button"
            className={`ra-status-toggle no-print ${expanded ? 'ra-status-toggle-open' : ''}`}
            onClick={() => setExpanded((prev) => !prev)}
            aria-expanded={expanded}
          >
            View details
            <span className="ra-status-toggle-chevron" aria-hidden="true">
              &darr;
            </span>
          </button>
        )}
      </div>

      {hasDetail && (
        <div className={`ra-status-detail ${expanded ? 'ra-status-detail-open' : ''}`}>
          {draftNames.length > 0 && (
            <div className="ra-status-group">
              <div className="ra-status-group-header">
                <span className="ra-status-group-title">Draft</span>
                <span className="ra-status-group-count">{draftNames.length}</span>
              </div>
              {/* Individual subtle items, not comma-separated prose — no
                  per-name status badge, since the group heading above
                  already communicates that every name here is a draft. */}
              <ul className="ra-status-name-list">
                {draftNames.map((name, i) => (
                  <li className="ra-status-name-item" key={`${name}-${i}`}>
                    {name}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {notStartedNames.length > 0 && (
            <div className="ra-status-group">
              <div className="ra-status-group-header">
                <span className="ra-status-group-title">Not Started</span>
                <span className="ra-status-group-count">{notStartedNames.length}</span>
              </div>
              {/* A responsive grid (≈3 columns on desktop, fewer on
                  narrower viewports via CSS) rather than comma-separated
                  prose — same subtle item styling as Draft above, no
                  per-name status badge. */}
              <ul className="ra-status-name-grid">
                {notStartedNames.map((name, i) => (
                  <li className="ra-status-name-item" key={`${name}-${i}`}>
                    {name}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
