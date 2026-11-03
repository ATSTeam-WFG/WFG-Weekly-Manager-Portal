import { authenticateAdminOrSalesAdmin } from '../../_lib/adminAuth.js'
import { listSalesReps } from '../../_lib/supabaseServiceClient.js'

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

// Admin or Sales Admin: lists every approved_employees row with
// portal_role='sales_rep', joined against profiles and
// rep_manager_assignments, for the Sales Rep Management table (name, email,
// status, current manager). currentManagerName is deliberately included —
// Sales Admin is explicitly authorized to see Manager names in exactly this
// assignment-management context, never beyond it. Never reachable by a
// plain Manager — authenticateAdminOrSalesAdmin independently re-verifies
// role is admin or sales_admin, and is_active, on every request, never
// trusting anything the client claims about itself.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'GET') {
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET requests are supported.')
    }

    const auth = await authenticateAdminOrSalesAdmin({
      supabaseUrl: SUPABASE_URL,
      supabasePublishableKey: SUPABASE_PUBLISHABLE_KEY,
      authorizationHeader: req.headers.authorization,
    })
    if (!auth.ok) {
      return sendError(res, auth.status, auth.code, auth.message)
    }

    const reps = await listSalesReps()
    if (reps === null) {
      return sendError(res, 500, 'LIST_FAILED', 'Could not load the sales rep list.')
    }

    return res.status(200).json({ reps })
  } catch (err) {
    console.error('admin/users/list-sales-reps: unexpected error:', err)
    return sendError(res, 500, 'UNKNOWN', 'An unexpected error occurred.')
  }
}
