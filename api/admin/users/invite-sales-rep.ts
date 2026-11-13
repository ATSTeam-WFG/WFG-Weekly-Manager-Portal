import { authenticateAdminOrSalesAdmin } from '../../_lib/adminAuth.js'
import { authenticateManager } from '../../_lib/managerAuth.js'
import { addOrCreateSalesRepAccount, inviteSalesRepAsManager } from '../../_lib/supabaseServiceClient.js'

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

// "Add Sales Rep" — Admin, Sales Admin, or a Manager. Creates an
// approved_employees roster entry (role: sales_rep) if one doesn't already
// exist, then creates the rep's Auth account directly with the shared
// temporary password (see createEmployeeAccount in
// supabaseServiceClient.ts) — no invitation email, no invite link. Mirrors
// api/admin/users/invite.ts exactly, but for the sales_rep role: this
// endpoint NEVER reads a role from the request body — the role is always
// hardcoded to sales_rep, and an existing manager/admin/sales_admin roster
// entry is never touched (role_conflict).
//
// A Manager caller additionally gets a pending-assignment claim recorded
// for the new rep (see inviteSalesRepAsManager) — nothing here lets a
// Manager invite on anyone ELSE's behalf or target an existing, already-
// provisioned rep; Admin/Sales Admin's own path (addOrCreateSalesRepAccount)
// is completely unchanged and never creates a pending-assignment row.
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

    let managerId: string | null = null
    if (!adminAuth.ok) {
      if (adminAuth.code !== 'FORBIDDEN') {
        return sendError(res, adminAuth.status, adminAuth.code, adminAuth.message)
      }
      const managerAuth = await authenticateManager({
        supabaseUrl: SUPABASE_URL,
        supabasePublishableKey: SUPABASE_PUBLISHABLE_KEY,
        authorizationHeader: req.headers.authorization,
      })
      if (!managerAuth.ok) {
        return sendError(res, managerAuth.status, managerAuth.code, managerAuth.message)
      }
      if (process.env.MANAGER_ACCOUNT_ACTIONS_ENABLED !== 'true' || process.env.VERCEL_ENV === 'production') {
        return sendError(res, 503, 'FEATURE_DISABLED', 'Manager account actions are not enabled.')
      }
      managerId = managerAuth.userId
    }

    const body = (req.body ?? {}) as { fullName?: unknown; email?: unknown }
    const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : ''
    const email = typeof body.email === 'string' ? body.email.trim() : ''

    if (!fullName || !email) {
      return sendError(res, 400, 'INVALID_REQUEST', 'A name and email are required.')
    }

    if (managerId) {
      const outcome = await inviteSalesRepAsManager(fullName, email, managerId)
      switch (outcome.status) {
        case 'created_and_pending':
        case 'already_created_and_pending':
          return res.status(200).json({ status: 'created' })
        case 'already_registered':
          return sendError(res, 409, 'ALREADY_REGISTERED', 'This person already has a portal account. Contact an Admin or Sales Admin to arrange assignment.')
        case 'pending_conflict':
          return sendError(
            res,
            409,
            'PENDING_CONFLICT',
            outcome.conflictingManagerName
              ? `${outcome.conflictingManagerName} has already invited this person and is awaiting their first login.`
              : 'Another Manager has already invited this person and is awaiting their first login.',
          )
        case 'invalid_domain':
          return sendError(res, 400, 'INVALID_DOMAIN', 'Only approved @wfgtitle.com email addresses can be added.')
        case 'role_conflict':
          return sendError(res, 409, 'ROLE_CONFLICT', 'This email is already assigned a Manager or Admin role.')
        case 'inactive':
          return sendError(res, 409, 'INACTIVE', 'This employee is deactivated. Contact an Admin to reactivate them.')
        default:
          return sendError(res, 500, 'CREATE_ACCOUNT_FAILED', 'Could not create the account.')
      }
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
