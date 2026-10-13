import { authenticateAdmin } from '../../_lib/adminAuth.js'
import { listPresenterSubjectCandidates } from '../../_lib/supabaseServiceClient.js'

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

// Admin-only: the candidate list for the Presenter & Voice step's "is this
// you, or someone else" picker. Returns active portal profiles only — the
// id returned here IS profiles.id, the exact value
// video_media_consents.subject_profile_id expects (never
// approved_employees.id — see listPresenterSubjectCandidates' own header).
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

    const subjects = await listPresenterSubjectCandidates()
    if (subjects === null) {
      return sendError(res, 500, 'LIST_FAILED', 'Could not load the subject list.')
    }

    return res.status(200).json({ subjects })
  } catch (err) {
    console.error('video/presenter/subjects: unexpected error:', err)
    return sendError(res, 500, 'UNKNOWN', 'An unexpected error occurred.')
  }
}
