import { authenticateAdmin } from '../../_lib/adminAuth.js'
import { checkSalesRepRotationEligibility, rotateSalesRepTempPassword } from '../../_lib/supabaseServiceClient.js'

interface VercelRequest {
  method?: string
  headers: Record<string, string | string[] | undefined>
  body: unknown
}

interface VercelResponse {
  status(code: number): VercelResponse
  json(body: unknown): void
  setHeader(name: string, value: string): VercelResponse
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
// Eligibility is decided from the Auth user's own authoritative state
// (password_change_required + last_sign_in_at), never from whether a
// profiles row exists — pre-provisioned Sales Reps already have a profiles
// row long before first login, so that would have been exactly backwards.
// See decideSalesRepRotation in supabaseServiceClient.ts for the full,
// independently unit-tested decision logic.
//
// dry-run (execute: false, the default) calls checkSalesRepRotationEligibility
// — a read-only function that never references auth.admin.updateUserById
// anywhere in its own body, not merely "the same function with a flag".
// execute calls the separate rotateSalesRepTempPassword, which performs
// its own identical eligibility check before ever writing.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // This response can carry a live, single-use credential — never cached
    // by any intermediary (CDN, browser back-forward cache, proxy).
    res.setHeader('Cache-Control', 'no-store')

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
      const decision = await checkSalesRepRotationEligibility(email)
      return res.status(200).json({
        execute: false,
        email,
        decision: decision.action,
        message: decision.action === 'rotate' ? 'Eligible for rotation — no password was generated or changed (dry run).' : decision.reason,
      })
    }

    const outcome = await rotateSalesRepTempPassword(email)
    switch (outcome.status) {
      case 'ok':
        return res.status(200).json({ execute: true, email, status: 'ok', password: outcome.password })
      case 'not_found':
        return sendError(res, 404, 'NOT_FOUND', outcome.reason)
      case 'already_onboarded':
        return sendError(res, 409, 'ALREADY_ONBOARDED', outcome.reason)
      case 'cannot_verify_state':
        return sendError(res, 409, 'CANNOT_VERIFY_STATE', outcome.reason)
      default:
        return sendError(res, 500, 'ROTATE_FAILED', 'Could not rotate this account\'s password — see server logs.')
    }
  } catch (err) {
    console.error('admin/users/rotate-sales-rep-password: unexpected error:', err)
    return sendError(res, 500, 'UNKNOWN', 'An unexpected error occurred.')
  }
}
