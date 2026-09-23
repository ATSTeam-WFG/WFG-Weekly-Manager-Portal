import type { ReportContent } from '../types'
import ReportContentView from './ReportContentView'
import './SubmittedManagerCard.css'

interface SubmittedManagerCardProps {
  managerId: string
  managerName: string
  // null when fetchManagersForWeek has no matching row for this manager, or
  // no submitted_at value on it — omitted from the header rather than
  // showing a fabricated date (see WeeklySummary.tsx's submittedAtByManagerId).
  submittedAt: string | null
  content: ReportContent
  isExpanded: boolean
  onToggle: () => void
}

function formatSubmittedDate(iso: string): string | null {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Weekly-Summary-only presentation of one submitted manager's report — a
// compact, collapsed-by-default row/card (name, submission date, the
// existing shared .submitted-badge, and a chevron) that expands in place.
// Uses the real, unmodified ReportContentView for content, so every one of
// the five existing report sections and their actual data/semantics are
// untouched; only a Weekly-Summary-scoped wrapper CSS grid changes how that
// same content is laid out on screen.
export default function SubmittedManagerCard({
  managerId,
  managerName,
  submittedAt,
  content,
  isExpanded,
  onToggle,
}: SubmittedManagerCardProps) {
  const formattedDate = submittedAt ? formatSubmittedDate(submittedAt) : null

  return (
    <div className="ws-manager-card" data-manager-id={managerId}>
      <button
        type="button"
        className="ws-manager-card-header"
        onClick={onToggle}
        aria-expanded={isExpanded}
      >
        <span className="ws-manager-card-name">{managerName}</span>
        {formattedDate && <span className="ws-manager-card-date">Submitted {formattedDate}</span>}
        <span className="submitted-badge ws-manager-card-badge">Submitted</span>
        {/* The expand/collapse indicator only — never part of the printed
            report, per the existing no-print convention. The rest of this
            header (name/date/badge) is intentionally NOT no-print, since it
            should still print as the report's heading even when collapsed
            on screen — see .ws-manager-card-body's own @media print rule. */}
        <span className={`ws-manager-card-chevron no-print ${isExpanded ? 'ws-manager-card-chevron-open' : ''}`} aria-hidden="true">
          &#8964;
        </span>
      </button>

      <div className={`ws-manager-card-body ${isExpanded ? 'ws-manager-card-body-open' : ''}`}>
        <div className="ws-manager-card-body-content">
          <ReportContentView content={content} />
        </div>
      </div>
    </div>
  )
}
