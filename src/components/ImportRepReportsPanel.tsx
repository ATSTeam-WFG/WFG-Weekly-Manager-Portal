import { useEffect, useRef, useState } from 'react'
import {
  fetchApprovedRepReportsForWeek,
  importRepReportForConsolidation,
  ManagerConsolidationError,
  type ApprovedRepReportForConsolidation,
  type SalesRepReportFieldKey,
} from '../lib/managerConsolidationService'
import {
  CONSOLIDATION_FIELD_LABELS,
  fieldHasContent,
  formatRepBlock,
  newFieldBlocksForSelection,
} from '../lib/repReportConsolidationMerge'
import './ImportRepReportsPanel.css'

interface ImportRepReportsPanelProps {
  isOpen: boolean
  weekStartDate: string
  // The manager's CURRENT otherNotableItems value — i.e. ReportForm's own
  // `data.otherNotableItems`, not the last-saved value. This is the single
  // source of truth this panel checks against to decide what is genuinely
  // NEW to add, rather than relying on the import ledger (a permanent audit
  // record, not proof that the manager's report was ever actually saved —
  // see the migration's own table comment). Passing the live, in-memory
  // value (not a stale prop captured once) means: a double-apply within the
  // same session is caught (the text is already there); and a retry after a
  // FAILED save is still allowed (after a reload, the freshly-loaded
  // initialData won't contain text that never actually persisted, so
  // re-importing correctly proceeds instead of being wrongly blocked by a
  // ledger row from the failed attempt).
  currentOtherNotableItems: string
  onClose: () => void
  // Called at most once per Apply click, and only when there is at least
  // one genuinely NEW field block to add (see handleApply, and
  // repReportConsolidationMerge.ts's newFieldBlocksForSelection, the actual
  // duplicate-prevention decision) — ReportForm appends this to its own
  // otherNotableItems exactly the way a voice-dictation transcript is
  // already appended there (see ReportForm.tsx's handleVoiceResult), never
  // replacing whatever the manager already wrote.
  onApply: (text: string) => void
}

// A stable per-rep-report selection key (repReportId -> set of checked
// fields) — not persisted, purely local UI state for this one panel visit.
type Selection = Record<string, Set<SalesRepReportFieldKey>>

export default function ImportRepReportsPanel({
  isOpen,
  weekStartDate,
  currentOtherNotableItems,
  onClose,
  onApply,
}: ImportRepReportsPanelProps) {
  const [reports, setReports] = useState<ApprovedRepReportForConsolidation[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [selection, setSelection] = useState<Selection>({})
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const applyInFlightRef = useRef(false)

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    setReports(null)
    setLoadError(false)
    setSelection({})
    setApplyError(null)
    fetchApprovedRepReportsForWeek(weekStartDate)
      .then((result) => {
        if (!cancelled) setReports(result)
      })
      .catch(() => {
        if (!cancelled) setLoadError(true)
      })
    return () => {
      cancelled = true
    }
  }, [isOpen, weekStartDate])

  if (!isOpen) return null

  const toggleField = (repReportId: string, field: SalesRepReportFieldKey) => {
    setSelection((prev) => {
      const current = new Set(prev[repReportId] ?? [])
      if (current.has(field)) current.delete(field)
      else current.add(field)
      return { ...prev, [repReportId]: current }
    })
  }

  const anySelected = Object.values(selection).some((set) => set.size > 0)

  // The field-level text block is the unit duplicate-checking works at (see
  // newFieldBlocksForSelection) — never the whole combined preview, and
  // never per-rep — so that adding ONE more field from a rep whose OTHER
  // fields were already applied earlier still works correctly: only the
  // genuinely new field is added, the already-present one is silently left
  // alone rather than re-added alongside itself.
  const previewBlocks: string[] = []
  let anyAlreadyApplied = false
  for (const report of reports ?? []) {
    const fields = selection[report.repReportId]
    if (!fields || fields.size === 0) continue
    const newBlocks = newFieldBlocksForSelection(report.content, fields, currentOtherNotableItems)
    if (newBlocks.length < fields.size) anyAlreadyApplied = true
    if (newBlocks.length === 0) continue
    previewBlocks.push(formatRepBlock(report.repName, newBlocks))
  }
  const previewText = previewBlocks.join('\n\n')

  const handleApply = async () => {
    if (applying || applyInFlightRef.current || !anySelected) return
    applyInFlightRef.current = true
    setApplying(true)
    setApplyError(null)
    try {
      const repBlocks: string[] = []
      for (const report of reports ?? []) {
        const fields = selection[report.repReportId]
        if (!fields || fields.size === 0) continue
        // Always recorded for the full audit trail of what the manager
        // chose, regardless of whether any of it turns out to be new text —
        // the ledger is a permanent record of the action, never conflated
        // with whether the report's own content changed as a result.
        await importRepReportForConsolidation(report.repReportId, weekStartDate, [...fields])
        const newBlocks = newFieldBlocksForSelection(report.content, fields, currentOtherNotableItems)
        if (newBlocks.length > 0) repBlocks.push(formatRepBlock(report.repName, newBlocks))
      }

      if (repBlocks.length === 0) {
        setApplyError('This content is already in your report — nothing new to add.')
        return
      }

      onApply(repBlocks.join('\n\n'))
      onClose()
    } catch (err) {
      if (err instanceof ManagerConsolidationError) {
        setApplyError(err.message)
      } else {
        setApplyError('Something went wrong importing this content. Please try again.')
      }
    } finally {
      applyInFlightRef.current = false
      setApplying(false)
    }
  }

  return (
    <div className="irp-overlay" onClick={onClose}>
      <div className="irp-panel" onClick={(e) => e.stopPropagation()}>
        <div className="irp-header">
          <h2>Import from Sales Reps</h2>
          <button type="button" className="irp-close-btn" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        <p className="irp-helper">
          Only your currently assigned reps&apos; APPROVED reports for this week appear here. Choose what to pull into
          &quot;Other Notable Items&quot; — nothing is applied until you click Apply, and your own content is never
          overwritten.
        </p>

        {reports === null && !loadError && <p className="irp-status">Loading approved reports…</p>}
        {loadError && <p className="irp-status irp-status-error">Couldn&apos;t load approved reports. Please try again.</p>}
        {reports !== null && reports.length === 0 && <p className="irp-status">No approved sales rep reports for this week yet.</p>}

        {reports !== null && reports.length > 0 && (
          <div className="irp-rep-list">
            {reports.map((report) => (
              <div className="irp-rep-card" key={report.repReportId}>
                <p className="irp-rep-name">{report.repName}</p>
                <div className="irp-field-grid">
                  {CONSOLIDATION_FIELD_LABELS.map((f) => {
                    const hasContent = fieldHasContent(report.content, f.key)
                    return (
                      <label key={f.key} className={`irp-field-checkbox ${hasContent ? '' : 'irp-field-checkbox-empty'}`}>
                        <input
                          type="checkbox"
                          disabled={!hasContent}
                          checked={selection[report.repReportId]?.has(f.key) ?? false}
                          onChange={() => toggleField(report.repReportId, f.key)}
                        />
                        {f.label}
                      </label>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {anySelected && previewText && (
          <div className="irp-preview">
            <p className="irp-preview-label">Preview — will be added to Other Notable Items</p>
            <pre className="irp-preview-text">{previewText}</pre>
            {anyAlreadyApplied && (
              <p className="irp-status">Some selected content is already in your report and won&apos;t be added again.</p>
            )}
          </div>
        )}

        {anySelected && !previewText && (
          <p className="irp-status">Everything selected is already in your report — nothing new to add.</p>
        )}

        {applyError && <p className="irp-status irp-status-error">{applyError}</p>}

        <div className="irp-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={applying}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={handleApply} disabled={!anySelected || applying}>
            {applying ? 'Applying…' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  )
}
