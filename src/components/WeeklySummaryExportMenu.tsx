import { useEffect, useState } from 'react'
import './WeeklySummaryExportMenu.css'

interface WeeklySummaryExportMenuProps {
  onCompleteWeeklySummary: () => void
  onExecutiveAnalysisOnly: () => void
}

// Weekly-Summary-only replacement for the old separate top "Print / Export
// PDF" button and Executive Analysis' own standalone "Print Executive
// Analysis" button — consolidated into one compact top-right control.
// Visually mirrors Reports & Analytics' ExportPrintMenu (anchored popover,
// same white-panel look) but is its own, separate component: RA's own
// ExportPrintMenu.tsx is untouched, and this one only ever offers the two
// choices this page needs, with no manager-selection step.
export default function WeeklySummaryExportMenu({
  onCompleteWeeklySummary,
  onExecutiveAnalysisOnly,
}: WeeklySummaryExportMenuProps) {
  const [isOpen, setIsOpen] = useState(false)

  const closeMenu = () => setIsOpen(false)

  const handleSelect = (action: () => void) => {
    action()
    closeMenu()
  }

  // Escape closes the menu — the same "close on outside interaction"
  // convention the click-outside scrim already provides, extended to the
  // keyboard. Only listens while the menu is actually open.
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  return (
    <div className="ws-export-anchor">
      <button type="button" className="btn btn-primary no-print" onClick={() => setIsOpen(true)}>
        Export / Print &#9662;
      </button>

      {isOpen && (
        <>
          {/* no-print here is a hard CSS guarantee independent of React
              state — see ExportPrintMenu.tsx's own equivalent comment and
              the earlier fix it required: closeMenu() runs before the
              print action for UX, but window.print() can render before
              that state update flushes, so the scrim/panel must never be
              printable regardless of whether the menu has actually
              unmounted yet. */}
          <div className="ws-export-scrim no-print" onClick={closeMenu} />
          <div className="ws-export-panel no-print" role="menu" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="ws-export-option"
              role="menuitem"
              onClick={() => handleSelect(onCompleteWeeklySummary)}
            >
              <span className="ws-export-option-label">Complete Weekly Summary</span>
              <span className="ws-export-option-description">
                Letterhead, full Executive Analysis, and every submitted manager report.
              </span>
            </button>
            <button
              type="button"
              className="ws-export-option"
              role="menuitem"
              onClick={() => handleSelect(onExecutiveAnalysisOnly)}
            >
              <span className="ws-export-option-label">Executive Analysis only</span>
              <span className="ws-export-option-description">Just the letterhead and full Executive Analysis.</span>
            </button>
          </div>
        </>
      )}
    </div>
  )
}
