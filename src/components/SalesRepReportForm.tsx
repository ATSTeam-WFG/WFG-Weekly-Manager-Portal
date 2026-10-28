import { useRef, useState } from 'react'
import BulletListInput from './BulletListInput'
import { useAutosave } from '../hooks/useAutosave'
import type { SalesRepReportSections } from '../types'
import { capBullets } from '../lib/reportValidation'
import { RepReportError } from '../lib/repReportsService'
import './SalesRepReportForm.css'

interface SalesRepReportFormProps {
  initialData: SalesRepReportSections
  // e.g. "Jan 5 – Jan 9, 2026" — from ReportingWeek.label
  weekLabel: string
  // e.g. "Friday, January 9 at 3:00 PM ET" — from ReportingWeek.deadlineLabel
  deadlineLabel: string
  isPastDeadline: boolean
  isRejectedCorrection: boolean
  rejectionReason?: string | null
  onBack: () => void
  onSaveDraft: (data: SalesRepReportSections) => Promise<void>
  onSubmit: (data: SalesRepReportSections) => void
  isSubmitting?: boolean
  submitFailureMessage?: string | null
}

// Five bullet sections, each capped at 5 items — matches the shape of
// SalesRepReportSections (src/types.ts) minus managerSupportNeeded, which is
// free text and rendered separately below.
const BULLET_SECTIONS: {
  key: Exclude<keyof SalesRepReportSections, 'managerSupportNeeded'>
  idPrefix: string
  title: string
  helper: string
}[] = [
  {
    key: 'accomplishments',
    idPrefix: 'rep-accomplishments',
    title: 'Accomplishments',
    helper: 'What did you get done this week?',
  },
  {
    key: 'salesMetrics',
    idPrefix: 'rep-sales-metrics',
    title: 'Sales Metrics',
    helper: 'Calls, meetings, closed deals, revenue — whatever numbers matter for your role.',
  },
  {
    key: 'pipelineUpdates',
    idPrefix: 'rep-pipeline-updates',
    title: 'Pipeline Updates',
    helper: 'New opportunities, stage changes, or deals that moved this week.',
  },
  {
    key: 'blockers',
    idPrefix: 'rep-blockers',
    title: 'Blockers / Challenges',
    helper: 'Anything slowing you down or getting in the way.',
  },
  {
    key: 'nextWeekPriorities',
    idPrefix: 'rep-next-week-priorities',
    title: 'Next Week Priorities',
    helper: 'What you plan to focus on next week.',
  },
]

const MAX_BULLETS_PER_SECTION = 5

function areSalesRepSectionsEqual(a: SalesRepReportSections, b: SalesRepReportSections): boolean {
  const bulletArraysEqual = (x: string[], y: string[]) => x.length === y.length && x.every((v, i) => v === y[i])
  return (
    bulletArraysEqual(a.accomplishments, b.accomplishments) &&
    bulletArraysEqual(a.salesMetrics, b.salesMetrics) &&
    bulletArraysEqual(a.pipelineUpdates, b.pipelineUpdates) &&
    bulletArraysEqual(a.blockers, b.blockers) &&
    bulletArraysEqual(a.nextWeekPriorities, b.nextWeekPriorities) &&
    a.managerSupportNeeded === b.managerSupportNeeded
  )
}

export default function SalesRepReportForm({
  initialData,
  weekLabel,
  deadlineLabel,
  isPastDeadline,
  isRejectedCorrection,
  rejectionReason,
  onBack,
  onSaveDraft,
  onSubmit,
  isSubmitting = false,
  submitFailureMessage = null,
}: SalesRepReportFormProps) {
  const [data, setData] = useState<SalesRepReportSections>(initialData)
  const [savedMessage, setSavedMessage] = useState(false)
  // Set only when saveNow/autosave surfaces a lock (REP_STATUS_REGRESSION_BLOCKED)
  // via the isLockedError predicate below — this is a friendlier, persistent
  // message distinct from the transient autosave.status === 'error' indicator.
  const [lockMessage, setLockMessage] = useState<string | null>(null)

  // Autosaves through the SAME onSaveDraft path the manual "Save Draft"
  // button uses below — never a second write implementation. Mirrors
  // ReportForm.tsx's own useAutosave wiring exactly.
  const autosave = useAutosave<SalesRepReportSections>({
    data,
    isEqual: areSalesRepSectionsEqual,
    isLockedError: (err) => err instanceof RepReportError && err.code === 'REP_STATUS_REGRESSION_BLOCKED',
    save: async (toSave) => {
      try {
        await onSaveDraft(toSave)
        setLockMessage(null)
      } catch (err) {
        if (err instanceof RepReportError && err.code === 'REP_STATUS_REGRESSION_BLOCKED') {
          setLockMessage('This report can no longer be edited.')
        }
        throw err
      }
    },
  })

  const clearFeedback = () => {
    setSavedMessage(false)
    autosave.notifyEditStarted()
  }

  const handleBulletsChange = (key: Exclude<keyof SalesRepReportSections, 'managerSupportNeeded'>, bullets: string[]) => {
    setData((prev) => ({ ...prev, [key]: capBullets(bullets, MAX_BULLETS_PER_SECTION) }))
    clearFeedback()
  }

  const handleManagerSupportChange = (value: string) => {
    setData((prev) => ({ ...prev, managerSupportNeeded: value }))
    clearFeedback()
  }

  const handleSave = () => {
    setSavedMessage(true)
    void autosave.saveNow('manual')
  }

  const handleBackClick = async () => {
    const outcome = await autosave.saveNow('back')
    if (outcome === 'success') {
      onBack()
    }
  }

  // Guards the brief async gap before cancelPendingAndAwaitInFlight resolves
  // and isSubmitting has had a chance to re-render as true — mirrors
  // ReportForm.tsx's own submitClickInFlightRef exactly.
  const submitClickInFlightRef = useRef(false)

  const handleSubmitClick = async () => {
    if (isSubmitting || submitClickInFlightRef.current) return
    submitClickInFlightRef.current = true
    try {
      // A background autosave draft write and the submit write both target
      // the same report row — waiting here first guarantees the draft write
      // fully lands before the submit write ever starts, so they can never
      // race each other at the database. See ReportForm.tsx's own
      // handleSubmitClick for the identical pattern.
      await autosave.cancelPendingAndAwaitInFlight()
      onSubmit(data)
    } finally {
      submitClickInFlightRef.current = false
    }
  }

  const submitLabel = isRejectedCorrection ? 'Resubmit' : 'Submit Report'

  return (
    <div className="report-form sales-rep-report-form">
      <button className="link-btn back-link" onClick={handleBackClick}>
        &larr; Back to Dashboard
      </button>

      <div className="report-form-heading">
        {isRejectedCorrection && <span className="submitted-badge rejected-badge">Needs Correction</span>}
        <h1>Weekly Sales Rep Report</h1>
        <p className="report-form-week">
          Week of {weekLabel} &middot; Due {deadlineLabel}
        </p>
      </div>

      {isRejectedCorrection && (
        <div className="rejection-banner" role="alert">
          <p className="rejection-banner-title">Your manager requested changes</p>
          <p className="rejection-banner-reason">
            {rejectionReason || 'No reason was provided.'}
          </p>
          <p className="rejection-banner-helper">
            Update your report below, then resubmit for review.
          </p>
        </div>
      )}

      {isPastDeadline && (
        <p className="deadline-passed-notice">
          The submission deadline for this week has passed. You can still save a draft, but submitting requires an
          admin-authorized exception. If one has already been granted, go ahead and submit below.
        </p>
      )}

      {BULLET_SECTIONS.map((section) => (
        <div className="report-section" key={section.key}>
          <div className="report-section-header">
            <label className="report-section-label" htmlFor={`${section.idPrefix}-0`}>
              {section.title}
            </label>
            <span className="report-section-context">
              Up to {MAX_BULLETS_PER_SECTION}
            </span>
          </div>
          <p className="report-section-helper">{section.helper}</p>
          <BulletListInput
            idPrefix={section.idPrefix}
            bullets={data[section.key]}
            onChange={(bullets) => handleBulletsChange(section.key, bullets)}
            max={MAX_BULLETS_PER_SECTION}
          />
        </div>
      ))}

      <div className="report-section">
        <div className="report-section-header">
          <label className="report-section-label" htmlFor="rep-manager-support-needed">
            Manager Support Needed
          </label>
        </div>
        <p className="report-section-helper">
          Anything you need help with from your manager — decisions, resources, introductions, etc. Optional.
        </p>
        <textarea
          id="rep-manager-support-needed"
          className="report-textarea"
          rows={4}
          value={data.managerSupportNeeded}
          onChange={(e) => handleManagerSupportChange(e.target.value)}
          placeholder="Type here... (optional)"
        />
      </div>

      {lockMessage && <p className="voice-error-message report-lock-message">{lockMessage}</p>}
      {submitFailureMessage && <p className="voice-error-message report-lock-message">{submitFailureMessage}</p>}

      <div className="report-form-actions">
        {savedMessage && <span className="saved-message">Draft saved</span>}
        {!savedMessage && autosave.status === 'saving' && <span className="autosave-status">Saving&hellip;</span>}
        {!savedMessage && autosave.status === 'saved' && <span className="autosave-status autosave-status-saved">Saved</span>}
        {!savedMessage && autosave.status === 'error' && (
          <span className="autosave-status autosave-status-error">Couldn&apos;t save automatically — your changes are still here.</span>
        )}
        <button className="btn btn-secondary" onClick={handleSave} disabled={isSubmitting}>
          Save Draft
        </button>
        <button className="btn btn-primary" onClick={handleSubmitClick} disabled={isSubmitting}>
          {isSubmitting ? 'Submitting…' : submitLabel}
        </button>
      </div>
    </div>
  )
}
