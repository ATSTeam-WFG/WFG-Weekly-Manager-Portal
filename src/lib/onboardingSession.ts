// Detects a signed-in session whose employee account was created by Admin
// User Management with the shared temporary password and has not yet had
// its own password set (see api/_lib/supabaseServiceClient.ts's
// createEmployeeAccount, which sets app_metadata.password_change_required=true
// at account-creation time, and api/onboarding/complete-profile.ts, which
// clears it once the employee successfully sets their own password).
//
// app_metadata (unlike user_metadata) can only be written by a service-role
// credential, never by the client itself (supabase.auth.updateUser only
// ever touches user_metadata), so this is a server-issued signal, not a
// value a browser could forge on its own session. It is still only a
// routing hint on the client: the actual, bypass-proof enforcement is
// api/_lib/adminAuth.ts's own check (for Admin API calls) and the
// reports_password_change_required_lock database trigger (for Manager
// report writes, which never go through a Node API at all) — this
// function never substitutes for either.
export const PASSWORD_CHANGE_REQUIRED_METADATA_KEY = 'password_change_required'

export function isPasswordChangeRequired(appMetadata: Record<string, unknown> | null | undefined): boolean {
  return !!appMetadata && appMetadata[PASSWORD_CHANGE_REQUIRED_METADATA_KEY] === true
}
