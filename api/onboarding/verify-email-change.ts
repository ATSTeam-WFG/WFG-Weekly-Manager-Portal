import { finalizeEmailChangeVerification } from '../_lib/supabaseServiceClient.js'
import { getClientIpHash } from '../_lib/requestHelpers.js'
import { isRateLimited } from '../_lib/simpleRateLimiter.js'

// Minimal local request/response typing — see api/executive-summary.ts for
// why this avoids a @vercel/node dependency.
interface VercelRequest {
  method?: string
  query?: Record<string, string | string[] | undefined>
  headers: Record<string, string | string[] | undefined>
}

interface VercelResponse {
  status(code: number): VercelResponse
  json(body: unknown): void
}

function sendError(res: VercelResponse, status: number, code: string, message: string) {
  res.status(status).json({ error: code, message })
}

// Reached by clicking the link in the "confirm your new email" message
// (see requestEmailChangeVerification in supabaseServiceClient.ts) — a GET,
// since that is what an email client's own link click sends, not a form
// submission. The token itself is the sole credential here (no session,
// no cookie, nothing ambient): a 256-bit random value, compared in
// constant time, known only from the one email it was sent in, and
// consumed (deleted) on first successful use — replaying the same link a
// second time correctly reports not_found, never a second silent apply.
// A high-entropy token cannot meaningfully be brute-forced within any
// practical request budget (unlike request-access.ts's much smaller
// email-guessing space), so the per-IP throttle below exists mainly to
// blunt a single scripted attacker hammering this endpoint, not as the
// primary defense — see simpleRateLimiter.ts's own header for its
// best-effort, instance-local limitation under serverless scaling.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'GET') {
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET requests are supported.')
    }

    if (isRateLimited(getClientIpHash(req.headers))) {
      return sendError(res, 429, 'TOO_MANY_REQUESTS', 'Too many attempts. Please try again in a minute.')
    }

    const id = typeof req.query?.id === 'string' ? req.query.id.trim() : ''
    const token = typeof req.query?.token === 'string' ? req.query.token.trim() : ''
    if (!id || !token) {
      return sendError(res, 400, 'INVALID_REQUEST', 'This link is missing required information.')
    }

    const outcome = await finalizeEmailChangeVerification(id, token)
    switch (outcome.status) {
      case 'ok':
        return res.status(200).json({ status: 'ok', message: 'Your new email address has been confirmed.' })
      case 'not_found':
      case 'invalid_token':
        return sendError(res, 404, 'NOT_FOUND', 'This link is invalid or has already been used.')
      case 'expired':
        return sendError(res, 410, 'EXPIRED', 'This link has expired. Ask an Admin, Sales Admin, or your Manager to resend the email change.')
      case 'email_conflict':
        return sendError(res, 409, 'EMAIL_CONFLICT', 'That email address is now in use by another account. Nothing was changed.')
      case 'partial_failure':
        return sendError(res, 500, 'PARTIAL_FAILURE', 'This change may be incomplete. Do not retry; contact support for reconciliation.')
      default:
        return sendError(res, 500, 'UNKNOWN', 'Could not confirm this email change.')
    }
  } catch (err) {
    console.error('onboarding/verify-email-change: unexpected error:', err)
    return sendError(res, 500, 'UNKNOWN', 'An unexpected error occurred.')
  }
}
