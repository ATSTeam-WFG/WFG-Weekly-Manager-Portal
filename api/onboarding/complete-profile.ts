import { createClient } from '@supabase/supabase-js'
import {
  clearPasswordChangeRequired,
  createProfileFromApprovedEmployee,
  findProfileByUserId,
  lookupApprovedEmployeeByNormalizedEmail,
  normalizeEmail,
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

// Creates the profiles row for an already-invited, already-authenticated
// user — never for anyone else. Identity comes exclusively from the
// caller's own bearer token (auth.getUser), never the request body, which
// is otherwise read for nothing: full_name/role/is_active always come from
// the approved-employee roster, looked up server-side by the token's own
// verified email. Create-only — an existing profile is treated as a
// successful no-op, never overwritten.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') {
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST requests are supported.')
    }
    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
      console.error('complete-profile: missing Supabase configuration.')
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

    // Identity only — never used to read approved_employees or write
    // profiles; those go through the service-role helper exclusively.
    const identityClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false },
    })
    const { data: userData, error: userError } = await identityClient.auth.getUser(accessToken)
    if (userError || !userData.user || !userData.user.email) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Invalid or expired session.')
    }

    // Explicit, not assumed: even though an invite-link session should
    // always arrive with the email already confirmed, this endpoint checks
    // the field itself rather than trusting "has a session" alone.
    if (!userData.user.email_confirmed_at) {
      return sendError(res, 403, 'EMAIL_NOT_VERIFIED', 'Your email address has not been verified yet.')
    }

    const existingLookup = await findProfileByUserId(userData.user.id)
    if (existingLookup.status === 'error') {
      return sendError(res, 500, 'PROFILE_LOOKUP_FAILED', 'Could not verify your account status.')
    }
    if (existingLookup.status === 'found') {
      // Idempotent: a retried/duplicated call is a success, not an error,
      // and never touches the already-existing row. Still attempts to
      // clear the mandatory-password-change marker (best-effort, see
      // clearPasswordChangeRequired) — a prior call may have created the
      // profile but failed on that follow-up step, and this is the only
      // remaining opportunity to retry it.
      await clearPasswordChangeRequired(userData.user.id)
      return res.status(200).json({ status: 'created', role: existingLookup.profile.role })
    }

    const emailNormalized = normalizeEmail(userData.user.email)
    const employee = await lookupApprovedEmployeeByNormalizedEmail(emailNormalized)

    if (!employee || !employee.isActive || employee.emailNormalized !== emailNormalized) {
      return sendError(res, 403, 'NOT_APPROVED', 'This account is not approved for portal access.')
    }

    const created = await createProfileFromApprovedEmployee(userData.user.id, employee)
    if (!created) {
      return sendError(res, 500, 'PROFILE_CREATION_FAILED', 'Could not finish setting up your account.')
    }

    // Only reachable once the profile itself was created successfully —
    // this is what actually lifts the mandatory-password-change gate (see
    // api/_lib/adminAuth.ts and the reports_password_change_required_lock
    // trigger). By this point in the flow, the caller's own new password
    // was already saved (CreatePassword.tsx calls supabase.auth.updateUser
    // before ever calling this endpoint), so clearing the marker here can
    // never leave the shared temporary password valid with the gate open.
    // Best-effort: logged, not thrown, on failure — the profile is already
    // created and must not be reported as failed just because this
    // follow-up call had trouble (see clearPasswordChangeRequired's own
    // comment for the known limitation this implies).
    await clearPasswordChangeRequired(userData.user.id)

    return res.status(200).json({ status: 'created', role: created.role })
  } catch (err) {
    console.error('complete-profile: unexpected error:', err)
    return sendError(res, 500, 'UNKNOWN', 'An unexpected error occurred.')
  }
}
