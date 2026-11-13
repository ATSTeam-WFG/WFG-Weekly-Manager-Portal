import type { ManagerOverviewCounts } from '../lib/managerOverviewService'
import './TeamStatusBar.css'

interface TeamStatusBarProps {
  counts: ManagerOverviewCounts
}

// Purely presentational — a visual breakdown of the exact same counts the
// KPI row above already computed from real data (fetchManagerOverview). No
// second calculation, no new query, nothing hardcoded: each segment's width
// is literally that bucket's share of totalAssigned.
export default function TeamStatusBar({ counts }: TeamStatusBarProps) {
  const total = counts.totalAssigned

  const segments = [
    { key: 'approved', label: 'Approved', value: counts.approved, className: 'tsb-segment-approved' },
    { key: 'pending', label: 'Pending Review', value: counts.pending, className: 'tsb-segment-pending' },
    { key: 'rejected', label: 'Needs Correction', value: counts.rejected, className: 'tsb-segment-rejected' },
    { key: 'missing', label: 'Missing', value: counts.missing, className: 'tsb-segment-missing' },
  ]

  return (
    <div className="tsb-card">
      <h2 className="tsb-heading">Team Reporting Status</h2>

      {total === 0 ? (
        <p className="tsb-empty">You have no reps currently assigned to you.</p>
      ) : (
        <>
          <div className="tsb-bar" role="img" aria-label={`${counts.approved} approved, ${counts.pending} pending review, ${counts.rejected} needing correction, ${counts.missing} missing, out of ${total} assigned reps`}>
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
