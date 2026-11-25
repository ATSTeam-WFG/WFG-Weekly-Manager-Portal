import type { ManagerOverviewCounts } from '../lib/managerOverviewService'
import './TeamStatusBar.css'

interface TeamStatusBarProps {
  counts: ManagerOverviewCounts
}

// Purely presentational — a visual breakdown of the exact same counts the
// KPI row above already computed from real data (fetchManagerOverview). No
// second calculation, no new query, nothing hardcoded: each segment's width
// is literally that bucket's share of totalAssigned.
//
// Beta feedback (2026-11-16): collapsed from the old
// approved/pending/rejected breakdown to a plain submitted/draft/missing
// split — review_status no longer gates or labels anything.
export default function TeamStatusBar({ counts }: TeamStatusBarProps) {
  const total = counts.totalAssigned

  const segments = [
    { key: 'submitted', label: 'Submitted', value: counts.submitted, className: 'tsb-segment-approved' },
    { key: 'draft', label: 'In Progress', value: counts.draft, className: 'tsb-segment-pending' },
    { key: 'missing', label: 'Missing', value: counts.missing, className: 'tsb-segment-missing' },
  ]

  return (
    <div className="tsb-card">
      <h2 className="tsb-heading">Team Reporting Status</h2>

      {total === 0 ? (
        <p className="tsb-empty">You have no reps currently assigned to you.</p>
      ) : (
        <>
          <div className="tsb-bar" role="img" aria-label={`${counts.submitted} submitted, ${counts.draft} in progress, ${counts.missing} missing, out of ${total} assigned reps`}>
            {segments
              .filter((s) => s.value > 0)
              .map((s) => (
                <span key={s.key} className={`tsb-segment ${s.className}`} style={{ width: `${(s.value / total) * 100}%` }} />
              ))}
          </div>

          <div className="tsb-legend">
            {segments.map((s) => (
              <div className="tsb-legend-item" key={s.key}>
                <span className={`tsb-legend-dot ${s.className}`} aria-hidden="true" />
                <span className="tsb-legend-label">{s.label}</span>
                <span className="tsb-legend-value">{s.value}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
