import type { ReportStatus } from '../types'
import './StatusBadge.css'

const LABELS: Record<ReportStatus, string> = {
  not_started: 'Not Started',
  draft: 'Draft Saved',
  submitted: 'Submitted',
}

export default function StatusBadge({ status }: { status: ReportStatus }) {
  return <span className={`status-badge status-${status}`}>{LABELS[status]}</span>
}
