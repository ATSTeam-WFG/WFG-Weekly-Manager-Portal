// Run with: node --test src/lib/betaFeedbackUpdatesWiring.test.ts
//
// Beta feedback (2026-11-16) — focused coverage for the three
// cross-cutting changes not already covered by an existing wiring test
// file: (1) the unified Thursday 11:59 PM deadline's SQL-layer migration
// draft, (2) the Sales Rep edit-after-submission SQL-layer migration
// draft, (3) the new, non-blocking Provide Feedback mechanism's TS service
// layer and its own SQL-layer migration draft. Draft SQL files are
// verified via source inspection only (same limitation as every other SQL
// wiring test in this project — see supabase/salesRepPhase1aWiring.test.ts's
// own header comment) — they have NOT been applied to Preview or
// Production.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { isInEasternActionWindow } from '../utils/easternTime.ts'
import { getCurrentReportingWeek } from '../utils/week.ts'

const dir = path.dirname(fileURLToPath(import.meta.url))
const deadlineDraftSql = readFileSync(
  path.join(dir, '..', '..', 'supabase', 'drafts', '20261117_weekly_deadline_and_rep_report_editing.sql'),
  'utf8',
)
const feedbackDraftSql = readFileSync(path.join(dir, '..', '..', 'supabase', 'drafts', '20261117_rep_report_feedback.sql'), 'utf8')
const repReportsServiceSrc = readFileSync(path.join(dir, 'repReportsService.ts'), 'utf8')

describe('20261117_weekly_deadline_and_rep_report_editing.sql — the single Thursday 11:59 PM (inclusive) cutoff replaces every old Friday constant', () => {
  // Fixed 2026-11-18: the lock is expressed as "now() >= Friday 00:00:00
  // Eastern" (Monday+4, time '00:00'), never as "(Thursday, time '23:59')
  // compared with >=" — the latter would lock starting at the FIRST
  // instant of the 11:59 PM minute, one minute too early.
  test('reports_enforce_manager_edit_cutoff() now checks Monday+4 (Friday) at 00:00, never the old Monday+4 (Friday) at 15:00/15:30/16:00 or a literal Thursday 23:59 instant', () => {
    const match = deadlineDraftSql.match(/CREATE OR REPLACE FUNCTION reports_enforce_manager_edit_cutoff\(\)[\s\S]*?\$\$;/)
    assert.ok(match, 'could not locate reports_enforce_manager_edit_cutoff')
    const body = match[0]
    assert.match(body, /lock_start_date := NEW\.week_start_date \+ 4;/)
    assert.match(body, /edit_cutoff := \(lock_start_date \+ time '00:00'\) AT TIME ZONE 'America\/New_York';/)
    assert.doesNotMatch(body, /time '1[56]:\d\d'/)
    assert.doesNotMatch(body, /time '23:59'/)
  })

  test('manager_report_edit_cutoff_passed() and rep_report_submission_cutoff_passed() both use the same Monday+4, 00:00 (Friday midnight) formula', () => {
    for (const fnName of ['manager_report_edit_cutoff_passed', 'rep_report_submission_cutoff_passed']) {
      const match = deadlineDraftSql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fnName}\\([\\s\\S]*?\\$\\$;`))
      assert.ok(match, `could not locate ${fnName}`)
      assert.match(match[0], /SELECT p_now >= \(\(p_week_start_date \+ 4 \+ time '00:00'\) AT TIME ZONE 'America\/New_York'\);/)
    }
  })

  test('the admin-exemption and status-regression guards inside reports_enforce_manager_edit_cutoff() are byte-for-byte unchanged from the prior Friday-cutoff version', () => {
    const match = deadlineDraftSql.match(/CREATE OR REPLACE FUNCTION reports_enforce_manager_edit_cutoff\(\)[\s\S]*?\$\$;/)
    assert.ok(match)
    const body = match[0]
    assert.match(body, /IF acting_role = 'admin' AND NOT \(coalesce\(acting_submits, false\) AND NEW\.manager_id = auth\.uid\(\)\) THEN/)
    assert.match(body, /MANAGER_STATUS_REGRESSION_BLOCKED/)
  })
})

describe('20261117_weekly_deadline_and_rep_report_editing.sql — save_rep_report_draft now allows editing an already-submitted report', () => {
  test('is now deadline-gated (drafts were never time-gated before this change)', () => {
    const match = deadlineDraftSql.match(/CREATE OR REPLACE FUNCTION public\.save_rep_report_draft\([\s\S]*?\$\$;/)
    assert.ok(match, 'could not locate save_rep_report_draft')
    assert.match(match[0], /IF public\.rep_report_submission_cutoff_passed\(p_week_start_date\) THEN\s*\n\s*RAISE EXCEPTION 'EDIT_LOCKED/)
  })

  test('a report already at status=\'submitted\' gets a content-only UPDATE — never touches status/submitted_at/first_submitted_at/review_status/owning_assignment_id', () => {
    const match = deadlineDraftSql.match(/CREATE OR REPLACE FUNCTION public\.save_rep_report_draft\([\s\S]*?\$\$;/)
    assert.ok(match)
    const body = match[0]
    const branchMatch = body.match(/IF v_existing IS NOT NULL AND v_existing\.status = 'submitted' THEN([\s\S]*?)ELSE/)
    assert.ok(branchMatch, 'could not locate the already-submitted branch')
    const branch = branchMatch[1]
    assert.match(branch, /UPDATE public\.rep_reports\s*\n\s*SET content = p_content, updated_at = now\(\)/)
    assert.doesNotMatch(branch, /status\s*=|submitted_at\s*=|first_submitted_at\s*=|review_status\s*=|owning_assignment_id\s*=/)
  })

  test('the REP_STATUS_REGRESSION_BLOCKED status-based guard (edit only after rejection) is gone — any submitted report can now be edited directly', () => {
    const match = deadlineDraftSql.match(/CREATE OR REPLACE FUNCTION public\.save_rep_report_draft\([\s\S]*?\$\$;/)
    assert.ok(match)
    assert.doesNotMatch(match[0], /REP_STATUS_REGRESSION_BLOCKED/)
  })

  test('a brand-new or still-draft report still goes through the original upsert, unchanged', () => {
    const match = deadlineDraftSql.match(/CREATE OR REPLACE FUNCTION public\.save_rep_report_draft\([\s\S]*?\$\$;/)
    assert.ok(match)
    assert.match(match[0], /ON CONFLICT \(rep_id, week_start_date\) DO UPDATE SET/)
  })
})

describe('20261117_weekly_deadline_and_rep_report_editing.sql — nothing historical is deleted', () => {
  test('resubmit_rejected_rep_report is kept, fully intact (legacy correction path, simply unused by current UI)', () => {
    assert.match(deadlineDraftSql, /CREATE OR REPLACE FUNCTION public\.resubmit_rejected_rep_report\(p_week_start_date date\)/)
  })

  test('no DROP TABLE, DROP COLUMN, or DELETE statement appears anywhere in this draft', () => {
    assert.doesNotMatch(deadlineDraftSql, /DROP TABLE|DROP COLUMN|DELETE FROM/)
  })
})

describe('20261117_rep_report_feedback.sql — a brand-new, independent mechanism, never touching existing approve/reject constraints', () => {
  test('never touches rep_reports.status/review_status or rep_report_review_history at all', () => {
    assert.doesNotMatch(feedbackDraftSql, /ALTER TABLE public\.rep_reports/)
    assert.doesNotMatch(feedbackDraftSql, /ALTER TABLE public\.rep_report_review_history/)
    // review_rep_report is only ever mentioned in an explanatory comment
    // here (confirming it is untouched) — never actually CALLED.
    assert.doesNotMatch(feedbackDraftSql, /PERFORM public\.review_rep_report|SELECT public\.review_rep_report/)
  })

  test('add_rep_report_feedback never updates rep_reports — it only INSERTs into rep_report_feedback', () => {
    const match = feedbackDraftSql.match(/CREATE OR REPLACE FUNCTION public\.add_rep_report_feedback\([\s\S]*?\$\$;/)
    assert.ok(match, 'could not locate add_rep_report_feedback')
    const body = match[0]
    assert.doesNotMatch(body, /UPDATE public\.rep_reports/)
    assert.match(body, /INSERT INTO public\.rep_report_feedback \(report_id, feedback, author_id\)/)
  })

  test('authorization mirrors review_rep_report\'s exact gate (is_assigned_manager_of OR is_admin) — a Sales Admin can read (separate SELECT policy) but never write', () => {
    const match = feedbackDraftSql.match(/CREATE OR REPLACE FUNCTION public\.add_rep_report_feedback\([\s\S]*?\$\$;/)
    assert.ok(match)
    assert.match(match[0], /IF NOT \(public\.is_assigned_manager_of\(v_rep_id\) OR public\.is_admin\(\)\) THEN/)
    assert.doesNotMatch(match[0], /is_sales_admin/)
    assert.match(feedbackDraftSql, /CREATE POLICY rep_report_feedback_select_sales_admin/)
  })

  test('feedback text is required and non-empty, both client-and-server-side', () => {
    const match = feedbackDraftSql.match(/CREATE OR REPLACE FUNCTION public\.add_rep_report_feedback\([\s\S]*?\$\$;/)
    assert.ok(match)
    assert.match(match[0], /IF p_feedback IS NULL OR btrim\(p_feedback\) = '' THEN\s*\n\s*RAISE EXCEPTION 'FEEDBACK_REQUIRED/)
    assert.match(feedbackDraftSql, /CHECK \(btrim\(feedback\) <> ''\)/)
  })

  test('feedback may be left on any report regardless of status — no status requirement in the function at all, unlike review_rep_report\'s own "status = \'submitted\'" requirement', () => {
    const match = feedbackDraftSql.match(/CREATE OR REPLACE FUNCTION public\.add_rep_report_feedback\([\s\S]*?\$\$;/)
    assert.ok(match)
    assert.doesNotMatch(match[0], /status = 'submitted'/)
  })

  test('default-deny RLS on the new table: SELECT granted, every write revoked from authenticated/anon, the RPC is the only path in', () => {
    assert.match(feedbackDraftSql, /GRANT SELECT ON public\.rep_report_feedback TO authenticated;/)
    assert.match(feedbackDraftSql, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN\s*\nON public\.rep_report_feedback\s*\nFROM authenticated, anon;/)
  })
})

describe('repReportsService.ts — addRepReportFeedback/fetchRepReportFeedback are additive; the legacy review path is kept, not deleted', () => {
  test('addRepReportFeedback calls the add_rep_report_feedback RPC with (p_report_id, p_feedback) only', () => {
    const match = repReportsServiceSrc.match(/export async function addRepReportFeedback\(reportId: string, feedback: string\): Promise<RepReportFeedbackEntry> \{[\s\S]*?\n\}/)
    assert.ok(match, 'could not locate addRepReportFeedback')
    assert.match(match[0], /supabase\.rpc\('add_rep_report_feedback', \{\s*\n\s*p_report_id: reportId,\s*\n\s*p_feedback: feedback,/)
  })

  test('fetchRepReportFeedback is read-only, fails soft (empty array) on error, never throws', () => {
    const match = repReportsServiceSrc.match(/export async function fetchRepReportFeedback\(reportId: string\): Promise<RepReportFeedbackEntry\[\]> \{[\s\S]*?\n\}/)
    assert.ok(match, 'could not locate fetchRepReportFeedback')
    const body = match[0]
    assert.match(body, /\.from\('rep_report_feedback'\)/)
    assert.doesNotMatch(body, /throw/)
    assert.match(body, /if \(error\) \{[\s\S]*?return \[\]/)
  })

  test('reviewSalesRepReport and fetchRepReportReviewHistory still exist, unmodified in signature — historical approve/reject data remains fully readable and the legacy RPC remains callable', () => {
    assert.match(repReportsServiceSrc, /export async function reviewSalesRepReport\(/)
    assert.match(repReportsServiceSrc, /export async function fetchRepReportReviewHistory\(reportId: string\): Promise<RepReportReviewHistoryEntry\[\]>/)
  })

  test('RepReportErrorCode includes the two new codes (EDIT_LOCKED, FEEDBACK_REQUIRED) alongside every existing one — none removed', () => {
    const match = repReportsServiceSrc.match(/export type RepReportErrorCode =[\s\S]*?\n\n/)
    assert.ok(match, 'could not locate RepReportErrorCode')
    for (const code of [
      'FORBIDDEN',
      'NOT_FOUND',
      'REP_STATUS_REGRESSION_BLOCKED',
      'SUBMISSION_DEADLINE_PASSED',
      'INVALID_STATE',
      'INVALID_REVIEW_STATUS',
      'REASON_REQUIRED',
      'EDIT_LOCKED',
      'FEEDBACK_REQUIRED',
      'UNKNOWN',
    ]) {
      assert.match(match[0], new RegExp(`'${code}'`))
    }
  })
})

// 2026-11-18 — Vercel Cron schedules run in UTC (vercel.json's existing
// "*/5 * * * 5" means "every 5 minutes, every UTC Friday" — unchanged by
// this work; NOT deployed/modified per the current local-only directive).
// Eastern is always UTC-4 (EDT) or UTC-5 (EST) — strictly BEHIND UTC, never
// ahead — so "Eastern Friday 00:00–00:14" (the auto-submit action window,
// immediately after the Thursday 11:59 PM deadline passes) always falls a
// few hours INTO the same UTC Friday, never spilling into UTC Thursday or
// Saturday in either DST state. These are real, directly-callable
// functions (isInEasternActionWindow, getCurrentReportingWeek have no
// Supabase/runtime dependency) — executed here, not just source-inspected.
describe('Auto-submit cron correctness across EST/EDT — the existing UTC-Friday cron schedule needs no change', () => {
  for (const [label, weekStartDate, windowStartUtc] of [
    // EST week: Monday 2026-01-05, Thursday deadline 2026-01-08, lock
    // begins Friday 2026-01-09 00:00:00 EST = 2026-01-09T05:00:00.000Z.
    ['EST (January)', '2026-01-05', '2026-01-09T05:00:00.000Z'],
    // EDT week: Monday 2026-07-06, Thursday deadline 2026-07-09, lock
    // begins Friday 2026-07-10 00:00:00 EDT = 2026-07-10T04:00:00.000Z.
    ['EDT (July)', '2026-07-06', '2026-07-10T04:00:00.000Z'],
  ] as const) {
    describe(label, () => {
      test('the auto-submit window\'s start AND end instants both fall on UTC Friday (day-of-week 5) — fully inside the existing cron schedule', () => {
        const start = new Date(windowStartUtc)
        const end = new Date(start.getTime() + 14 * 60_000) // last in-window minute
        assert.equal(start.getUTCDay(), 5, 'window start must be UTC Friday')
        assert.equal(end.getUTCDay(), 5, 'window end must still be UTC Friday (no midnight-UTC rollover)')
      })

      test('isInEasternActionWindow confirms this UTC instant is genuinely Eastern Friday 00:00–00:14', () => {
        assert.equal(isInEasternActionWindow('Fri', 0, 0, 15, new Date(windowStartUtc)), true)
        // One minute before the window must NOT match (still Thursday Eastern).
        assert.equal(isInEasternActionWindow('Fri', 0, 0, 15, new Date(new Date(windowStartUtc).getTime() - 60_000)), false)
      })

      test('getCurrentReportingWeek(), called at the exact moment auto-submit runs, still resolves to the week that just closed — never the new Monday\'s week', () => {
        const week = getCurrentReportingWeek(new Date(windowStartUtc))
        assert.equal(week.weekStartDate, weekStartDate)
      })
    })
  }
})
