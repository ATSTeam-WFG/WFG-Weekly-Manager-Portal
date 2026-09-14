import type { ReportContent, ReportSections } from '../types'
import './SubmittedReport.css'

const LEGACY_SECTIONS: { key: keyof ReportSections; title: string }[] = [
  { key: 'topPriorities', title: 'Top Priorities This Week' },
  { key: 'wins', title: 'Wins / Progress' },
  { key: 'challenges', title: 'Challenges & Opportunities' },
  { key: 'nextWeekPriorities', title: 'Priorities for Next Week' },
]

function BulletSection({ title, context, bullets }: { title: string; context?: string; bullets: string[] }) {
  return (
    <div className="report-section">
      <div className="report-section-header">
        <p className="report-section-label">{title}</p>
        {context && <span className="report-section-context">{context}</span>}
      </div>
      {bullets.length > 0 ? (
        <ul className="report-readonly-bullets">
          {bullets.map((bullet, i) => (
            <li key={i}>{bullet}</li>
          ))}
        </ul>
      ) : (
        <p className="report-readonly-text">
          <span className="report-empty">No response provided.</span>
        </p>
      )}
    </div>
  )
}

// Read-only rendering shared by SubmittedReport, HistoricalReportView, and
// ManagerReportView — a legacy row renders through the exact same 4-field
// layout this app has always used; a V2 row renders the five approved
// sections. Which branch runs is decided entirely by `content.version`
// (set by reportsService.ts's isV2Row), never guessed or converted here.
export default function ReportContentView({ content }: { content: ReportContent }) {
  if (content.version === 'legacy') {
    return (
      <>
        {LEGACY_SECTIONS.map((section) => (
          <div className="report-section" key={section.key}>
            <p className="report-section-label">{section.title}</p>
            <p className="report-readonly-text">
              {content.sections[section.key] || <span className="report-empty">No response provided.</span>}
            </p>
          </div>
        ))}
      </>
    )
  }

  const { sections } = content
  return (
    <>
      <BulletSection title="01 — What Matters Now" bullets={sections.whatMattersNow} />
      <BulletSection title="02 — Looking Around the Corner" context="Next 4 weeks" bullets={sections.lookingAroundCorner} />
      <BulletSection
        title="03 — Next Week - High-Impact Priorities"
        context="Up to 3 priorities"
        bullets={sections.nextWeekPriorities}
      />
      <div className="report-section">
        <p className="report-section-label">Other Notable Items</p>
        <p className="report-readonly-text">
          {sections.otherNotableItems || <span className="report-empty">No response provided.</span>}
        </p>
      </div>
      <div className="report-section">
        <p className="report-section-label">OKR Notes / Exceptions - If Applicable</p>
        <p className="report-readonly-text">
          {sections.okrNotes || <span className="report-empty">No response provided.</span>}
        </p>
      </div>
    </>
  )
}
