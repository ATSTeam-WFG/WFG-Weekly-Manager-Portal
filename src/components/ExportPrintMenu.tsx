import { useState } from 'react'
import './ExportPrintMenu.css'

export type ExportChoice = 'executive-analysis' | 'weekly-summary' | 'manager-reports' | 'complete'

interface ExportManagerOption {
  id: string
  name: string
}

interface ExportPrintMenuProps {
  managers: ExportManagerOption[]
  // "Weekly Summary only" is the existing weekly-summary artifact — only
  // meaningful when the page is currently showing weekly data (see
  // ReportsAnalytics.tsx). Disabled (not hidden) otherwise, with a note
  // explaining why, rather than silently switching the selected period.
  weeklySummaryAvailable: boolean
  onExecutiveAnalysisOnly: () => void
  onWeeklySummaryOnly: () => void
  onManagerReportsOnly: (selectedManagerIds: string[]) => void
  onCompleteLeadershipReport: () => void
}

const CHOICES: { key: ExportChoice; label: string; description: string }[] = [
  { key: 'executive-analysis', label: 'Executive Analysis only', description: 'Just the AI-generated analysis for this period.' },
  { key: 'weekly-summary', label: 'Weekly Summary only', description: 'Stats and every submitted manager report for the current week.' },
  { key: 'manager-reports', label: 'Manager Reports only', description: 'Choose which managers’ reports to include.' },
  { key: 'complete', label: 'Complete Leadership Report', description: 'Everything currently shown for this period.' },
]

// One unified control replacing the separate page-level "Print / Export
// PDF" button — still native window.print() + CSS print scoping under the
// hood (see the on*Only callbacks this is wired to in ReportsAnalytics.tsx),
// never a new print mechanism or PDF library. This component owns only the
// choice/selection UI; the actual print-triggering logic lives with its
// callers.
export default function ExportPrintMenu({
  managers,
  weeklySummaryAvailable,
  onExecutiveAnalysisOnly,
  onWeeklySummaryOnly,
  onManagerReportsOnly,
  onCompleteLeadershipReport,
}: ExportPrintMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [choice, setChoice] = useState<ExportChoice>('complete')
  const [selectedManagerIds, setSelectedManagerIds] = useState<Set<string>>(() => new Set(managers.map((m) => m.id)))
  const [managerSearch, setManagerSearch] = useState('')

  const openMenu = () => {
    setChoice('complete')
    setSelectedManagerIds(new Set(managers.map((m) => m.id)))
    setManagerSearch('')
    setIsOpen(true)
  }

  const closeMenu = () => setIsOpen(false)

  const handleChoiceSelect = (key: ExportChoice) => {
    if (key === 'weekly-summary' && !weeklySummaryAvailable) return
    setChoice(key)
  }

  const toggleManager = (id: string) => {
    setSelectedManagerIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    setSelectedManagerIds((prev) => (prev.size === managers.length ? new Set() : new Set(managers.map((m) => m.id))))
  }

  const handlePrint = () => {
    if (choice === 'executive-analysis') onExecutiveAnalysisOnly()
    else if (choice === 'weekly-summary') onWeeklySummaryOnly()
    else if (choice === 'manager-reports') onManagerReportsOnly(Array.from(selectedManagerIds))
    else onCompleteLeadershipReport()
    closeMenu()
  }

  const visibleManagers = managers.filter((m) => m.name.toLowerCase().includes(managerSearch.trim().toLowerCase()))
  const printDisabled = choice === 'manager-reports' && selectedManagerIds.size === 0

  // An anchored popover under the trigger button (not a centered modal) —
  // a transparent, full-screen "scrim" still catches an outside click to
  // close it (same closeMenu as before), it just isn't visibly dimmed.
  return (
    <div className="export-print-anchor">
      <button type="button" className="btn btn-primary no-print" onClick={openMenu}>
        Export / Print &#9662;
      </button>

      {isOpen && (
        <>
          {/* no-print here is a hard CSS guarantee, independent of React
              state: closeMenu() runs before window.print() for UX, but
              window.print() can render synchronously before that state
              update flushes, so the panel/scrim must never be printable
              regardless of whether the modal has actually unmounted yet. */}
          <div className="export-print-scrim no-print" onClick={closeMenu} />
          <div className="export-print-panel no-print" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="export-print-header">
              <h2>Export / Print</h2>
              <button type="button" className="export-print-close-btn" onClick={closeMenu} aria-label="Close">
                &times;
              </button>
            </div>

            <div className="export-print-body">
              <div className="export-print-choices" role="radiogroup" aria-label="What to export">
                {CHOICES.map((option) => {
                  const disabled = option.key === 'weekly-summary' && !weeklySummaryAvailable
                  return (
                    <label
                      key={option.key}
                      className={`export-print-choice ${choice === option.key ? 'export-print-choice-selected' : ''} ${disabled ? 'export-print-choice-disabled' : ''}`}
                    >
                      <input
                        type="radio"
                        name="export-print-choice"
                        checked={choice === option.key}
                        disabled={disabled}
                        onChange={() => handleChoiceSelect(option.key)}
                      />
                      <span className="export-print-choice-text">
                        <span className="export-print-choice-label">{option.label}</span>
                        <span className="export-print-choice-description">
                          {disabled ? 'Available when the Weekly period is selected.' : option.description}
                        </span>
                      </span>
                    </label>
                  )
                })}
              </div>

              {choice === 'manager-reports' && (
                <div className="export-print-manager-select">
                  <div className="export-print-manager-select-header">
                    <label className="export-print-select-all">
                      <input
                        type="checkbox"
                        checked={managers.length > 0 && selectedManagerIds.size === managers.length}
                        onChange={toggleSelectAll}
                      />
                      Select All
                    </label>
                    {managers.length > 6 && (
                      <input
                        type="search"
                        className="export-print-manager-search"
                        placeholder="Search managers…"
                        value={managerSearch}
                        onChange={(e) => setManagerSearch(e.target.value)}
                        aria-label="Search managers to export"
                      />
                    )}
                  </div>
                  <div className="export-print-manager-list">
                    {visibleManagers.length === 0 ? (
                      <p className="export-print-manager-empty">No managers match this search.</p>
                    ) : (
                      visibleManagers.map((m) => (
                        <label className="export-print-manager-option" key={m.id}>
                          <input type="checkbox" checked={selectedManagerIds.has(m.id)} onChange={() => toggleManager(m.id)} />
                          {m.name}
                        </label>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="export-print-footer">
              <button type="button" className="btn btn-secondary" onClick={closeMenu}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={handlePrint} disabled={printDisabled}>
                Print / Save PDF
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
