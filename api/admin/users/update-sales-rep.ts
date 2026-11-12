import { authenticateAdminOrSalesAdmin } from '../../_lib/adminAuth.js'
import { updateSalesRepProfile } from '../../_lib/supabaseServiceClient.js'

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

// Admin or Sales Admin may correct Sales Rep name/email only. The caller's
// role and active status are revalidated here, while updateSalesRepProfile
// independently verifies the target's actual portal_role before using the
// server-only service client. Role, activation, reporting flags, assignment,
// and report data are not accepted by this endpoint.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') {
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST requests are supported.')
    }

    const auth = await authenticateAdminOrSalesAdmin({
      supabaseUrl: SUPABASE_URL,
      supabasePublishableKey: SUPABASE_PUBLISHABLE_KEY,
      authorizationHeader: req.headers.authorization,
    })
    if (!auth.ok) {
      return sendError(res, auth.status, auth.code, auth.message)
    }

    const body = (req.body ?? {}) as { id?: unknown; fullName?: unknown; email?: unknown }
    const id = typeof body.id === 'string' ? body.id.trim() : ''
    const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : ''
    const email = typeof body.email === 'string' ? body.email.trim() : ''
    if (!id || !fullName || !email || fullName.length > 200 || email.length > 254) {
      return sendError(res, 400, 'INVALID_REQUEST', 'A Sales Rep id, a name up to 200 characters, and an email up to 254 characters are required.')
    }

    const outcome = await updateSalesRepProfile(id, { fullName, email }, auth.userId)
    switch (outcome.status) {
      case 'ok':
        return res.status(200).json({ status: 'ok' })
      case 'not_found':
        return sendError(res, 404, 'NOT_FOUND', 'This Sales Rep could not be found.')
      case 'forbidden':
        return sendError(res, 403, 'FORBIDDEN', 'Only Sales Rep accounts can be edited here.')
      case 'invalid_domain':
        return sendError(res, 400, 'INVALID_DOMAIN', 'Only approved @wfgtitle.com email addresses can be used.')
      case 'email_conflict':
        return sendError(res, 409, 'EMAIL_CONFLICT', 'That email address is already in use by another portal account.')
      case 'auth_identity_unresolved':
        return sendError(
          res,
          409,
          'AUTH_IDENTITY_UNRESOLVED',
          'This account’s sign-in identity could not be safely verified. The email was not changed; contact support.',
        )
      case 'partial_failure':
        return sendError(
          res,
          500,
          'PARTIAL_FAILURE',
          'This change may be incomplete. Do not retry; contact support for reconciliation.',
        )
      default:
        return sendError(res, 500, 'UPDATE_FAILED', 'Could not save this Sales Rep.')
    }
  } catch (err) {
    console.error('admin/users/update-sales-rep: unexpected error:', err)
    return sendError(res, 500, 'UNKNOWN', 'An unexpected error occurred.')
  }
}
