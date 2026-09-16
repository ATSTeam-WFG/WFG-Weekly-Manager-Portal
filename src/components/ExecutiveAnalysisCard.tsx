import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fetchPeriodReportStats } from '../lib/reportsAnalyticsService'
import { computeSourceFingerprint } from '../lib/executiveAnalysisFingerprint'
import {
  generateReportingAnalysis,
  fetchPersistedAnalysis,
  saveEditedAnalysis,
  revertToOriginal,
  ExecutiveSummaryError,
  REPORTING_ANALYSIS_SECTIONS,
  type PersistedExecutiveAnalysis,
  type ReportingAnalysisSections,
} from '../lib/executiveSummaryService'
import type { ReportPeriodKey } from '../utils/reportPeriods'
import './ExecutiveAnalysisCard.css'

type Mode = 'view' | 'edit'
type ActionStatus = 'idle' | 'generating' | 'saving' | 'reverting'

// Toggled on <body> only for the duration of an Executive-Analysis-only
// print/export — src/print.css hides every other section on the page while
// this class is present, leaving only .print-header (WFG branding + the
// reporting week/date) and this card's own .executive-summary-section
// (heading, badge, and the current saved content) visible. The page-level
// "Print / Export PDF" buttons in ReportsAnalytics.tsx/WeeklySummary.tsx
// never touch this class and are completely unaffected.
const PRINT_EXECUTIVE_ANALYSIS_ONLY_CLASS = 'print-executive-analysis-only'

// Safety-net only: 'afterprint' fires reliably in every browser this app
// targets and is what actually removes the class in the normal case (both
// on a completed print and on a canceled dialog). This timeout exists
// solely so a browser/print flow that somehow never fires 'afterprint'
// can't leave the whole app permanently stuck showing only the Executive
// Analysis — it's long enough to never interrupt a real print dialog still
// open, and the cleanup itself is idempotent (safe to run twice).
const PRINT_MODE_FALLBACK_MS = 60_000

// Isolates printing to just this card (plus the shared page letterhead) by
// toggling a body-level class around the existing native window.print() —
// never a second print mechanism, never touching the page-level Print /
// Export PDF buttons. Reachable regardless of view/edit mode: printing
// while editing is harmless, since the already-existing
// .executive-summary-content--print-only rule (below) guarantees the
// LAST-SAVED content is what actually renders for print either way.
function printExecutiveAnalysisOnly(): void {
  document.body.classList.add(PRINT_EXECUTIVE_ANALYSIS_ONLY_CLASS)

  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    document.body.classList.remove(PRINT_EXECUTIVE_ANALYSIS_ONLY_CLASS)
    window.removeEventListener('afterprint', cleanup)
  }

  window.addEventListener('afterprint', cleanup)
  window.setTimeout(cleanup, PRINT_MODE_FALLBACK_MS)
  window.print()
}

interface ExecutiveAnalysisCardProps {
  periodKey: ReportPeriodKey
  offset: number
  weekStartDates: string[]
  periodStartDate: string
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// The single shared AI-analysis card used by both Weekly Summary and Reports
// & Analytics, so the persisted analysis for a given period is read, edited,
// reverted, and regenerated through exactly one implementation — never a
// second, independently-maintained copy of this logic.
export default function ExecutiveAnalysisCard({ periodKey, offset, weekStartDates, periodStartDate }: ExecutiveAnalysisCardProps) {
  const [loading, setLoading] = useState(true)
  const [hasSubmissions, setHasSubmissions] = useState(false)
  const [analysis, setAnalysis] = useState<PersistedExecutiveAnalysis | null>(null)
  const [isStale, setIsStale] = useState(false)

  const [mode, setMode] = useState<Mode>('view')
  const [editedSections, setEditedSections] = useState<ReportingAnalysisSections | null>(null)
  const [actionStatus, setActionStatus] = useState<ActionStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setMode('view')
    setEditedSections(null)
    setError(null)
    setShowRegenerateConfirm(false)

    async function load() {
      const [stats, persisted] = await Promise.all([
        fetchPeriodReportStats(supabase, weekStartDates),
        fetchPersistedAnalysis(periodKey, periodStartDate),
      ])
      if (!active) return

      setHasSubmissions(stats.entries.length > 0)
      setAnalysis(persisted)

      if (persisted) {
        const currentFingerprint = await computeSourceFingerprint(stats.entries)
        if (!active) return
        setIsStale(currentFingerprint !== persisted.sourceFingerprint)
      } else {
        setIsStale(false)
      }

      setLoading(false)
    }

    load()

    return () => {
      active = false
    }
  }, [periodKey, periodStartDate, weekStartDates])

  const handleGenerate = async () => {
    setActionStatus('generating')
    setError(null)
    try {
      const result = await generateReportingAnalysis(periodKey, offset)
      setAnalysis(result)
      setIsStale(false)
      setMode('view')
    } catch (err) {
      setError(err instanceof ExecutiveSummaryError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setActionStatus('idle')
    }
  }

  const runRegenerate = async (confirmOverwrite: boolean) => {
    setActionStatus('generating')
    setError(null)
    setShowRegenerateConfirm(false)
    try {
      const result = await generateReportingAnalysis(periodKey, offset, confirmOverwrite)
      setAnalysis(result)
      setIsStale(false)
      setMode('view')
    } catch (err) {
      if (err instanceof ExecutiveSummaryError && err.code === 'EDITED_VERSION_EXISTS') {
        // The server independently refused too — not just relying on the
        // client-side check below. Surface the same confirmation either way.
        setShowRegenerateConfirm(true)
      } else {
        setError(err instanceof ExecutiveSummaryError ? err.message : 'Something went wrong. Please try again.')
      }
    } finally {
      setActionStatus('idle')
    }
  }

  const handleRegenerateClick = () => {
    if (analysis?.isEdited) {
      setShowRegenerateConfirm(true)
      return
    }
    void runRegenerate(false)
  }

  const handleEditClick = () => {
    if (!analysis) return
    setEditedSections(analysis.sections)
    setMode('edit')
    setError(null)
  }

  const handleCancelEdit = () => {
    setMode('view')
    setEditedSections(null)
    setError(null)
  }

  const handleSectionChange = (key: keyof ReportingAnalysisSections, value: string) => {
    setEditedSections((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  const handleSaveChanges = async () => {
    if (!analysis || !editedSections) return
    setActionStatus('saving')
    setError(null)
    try {
      const result = await saveEditedAnalysis(analysis.id, editedSections)
      setAnalysis(result)
      setIsStale(false)
      setMode('view')
      setEditedSections(null)
    } catch (err) {
      setError(err instanceof ExecutiveSummaryError ? err.message : 'Could not save your changes. Please try again.')
    } finally {
      setActionStatus('idle')
    }
  }

  const handleRevert = async () => {
    if (!analysis) return
    setActionStatus('reverting')
    setError(null)
    try {
      const result = await revertToOriginal(analysis.id)
      setAnalysis(result)
    } catch (err) {
      setError(err instanceof ExecutiveSummaryError ? err.message : 'Could not revert. Please try again.')
    } finally {
      setActionStatus('idle')
    }
  }

  const busy = actionStatus !== 'idle'

  return (
    <div className="executive-summary-section">
      <div className="executive-summary-header no-print">
        <h2>AI Executive Analysis</h2>
        <div className="executive-summary-actions">
          {analysis && mode === 'view' && (
            <button type="button" className="btn btn-secondary" onClick={handleEditClick} disabled={busy}>
              Edit Analysis
            </button>
          )}
          {analysis && analysis.isEdited && mode === 'view' && (
            <button type="button" className="btn btn-secondary" onClick={handleRevert} disabled={busy}>
              {actionStatus === 'reverting' ? 'Reverting…' : 'Revert to Original AI'}
            </button>
          )}
          {mode === 'view' && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={analysis ? handleRegenerateClick : handleGenerate}
              disabled={!hasSubmissions || busy}
            >
              {actionStatus === 'generating' ? 'Generating…' : analysis ? 'Regenerate' : 'Generate AI Analysis'}
            </button>
          )}
          {analysis && (
            <button type="button" className="btn btn-secondary" onClick={printExecutiveAnalysisOnly} disabled={busy}>
              Print Executive Analysis
            </button>
          )}
        </div>
      </div>

      <div className="no-print">
        {!hasSubmissions && (
          <p className="executive-summary-status">No submitted reports for this period yet — nothing to analyze.</p>
        )}
        {hasSubmissions && !loading && !analysis && mode === 'view' && (
          <p className="executive-summary-status">Click Generate to create an AI-assisted analysis of this period&apos;s submitted reports.</p>
        )}
        {error && <p className="executive-summary-status executive-summary-error">{error}</p>}
        {isStale && mode === 'view' && !error && (
          <p className="executive-summary-stale-notice">
            This analysis may be outdated — the underlying submitted reports have changed since it was generated. Consider
            regenerating.
          </p>
        )}
        {showRegenerateConfirm && (
          <div className="executive-summary-confirm">
            <p>
              Regenerating will replace the saved manual edits with a new AI-generated version. The current version is kept
              in history, but this analysis card will show the new content going forward. Continue?
            </p>
            <div className="executive-summary-confirm-actions">
              <button type="button" className="btn btn-primary" onClick={() => runRegenerate(true)} disabled={busy}>
                Regenerate Anyway
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setShowRegenerateConfirm(false)} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {analysis && (
        <>
          {/* Always rendered, even while editing — print must always reflect
              the last-SAVED sections, never an in-progress unsaved edit.
              Hidden on-screen while editing via the print-only class below,
              but still present in the DOM for printing. */}
          <div
            className={`executive-summary-content ${mode === 'edit' ? 'executive-summary-content--print-only' : ''}`}
          >
            <span className="ai-generated-badge">
              AI-Generated Analysis · {analysis.periodLabel}
              {analysis.isEdited ? ' · Edited' : ''}
            </span>
            <p className="executive-summary-provenance no-print">
              Generated {formatDate(analysis.generatedAt)}
              {analysis.isEdited && analysis.editedAt ? ` · Edited ${formatDate(analysis.editedAt)}` : ''}
            </p>
            {REPORTING_ANALYSIS_SECTIONS.map((section) => (
              <div className="executive-summary-block" key={section.key}>
                <h3>{section.title}</h3>
                <p className="report-readonly-text">{analysis.sections[section.key]}</p>
              </div>
            ))}
          </div>

          {mode === 'edit' && editedSections && (
            <div className="executive-summary-content executive-summary-edit-form no-print">
              <span className="ai-generated-badge">Editing Analysis</span>
              {REPORTING_ANALYSIS_SECTIONS.map((section) => (
                <div className="executive-summary-block" key={section.key}>
                  <h3>{section.title}</h3>
                  <textarea
                    className="executive-summary-edit-textarea"
                    value={editedSections[section.key]}
                    onChange={(e) => handleSectionChange(section.key, e.target.value)}
                    rows={4}
                  />
                </div>
              ))}
              <div className="executive-summary-edit-actions">
                <button type="button" className="btn btn-primary" onClick={handleSaveChanges} disabled={busy}>
                  {actionStatus === 'saving' ? 'Saving…' : 'Save Changes'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={handleCancelEdit} disabled={busy}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
