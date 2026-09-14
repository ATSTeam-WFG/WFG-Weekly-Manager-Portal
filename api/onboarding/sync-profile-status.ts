import { createClient } from '@supabase/supabase-js'
import {
  lookupApprovedEmployeeByNormalizedEmail,
  normalizeEmail,
  syncProfileAccessFromApprovedEmployee,
} from '../_lib/supabaseServiceClient.js'

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

// Reconciles an ALREADY-SIGNED-IN caller's profile role/is_active against
// the current approved-employee roster. Identity comes exclusively from the
// caller's own bearer token (never the request body) — this endpoint takes
// no other input. Only ever updates role/is_active on an existing profile;
// it never creates one (see the separate, not-yet-built complete-profile
// endpoint for account creation).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') {
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST requests are supported.')
    }
    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
      console.error('sync-profile-status: missing Supabase configuration.')
      return sendError(res, 500, 'SERVER_MISCONFIGURED', 'Server is missing required configuration.')
    }

    const authHeader = req.headers.authorization
    const authValue = Array.isArray(authHeader) ? authHeader[0] : authHeader
    if (!authValue || !authValue.startsWith('Bearer ')) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Missing or invalid Authorization header.')
    }
    const accessToken = authValue.slice('Bearer '.length).trim()
    if (!accessToken) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Missing access token.')
    }

    // Identity only — this client is never used to read approved_employees
    // or to write profiles; it exists solely to verify who the caller is.
    const identityClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false },
    })
    const { data: userData, error: userError } = await identityClient.auth.getUser(accessToken)
    if (userError || !userData.user || !userData.user.email) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Invalid or expired session.')
    }

    const normalizedEmail = normalizeEmail(userData.user.email)
    const employee = await lookupApprovedEmployeeByNormalizedEmail(normalizedEmail)
    const outcome = await syncProfileAccessFromApprovedEmployee(userData.user.id, employee)

    return res.status(200).json(outcome)
  } catch (err) {
    console.error('sync-profile-status: unexpected error:', err)
    return sendError(res, 500, 'UNKNOWN', 'An unexpected error occurred.')
  }
}
