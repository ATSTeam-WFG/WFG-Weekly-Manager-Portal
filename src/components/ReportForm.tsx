import { useState } from 'react'
import MicButton from './MicButton'
import BulletListInput from './BulletListInput'
import { useSpeechToText } from '../hooks/useSpeechToText'
import type { ManagerReportSectionsV2, ReportSections } from '../types'
import { getCurrentReportingWeek } from '../utils/week'
import { capBullets, isWhatMattersNowValidForSubmit } from '../lib/reportValidation'
import './ReportForm.css'
import './SubmittedReport.css'

interface ReportFormProps {
  initialData: ManagerReportSectionsV2
  // Non-null only when this manager/week's existing row is still in the
  // legacy format (see reportsService.ts's isV2Row) — shown read-only, above
  // the new form, as a reference. Never converted, remapped, or edited; once
  // the manager saves via this form, the row becomes V2 and this stops
  // appearing on subsequent visits.
  legacyReference: ReportSections | null
  leaderName: string
  // Set only when a save/submit was rejected by the Friday-cutoff guard at
  // the moment it was attempted — a stale-tab defense-in-depth case, since
  // the normal path is for Dashboard to never let a manager reach this form
  // once locked. Displayed prominently near the actions, not silently
  // swallowed.
  lockMessage?: string | null
  onBack: () => void
  onSaveDraft: (data: ManagerReportSectionsV2) => void
  onSubmit: (data: ManagerReportSectionsV2) => void
  isEditingSubmitted?: boolean
  onSaveChanges?: (data: ManagerReportSectionsV2) => void
}

const LEGACY_SECTIONS: { key: keyof ReportSections; title: string }[] = [
  { key: 'topPriorities', title: 'Top Priorities This Week' },
  { key: 'wins', title: 'Wins / Progress' },
  { key: 'challenges', title: 'Challenges & Opportunities' },
  { key: 'nextWeekPriorities', title: 'Priorities for Next Week' },
]

const WHAT_MATTERS_GUIDANCE = [
  'Materially affect WFG',
  'Create an opportunity',
  'Address a risk',
  'Require leadership attention',
  'Signal what is around the corner',
]

export default function ReportForm({
  initialData,
  legacyReference,
  leaderName,
  lockMessage,
  onBack,
  onSaveDraft,
  onSubmit,
  isEditingSubmitted = false,
  onSaveChanges,
}: ReportFormProps) {
  const [data, setData] = useState<ManagerReportSectionsV2>(initialData)
  const [savedMessage, setSavedMessage] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const week = getCurrentReportingWeek()
  const weekEndingLabel = week.fridayDate.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
  const { isSupported, activeField, errorField, errorMessage, start, stop } = useSpeechToText()
  // One shared speech-recognition session (see useSpeechToText) powers every
  // mic button on this form — both the two free-text sections below and
  // every individual bullet row. Only one field can ever be listening at
  // once, which is exactly what guarantees dictation for bullet 2 can never
  // bleed into bullet 1 or any other field.
  const bulletVoice = { isSupported, activeField, errorField, errorMessage, onStart: start, onStop: stop }

  const clearFeedback = () => {
    setSavedMessage(false)
    setSubmitError(null)
  }

  const handleBulletsChange = (key: 'whatMattersNow' | 'lookingAroundCorner' | 'nextWeekPriorities', bullets: string[]) => {
    setData((prev) => ({ ...prev, [key]: capBullets(bullets, 3) }))
    clearFeedback()
  }

  const handleTextChange = (key: 'otherNotableItems' | 'okrNotes', value: string) => {
    setData((prev) => ({ ...prev, [key]: value }))
    clearFeedback()
  }

  const handleVoiceResult = (key: 'otherNotableItems' | 'okrNotes', transcript: string) => {
    setData((prev) => {
      const current = prev[key].trim()
      return { ...prev, [key]: current ? `${current} ${transcript}` : transcript }
    })
    clearFeedback()
  }

  const handleSave = () => {
    onSaveDraft(data)
    setSavedMessage(true)
    setSubmitError(null)
  }

  const handleSaveChanges = () => {
    onSaveChanges?.(data)
    setSavedMessage(true)
    setSubmitError(null)
  }

  const handleSubmitClick = () => {
    if (!isWhatMattersNowValidForSubmit(data.whatMattersNow)) {
      setSubmitError('"01 — What Matters Now" needs 2–3 meaningful items before you can submit.')
      setSavedMessage(false)
      return
    }
    setSubmitError(null)
    onSubmit(data)
  }

  return (
    <div className="report-form">
      <button className="link-btn back-link" onClick={onBack}>
        &larr; Back to Dashboard
      </button>

      {legacyReference && (
        <div className="legacy-reference-block">
          <p className="legacy-reference-title">
            Previous {isEditingSubmitted ? 'Submitted' : 'Draft'} Content <span className="legacy-reference-badge">Previous format</span>
          </p>
          <p className="legacy-reference-helper">
            This is what you {isEditingSubmitted ? 'previously submitted' : 'previously saved'} under the old report
            format. It is shown here only as a reference and will not be changed — use it to help fill in the new
            format below.
          </p>
          {LEGACY_SECTIONS.map((section) => (
            <div className="report-section legacy-reference-section" key={section.key}>
              <p className="report-section-label">{section.title}</p>
              <p className="report-readonly-text">
                {legacyReference[section.key] || <span className="report-empty">No response provided.</span>}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="report-form-heading">
        {isEditingSubmitted && <span className="submitted-badge">Submitted</span>}
        <h1>WFG Weekly Leadership Update</h1>
        <p className="report-form-week">
          Leader: {leaderName} &middot; Week Ending {weekEndingLabel}
        </p>
        <p className="report-form-subtitle">Exception-based | Forward-looking | Focused on material impact</p>
      </div>

      <div className="report-guidance-card">
        <p className="report-guidance-title">Report only what matters</p>
        <ul className="report-guidance-list">
          {WHAT_MATTERS_GUIDANCE.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>

      <p className="report-leadership-expectations">Be Decisive | Be Proactive | Be Engaged | Be Reliable | Be Prospective</p>

      {!isSupported && (
        <p className="voice-unsupported-notice">
          Voice input is not available in this browser. You can continue typing your response.
        </p>
      )}

      <div className="report-section">
        <label className="report-section-label" htmlFor="what-matters-now-0">
          01 — What Matters Now
        </label>
        <p className="report-section-helper">
          The 2–3 most important things — significant results, decisions, changes, or developments.
        </p>
        <BulletListInput
          idPrefix="what-matters-now"
          bullets={data.whatMattersNow}
          onChange={(bullets) => handleBulletsChange('whatMattersNow', bullets)}
          max={3}
          voice={bulletVoice}
        />
        {submitError && <p className="voice-error-message">{submitError}</p>}
      </div>

      <div className="report-section">
        <div className="report-section-header">
          <label className="report-section-label" htmlFor="looking-around-corner-0">
            02 — Looking Around the Corner
          </label>
          <span className="report-section-context">Next 4 weeks</span>
        </div>
        <p className="report-section-helper">
          What do you see developing over the next four weeks that could create an opportunity, risk, decision, or
          need for action?
        </p>
        <BulletListInput
          idPrefix="looking-around-corner"
          bullets={data.lookingAroundCorner}
          onChange={(bullets) => handleBulletsChange('lookingAroundCorner', bullets)}
          max={3}
          voice={bulletVoice}
        />
      </div>

      <div className="report-section">
        <div className="report-section-header">
          <label className="report-section-label" htmlFor="next-week-priorities-0">
            03 — Next Week - High-Impact Priorities
          </label>
          <span className="report-section-context">Up to 3 priorities</span>
        </div>
        <p className="report-section-helper">
          What actions will your team drive that will materially advance WFG or an important business outcome?
        </p>
        <BulletListInput
          idPrefix="next-week-priorities"
          bullets={data.nextWeekPriorities}
          onChange={(bullets) => handleBulletsChange('nextWeekPriorities', bullets)}
          max={3}
          voice={bulletVoice}
        />
      </div>

      <div className="report-section">
        <div className="report-section-header">
          <label className="report-section-label" htmlFor="other-notable-items">
            Other Notable Items
          </label>
          <MicButton
            isListening={activeField === 'otherNotableItems'}
            isSupported={isSupported}
            fieldLabel="Other Notable Items"
            onStart={() => start('otherNotableItems', (transcript) => handleVoiceResult('otherNotableItems', transcript))}
            onStop={stop}
          />
        </div>
        <p className="report-section-helper">Anything important that does not fit above but warrants attention.</p>
        {errorField === 'otherNotableItems' && errorMessage && <p className="voice-error-message">{errorMessage}</p>}
        <textarea
          id="other-notable-items"
          className="report-textarea"
          rows={3}
          value={data.otherNotableItems}
          onChange={(e) => handleTextChange('otherNotableItems', e.target.value)}
          placeholder="Type here..."
        />
      </div>

      <div className="report-section">
        <div className="report-section-header">
          <label className="report-section-label" htmlFor="okr-notes">
            OKR Notes / Exceptions - If Applicable
          </label>
          <MicButton
            isListening={activeField === 'okrNotes'}
            isSupported={isSupported}
            fieldLabel="OKR Notes / Exceptions"
            onStart={() => start('okrNotes', (transcript) => handleVoiceResult('okrNotes', transcript))}
            onStop={stop}
          />
        </div>
        <p className="report-section-helper">
          Note only meaningful OKR movement, status changes, completions, or concerns. Leave blank if there is
          nothing material to report.
        </p>
        {errorField === 'okrNotes' && errorMessage && <p className="voice-error-message">{errorMessage}</p>}
        <textarea
          id="okr-notes"
          className="report-textarea"
          rows={3}
          value={data.okrNotes}
          onChange={(e) => handleTextChange('okrNotes', e.target.value)}
          placeholder="Type here... (optional)"
        />
      </div>

      {lockMessage && <p className="voice-error-message report-lock-message">{lockMessage}</p>}

      <div className="report-form-actions">
        {savedMessage && <span className="saved-message">{isEditingSubmitted ? 'Changes saved' : 'Draft saved'}</span>}
        {isEditingSubmitted ? (
          <button className="btn btn-primary" onClick={handleSaveChanges}>
            Save Changes
          </button>
        ) : (
          <>
            <button className="btn btn-secondary" onClick={handleSave}>
              Save Draft
            </button>
            <button className="btn btn-primary" onClick={handleSubmitClick}>
              Submit Report
            </button>
          </>
        )}
      </div>
    </div>
  )
}
