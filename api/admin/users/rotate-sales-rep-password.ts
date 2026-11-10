import { authenticateAdmin } from '../../_lib/adminAuth.js'
import { rotateSalesRepTempPassword } from '../../_lib/supabaseServiceClient.js'

interface VercelRequest {
  method?: string
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

// "Rotate Sales Rep Password" — Admin-ONLY. Rotates exactly ONE existing
// Sales Rep account (named by email in the request) to a fresh, unique,
// cryptographically random temporary password — never the shared
// EMPLOYEE_TEMP_PASSWORD. One account per call, by design: the generated
// password is returned exactly once, directly in this response, to be
// delivered to that one employee through an approved secure channel before
// moving to the next person — never batched, never logged, never written
// to any table.
//
// Refuses (ALREADY_ONBOARDED) if that employee has already completed first
// login — rotateSalesRepTempPassword itself enforces this by checking for
// an existing profiles row, so this can never overwrite a real employee's
// own chosen password, regardless of what the caller passes.
//
// dry-run (execute: false, the default) performs the exact same eligibility
// checks with zero write and zero password generated — lets an admin
// confirm a specific email is rotatable before actually doing it.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') {
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST requests are supported.')
    }

    const auth = await authenticateAdmin({
      supabaseUrl: SUPABASE_URL,
      supabasePublishableKey: SUPABASE_PUBLISHABLE_KEY,
      authorizationHeader: req.headers.authorization,
    })
    if (!auth.ok) {
      return sendError(res, auth.status, auth.code, auth.message)
    }

    const body = (req.body ?? {}) as { email?: unknown; execute?: unknown }
    const email = typeof body.email === 'string' ? body.email.trim() : ''
    const execute = body.execute === true

    if (!email) {
      return sendError(res, 400, 'INVALID_REQUEST', 'An email is required.')
    }

    if (!execute) {
      // Dry-run reuses the exact same function and its exact same checks —
      // the only difference is that a genuinely eligible result is
      // discarded here rather than ever being generated for real. There is
      // no separate "preview-only" code path to drift out of sync.
      const preview = await rotateSalesRepTempPassword(email)
      return res.status(200).json({
        execute: false,
        email,
        decision: preview.status === 'ok' ? 'eligible' : preview.status,
        message:
          preview.status === 'ok'
            ? 'Eligible for rotation — no password was generated or changed (dry run).'
            : preview.status === 'not_found'
              ? 'No active Sales Rep roster entry with an Auth account found for this email.'
              : preview.status === 'already_onboarded'
                ? 'This employee already has their own password from completing first login — rotation is refused.'
                : 'Could not determine eligibility — see server logs.',
      })
    }

    const outcome = await rotateSalesRepTempPassword(email)
    switch (outcome.status) {
      case 'ok':
        return res.status(200).json({ execute: true, email, status: 'ok', password: outcome.password })
      case 'not_found':
        return sendError(res, 404, 'NOT_FOUND', 'No active Sales Rep roster entry with an Auth account found for this email.')
      case 'already_onboarded':
        return sendError(res, 409, 'ALREADY_ONBOARDED', 'This employee already has their own password from completing first login — rotation is refused.')
      default:
        return sendError(res, 500, 'ROTATE_FAILED', 'Could not rotate this account\'s password — see server logs.')
    }
  } catch (err) {
    console.error('admin/users/rotate-sales-rep-password: unexpected error:', err)
    return sendError(res, 500, 'UNKNOWN', 'An unexpected error occurred.')
  }
}
