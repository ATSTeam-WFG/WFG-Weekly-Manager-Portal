import { authenticateAdminOrSalesAdmin } from '../../_lib/adminAuth.js'
import { authenticateManager } from '../../_lib/managerAuth.js'
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

// Admin, Sales Admin, or a Manager who currently owns the target rep may
// correct Sales Rep name/email. Admin/Sales Admin are tried first (an
// unrelated failure, e.g. a misconfigured server, is reported as-is rather
// than masked by a Manager-auth attempt); only a FORBIDDEN result falls
// through to Manager auth, since any other failure (bad token, server
// misconfiguration) is the same regardless of which role the caller meant
// to use. The Manager-ownership check itself happens inside
// updateSalesRepProfile, not here — this endpoint only decides WHICH role
// authenticated, never whether that Manager owns this particular rep.
// Role, activation, reporting flags, assignment, and report data are not
// accepted by this endpoint for any caller.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') {
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST requests are supported.')
    }

    const adminAuth = await authenticateAdminOrSalesAdmin({
      supabaseUrl: SUPABASE_URL,
      supabasePublishableKey: SUPABASE_PUBLISHABLE_KEY,
      authorizationHeader: req.headers.authorization,
    })

    let userId: string
    let callerRole: 'admin' | 'sales_admin' | 'manager'
    if (adminAuth.ok) {
      userId = adminAuth.userId
      callerRole = adminAuth.role
    } else if (adminAuth.code === 'FORBIDDEN') {
      const managerAuth = await authenticateManager({
        supabaseUrl: SUPABASE_URL,
        supabasePublishableKey: SUPABASE_PUBLISHABLE_KEY,
        authorizationHeader: req.headers.authorization,
      })
      if (!managerAuth.ok) {
        return sendError(res, managerAuth.status, managerAuth.code, managerAuth.message)
      }
      userId = managerAuth.userId
      callerRole = 'manager'
    } else {
      return sendError(res, adminAuth.status, adminAuth.code, adminAuth.message)
    }

    const body = (req.body ?? {}) as { id?: unknown; fullName?: unknown; email?: unknown }
    const id = typeof body.id === 'string' ? body.id.trim() : ''
    const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : ''
    const email = typeof body.email === 'string' ? body.email.trim() : ''
    if (!id || !fullName || !email || fullName.length > 200 || email.length > 254) {
      return sendError(res, 400, 'INVALID_REQUEST', 'A Sales Rep id, a name up to 200 characters, and an email up to 254 characters are required.')
    }

    const outcome = await updateSalesRepProfile(id, { fullName, email }, userId, callerRole)
    switch (outcome.status) {
      case 'ok':
        return res.status(200).json({ status: 'ok' })
      case 'pending_verification':
        return res.status(200).json({ status: 'pending_verification' })
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
