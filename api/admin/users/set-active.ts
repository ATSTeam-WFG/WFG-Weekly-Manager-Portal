import { authenticateAdmin } from '../../_lib/adminAuth.js'
import { setManagedUserActive } from '../../_lib/supabaseServiceClient.js'

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

// Deactivate/reactivate — Admin-only. One endpoint handles both directions
// (isActive: false | true) since the underlying operation is identical —
// update approved_employees.is_active, and profiles.is_active if a profile
// already exists, together. Never touches role/portal_role: a
// deactivate-then-reactivate cycle always preserves the original role.
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

    const body = (req.body ?? {}) as { email?: unknown; isActive?: unknown }
    const email = typeof body.email === 'string' ? body.email.trim() : ''
    const isActive = body.isActive === true || body.isActive === false ? body.isActive : null

    if (!email || isActive === null) {
      return sendError(res, 400, 'INVALID_REQUEST', 'An email and isActive (true/false) are required.')
    }

    const outcome = await setManagedUserActive(email, isActive)

    switch (outcome.status) {
      case 'ok':
        return res.status(200).json({ status: 'ok', isActive })
      case 'not_found':
        return sendError(res, 404, 'NOT_FOUND', 'No user was found for this email.')
      default:
        return sendError(res, 500, 'UPDATE_FAILED', 'Could not update this user.')
    }
  } catch (err) {
    console.error('admin/users/set-active: unexpected error:', err)
    return sendError(res, 500, 'UNKNOWN', 'An unexpected error occurred.')
  }
}
