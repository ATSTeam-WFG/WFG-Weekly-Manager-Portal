import { authenticateAdmin } from '../../_lib/adminAuth.js'
import { updateManagedEmployee } from '../../_lib/supabaseServiceClient.js'

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

// "Edit Employee" — Admin-only. Corrects an existing approved_employees
// row's full name, email, portal role, and/or submits_weekly_report — never
// creates a roster row, never creates an Auth account, never touches
// is_active (that remains Deactivate/Reactivate's own action). The target
// is always identified by its stable approved_employees `id` — the request
// body's `email` is only ever a NEW VALUE to apply, never used to look up
// which row is being edited, so a request can never accidentally retarget
// a different employee.
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

    const body = (req.body ?? {}) as {
      id?: unknown
      fullName?: unknown
      email?: unknown
      role?: unknown
      submitsWeeklyReport?: unknown
    }
    const id = typeof body.id === 'string' ? body.id.trim() : ''
    const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : ''
    const email = typeof body.email === 'string' ? body.email.trim() : ''
    const role = body.role === 'manager' || body.role === 'admin' ? body.role : null
    const submitsWeeklyReport = typeof body.submitsWeeklyReport === 'boolean' ? body.submitsWeeklyReport : null

    if (!id || !fullName || !email || !role || submitsWeeklyReport === null) {
      return sendError(
        res,
        400,
        'INVALID_REQUEST',
        'An id, full name, email, role, and submitsWeeklyReport are all required.',
      )
    }

    const outcome = await updateManagedEmployee(id, { fullName, email, role, submitsWeeklyReport }, auth.userId)

    switch (outcome.status) {
      case 'ok':
        return res.status(200).json({ status: 'ok' })
      case 'not_found':
        return sendError(res, 404, 'NOT_FOUND', 'This employee could not be found.')
      case 'invalid_domain':
        return sendError(res, 400, 'INVALID_DOMAIN', 'Only approved @wfgtitle.com email addresses can be used.')
      case 'email_conflict':
        return sendError(res, 409, 'EMAIL_CONFLICT', 'That email address is already in use by another portal account.')
      case 'self_role_change_blocked':
        return sendError(res, 409, 'SELF_ROLE_CHANGE_BLOCKED', 'You cannot remove your own Admin access.')
      case 'auth_identity_unresolved':
        return sendError(
          res,
          409,
          'AUTH_IDENTITY_UNRESOLVED',
          'This account was created before we could safely verify its sign-in identity. Name, role, and weekly-report settings can still be edited, but the email cannot be changed until this is resolved — please contact support.',
        )
      case 'partial_failure':
        return sendError(
          res,
          500,
          'PARTIAL_FAILURE',
          'Something went wrong while saving this change and it may be incomplete. Do NOT retry — please contact support so this can be reviewed before anything else is changed for this employee.',
        )
      default:
        return sendError(res, 500, 'UPDATE_FAILED', 'Could not save these changes.')
    }
  } catch (err) {
    console.error('admin/users/update: unexpected error:', err)
    return sendError(res, 500, 'UNKNOWN', 'An unexpected error occurred.')
  }
}
