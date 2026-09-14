import {
  checkOnboardingRequestRateLimit,
  inviteApprovedEmployee,
  lookupApprovedEmployeeByNormalizedEmail,
  normalizeEmail,
} from '../_lib/supabaseServiceClient.js'
import { getClientIpHash } from '../_lib/requestHelpers.js'

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

const ONBOARDING_REDIRECT_URL = process.env.ONBOARDING_REDIRECT_URL

// The one response shape sent to the browser, always, regardless of what
// actually happened server-side — this is the entire anti-enumeration
// mechanism. Never branch the browser-visible response on roster match,
// active status, portal_role assignment, or "already registered".
const GENERIC_RESPONSE = { message: "If this is an approved WFG email, we've sent a verification link." }

function sendGenericResponse(res: VercelResponse) {
  res.status(200).json(GENERIC_RESPONSE)
}

// Checks the approved-employee roster server-side and, only for an active,
// role-assigned match, sends a real Supabase invite email — never any table
// contents, never any authorization signal, to the browser. See
// api/_lib/supabaseServiceClient.ts for why this needs a privileged
// server-side credential at all (approved_employees has no RLS grant for
// anon/authenticated, by design).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') {
      return sendGenericResponse(res)
    }

    const body = (req.body ?? {}) as { email?: unknown }
    if (typeof body.email !== 'string' || !body.email.trim()) {
      return sendGenericResponse(res)
    }

    if (!ONBOARDING_REDIRECT_URL) {
      // Configuration gap, not a roster outcome — still never surfaced to
      // the browser as anything other than the same generic response.
      console.error('request-access: missing ONBOARDING_REDIRECT_URL.')
      return sendGenericResponse(res)
    }

    const emailNormalized = normalizeEmail(body.email)
    const ipHash = getClientIpHash(req.headers)

    // Rate limit gates whether we proceed at all — it never changes what the
    // browser sees, and it runs before the roster lookup so a blocked
    // request never even queries approved_employees. Fails closed: any
    // error from the check itself skips the invite too (see
    // checkOnboardingRequestRateLimit).
    const allowed = await checkOnboardingRequestRateLimit(emailNormalized, ipHash)

    if (allowed) {
      const employee = await lookupApprovedEmployeeByNormalizedEmail(emailNormalized)

      if (employee && employee.isActive) {
        const outcome = await inviteApprovedEmployee(employee.email, ONBOARDING_REDIRECT_URL)
        // outcome.ok === false with alreadyRegistered === true means this
        // person already has a working password-based account — intentionally
        // no email is sent in that case; they already have normal sign-in and
        // Forgot Password available. Any other failure is already logged
        // inside inviteApprovedEmployee and otherwise ignored here.
        void outcome
      }
    }

    return sendGenericResponse(res)
  } catch (err) {
    console.error('request-access: unexpected error:', err)
    return sendGenericResponse(res)
  }
}
