import type { AtsReport } from '../lib/atsReport'
import './AtsReportView.css'

interface AtsReportViewProps {
  report: AtsReport
  // A fully caller-formatted period descriptor — e.g. "Week Ending
  // September 21, 2026" for a single reporting week, or "Q4 2026 (Oct 1 –
  // Dec 31)" for a longer period. This component renders it verbatim and no
  // longer decides the wording itself: only the caller knows whether it's
  // showing a single week (where "Week Ending [date]" reads naturally) or a
  // multi-week aggregate (where a range/label reads better) — see
  // ExecutiveAnalysisCard.tsx for the period-key-aware logic that builds
  // this string.
  periodLabel: string
  // Omitted (or undefined) whenever there is no single, genuine leader to
  // name — e.g. Executive Analysis, which aggregates every manager's
  // reports rather than belonging to one leader. Never fabricate a
  // placeholder value here; the "Leader:" line simply doesn't render.
  leaderName?: string
}

// The single shared renderer for the approved ATS written-report format —
// reused, unmodified in its rendering logic, by Weekly Summary's future
// consolidated report content, Executive Analysis' generated report, and
// the future Leadership Report's read-only left pane (and, once editable,
// as the starting point copied into its right pane). Purely presentational:
//   - never fetches data (report/periodLabel/leaderName are all caller-
//     supplied props)
//   - never calls the AI or generates content
//   - never saves/persists anything
//   - never modifies `report` — it is read, not written
//   - never infers or fabricates content beyond what `report`/its props
//     contain — every topic, bullet, and word displayed here comes directly
//     from the data the caller supplies
// Works equally inside a full-width page or one half of a side-by-side
// layout — no fixed widths, only fluid/relative sizing.
export default function AtsReportView({ report, periodLabel, leaderName }: AtsReportViewProps) {
  return (
    <div className="ats-report">
      <div className="ats-report-heading">
        <h1>WFG Weekly Leadership Update</h1>
        <p className="ats-report-week">{periodLabel}</p>
        {leaderName && <p className="ats-report-leader">Leader: {leaderName}</p>}
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
