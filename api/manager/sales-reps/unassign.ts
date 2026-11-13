import { authenticateManager } from '../../_lib/managerAuth.js'

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

// Draft Manager-only endpoint for the proposed Remove Assignment control.
// It is disabled by default and always disabled on Production. When enabled
// in a disposable/local or Preview environment, the SECURITY DEFINER RPC
// independently derives auth.uid(), verifies current assignment ownership,
// and closes only that assignment. No role/manager id is accepted from the
// request body, no service-role client is used, and no account/report row is
// deleted. Do not enable until the companion SQL draft is reviewed/applied
// to the intended non-Production database and the authorization design is
// approved.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') {
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST requests are supported.')
    }

    const auth = await authenticateManager({
      supabaseUrl: SUPABASE_URL,
      supabasePublishableKey: SUPABASE_PUBLISHABLE_KEY,
      authorizationHeader: req.headers.authorization,
    })
    if (!auth.ok) return sendError(res, auth.status, auth.code, auth.message)

    if (process.env.MANAGER_ACCOUNT_ACTIONS_ENABLED !== 'true' || process.env.VERCEL_ENV === 'production') {
      return sendError(res, 503, 'FEATURE_DISABLED', 'Manager account actions are not enabled.')
    }

    const body = (req.body ?? {}) as { repId?: unknown }
    const repId = typeof body.repId === 'string' ? body.repId.trim() : ''
    if (!repId) return sendError(res, 400, 'INVALID_REQUEST', 'A Sales Rep id is required.')

    const { data, error } = await auth.supabase.rpc('unassign_own_sales_rep', { p_rep_id: repId })
    if (error) {
      const message = error.message ?? ''
      if (message.includes('FORBIDDEN')) {
        return sendError(res, 403, 'FORBIDDEN', 'This Sales Rep is not currently assigned to you.')
      }
      if (message.includes('INVALID_REP')) {
        return sendError(res, 400, 'INVALID_REP', 'The target account is not a Sales Rep.')
      }
      console.error('manager/sales-reps/unassign: RPC failed:', message)
      return sendError(res, 500, 'UNASSIGN_FAILED', 'Could not remove this assignment.')
    }
    if (data !== true) return sendError(res, 404, 'ASSIGNMENT_NOT_FOUND', 'No current assignment was found for this Sales Rep.')
    return res.status(200).json({ status: 'ok' })
  } catch (err) {
    console.error('manager/sales-reps/unassign: unexpected error:', err)
    return sendError(res, 500, 'UNKNOWN', 'An unexpected error occurred.')
  }
}
