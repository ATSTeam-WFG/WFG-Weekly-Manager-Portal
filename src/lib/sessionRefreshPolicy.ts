// Pure refresh-margin decision, kept separate from sessionService.ts (whose
// getValidAccessToken touches the real browser Supabase client singleton —
// unsafe to import directly under plain `node --test`, see
// sessionServiceWiring.test.ts) so this logic is directly, exhaustively
// unit-testable.
//
// This margin MUST stay larger than supabase-js's own internal expiry
// margin (EXPIRY_MARGIN_MS in @supabase/auth-js — currently 90s:
// AUTO_REFRESH_TICK_THRESHOLD(3) * AUTO_REFRESH_TICK_DURATION_MS(30_000), see
// node_modules/@supabase/auth-js/dist/module/lib/constants.js).
// supabase.auth.getSession() itself proactively refreshes once a session
// falls within THAT internal margin — but if that internal refresh attempt
// fails (e.g. the refresh token was already consumed/rotated/invalidated)
// while the access token's real `exp` hasn't passed yet, getSession()
// deliberately swallows the failure and hands back the SAME soon-to-be-dead
// access token as "still valid" (see the `accessTokenStillValid` fallback in
// __loadSession, node_modules/@supabase/auth-js/dist/module/GoTrueClient.js
// — explicit refresh entry points like refreshSession() intentionally do
// NOT get this same silent fallback; they surface a real failure).
//
// If our own margin here were smaller than (or too close to) the SDK's own
// 90s, our "needs refresh" check would never fire in time to notice: by the
// time it triggers, the SDK's internal check has already run and silently
// hidden a genuine refresh failure, so a caller (e.g. fetchManagedUsers())
// could be handed a token that looks locally fine but the server correctly
// rejects as invalid/expired. Keeping this margin comfortably wider than
// the SDK's own means our own explicit refreshSession() call always runs
// BEFORE that silent-fallback window, so a truly dead refresh token
// surfaces here as an honest failure (SessionError -> NO_VALID_SESSION)
// instead of a confusing server-side 401 on an apparently-fine session.
export const SESSION_REFRESH_MARGIN_SECONDS = 150

export function shouldRefreshBeforeUse(expiresAt: number | null | undefined, nowSeconds: number): boolean {
  return !expiresAt || expiresAt - nowSeconds <= SESSION_REFRESH_MARGIN_SECONDS
}
