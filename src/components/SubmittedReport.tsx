import type { ManagerReportSectionsV2 } from '../types'
import { getCurrentReportingWeek } from '../utils/week'
import ReportContentView from './ReportContentView'
import './ReportForm.css'
import './SubmittedReport.css'

interface SubmittedReportProps {
  data: ManagerReportSectionsV2
  submittedAt: string
  onBack: () => void
}

// Only ever reached right after a fresh submission this session — every
// submission going forward is V2, so this always renders the new format.
export default function SubmittedReport({ data, submittedAt, onBack }: SubmittedReportProps) {
  const week = getCurrentReportingWeek()

  return (
    <div className="report-form">
      <button className="link-btn back-link" onClick={onBack}>
        &larr; Back to Dashboard
      </button>

      <div className="report-form-heading">
        <span className="submitted-badge">Submitted</span>
        <h1>WFG Weekly Leadership Update</h1>
        <p className="report-form-week">
          Week Ending {week.fridayDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}{' '}
          &middot; Submitted {submittedAt}
        </p>
      </div>

      <ReportContentView content={{ version: 'v2', sections: data }} />
    </div>
  )
}
