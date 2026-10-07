import {
  LEADERSHIP_REPORT_TITLE,
  LEADERSHIP_REPORT_TAGLINE,
  LEADERSHIP_REPORT_SECTION_LABELS,
  LEADERSHIP_REPORT_BOTTOM_GUIDANCE,
  type LeadershipReportContent,
} from '../lib/leadershipReportContent'
import './LeadershipReportForm.css'

interface LeadershipReportFormProps {
  content: LeadershipReportContent
  onChange: (next: LeadershipReportContent) => void
}

type BulletSectionKey = 'weeklyUpdateBullets' | 'lookingAroundTheCornerBullets' | 'nextWeekPrioritiesBullets' | 'otherNotableItemsBullets'

// A flat bullet-list editor (add/remove/edit) shared by all four bullet
// sections below — each bullet is one plain string, matching the source
// document's own "Bold Label: rest of sentence" lines (see
// leadershipReportContent.ts). No separate label/text input: the leader
// types the whole line, exactly as the document shows it.
function BulletListEditor({ bullets, onChange }: { bullets: string[]; onChange: (next: string[]) => void }) {
  const updateBullet = (index: number, value: string) => {
    const next = [...bullets]
    next[index] = value
    onChange(next)
  }
  const removeBullet = (index: number) => onChange(bullets.filter((_, i) => i !== index))
  const addBullet = () => onChange([...bullets, ''])

  return (
    <div className="lrf-bullet-editor">
      {bullets.map((bullet, index) => (
        <div className="lrf-bullet-row" key={index}>
          <textarea
            className="lrf-bullet-input"
            value={bullet}
            onChange={(e) => updateBullet(index, e.target.value)}
            rows={2}
            aria-label={`Item ${index + 1}`}
          />
          <button type="button" className="btn btn-secondary lrf-bullet-remove" onClick={() => removeBullet(index)} aria-label={`Remove item ${index + 1}`}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-secondary lrf-bullet-add" onClick={addBullet}>
        + Add item
      </button>
    </div>
  )
}

// THE EDITABLE WFG WEEKLY LEADERSHIP UPDATE FORM. Every heading, helper
// question, supporting label, and the bottom guidance block is PERMANENT
// TEMPLATE WORDING — rendered from the same shared constants as
// LeadershipReportFormView.tsx, never editable, never part of `content`.
// Only the bordered/background-tinted input areas below each permanent
// label are user-editable report content.
export default function LeadershipReportForm({ content, onChange }: LeadershipReportFormProps) {
  const updateBulletSection = (key: BulletSectionKey, next: string[]) => onChange({ ...content, [key]: next })

  return (
    <div className="lrf-report lrf-report-editable">
      <div className="lrf-banner">
        <h1>{LEADERSHIP_REPORT_TITLE}</h1>
        <p className="lrf-tagline">{LEADERSHIP_REPORT_TAGLINE}</p>
      </div>

      <div className="lrf-identity">
        <div>
          <label className="lrf-identity-label" htmlFor="lrf-leader">
            Leader
          </label>
          <input
            id="lrf-leader"
            className="lrf-identity-input"
            type="text"
            value={content.leader}
            onChange={(e) => onChange({ ...content, leader: e.target.value })}
          />
        </div>
        <div>
          <label className="lrf-identity-label" htmlFor="lrf-week-ending">
            Week Ending
          </label>
          <input
            id="lrf-week-ending"
            className="lrf-identity-input"
            type="text"
            value={content.weekEnding}
            onChange={(e) => onChange({ ...content, weekEnding: e.target.value })}
          />
        </div>
      </div>

      {/* Unheaded first content section — see leadershipReportContent.ts. */}
      <div className="lrf-section">
        <BulletListEditor bullets={content.weeklyUpdateBullets} onChange={(next) => updateBulletSection('weeklyUpdateBullets', next)} />
      </div>

      <div className="lrf-section">
        <h2 className="lrf-section-heading">{LEADERSHIP_REPORT_SECTION_LABELS.lookingAroundTheCorner.heading}</h2>
        <p className="lrf-helper-question">{LEADERSHIP_REPORT_SECTION_LABELS.lookingAroundTheCorner.helperQuestion}</p>
        <p className="lrf-supporting-label">{LEADERSHIP_REPORT_SECTION_LABELS.lookingAroundTheCorner.supportingLabel}</p>
        <BulletListEditor
          bullets={content.lookingAroundTheCornerBullets}
          onChange={(next) => updateBulletSection('lookingAroundTheCornerBullets', next)}
        />
      </div>

      <div className="lrf-section">
        <h2 className="lrf-section-heading">{LEADERSHIP_REPORT_SECTION_LABELS.nextWeekPriorities.heading}</h2>
        <p className="lrf-helper-question">{LEADERSHIP_REPORT_SECTION_LABELS.nextWeekPriorities.helperQuestion}</p>
        <p className="lrf-supporting-label">{LEADERSHIP_REPORT_SECTION_LABELS.nextWeekPriorities.supportingLabel}</p>
        <BulletListEditor bullets={content.nextWeekPrioritiesBullets} onChange={(next) => updateBulletSection('nextWeekPrioritiesBullets', next)} />
      </div>

      <div className="lrf-section">
        <h2 className="lrf-section-heading">{LEADERSHIP_REPORT_SECTION_LABELS.otherNotableItems.heading}</h2>
        <p className="lrf-helper-question">{LEADERSHIP_REPORT_SECTION_LABELS.otherNotableItems.helperQuestion}</p>
        <BulletListEditor bullets={content.otherNotableItemsBullets} onChange={(next) => updateBulletSection('otherNotableItemsBullets', next)} />
      </div>

      <div className="lrf-section">
        <h2 className="lrf-section-heading">{LEADERSHIP_REPORT_SECTION_LABELS.okrNotes.heading}</h2>
        <p className="lrf-helper-question">{LEADERSHIP_REPORT_SECTION_LABELS.okrNotes.helperQuestion}</p>
        <textarea
          className="lrf-okr-input"
          value={content.okrNotes}
          onChange={(e) => onChange({ ...content, okrNotes: e.target.value })}
          rows={3}
          aria-label="OKR notes / exceptions"
        />
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
