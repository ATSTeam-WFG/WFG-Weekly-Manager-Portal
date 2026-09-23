import type { AtsReport } from '../lib/atsReport'
import './AtsReportView.css'

interface AtsReportViewProps {
  report: AtsReport
  // ISO date string (e.g. a week's Friday/deadline date) — formatted for
  // display here, the same "format what the caller supplies" convention
  // ExecutiveAnalysisCard/ReportForm already use for their own dates.
  weekEndingDate: string
  leaderName: string
}

function formatWeekEndingDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

// The single shared renderer for the approved ATS written-report format —
// reused, unmodified, by Weekly Summary's consolidated report content,
// Executive Analysis' future generated report, and the future Leadership
// Report's read-only left pane (and, once editable, as the starting point
// copied into its right pane). Purely presentational:
//   - never fetches data (report/weekEndingDate/leaderName are all caller-
//     supplied props)
//   - never calls the AI or generates content
//   - never saves/persists anything
//   - never modifies `report` — it is read, not written
//   - never infers or fabricates content beyond what `report` contains —
//     every topic, bullet, and word displayed here comes directly from the
//     data the caller supplies
// Works equally inside a full-width page or one half of a side-by-side
// layout — no fixed widths, only fluid/relative sizing.
export default function AtsReportView({ report, weekEndingDate, leaderName }: AtsReportViewProps) {
  return (
    <div className="ats-report">
      <div className="ats-report-heading">
        <h1>WFG Weekly Leadership Update</h1>
        <p className="ats-report-week">Week Ending {formatWeekEndingDate(weekEndingDate)}</p>
        <p className="ats-report-leader">Leader: {leaderName}</p>
      </div>

      <p className="ats-report-opening">{report.openingParagraph}</p>

      <div className="ats-report-topics">
        {report.topics.map((topic, index) => (
          <div className="ats-topic-section" key={index}>
            <h2 className="ats-topic-title">{topic.title}</h2>
            <p className="ats-topic-status">{topic.statusSummary}</p>
            <ul className="ats-topic-bullets">
              {topic.bullets.map((bullet, bulletIndex) => (
                <li key={bulletIndex}>{bullet}</li>
              ))}
            </ul>
            <p className="ats-topic-next">
              <strong>Next:</strong> {topic.next}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
