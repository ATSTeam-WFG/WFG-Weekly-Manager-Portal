import { getCurrentReportingWeek } from '../src/utils/week.js'
import { isInEasternActionWindow } from '../src/utils/easternTime.js'
import { runAutoSubmit, type AutoSubmitQuery } from './_lib/autoSubmit.js'
import { authenticateRequest } from './_lib/adminAuth.js'
import { resolveDryRun } from './_lib/requestHelpers.js'

// Friday 3:00 PM through 3:14 PM America/New_York — see
// src/utils/easternTime.ts for why this is DST-safe without any manual
// UTC-offset math.
const AUTO_SUBMIT_WINDOW_HOUR = 15
const AUTO_SUBMIT_WINDOW_MINUTE = 0
const AUTO_SUBMIT_WINDOW_MINUTES = 15

interface VercelRequest {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
  body: unknown
}

interface VercelResponse {
  status(code: number): VercelResponse
  json(body: unknown): void
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

function sendError(res: VercelResponse, status: number, code: string, message: string) {
  res.status(status).json({ error: code, message })
}

// Friday 3:00 PM Eastern Time (ET) auto-submit: updates existing Draft rows
// for the current reporting week to Submitted, setting submitted_at to now
// and submission_source to 'automatic' so Admin can distinguish it later.
//
// This is a plain UPDATE filtered to week_start_date = current week AND
// status = 'draft':
//   - never creates a row (UPDATE only ever touches rows that already exist)
//   - never touches a manager with no current-week report row (no row to match)
//   - never touches an already-Submitted row (excluded by the status filter)
//   - never writes to the four report-content fields, so their saved text is
//     preserved exactly
//
// Supports two distinct, unambiguous authentication paths (see
// api/_lib/adminAuth.ts): an interactively signed-in human Admin (POST), or
// an authenticated Vercel Cron invocation (GET, authenticated via
// `Authorization: Bearer <CRON_SECRET>` — AUTOMATION_BOT_EMAIL/PASSWORD
// aren't configured yet, so this path is currently inert past that point).
// Which path was actually used is read back from the authentication
// result itself (`auth.via`) — never guessed from a request header before
// authenticating, since a real Vercel Cron invocation never carries one.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST' && req.method !== 'GET') {
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET or POST requests are supported.')
    }

    const auth = await authenticateRequest({
      supabaseUrl: SUPABASE_URL,
      supabasePublishableKey: SUPABASE_PUBLISHABLE_KEY,
      authorizationHeader: req.headers.authorization,
    })
    if (!auth.ok) {
      return sendError(res, auth.status, auth.code, auth.message)
    }
    const { supabase, via } = auth
    const scheduled = via === 'scheduler-bot'

    // Checked before any action-related database query or report
    // mutation — and before dry-run is even resolved, since a preview is
    // still "action-related" for this purpose. Applies only to the
    // scheduler-bot path; a human Admin's own POST is never restricted by
    // this window, matching the existing dry-run-default behavior below.
    if (scheduled && !isInEasternActionWindow(AUTO_SUBMIT_WINDOW_HOUR, AUTO_SUBMIT_WINDOW_MINUTE, AUTO_SUBMIT_WINDOW_MINUTES)) {
      return res.status(200).json({
        skipped: true,
        reason: 'outside_action_window',
        message: 'Scheduler invocation received outside the Friday 3:00–3:14 PM America/New_York auto-submit window; no action taken.',
      })
    }

    const dryRun = resolveDryRun({ isSchedulerRequest: scheduled, body: req.body, url: req.url })

    const week = getCurrentReportingWeek()

    // Same two Supabase calls as before, unchanged filters/payload — just
    // named and handed to runAutoSubmit so the actual draft/submitted
    // decision logic (in api/_lib/autoSubmit.ts) is directly testable with
    // a fake in place of this adapter.
    const query: AutoSubmitQuery = {
      selectDraftReports: (weekStartDate) =>
        supabase.from('reports').select('id, manager_id, status').eq('week_start_date', weekStartDate).eq('status', 'draft'),
      updateDraftReportsToSubmitted: (weekStartDate, submittedAt) =>
        supabase
          .from('reports')
          .update({ status: 'submitted', submitted_at: submittedAt, submission_source: 'automatic' })
          .eq('week_start_date', weekStartDate)
          .eq('status', 'draft')
          .select('id, manager_id, status, submitted_at, submission_source'),
    }

    const outcome = await runAutoSubmit(query, week.weekStartDate, dryRun)

    if (!outcome.ok) {
      console.error(dryRun ? 'auto-submit: dry-run query failed:' : 'auto-submit: update failed:', outcome.error)
      return sendError(
        res,
        500,
        dryRun ? 'DATA_FETCH_FAILED' : 'UPDATE_FAILED',
        dryRun ? 'Could not check draft reports.' : 'Could not auto-submit draft reports.',
      )
    }

    return res.status(200).json(
      dryRun
        ? {
            week: { weekStartDate: week.weekStartDate, label: week.label },
            dryRun: true,
            wouldAutoSubmitCount: outcome.count,
            wouldAutoSubmit: outcome.reports,
          }
        : {
            week: { weekStartDate: week.weekStartDate, label: week.label },
            dryRun: false,
            autoSubmittedCount: outcome.count,
            autoSubmitted: outcome.reports,
          },
    )
  } catch (err) {
    console.error('auto-submit: unexpected error:', err)
    return sendError(res, 500, 'UNKNOWN', 'An unexpected error occurred.')
  }
}
