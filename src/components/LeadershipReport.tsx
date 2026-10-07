import { useState } from 'react'
import type { ReportingWeek } from '../utils/week'
import LeadershipReportCurrent from './LeadershipReportCurrent'
import LeadershipReportHistory from './LeadershipReportHistory'
import ConfirmDialog from './ConfirmDialog'
import './LeadershipReport.css'

interface LeadershipReportProps {
  week: ReportingWeek
  isCurrentWeek: boolean
  onPreviousWeek: () => void
  onNextWeek: () => void
  // Relayed all the way up to App.tsx (via LeadershipReportGate) so a
  // sidebar navigation away from Leadership Report can warn before
  // discarding unsaved Current-tab edits. History has no dirty state of
  // its own to report — see handleSwitchToHistory below.
  onDirtyChange: (isDirty: boolean) => void
}

type TopView = 'current' | 'history'

// Thin shell: title + the Current/History switch this private workspace
// exposes once unlocked (the password gate itself lives one level up, in
// LeadershipReportGate.tsx, and is unaffected by anything in this file —
// switching between Current and History never re-locks the workspace).
// Each sub-view owns its own week navigation and data; this file holds no
// Leadership Report content/fetch logic of its own.
export default function LeadershipReport({ week, isCurrentWeek, onPreviousWeek, onNextWeek, onDirtyChange }: LeadershipReportProps) {
  const [view, setView] = useState<TopView>('current')
  // Reported up by LeadershipReportCurrent — switching to History unmounts
  // it (and its in-memory draft), so an unsaved edit must be confirmed
  // first, exactly like changing weeks already is inside Current itself.
  const [currentIsDirty, setCurrentIsDirty] = useState(false)

  // Every change Current reports is also relayed to the parent (App.tsx,
  // via LeadershipReportGate) — this is the one seam that lets a sidebar
  // navigation away from Leadership Report reuse the exact same dirty
  // signal Current already computes, rather than a second, duplicate
  // tracking mechanism.
  const handleCurrentDirtyChange = (isDirty: boolean) => {
    setCurrentIsDirty(isDirty)
    onDirtyChange(isDirty)
  }

  // Deferred "pending action" + rendered <ConfirmDialog>, not
  // window.confirm() — confirmed directly that the native dialog silently
  // resolves to false with no visible UI in the preview environment used
  // for this app's manual QA, so it cannot satisfy "a visible confirmation
  // must appear." currentIsDirty itself is unchanged.
  const [historySwitchPending, setHistorySwitchPending] = useState(false)

  const switchToHistory = () => {
    // History has no unsaved state of its own (read-only) — nothing is
    // dirty once Current is no longer even mounted.
    onDirtyChange(false)
    setView('history')
  }

  const handleSwitchToHistory = () => {
    if (!currentIsDirty) {
      switchToHistory()
      return
    }
    setHistorySwitchPending(true)
  }

  return (
    <div className="leadership-report-page">
      {historySwitchPending && (
        <ConfirmDialog
          message="You have unsaved changes. If you continue, those changes will be lost. Continue?"
          onConfirm={() => {
            setHistorySwitchPending(false)
            switchToHistory()
          }}
          onCancel={() => setHistorySwitchPending(false)}
        />
      )}

      <div className="lr-header">
        <div className="lr-header-titles">
          <h1>Leadership Report</h1>
          <p className="lr-header-subtitle">Review the Present Week Summary source and prepare the final leadership report.</p>
        </div>

        <div className="lr-view-switch" role="tablist" aria-label="Leadership Report view">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'current'}
            className={`lr-view-tab ${view === 'current' ? 'lr-view-tab-active' : ''}`}
            onClick={() => setView('current')}
          >
            Current
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'history'}
            className={`lr-view-tab ${view === 'history' ? 'lr-view-tab-active' : ''}`}
            onClick={handleSwitchToHistory}
          >
            History
          </button>
        </div>
      </div>

      {view === 'current' ? (
        <LeadershipReportCurrent
          week={week}
          isCurrentWeek={isCurrentWeek}
          onPreviousWeek={onPreviousWeek}
          onNextWeek={onNextWeek}
          onDirtyChange={handleCurrentDirtyChange}
        />
      ) : (
        <LeadershipReportHistory />
      )}
    </div>
  )
}
