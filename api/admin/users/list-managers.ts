import { authenticateAdmin } from '../../_lib/adminAuth.js'
import { listActiveManagers } from '../../_lib/supabaseServiceClient.js'

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

// Admin-only: lists active Managers (profiles.role='manager', is_active=true)
// to populate the Sales Rep Management screen's "Assign Manager" dropdown.
// This is NOT itself a security boundary — assign_sales_rep independently
// re-validates server-side that the target is really an active manager, so
// a stale/tampered id reaching that RPC is rejected there regardless of
// what this endpoint ever returned. It exists only so the dropdown doesn't
// have to be populated from a broader, unfiltered admin listing. Does its
// own authenticateAdmin check like every other admin endpoint, never trusts
// anything the client claims about itself.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'GET') {
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET requests are supported.')
    }

    const auth = await authenticateAdmin({
      supabaseUrl: SUPABASE_URL,
      supabasePublishableKey: SUPABASE_PUBLISHABLE_KEY,
      authorizationHeader: req.headers.authorization,
    })
    if (!auth.ok) {
      return sendError(res, auth.status, auth.code, auth.message)
    }

    const managers = await listActiveManagers()
    return res.status(200).json({ managers })
  } catch (err) {
    console.error('admin/users/list-managers: unexpected error:', err)
    return sendError(res, 500, 'UNKNOWN', 'An unexpected error occurred.')
  }
}
