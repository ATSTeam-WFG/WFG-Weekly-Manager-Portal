import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// This is the ONLY file in the repo permitted to reference
// SUPABASE_SECRET_KEY. Every caller gets a narrow, purpose-built function
// below — the client itself is never exported, and auth.admin is never
// exposed directly — so nothing outside this file can construct an
// arbitrary privileged query or call an arbitrary Admin API method. The key
// must exist only as a server-side environment variable (no VITE_/
// NEXT_PUBLIC_ prefix) so it can never be bundled into client code, must
// never be logged, and must never appear in an error message returned to a
// caller.
//
// Named SUPABASE_SECRET_KEY, not SUPABASE_SERVICE_ROLE_KEY: this project's
// publishable key already uses the newer `sb_publishable_...` format (not a
// legacy `eyJ...` anon JWT), so its privileged counterpart for this project
// is the corresponding new-format `sb_secret_...` project secret key, not
// the legacy service-role JWT.

let cachedClient: SupabaseClient | null = null

function getServiceClient(): SupabaseClient {
  if (cachedClient) return cachedClient

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY

  if (!supabaseUrl || !secretKey) {
    // Deliberately generic — never names which variable is missing, so a
    // misconfiguration can't leak any part of the expected shape upstream.
    throw new Error('Server is missing required configuration for a privileged operation.')
  }

  cachedClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return cachedClient
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export interface ApprovedEmployee {
  id: string
  fullName: string
  title: string | null
  email: string
  emailNormalized: string
  portalRole: 'manager' | 'admin'
  isActive: boolean
}

interface ApprovedEmployeeRow {
  id: string
  full_name: string
  title: string | null
  email: string
  email_normalized: string
  portal_role: string | null
  is_active: boolean
}

function toApprovedEmployee(row: ApprovedEmployeeRow): ApprovedEmployee | null {
  // A row with no portal_role assigned yet (or an unrecognized value) is not
  // eligible for anything — treated identically to no roster match at all.
  if (row.portal_role !== 'manager' && row.portal_role !== 'admin') return null
  return {
    id: row.id,
    fullName: row.full_name,
    title: row.title,
    email: row.email,
    emailNormalized: row.email_normalized,
    portalRole: row.portal_role,
    isActive: row.is_active,
  }
}

// approved_employees has no RLS grant for anon or authenticated — this is
// the only code path in the repo permitted to read it.
export async function lookupApprovedEmployeeByNormalizedEmail(emailNormalized: string): Promise<ApprovedEmployee | null> {
  const { data, error } = await getServiceClient()
    .from('approved_employees')
    .select('id, full_name, title, email, email_normalized, portal_role, is_active')
    .eq('email_normalized', emailNormalized)
    .maybeSingle()

  if (error) {
    console.error('supabaseServiceClient: approved_employees lookup failed:', error.message)
    return null
  }
  if (!data) return null
  return toApprovedEmployee(data)
}

// Fails CLOSED: any error talking to the rate-limit RPC itself — or any
// return value other than exactly `true` — is treated as "not allowed,"
// never "allowed by default." The entire point of this check is to prevent
// an unwanted invite email from being sent; if the authoritative check is
// unavailable, the safe default is to skip the invite, not to proceed as if
// unlimited. Never logs emailNormalized or ipHash — only the Supabase error
// message, matching every other log line in this file.
export async function checkOnboardingRequestRateLimit(emailNormalized: string, ipHash: string): Promise<boolean> {
  const { data, error } = await getServiceClient().rpc('check_onboarding_request_rate_limit', {
    p_email_normalized: emailNormalized,
    p_ip_hash: ipHash,
  })
  if (error) {
    console.error('supabaseServiceClient: rate-limit check failed:', error.message)
    return false
  }
  return data === true
}

export interface ReminderDeliveryClaim {
  deliveryId: number
  claimToken: string
  attemptCount: number
}

// Fails CLOSED: any error talking to the RPC is treated as "not claimed" —
// same reasoning as checkOnboardingRequestRateLimit above. The safe default
// when the ledger itself is unreachable is to skip this recipient this
// round (a future invocation can retry via the stale-claim path), never to
// guess and risk a duplicate send. Never logs managerId or weekStartDate —
// only the Supabase error message.
export async function claimReminderDelivery(managerId: string, weekStartDate: string): Promise<ReminderDeliveryClaim | null> {
  const { data, error } = await getServiceClient().rpc('claim_reminder_delivery', {
    p_manager_id: managerId,
    p_week_start_date: weekStartDate,
  })
  if (error) {
    console.error('supabaseServiceClient: claim_reminder_delivery failed:', error.message)
    return null
  }
  const row = Array.isArray(data) ? data[0] : null
  if (!row) return null
  return { deliveryId: row.delivery_id, claimToken: row.claim_token, attemptCount: row.attempt_count }
}

// Returns whether the resolve actually took effect. false means the claim
// was stale (reclaimed by another invocation since) — callers must treat
// that as a lost-claim condition, never as a normal success.
//
// providerMessageId may be null — the provider genuinely didn't return one.
// A genuinely sent email must still resolve as 'sent' in that case; callers
// must never substitute a fabricated placeholder (see
// reminderDelivery.ts's normalizeProviderMessageId, the only caller). The
// database function's own column-length bound remains the authoritative
// storage limit — nothing is truncated here.
export async function resolveReminderDeliverySent(
  deliveryId: number,
  claimToken: string,
  providerMessageId: string | null,
): Promise<boolean> {
  const { data, error } = await getServiceClient().rpc('resolve_reminder_delivery_sent', {
    p_delivery_id: deliveryId,
    p_claim_token: claimToken,
    p_provider_message_id: providerMessageId,
  })
  if (error) {
    console.error('supabaseServiceClient: resolve_reminder_delivery_sent failed:', error.message)
    return false
  }
  return data === true
}

// sanitizedError must already be a fixed, generic reason — never raw
// provider payloads, credentials, headers, tokens, email body content, or
// stack traces (see api/_lib/reminderDelivery.ts's sanitizeSendFailureReason,
// the only caller). The database function also bounds its stored length.
export async function resolveReminderDeliveryFailed(
  deliveryId: number,
  claimToken: string,
  sanitizedError: string,
): Promise<boolean> {
  const { data, error } = await getServiceClient().rpc('resolve_reminder_delivery_failed', {
    p_delivery_id: deliveryId,
    p_claim_token: claimToken,
    p_error: sanitizedError,
  })
  if (error) {
    console.error('supabaseServiceClient: resolve_reminder_delivery_failed failed:', error.message)
    return false
  }
  return data === true
}

export type InviteOutcome = { ok: true } | { ok: false; alreadyRegistered: boolean }

// Sends a Supabase-hosted invite email — the only way a new portal account
// is ever created. Requires SUPABASE_SECRET_KEY; auth.admin itself is never
// exposed outside this function. Never returns the underlying Supabase error
// (message or code) to the caller — only the one distinction callers need
// (already registered vs. not), so a request-access failure can never leak
// implementation detail into a browser-facing response.
export async function inviteApprovedEmployee(email: string, redirectTo: string): Promise<InviteOutcome> {
  const { error } = await getServiceClient().auth.admin.inviteUserByEmail(email, { redirectTo })

  if (!error) return { ok: true }

  const alreadyRegistered = error.code === 'email_exists' || error.code === 'user_already_exists'
  if (!alreadyRegistered) {
    console.error('supabaseServiceClient: invite failed:', error.message)
  }
  return { ok: false, alreadyRegistered }
}

export interface ProfileRow {
  id: string
  fullName: string | null
  role: 'manager' | 'admin'
  isActive: boolean
}

export type ProfileLookupResult =
  | { status: 'found'; profile: ProfileRow }
  | { status: 'not-found' }
  // A genuine query failure (bad credential, network issue, RLS/permission
  // problem, etc.) — deliberately distinct from 'not-found' so callers never
  // treat "the lookup broke" the same as "this user genuinely has no
  // profile". No error detail lives on this type itself — only the sanitized
  // Supabase error object is logged server-side (see below); nothing here
  // ever reaches a browser-facing response.
  | { status: 'error' }

// Reads a profile by id via the service client — used by both
// complete-profile (whose own INSERT/UPDATE access to profiles no longer
// exists after this migration) and the login-time sync check, through one
// consistent path rather than mixing an anon-scoped and a service-scoped
// client within the same handler.
export async function findProfileByUserId(userId: string): Promise<ProfileLookupResult> {
  const { data, error } = await getServiceClient()
    .from('profiles')
    .select('id, full_name, role, is_active')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    // Server-side only — message/code/details/hint are exactly what
    // PostgREST/Supabase returned, never forwarded to any HTTP response.
    console.error('supabaseServiceClient: profile lookup failed:', {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
    })
    return { status: 'error' }
  }
  if (!data) return { status: 'not-found' }
  return {
    status: 'found',
    profile: { id: data.id, fullName: data.full_name, role: data.role, isActive: data.is_active },
  }
}

// Create-only. Callers must check findProfileByUserId() first and treat an
// existing row as a no-op success — this never overwrites one.
//
// email is set from employee.emailNormalized — the roster's own normalized
// value, never anything a browser could supply. By the time a caller has a
// legitimate ApprovedEmployee here, it has already been matched against the
// authenticated user's own verified email (see complete-profile.ts's
// `employee.emailNormalized !== emailNormalized` check), so this is
// guaranteed to equal the authenticated identity's email, not just "some
// roster email". Using the normalized (lowercased/trimmed) form matches the
// convention every existing profile already uses.
export async function createProfileFromApprovedEmployee(userId: string, employee: ApprovedEmployee): Promise<ProfileRow | null> {
  const { data, error } = await getServiceClient()
    .from('profiles')
    .insert({
      id: userId,
      full_name: employee.fullName,
      role: employee.portalRole,
      is_active: employee.isActive,
      email: employee.emailNormalized,
    })
    .select('id, full_name, role, is_active')
    .single()

  if (error) {
    console.error('supabaseServiceClient: profile creation failed:', error.message)
    return null
  }
  return { id: data.id, fullName: data.full_name, role: data.role, isActive: data.is_active }
}

export type SyncOutcome =
  | { status: 'synced'; role: 'manager' | 'admin'; isActive: boolean }
  | { status: 'unchanged' }
  | { status: 'denied' }
  | { status: 'no-profile' }
  | { status: 'error' }

// Synchronizes ONLY role and is_active on an ALREADY-EXISTING profile from
// the current approved-roster state — never full_name, never anything else,
// and never the id. This is exclusively the ongoing reconciliation path; it
// is never called as part of initial account creation
// (see createProfileFromApprovedEmployee), so it can never destructively
// overwrite unrelated profile data or historical reports (reports.manager_id
// keeps pointing at the same, untouched profiles.id throughout).
export async function syncProfileAccessFromApprovedEmployee(
  userId: string,
  employee: ApprovedEmployee | null,
): Promise<SyncOutcome> {
  const lookup = await findProfileByUserId(userId)
  if (lookup.status === 'error') return { status: 'error' }
  if (lookup.status === 'not-found') return { status: 'no-profile' }
  const existing = lookup.profile

  if (!employee || !employee.isActive) {
    if (existing.isActive) {
      const { error } = await getServiceClient().from('profiles').update({ is_active: false }).eq('id', userId)
      if (error) {
        console.error('supabaseServiceClient: deactivation sync failed:', {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
        })
        return { status: 'error' }
      }
    }
    return { status: 'denied' }
  }

  if (existing.role === employee.portalRole && existing.isActive === true) {
    return { status: 'unchanged' }
  }

  const { error } = await getServiceClient()
    .from('profiles')
    .update({ role: employee.portalRole, is_active: true })
    .eq('id', userId)

  if (error) {
    console.error('supabaseServiceClient: role/access sync failed:', {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
    })
    return { status: 'error' }
  }
  return { status: 'synced', role: employee.portalRole, isActive: true }
}
