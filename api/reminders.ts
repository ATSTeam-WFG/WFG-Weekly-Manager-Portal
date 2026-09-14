import { getCurrentReportingWeek } from '../src/utils/week.js'
import { isInEasternActionWindow } from '../src/utils/easternTime.js'
import { fetchManagersForWeek } from '../src/lib/adminService.js'
import { getReminderTargets, buildFridayReminderEmail } from '../src/lib/reminderService.js'
import { getEmailSender } from './_lib/emailSender.js'
import { processReminderTarget } from './_lib/reminderDelivery.js'
import { claimReminderDelivery, resolveReminderDeliveryFailed, resolveReminderDeliverySent } from './_lib/supabaseServiceClient.js'
import { authenticateRequest } from './_lib/adminAuth.js'
import { resolveDryRun } from './_lib/requestHelpers.js'

// Friday 12:00 PM through 12:14 PM America/New_York — see
// src/utils/easternTime.ts for why this is DST-safe without any manual
// UTC-offset math.
const REMINDER_WINDOW_HOUR = 12
const REMINDER_WINDOW_MINUTE = 0
const REMINDER_WINDOW_MINUTES = 15

// Minimal local request/response typing — see api/executive-summary.ts for
// why this avoids a @vercel/node dependency.
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

// Computes the Friday-noon reminder targets (Draft + Not Started, never
// Submitted) for the current reporting week and either previews or "sends"
// (via the test-mode email sender — nothing is ever actually delivered
// until a real provider is approved) the reminder content.
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

    // Checked before any action-related database query, email work, or
    // report mutation — and before dry-run is even resolved, since a
    // preview is still "action-related" for this purpose. Applies only to
    // the scheduler-bot path; a human Admin's own POST is never restricted
    // by this window, matching the existing dry-run-default behavior below.
    if (scheduled && !isInEasternActionWindow(REMINDER_WINDOW_HOUR, REMINDER_WINDOW_MINUTE, REMINDER_WINDOW_MINUTES)) {
      return res.status(200).json({
        skipped: true,
        reason: 'outside_action_window',
        message: 'Scheduler invocation received outside the Friday 12:00–12:14 PM America/New_York reminder window; no action taken.',
      })
    }

    const dryRun = resolveDryRun({ isSchedulerRequest: scheduled, body: req.body, url: req.url })

    const week = getCurrentReportingWeek()
    const managers = await fetchManagersForWeek(supabase, week.weekStartDate)
    const targets = getReminderTargets(managers)

    const preview = targets.map((target) => {
      const content = buildFridayReminderEmail(target, week)
      return {
        managerId: target.id,
        fullName: target.fullName,
        email: target.email,
        status: target.status,
        subject: content.subject,
        body: content.body,
      }
    })

    if (dryRun) {
      return res.status(200).json({
        week: { weekStartDate: week.weekStartDate, label: week.label },
        dryRun: true,
        targetCount: targets.length,
        targets: preview,
      })
    }

    // Reached only past the dry-run early-return above — dry-run never
    // claims a ledger row, never sends, and never mutates anything.
    const sender = getEmailSender()
    const results = []
    for (const item of preview) {
      if (!item.email) {
        results.push({ managerId: item.managerId, to: null, status: 'skipped', detail: 'No email on file for this manager.' })
        continue
      }
      // Claim happens immediately before the send attempt, inside
      // processReminderTarget — see api/_lib/reminderDelivery.ts for the
      // full claim/send/resolve decision logic.
      const outcome = await processReminderTarget(
        { managerId: item.managerId, email: item.email, subject: item.subject, body: item.body },
        week.weekStartDate,
        {
          claim: claimReminderDelivery,
          send: (message) => sender.send(message),
          resolveSent: resolveReminderDeliverySent,
          resolveFailed: resolveReminderDeliveryFailed,
        },
      )
      results.push(outcome)
    }

    return res.status(200).json({
      week: { weekStartDate: week.weekStartDate, label: week.label },
      dryRun: false,
      targetCount: targets.length,
      results,
    })
  } catch (err) {
    console.error('reminders: unexpected error:', err)
    return sendError(res, 500, 'UNKNOWN', 'An unexpected error occurred.')
  }
}
