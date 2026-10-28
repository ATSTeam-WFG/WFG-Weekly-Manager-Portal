import { authenticateAdmin } from '../../_lib/adminAuth.js'
import { addOrCreateSalesRepAccount } from '../../_lib/supabaseServiceClient.js'

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

// "Add Sales Rep" — Admin-only. Creates an approved_employees roster entry
// (role: sales_rep) if one doesn't already exist, then creates the rep's
// Auth account directly with the shared temporary password (see
// createEmployeeAccount in supabaseServiceClient.ts) — no invitation email,
// no invite link. Mirrors api/admin/users/invite.ts exactly, but for the
// sales_rep role: this endpoint NEVER reads a role from the request body —
// the role is always hardcoded to sales_rep via addOrCreateSalesRepAccount,
// and an existing manager/admin roster entry is never touched (role_conflict).
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

    const body = (req.body ?? {}) as { fullName?: unknown; email?: unknown }
    const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : ''
    const email = typeof body.email === 'string' ? body.email.trim() : ''

    if (!fullName || !email) {
      return sendError(res, 400, 'INVALID_REQUEST', 'A name and email are required.')
    }

    const outcome = await addOrCreateSalesRepAccount(fullName, email)

    switch (outcome.status) {
      case 'created':
        return res.status(200).json({ status: 'created' })
      case 'already_created':
        return sendError(
          res,
          409,
          'ALREADY_CREATED',
          'An account has already been created for this person and is awaiting their first login.',
        )
      case 'already_registered':
        return sendError(res, 409, 'ALREADY_REGISTERED', 'This person already has a portal account.')
      case 'invalid_domain':
        return sendError(res, 400, 'INVALID_DOMAIN', 'Only approved @wfgtitle.com email addresses can be added.')
      case 'role_conflict':
        return sendError(res, 409, 'ROLE_CONFLICT', 'This email is already assigned a Manager or Admin role.')
      case 'inactive':
        return sendError(res, 409, 'INACTIVE', 'This employee is deactivated. Reactivate them before creating an account.')
      default:
        return sendError(res, 500, 'CREATE_ACCOUNT_FAILED', 'Could not create the account.')
    }
  } catch (err) {
    console.error('admin/users/invite-sales-rep: unexpected error:', err)
    return sendError(res, 500, 'UNKNOWN', 'An unexpected error occurred.')
  }
}
