import { authenticateAdmin } from '../../_lib/adminAuth.js'
import { createAccountForExistingEmployee } from '../../_lib/supabaseServiceClient.js'

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

// "Create Account" — Admin-only. Replaces the old "Resend Invitation"
// action: there is no invitation link to resend anymore. This creates the
// Auth account (shared temporary password, no email sent) for an existing,
// active, not-yet-created approved_employees entry — Manager or Admin
// alike. Never creates a new roster row (see api/admin/users/invite.ts for
// that) and never sets or changes a role.
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

    const body = (req.body ?? {}) as { email?: unknown }
    const email = typeof body.email === 'string' ? body.email.trim() : ''
    if (!email) {
      return sendError(res, 400, 'INVALID_REQUEST', 'An email is required.')
    }

    const outcome = await createAccountForExistingEmployee(email)

    switch (outcome.status) {
      case 'created':
        return res.status(200).json({ status: 'created' })
      case 'not_found':
        return sendError(res, 404, 'NOT_FOUND', 'No matching approved employee was found for this email.')
      case 'already_registered':
        return sendError(res, 409, 'ALREADY_REGISTERED', 'This person already has a portal account.')
      case 'already_created':
        return sendError(
          res,
          409,
          'ALREADY_CREATED',
          'An account has already been created for this person and is awaiting their first login.',
        )
      case 'inactive':
        return sendError(res, 409, 'INACTIVE', 'This employee is deactivated. Reactivate them before creating an account.')
      default:
        return sendError(res, 500, 'CREATE_ACCOUNT_FAILED', 'Could not create the account.')
    }
  } catch (err) {
    console.error('admin/users/create-account: unexpected error:', err)
    return sendError(res, 500, 'UNKNOWN', 'An unexpected error occurred.')
  }
}
