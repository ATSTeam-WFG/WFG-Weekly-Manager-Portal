import { useRef, useState } from 'react'
import MicButton from './MicButton'
import BulletListInput from './BulletListInput'
import { useSpeechToText } from '../hooks/useSpeechToText'
import { useAutoGrowTextarea } from '../hooks/useAutoGrowTextarea'
import { useAutosave } from '../hooks/useAutosave'
import type { ManagerReportSectionsV2, ReportSections } from '../types'
import { getCurrentReportingWeek } from '../utils/week'
import { capBullets, isWhatMattersNowValidForSubmit, areReportSectionsEqual } from '../lib/reportValidation'
import { ManagerEditLockedError } from '../lib/reportsService'
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
  onSaveDraft: (data: ManagerReportSectionsV2) => Promise<void>
  onSubmit: (data: ManagerReportSectionsV2) => void
  isEditingSubmitted?: boolean
  onSaveChanges?: (data: ManagerReportSectionsV2, options?: { navigateToDashboard?: boolean }) => Promise<void>
  // True only while a Submit is in flight (onSubmit was called and hasn't
  // resolved yet) — disables the Submit button so a second click can never
  // fire a duplicate submission, and shows a "Submitting…" label.
  isSubmitting?: boolean
  // Set only when a genuine Submit attempt failed for a reason other than
  // the Friday-cutoff guard (that has its own lockMessage) — e.g. a
  // network/Supabase error. Distinct from this component's own client-side
  // validation message below. The manager's entered content in `data` is
  // never touched by this — they can simply retry.
  submitFailureMessage?: string | null
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
  isSubmitting = false,
  submitFailureMessage = null,
}: ReportFormProps) {
  const [data, setData] = useState<ManagerReportSectionsV2>(initialData)
  const [savedMessage, setSavedMessage] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  // Auto-grow the two free-text textareas as their own content changes —
  // same dependency-free technique used per bullet row in BulletListInput.
  const otherNotableItemsRef = useAutoGrowTextarea(data.otherNotableItems)
  const okrNotesRef = useAutoGrowTextarea(data.okrNotes)
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

  // Autosaves through the SAME onSaveDraft/onSaveChanges persistence path
  // used by the manual buttons below — never a second write implementation.
  // `trigger === 'manual'` is the only case allowed to navigate away on a
  // successful Save Changes (preserving that button's existing behavior);
  // autosave and the Back-to-Dashboard dirty-save must never navigate here
  // themselves — Back navigates explicitly, via handleBackClick, only after
  // its own save succeeds.
  const autosave = useAutosave<ManagerReportSectionsV2>({
    data,
    isEqual: areReportSectionsEqual,
    isLockedError: (err) => err instanceof ManagerEditLockedError,
    save: async (toSave, trigger) => {
      if (isEditingSubmitted) {
        await onSaveChanges?.(toSave, { navigateToDashboard: trigger === 'manual' })
      } else {
        await onSaveDraft(toSave)
      }
    },
  })

  const clearFeedback = () => {
    setSavedMessage(false)
    setSubmitError(null)
    autosave.notifyEditStarted()
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

  // Manual Save Draft/Save Changes: shows the existing confirmation
  // immediately (unchanged), and routes through the same single-flight
  // autosave.saveNow so it cancels/absorbs any pending autosave timer and
  // never runs concurrently with an in-flight autosave.
  const handleSave = () => {
    setSavedMessage(true)
    setSubmitError(null)
    void autosave.saveNow('manual')
  }

  const handleSaveChanges = () => {
    setSavedMessage(true)
    setSubmitError(null)
    void autosave.saveNow('manual')
  }

  // Back to Dashboard: if there's nothing unsaved, saveNow('back') resolves
  // immediately without calling onSaveDraft/onSaveChanges at all (see
  // useAutosave's own dirty short-circuit), so navigation is effectively
  // immediate. If there ARE unsaved changes, this awaits the same safe save
  // used everywhere else and only navigates once it actually succeeds — on
  // a lock or an ordinary error, this stays on the form so the manager
  // still sees their content plus the existing lock/error messaging.
  const handleBackClick = async () => {
    const outcome = await autosave.saveNow('back')
    if (outcome === 'success') {
      onBack()
    }
  }

  // Guards the brief async gap below (cancelPendingAndAwaitInFlight) before
  // App.tsx's own isSubmitting prop has had a chance to re-render as true —
  // without this, a second click landing inside that gap would pass the
  // isSubmitting check below (still false) and could start a second
  // concurrent submit attempt.
  const submitClickInFlightRef = useRef(false)

  const handleSubmitClick = async () => {
    // Defense-in-depth alongside disabling the button below: a second
    // click that somehow still fires (e.g. a queued event) can never start
    // a duplicate submission while one is already in flight.
    if (isSubmitting || submitClickInFlightRef.current) return
    if (!isWhatMattersNowValidForSubmit(data.whatMattersNow)) {
      setSubmitError('"01 — What Matters Now" needs 2–3 meaningful items before you can submit.')
      setSavedMessage(false)
      return
    }
    setSubmitError(null)
    submitClickInFlightRef.current = true
    try {
      // A background autosave draft write and the submit write both target
      // the same report row with no coordination between them otherwise —
      // if an autosave save is already in flight (or a timer is already
      // armed) at the exact moment Submit is clicked, waiting here first
      // guarantees the draft write fully lands before the submit write ever
      // starts, so they can never race each other at the database.
      await autosave.cancelPendingAndAwaitInFlight()
      onSubmit(data)
    } finally {
      submitClickInFlightRef.current = false
    }
  }

  return (
    <div className="report-form">
      <button className="link-btn back-link" onClick={handleBackClick}>
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
          ref={otherNotableItemsRef}
          className="report-textarea"
          rows={5}
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
          ref={okrNotesRef}
          className="report-textarea"
          rows={5}
          value={data.okrNotes}
          onChange={(e) => handleTextChange('okrNotes', e.target.value)}
          placeholder="Type here... (optional)"
        />
      </div>

      {lockMessage && <p className="voice-error-message report-lock-message">{lockMessage}</p>}
      {submitFailureMessage && <p className="voice-error-message report-lock-message">{submitFailureMessage}</p>}

      <div className="report-form-actions">
        {savedMessage && <span className="saved-message">{isEditingSubmitted ? 'Changes saved' : 'Draft saved'}</span>}
        {!savedMessage && autosave.status === 'saving' && <span className="autosave-status">Saving&hellip;</span>}
        {!savedMessage && autosave.status === 'saved' && <span className="autosave-status autosave-status-saved">Saved</span>}
        {!savedMessage && autosave.status === 'error' && (
          <span className="autosave-status autosave-status-error">Couldn&apos;t save automatically — your changes are still here.</span>
        )}
        {isEditingSubmitted ? (
          <button className="btn btn-primary" onClick={handleSaveChanges}>
            Save Changes
          </button>
        ) : (
          <>
            <button className="btn btn-secondary" onClick={handleSave} disabled={isSubmitting}>
              Save Draft
            </button>
            <button className="btn btn-primary" onClick={handleSubmitClick} disabled={isSubmitting}>
              {isSubmitting ? 'Submitting…' : 'Submit Report'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
