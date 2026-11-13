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

// Draft Manager-only endpoint, companion to unassign.ts — claims an
// UNASSIGNED Sales Rep for the calling Manager (used right after Add Sales
// Rep creates a new roster entry). Disabled by default and always disabled
// on Production, same gating as unassign.ts. The SECURITY DEFINER RPC
// independently derives auth.uid(), can only ever target the caller
// themselves (there is no manager id parameter to accept), and raises
// ALREADY_ASSIGNED rather than reassigning a rep who already belongs to a
// different manager — a Manager can never use this to take over another
// Manager's rep. Do not enable until the companion SQL draft is
// reviewed/applied to the intended non-Production database and the
// authorization design is approved.
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

    const { error } = await auth.supabase.rpc('assign_own_sales_rep', { p_rep_id: repId })
    if (error) {
      const message = error.message ?? ''
      if (message.includes('ALREADY_ASSIGNED')) {
        return sendError(res, 409, 'ALREADY_ASSIGNED', 'This Sales Rep is already assigned to a different Manager.')
      }
      if (message.includes('INVALID_REP')) {
        return sendError(res, 400, 'INVALID_REP', 'The target account is not a Sales Rep.')
      }
      if (message.includes('FORBIDDEN')) {
        return sendError(res, 403, 'FORBIDDEN', 'An active Manager session is required.')
      }
      console.error('manager/sales-reps/assign: RPC failed:', message)
      return sendError(res, 500, 'ASSIGN_FAILED', 'Could not assign this Sales Rep.')
    }
    return res.status(200).json({ status: 'ok' })
  } catch (err) {
    console.error('manager/sales-reps/assign: unexpected error:', err)
    return sendError(res, 500, 'UNKNOWN', 'An unexpected error occurred.')
  }
}
