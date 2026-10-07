import {
  LEADERSHIP_REPORT_TITLE,
  LEADERSHIP_REPORT_TAGLINE,
  LEADERSHIP_REPORT_SECTION_LABELS,
  LEADERSHIP_REPORT_BOTTOM_GUIDANCE,
  splitBulletLeadIn,
  type LeadershipReportContent,
} from '../lib/leadershipReportContent'
import './LeadershipReportForm.css'

interface LeadershipReportFormViewProps {
  content: LeadershipReportContent
}

function Bullet({ text }: { text: string }) {
  const { label, rest } = splitBulletLeadIn(text)
  return (
    <li>
      {label && <strong>{label}: </strong>}
      {rest}
    </li>
  )
}

function BulletListSection({ bullets }: { bullets: string[] }) {
  if (bullets.length === 0) return <p className="lrf-section-empty">Nothing reported.</p>
  return (
    <ul className="lrf-bullets">
      {bullets.map((bullet, index) => (
        <Bullet key={index} text={bullet} />
      ))}
    </ul>
  )
}

// The READ-ONLY rendering of the WFG Weekly Leadership Update form — used
// for view mode, print, Previous Work, and History. Renders the exact
// same permanent template wording (title/tagline/section
// headings/helper questions/supporting labels/bottom guidance) as
// LeadershipReportForm.tsx's editable counterpart, from the same shared
// constants, so the editable form and the read-only/submitted
// representation can never drift apart.
export default function LeadershipReportFormView({ content }: LeadershipReportFormViewProps) {
  return (
    <div className="lrf-report">
      <div className="lrf-banner">
        <h1>{LEADERSHIP_REPORT_TITLE}</h1>
        <p className="lrf-tagline">{LEADERSHIP_REPORT_TAGLINE}</p>
      </div>

      <div className="lrf-identity">
        <div>
          <span className="lrf-identity-label">Leader</span>
          <p className="lrf-identity-value">{content.leader || '—'}</p>
        </div>
        <div>
          <span className="lrf-identity-label">Week Ending</span>
          <p className="lrf-identity-value">{content.weekEnding || '—'}</p>
        </div>
      </div>

      {/* The document's first content section has no heading of its own —
          see leadershipReportContent.ts's header comment. */}
      <div className="lrf-section">
        <BulletListSection bullets={content.weeklyUpdateBullets} />
      </div>

      <div className="lrf-section">
        <h2 className="lrf-section-heading">{LEADERSHIP_REPORT_SECTION_LABELS.lookingAroundTheCorner.heading}</h2>
        <p className="lrf-helper-question">{LEADERSHIP_REPORT_SECTION_LABELS.lookingAroundTheCorner.helperQuestion}</p>
        <p className="lrf-supporting-label">{LEADERSHIP_REPORT_SECTION_LABELS.lookingAroundTheCorner.supportingLabel}</p>
        <BulletListSection bullets={content.lookingAroundTheCornerBullets} />
      </div>

      <div className="lrf-section">
        <h2 className="lrf-section-heading">{LEADERSHIP_REPORT_SECTION_LABELS.nextWeekPriorities.heading}</h2>
        <p className="lrf-helper-question">{LEADERSHIP_REPORT_SECTION_LABELS.nextWeekPriorities.helperQuestion}</p>
        <p className="lrf-supporting-label">{LEADERSHIP_REPORT_SECTION_LABELS.nextWeekPriorities.supportingLabel}</p>
        <BulletListSection bullets={content.nextWeekPrioritiesBullets} />
      </div>

      <div className="lrf-section">
        <h2 className="lrf-section-heading">{LEADERSHIP_REPORT_SECTION_LABELS.otherNotableItems.heading}</h2>
        <p className="lrf-helper-question">{LEADERSHIP_REPORT_SECTION_LABELS.otherNotableItems.helperQuestion}</p>
        <BulletListSection bullets={content.otherNotableItemsBullets} />
      </div>

      <div className="lrf-section">
        <h2 className="lrf-section-heading">{LEADERSHIP_REPORT_SECTION_LABELS.okrNotes.heading}</h2>
        <p className="lrf-helper-question">{LEADERSHIP_REPORT_SECTION_LABELS.okrNotes.helperQuestion}</p>
        {content.okrNotes ? <p className="lrf-okr-notes">{content.okrNotes}</p> : <p className="lrf-section-empty">Nothing reported.</p>}
      </div>

      <div className="lrf-guidance">
        <p>
          <strong>{LEADERSHIP_REPORT_BOTTOM_GUIDANCE.reportOnlyWhatMatters.heading}</strong> &nbsp;
          {LEADERSHIP_REPORT_BOTTOM_GUIDANCE.reportOnlyWhatMatters.items.join(' | ')}
        </p>
        <p>
          <strong>{LEADERSHIP_REPORT_BOTTOM_GUIDANCE.leadershipExpectations.heading}</strong> &nbsp;
          {LEADERSHIP_REPORT_BOTTOM_GUIDANCE.leadershipExpectations.items.join(' | ')}
        </p>
      </div>
    </div>
  )
}
