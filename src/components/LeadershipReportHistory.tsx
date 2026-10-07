import { useEffect, useState } from 'react'
import wfgLogo from '../assets/wfg-logo.png'
import { fetchLeadershipReportDraft, type LeadershipReportDraft } from '../lib/leadershipReportDraftService'
import { isLeadershipReportContent } from '../lib/leadershipReportContent'
import type { AtsReport } from '../lib/atsReport'
import { getReportingWeekByOffset } from '../utils/week'
import AtsReportView from './AtsReportView'
import LeadershipReportFormView from './LeadershipReportFormView'
import { printWithScopedClass } from './LeadershipReportCurrent'
import './LeadershipReport.css'

// Reuses the exact same toggle-body-class-around-window.print() mechanism
// as LeadershipReportCurrent.tsx's ATS/draft/previous print actions (see
// printWithScopedClass there, imported directly rather than reimplemented)
// — its own dedicated class keeps History's print isolation independent of
// Current's three targets.
const PRINT_LR_HISTORY_ONLY_CLASS = 'print-lr-history-only'

function printLeadershipReportHistoryOnly(): void {
  printWithScopedClass(PRINT_LR_HISTORY_ONLY_CLASS)
}

// A private, read-only browser of the CURRENT caller's own saved Leadership
// Reports — reuses fetchLeadershipReportDraft exactly as-is (the same
// function My Leadership Report already uses to load the current week's
// saved draft): it takes only a period_start_date and relies entirely on
// existing RLS (owner_id = auth.uid()) to scope every result to the caller.
// No new table, RPC, or RLS policy — an arbitrary historical week is no
// different from "the current week" as far as this read is concerned. No
// owner_id parameter exists here or anywhere in the function it calls, so
// this view structurally cannot be redirected to another owner's history.
//
// Deliberately independent of both the Current tab's week (a separate,
// unsaved editing context) and Admin Dashboard/Weekly Summary's own week
// state — browsing history is its own task with its own cursor.
export default function LeadershipReportHistory() {
  const [weekOffset, setWeekOffset] = useState(0)
  const week = getReportingWeekByOffset(weekOffset)
  const isCurrentWeek = weekOffset === 0

  const [loading, setLoading] = useState(true)
  const [savedDraft, setSavedDraft] = useState<LeadershipReportDraft | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)

    fetchLeadershipReportDraft(week.weekStartDate).then((draft) => {
      if (!active) return
      setSavedDraft(draft)
      setLoading(false)
    })

    return () => {
      active = false
    }
  }, [week.weekStartDate])

  return (
    <div className="lr-history">
      {/* Print-only letterhead — logo only, identical convention to
          LeadershipReportCurrent.tsx (AtsReportView's own heading below
          supplies the report title and week). Unconditionally
          display:none outside @media print (LeadershipReport.css). */}
      <div className="print-header">
        <img src={wfgLogo} alt="WFG" className="print-logo" />
      </div>

      <div className="lr-week-nav">
        <button
          type="button"
          className="lr-week-nav-btn"
          onClick={() => setWeekOffset((offset) => offset - 1)}
          aria-label="Previous reporting week"
        >
          &lsaquo; Previous
        </button>
        <span className="lr-week-label">
          Week of {week.label}
          {isCurrentWeek && <span className="week-current-badge">Current</span>}
        </span>
        <button
          type="button"
          className="lr-week-nav-btn"
          onClick={() => setWeekOffset((offset) => Math.min(0, offset + 1))}
          disabled={isCurrentWeek}
          aria-label="Next reporting week"
        >
          Next &rsaquo;
        </button>
      </div>

      <div className="lr-pane lr-pane-history">
        <div className="lr-pane-header">
          <div>
            <h2>My Leadership Report History</h2>
            <p className="lr-pane-subtitle">Read-only</p>
          </div>
          {/* Rendered only when a saved report exists for the selected
              historical week — never a disabled placeholder, so an empty
              week can never expose a misleading print action. Prints the
              always-mounted .lr-print-history-only mirror below, wired
              directly to savedDraft — the selected week's actual saved
              content, never re-derived or re-fetched for print. */}
          {savedDraft && (
            <button
              type="button"
              className="btn btn-secondary no-print"
              onClick={printLeadershipReportHistoryOnly}
              title="Print or save this saved Leadership Report as PDF"
            >
              Print / Download Report
            </button>
          )}
        </div>

        <div className="lr-pane-body">
          {loading ? (
            <div className="admin-loading">Loading…</div>
          ) : !savedDraft ? (
            // Never substitutes the ATS source or any other content — an
            // absent saved report for this week means exactly that.
            <div className="lr-empty-state">
              <p>No saved Leadership Report for this week.</p>
            </div>
          ) : isLeadershipReportContent(savedDraft.content) ? (
            <LeadershipReportFormView content={savedDraft.content} />
          ) : (
            // Legacy (pre-rebuild) shape — still shown via the original
            // ATS-shaped viewer rather than hidden or crashed on, since
            // this historical row is never modified or reshaped by this
            // app.
            <AtsReportView report={savedDraft.content as AtsReport} periodLabel={savedDraft.periodLabel} />
          )}
        </div>
      </div>

      {/* Always-mounted print-only mirror — hidden on screen (see
          LeadershipReport.css), revealed only while
          body.print-lr-history-only is active. Wired directly to
          savedDraft rather than reusing the on-screen pane above, matching
          the same convention used in LeadershipReportCurrent.tsx. */}
      {savedDraft && isLeadershipReportContent(savedDraft.content) && (
        <div className="lr-print-history-only">
          <LeadershipReportFormView content={savedDraft.content} />
        </div>
      )}
      {savedDraft && !isLeadershipReportContent(savedDraft.content) && (
        <div className="lr-print-history-only">
          <AtsReportView report={savedDraft.content as AtsReport} periodLabel={savedDraft.periodLabel} />
        </div>
      )}
    </div>
  )
}
