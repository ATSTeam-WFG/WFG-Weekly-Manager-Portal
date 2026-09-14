import { supabase } from './supabaseClient'

// How much longer a token must still be valid (in seconds) before we trust
// it as-is. Below this margin we proactively refresh rather than risk
// sending a token that expires mid-request or was never actually refreshed
// by the SDK's background timer (which browsers can delay or skip entirely
// for an inactive/backgrounded tab).
const SESSION_REFRESH_MARGIN_SECONDS = 60

export class SessionError extends Error {}

// Returns a current, valid access token — refreshing the session first if
// the cached one is expired or about to expire. Never logs the token itself,
// only whether a refresh happened. Throws SessionError if no valid session
// can be obtained, rather than silently proceeding with a stale token (which
// would just surface as an opaque 401 from the server). Shared by every
// caller that needs an authenticated bearer token for a server-only API.
export async function getValidAccessToken(): Promise<string> {
  const { data: sessionData } = await supabase.auth.getSession()
  const session = sessionData.session

  if (!session) {
    throw new SessionError('You must be signed in.')
  }

  const nowSeconds = Math.floor(Date.now() / 1000)
  const expiresAt = session.expires_at
  const needsRefresh = !expiresAt || expiresAt - nowSeconds <= SESSION_REFRESH_MARGIN_SECONDS

  if (!needsRefresh) {
    return session.access_token
  }

  const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession()
  if (refreshError || !refreshData.session) {
    throw new SessionError('Your session has expired. Please sign in again.')
  }

  return refreshData.session.access_token
}
