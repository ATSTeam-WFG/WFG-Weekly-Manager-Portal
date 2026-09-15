import { supabase } from './supabaseClient'
import { shouldRefreshBeforeUse } from './sessionRefreshPolicy'

export class SessionError extends Error {}

// Returns a current, valid access token — refreshing the session first if
// the cached one is expired or about to expire (see sessionRefreshPolicy.ts
// for exactly why the margin is sized the way it is, and why relying only
// on supabase-js's own getSession() isn't enough). Never logs the token
// itself, only whether a refresh happened. Throws SessionError if no valid
// session can be obtained, rather than silently proceeding with a stale
// token (which would just surface as an opaque 401 from the server).
// Shared by every caller that needs an authenticated bearer token for a
// server-only API.
export async function getValidAccessToken(): Promise<string> {
  const { data: sessionData } = await supabase.auth.getSession()
  const session = sessionData.session

  if (!session) {
    throw new SessionError('You must be signed in.')
  }

  const nowSeconds = Math.floor(Date.now() / 1000)

  if (!shouldRefreshBeforeUse(session.expires_at, nowSeconds)) {
    return session.access_token
  }

  const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession()
  if (refreshError || !refreshData.session) {
    throw new SessionError('Your session has expired. Please sign in again.')
  }

  return refreshData.session.access_token
}
