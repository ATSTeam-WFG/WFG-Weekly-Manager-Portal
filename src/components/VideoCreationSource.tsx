import { useEffect, useState } from 'react'
import { fetchPersistedAnalysis, isAtsShapedSections } from '../lib/executiveSummaryService'
import { fetchLeadershipReportDraft } from '../lib/leadershipReportDraftService'
import { buildStoryboardFromAtsReport, type VideoStoryboard, type VideoStoryboardSourceType } from '../lib/videoStoryboard'
import { generateAiVideoStoryboard } from '../lib/videoStoryboardAiService'
import type { AtsReport } from '../lib/atsReport'
import type { ReportingWeek } from '../utils/week'
import { parseDateOnly } from '../utils/week'

interface VideoCreationSourceProps {
  sourceType: VideoStoryboardSourceType | null
  onSelectSourceType: (sourceType: VideoStoryboardSourceType) => void
  week: ReportingWeek
  isCurrentWeek: boolean
  onPreviousWeek: () => void
  onNextWeek: () => void
  onCreateVideo: (storyboard: VideoStoryboard) => void
}

interface LoadedSource {
  report: AtsReport
  periodLabel: string
  topicCount: number
}

// A Leadership Report draft's content can now be either the legacy
// AtsReport shape or the new WFG Weekly Leadership Update shape (see
// leadershipReportContent.ts) — this screen only ever understood the
// former, so this guard is the minimal safe change needed to keep reading
// a legacy-shaped draft working, without adding any new capability here.
function isAtsReportShape(value: unknown): value is AtsReport {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.openingParagraph === 'string' && Array.isArray(v.topics)
}

// Same "Week Ending [date]" convention already used by
// LeadershipReportCurrent.tsx's own weekEndingLabel — duplicated here
// (rather than imported) since that one is private to its own file, and
// this is a single, trivial, pure formatting line. parseDateOnly, never
// `new Date(dateOnlyString)` — see the production off-by-one bug that fix
// addressed; periodEndDate is a date-only value.
function weekEndingLabel(periodEndDate: string): string {
  return `Week Ending ${parseDateOnly(periodEndDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
}

// The Source step: choose Weekly Summary or Leadership Report, pick a
// week, and load that week's report READ-ONLY. Both fetches below are the
// exact same, already-established, already-RLS-scoped reads used
// elsewhere in this app (fetchPersistedAnalysis for Weekly Summary's own
// persisted ATS analysis, exactly as LeadershipReportCurrent.tsx's own ATS
// pane already does; fetchLeadershipReportDraft for the CURRENT
// authenticated user's own saved Leadership Report, exactly as
// LeadershipReportCurrent.tsx/LeadershipReportHistory.tsx already do) —
// neither is a new query, and neither ever passes or filters by an
// owner/user identifier: RLS alone is what scopes the Leadership Report
// read to "mine." Nothing here ever writes anything.
export default function VideoCreationSource({
  sourceType,
  onSelectSourceType,
  week,
  isCurrentWeek,
  onPreviousWeek,
  onNextWeek,
  onCreateVideo,
}: VideoCreationSourceProps) {
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState<LoadedSource | null>(null)
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    if (!sourceType) {
      setLoaded(null)
      return
    }

    let active = true
    setLoading(true)
    setLoaded(null)

    async function load() {
      if (sourceType === 'weekly-summary') {
        const persisted = await fetchPersistedAnalysis('weekly', week.weekStartDate)
        if (!active) return
        if (persisted && isAtsShapedSections(persisted.sections)) {
          setLoaded({
            report: persisted.sections,
            periodLabel: weekEndingLabel(persisted.periodEndDate),
            topicCount: persisted.sections.topics.length,
          })
        }
      } else {
        // Read-only, RLS-scoped (owner_id = auth.uid()) — no owner/user
        // identifier is passed or filtered here client-side. This can
        // structurally never return, and therefore never show or copy,
        // another user's saved Leadership Report.
        const draft = await fetchLeadershipReportDraft(week.weekStartDate)
        if (!active) return
        // leadership_report_drafts.content can now be either the legacy
        // AtsReport shape (openingParagraph/topics, what this screen
        // expects) or the new WFG Weekly Leadership Update shape from the
        // Leadership Report rebuild — Video Creation is paused/unaffected
        // by that rebuild, so a new-shaped draft simply isn't offered as a
        // video source yet (same empty state as "no draft"), rather than
        // guessing a mapping or crashing.
        if (draft && isAtsReportShape(draft.content)) {
          setLoaded({
            report: draft.content,
            periodLabel: draft.periodLabel,
            topicCount: draft.content.topics.length,
          })
        }
      }
      setLoading(false)
    }

    void load()

    return () => {
      active = false
    }
  }, [sourceType, week.weekStartDate])

  const canCreateVideo = loaded !== null && !generating

  // Attempt AI-assisted storyboard generation first (see
  // videoStoryboardAiService.ts / api/video/generate-storyboard.ts) — it
  // reads only loaded.periodLabel/sourceType and the week/source identity
  // (the server independently re-fetches and re-validates the actual
  // report itself). ANY failure — network, auth, AI generation, invalid
  // AI structure — falls back to the same deterministic transformer this
  // component already had, using the report already loaded here in
  // memory. The user is never left without a storyboard: onCreateVideo is
  // called exactly once, either way, in this function.
  const handleCreateVideo = async () => {
    if (!loaded || !sourceType) return

    setGenerating(true)
    try {
      const storyboard = await generateAiVideoStoryboard(sourceType, week.weekStartDate)
      onCreateVideo(storyboard)
    } catch {
      // buildStoryboardFromAtsReport only ever reads loaded.report — see
      // videoStoryboard.ts for why the result can never share a reference
      // back into it (and therefore can never mutate it, or the persisted
      // row it came from, however the storyboard is edited afterward).
      const fallback = buildStoryboardFromAtsReport(loaded.report, loaded.periodLabel, sourceType)
      onCreateVideo(fallback)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <>
      <div className="vc-source-cards">
        <button
          type="button"
          className={`vc-source-card ${sourceType === 'weekly-summary' ? 'vc-source-card-selected' : ''}`}
          onClick={() => onSelectSourceType('weekly-summary')}
        >
          <h2>Weekly Summary</h2>
          <p>Use a consolidated weekly report.</p>
        </button>

        <button
          type="button"
          className={`vc-source-card ${sourceType === 'leadership-report' ? 'vc-source-card-selected' : ''}`}
          onClick={() => onSelectSourceType('leadership-report')}
        >
          <h2>Leadership Report</h2>
          <p>Use your saved leadership report.</p>
        </button>

        <div className="vc-source-card vc-source-card-disabled" aria-disabled="true">
          <span className="vc-source-card-badge">Coming next</span>
          <h2>Upload Report</h2>
          <p>Upload a report or document.</p>
        </div>
      </div>

      {sourceType && (
        <div className="vc-source-week">
          <div className="vc-week-nav">
            <button type="button" className="vc-week-nav-btn" onClick={onPreviousWeek} aria-label="Previous reporting week">
              &lsaquo; Previous
            </button>
            <span className="vc-week-label">
              Week of {week.label}
              {isCurrentWeek && <span className="week-current-badge">Current</span>}
            </span>
            <button
              type="button"
              className="vc-week-nav-btn"
              onClick={onNextWeek}
              disabled={isCurrentWeek}
              aria-label="Next reporting week"
            >
              Next &rsaquo;
            </button>
          </div>

          {loading ? (
            <div className="admin-loading">Loading report&hellip;</div>
          ) : loaded ? (
            <div className="vc-source-confirm">
              <p className="vc-source-confirm-label">This report will be used:</p>
              <p className="vc-source-confirm-detail">
                {loaded.periodLabel} &middot; {loaded.topicCount} topic{loaded.topicCount === 1 ? '' : 's'}
              </p>
            </div>
          ) : (
            <div className="vc-empty-state">
              <p>
                {sourceType === 'weekly-summary'
                  ? 'No ATS report has been generated for this week yet.'
                  : 'No saved Leadership Report for this week.'}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="vc-create-action">
        {generating ? (
          <p className="vc-generating-status">Creating your video storyboard&hellip;</p>
        ) : (
          <button
            type="button"
            className="btn btn-primary vc-create-btn"
            onClick={() => void handleCreateVideo()}
            disabled={!canCreateVideo}
            title={loaded ? undefined : 'Choose a source and week with an available report first'}
          >
            Create Video
          </button>
        )}
      </div>
    </>
  )
}
