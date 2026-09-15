import { authenticateAdmin } from '../../_lib/adminAuth.js'
import { listManagedUsers } from '../../_lib/supabaseServiceClient.js'

// Minimal local request/response typing — see api/executive-summary.ts for
// why this avoids a @vercel/node dependency.
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

// Admin-only: lists every approved_employees row with a real role assigned,
// joined against profiles by normalized email, for the User Management
// table (name, email, role, status). Never reachable by a Manager —
// authenticateAdmin independently re-verifies role='admin' and is_active on
// every request, never trusting anything the client claims about itself.
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

    const users = await listManagedUsers()
    if (users === null) {
      return sendError(res, 500, 'LIST_FAILED', 'Could not load the user list.')
    }

    return res.status(200).json({ users })
  } catch (err) {
    console.error('admin/users/list: unexpected error:', err)
    return sendError(res, 500, 'UNKNOWN', 'An unexpected error occurred.')
  }
}
