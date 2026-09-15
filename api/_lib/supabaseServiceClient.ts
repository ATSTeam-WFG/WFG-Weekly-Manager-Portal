import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  decideCreateManagerAccountAction,
  decideCreateAccountForExistingAction,
  deriveManagedUserStatus,
  type ProfileSnapshot,
  type RosterEntrySnapshot,
} from './adminUserManagement.js'

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
  accountCreated: boolean
  // Explicit, never inferred — see submits_weekly_report on both
  // approved_employees and profiles. True for every Manager (backfilled)
  // and for an Admin explicitly designated as also submitting their own
  // weekly report. Never derived from portalRole alone.
  submitsWeeklyReport: boolean
}

interface ApprovedEmployeeRow {
  id: string
  full_name: string
  title: string | null
  email: string
  email_normalized: string
  portal_role: string | null
  is_active: boolean
  account_created_at: string | null
  submits_weekly_report: boolean
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
    accountCreated: row.account_created_at !== null,
    submitsWeeklyReport: row.submits_weekly_report,
  }
}

// approved_employees has no RLS grant for anon or authenticated — this is
// the only code path in the repo permitted to read it.
export async function lookupApprovedEmployeeByNormalizedEmail(emailNormalized: string): Promise<ApprovedEmployee | null> {
  const { data, error } = await getServiceClient()
    .from('approved_employees')
    .select('id, full_name, title, email, email_normalized, portal_role, is_active, account_created_at, submits_weekly_report')
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

// inviteApprovedEmployee/InviteOutcome/InviteSource below are now reached
// ONLY by the self-service Request Access flow (api/onboarding/request-access.ts,
// source: 'self_service') — since Admin User Management no longer sends
// invitation emails at all (see createEmployeeAccount further down, which
// creates the Auth account directly with a shared temporary password
// instead). Left otherwise unchanged/untouched: self-service is still gated
// off by SELF_SERVICE_ONBOARDING_ENABLED and out of scope for that redesign,
// so this function, its 'admin_invite' branch (now unreachable in practice,
// kept rather than removed to avoid touching a working, tested, if currently
// unused, code path), and its own onboarding marker remain exactly as they
// were.
//
// 'sent': the invite email went out and (for an admin_invite source) the
// onboarding marker was set successfully — the ONLY status callers may treat
// as a fully-completed invitation.
// 'sent_marker_failed': admin_invite ONLY — the invite email may already
// have gone out (Supabase's inviteUserByEmail had already succeeded before
// the follow-up updateUserById call failed), but the app_metadata marker
// could not be set. Callers MUST NOT report this as a full success: without
// the marker, the invited employee will land on NoProfile instead of Create
// Password.
// 'already_registered' / 'send_failed': unchanged pre-existing outcomes —
// the invite email itself was not (re)sent.
export type InviteOutcome =
  | { status: 'sent' }
  | { status: 'sent_marker_failed' }
  | { status: 'already_registered' }
  | { status: 'send_failed' }

// Which flow originated this invite. Controls ONLY whether the app_metadata
// onboarding marker below gets set — never anything about the invite email
// itself, and never a substitute for SELF_SERVICE_ONBOARDING_ENABLED (which
// still independently gates the self-service Request Access UI/flow
// entirely separately from this).
export type InviteSource = 'admin_invite' | 'self_service'

// The key/value set on the invited user's app_metadata (never user_metadata)
// when source is 'admin_invite' — see src/lib/onboardingSession.ts, the sole
// reader of this marker. app_metadata is writable only via this
// service-role-credentialed admin.updateUserById call, never by the client
// itself (supabase.auth.updateUser only ever touches user_metadata), so it
// is a trustworthy, server-issued routing hint — never a client-side flag or
// URL param, and never itself the authorization boundary: complete-profile.ts's
// own approved_employees check remains that, unchanged, regardless of this
// marker.
const ADMIN_INVITE_APP_METADATA = { onboarding_source: 'admin_invite' } as const

// Sends a Supabase-hosted invite email — the only way a new portal account
// is ever created. Requires SUPABASE_SECRET_KEY; auth.admin itself is never
// exposed outside this function. Never returns the underlying Supabase error
// (message or code) to the caller — only the fixed status values above, so a
// request-access or Admin-invite failure can never leak implementation
// detail into a browser-facing response.
//
// Sender address note: the approved company sender (WeeklyUpdates@wfgtitle.com,
// see WEEKLY_UPDATES_FROM_EMAIL in api/_lib/emailSender.ts) cannot be applied
// to this email from application code — Supabase's admin.inviteUserByEmail
// has no from-address parameter at all. The sender for every Supabase-hosted
// auth email (invite, recovery, etc.) is fixed by the Supabase project's own
// Auth SMTP configuration (Dashboard -> Authentication -> Emails -> SMTP
// Settings -> Sender email), which must be set there directly, separately
// from this codebase, once real SMTP is approved and configured.
export async function inviteApprovedEmployee(email: string, redirectTo: string, source: InviteSource): Promise<InviteOutcome> {
  const { data, error } = await getServiceClient().auth.admin.inviteUserByEmail(email, { redirectTo })

  if (error) {
    const alreadyRegistered = error.code === 'email_exists' || error.code === 'user_already_exists'
    if (!alreadyRegistered) {
      console.error('supabaseServiceClient: invite failed:', error.message)
    }
    return alreadyRegistered ? { status: 'already_registered' } : { status: 'send_failed' }
  }

  // Only an Admin-initiated invite gets tagged — a self-service invite
  // (request-access.ts) must never become eligible for Create Password
  // through this path; it stays gated by SELF_SERVICE_ONBOARDING_ENABLED
  // exactly as before.
  if (source === 'admin_invite') {
    // The invite email has already been sent by this point — Supabase does
    // not offer an atomic "send + tag" operation, so this can genuinely
    // diverge from the marker below. Reporting 'sent' here regardless would
    // let the caller believe onboarding is fully wired up when it isn't;
    // 'sent_marker_failed' forces every caller to treat this as incomplete.
    if (!data.user) {
      console.error('supabaseServiceClient: invite succeeded but returned no user id; cannot set the admin-invite marker.')
      return { status: 'sent_marker_failed' }
    }
    const { error: metadataError } = await getServiceClient().auth.admin.updateUserById(data.user.id, {
      app_metadata: ADMIN_INVITE_APP_METADATA,
    })
    if (metadataError) {
      console.error('supabaseServiceClient: setting admin-invite onboarding marker failed:', metadataError.message)
      return { status: 'sent_marker_failed' }
    }
  }

  return { status: 'sent' }
}

// -----------------------------------------------------------------------
// Shared-temporary-password account creation — Admin User Management's
// current onboarding mechanism. Replaces invitation emails/links entirely:
// the Auth account is created directly, with a fixed, server-only temporary
// password (EMPLOYEE_TEMP_PASSWORD, never read anywhere outside this
// function, never bundled into client code, never logged, never returned to
// any caller), and app_metadata.password_change_required=true. No email is
// ever sent by this call — Admin User Management sends no email at all;
// the temporary password is communicated to the employee entirely outside
// this codebase (see src/lib/onboardingSession.ts for the marker that keeps
// the employee locked out of normal portal use until they change it).
// -----------------------------------------------------------------------

const PASSWORD_CHANGE_REQUIRED_APP_METADATA = { password_change_required: true } as const

export type CreateAccountOutcome = { status: 'created' } | { status: 'already_registered' } | { status: 'failed' }

// Never logs, returns, or otherwise exposes EMPLOYEE_TEMP_PASSWORD's value —
// only whether the call succeeded. A missing env var fails closed (never
// falls back to inviting, never proceeds with an empty/undefined password).
export async function createEmployeeAccount(email: string): Promise<CreateAccountOutcome> {
  const tempPassword = process.env.EMPLOYEE_TEMP_PASSWORD
  if (!tempPassword) {
    console.error('supabaseServiceClient: EMPLOYEE_TEMP_PASSWORD is not configured.')
    return { status: 'failed' }
  }

  const { error } = await getServiceClient().auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    app_metadata: PASSWORD_CHANGE_REQUIRED_APP_METADATA,
  })

  if (error) {
    const alreadyRegistered = error.code === 'email_exists' || error.code === 'user_already_exists'
    if (!alreadyRegistered) {
      console.error('supabaseServiceClient: createEmployeeAccount failed:', error.message)
    }
    return alreadyRegistered ? { status: 'already_registered' } : { status: 'failed' }
  }

  return { status: 'created' }
}

// Clears the mandatory-password-change marker once the employee has
// successfully set their own password (see api/onboarding/complete-profile.ts).
// Best-effort: a failure here is logged, never thrown — the caller (profile
// creation) has already succeeded and must not be reported as failed just
// because this follow-up call had trouble; see complete-profile.ts's own
// comment for the known limitation this implies (a failure here leaves the
// employee still gated on their very next request until retried).
export async function clearPasswordChangeRequired(userId: string): Promise<boolean> {
  const { error } = await getServiceClient().auth.admin.updateUserById(userId, {
    app_metadata: { password_change_required: false },
  })
  if (error) {
    console.error('supabaseServiceClient: clearing password_change_required failed:', error.message)
    return false
  }
  return true
}

export interface ProfileRow {
  id: string
  fullName: string | null
  role: 'manager' | 'admin'
  isActive: boolean
  submitsWeeklyReport: boolean
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
    .select('id, full_name, role, is_active, submits_weekly_report')
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
    profile: {
      id: data.id,
      fullName: data.full_name,
      role: data.role,
      isActive: data.is_active,
      submitsWeeklyReport: data.submits_weekly_report,
    },
  }
}

// Reads a profile by its normalized email — used by Admin User Management,
// where the caller (an approved_employees row) has no userId at all until
// the invited person actually signs up. profiles.email is always the
// roster's own normalized value (see createProfileFromApprovedEmployee), so
// matching on it here is exact, never a case-sensitivity or whitespace trap.
export async function findProfileByEmail(emailNormalized: string): Promise<ProfileLookupResult> {
  const { data, error } = await getServiceClient()
    .from('profiles')
    .select('id, full_name, role, is_active, submits_weekly_report')
    .eq('email', emailNormalized)
    .maybeSingle()

  if (error) {
    console.error('supabaseServiceClient: profile lookup by email failed:', {
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
    profile: {
      id: data.id,
      fullName: data.full_name,
      role: data.role,
      isActive: data.is_active,
      submitsWeeklyReport: data.submits_weekly_report,
    },
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
      // Copied verbatim from the roster — never inferred from role, never
      // defaulted here. See ApprovedEmployee.submitsWeeklyReport.
      submits_weekly_report: employee.submitsWeeklyReport,
    })
    .select('id, full_name, role, is_active, submits_weekly_report')
    .single()

  if (error) {
    console.error('supabaseServiceClient: profile creation failed:', error.message)
    return null
  }
  return {
    id: data.id,
    fullName: data.full_name,
    role: data.role,
    isActive: data.is_active,
    submitsWeeklyReport: data.submits_weekly_report,
  }
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

// -----------------------------------------------------------------------
// Admin User Management — Admin-driven account creation, deactivation, and
// reactivation, built entirely on the existing approved_employees /
// profiles / Supabase Auth architecture above (no parallel user system).
// Every function here is called only from an Admin-authenticated
// api/admin/users/*.ts endpoint (authenticateAdmin) — never reachable by a
// Manager. The WHAT-should-happen decisions live in
// api/_lib/adminUserManagement.ts (pure, directly unit-tested); these
// functions are the thin I/O layer that fetches fresh state, calls that
// decision logic, and performs exactly the resulting read/write.
// -----------------------------------------------------------------------

export interface ManagedUserSummary {
  fullName: string
  email: string
  role: 'manager' | 'admin'
  status: ReturnType<typeof deriveManagedUserStatus>
  // Read-only display flag — see submits_weekly_report on approved_employees.
  // Never a toggle here; changing it is not part of this surface.
  submitsWeeklyReport: boolean
}

// Lists every approved_employees row with a real portal_role assigned,
// joined against profiles by normalized email (the only link between the
// two tables prior to sign-up — approved_employees has no auth.users id at
// all until the person completes Create Password). The displayed role
// prefers the profile's own current role when one exists (the actual,
// currently-enforced access level) and falls back to the roster's
// portal_role for a still-pending/awaiting-first-login entry.
export async function listManagedUsers(): Promise<ManagedUserSummary[] | null> {
  const client = getServiceClient()
  const [rosterResult, profileResult] = await Promise.all([
    client
      .from('approved_employees')
      .select('full_name, email, email_normalized, portal_role, is_active, account_created_at, submits_weekly_report'),
    client.from('profiles').select('email, role, is_active'),
  ])

  if (rosterResult.error || profileResult.error) {
    console.error(
      'supabaseServiceClient: listManagedUsers failed:',
      rosterResult.error?.message ?? profileResult.error?.message,
    )
    return null
  }

  const profileByEmail = new Map((profileResult.data ?? []).map((p) => [p.email, p]))

  return (rosterResult.data ?? [])
    .filter((row): row is typeof row & { portal_role: 'manager' | 'admin' } => row.portal_role === 'manager' || row.portal_role === 'admin')
    .map((row) => {
      const profile = profileByEmail.get(row.email_normalized)
      const profileSnapshot: ProfileSnapshot | null = profile ? { isActive: profile.is_active } : null
      return {
        fullName: row.full_name,
        email: row.email,
        role: (profile?.role ?? row.portal_role) as 'manager' | 'admin',
        status: deriveManagedUserStatus(row.is_active, row.account_created_at !== null, profileSnapshot),
        submitsWeeklyReport: row.submits_weekly_report,
      }
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName))
}

async function fetchRosterAndProfileSnapshots(
  emailNormalized: string,
): Promise<{ roster: RosterEntrySnapshot | null; profile: ProfileSnapshot | null } | { error: true }> {
  const employee = await lookupApprovedEmployeeByNormalizedEmail(emailNormalized)
  const profileLookup = await findProfileByEmail(emailNormalized)
  if (profileLookup.status === 'error') return { error: true }
  return {
    roster: employee ? { portalRole: employee.portalRole, isActive: employee.isActive, accountCreated: employee.accountCreated } : null,
    profile: profileLookup.status === 'found' ? { isActive: profileLookup.profile.isActive } : null,
  }
}

// Shared tail for both addOrCreateManagerAccount and
// createAccountForExistingEmployee below: actually create the Auth account,
// then record approved_employees.account_created_at so the User Management
// list can show "Awaiting First Login" without any extra Auth-API lookup.
// A failure to record the timestamp is logged but not fatal — the account
// itself was already created successfully; the roster row simply won't
// reflect that until the next successful call (harmless: it never blocks
// or duplicates account creation, since createEmployeeAccount itself
// already fails closed with 'already_registered' for a second attempt).
async function createAccountAndMarkRoster(
  emailNormalized: string,
  email: string,
): Promise<{ status: 'created' } | { status: 'already_created' } | { status: 'error' }> {
  const outcome = await createEmployeeAccount(email)
  if (outcome.status === 'failed') return { status: 'error' }
  if (outcome.status === 'already_registered') return { status: 'already_created' }

  const { error: markError } = await getServiceClient()
    .from('approved_employees')
    .update({ account_created_at: new Date().toISOString() })
    .eq('email_normalized', emailNormalized)
  if (markError) {
    console.error('supabaseServiceClient: failed to record account_created_at:', markError.message)
  }

  return { status: 'created' }
}

export type CreateManagerAccountOutcome =
  | { status: 'created' }
  | { status: 'already_registered' }
  | { status: 'already_created' }
  | { status: 'invalid_domain' }
  | { status: 'role_conflict' }
  | { status: 'inactive' }
  | { status: 'error' }

// "Add Manager" — Admin-only, from api/admin/users/invite.ts. fullName is
// only ever used the FIRST time a roster row is created for this email; if
// one already exists, its stored name is left untouched. No email is sent —
// this creates the Auth account directly with the shared temporary
// password (see createEmployeeAccount); the employee's own portal access
// details are communicated to them entirely outside this codebase.
export async function addOrCreateManagerAccount(fullName: string, email: string): Promise<CreateManagerAccountOutcome> {
  const emailNormalized = normalizeEmail(email)
  const snapshots = await fetchRosterAndProfileSnapshots(emailNormalized)
  if ('error' in snapshots) return { status: 'error' }

  const decision = decideCreateManagerAccountAction(emailNormalized, snapshots.roster, snapshots.profile)

  if (decision.action === 'invalid_domain') return { status: 'invalid_domain' }
  if (decision.action === 'role_conflict') return { status: 'role_conflict' }
  if (decision.action === 'inactive') return { status: 'inactive' }
  if (decision.action === 'already_registered') return { status: 'already_registered' }
  if (decision.action === 'already_created') return { status: 'already_created' }

  if (decision.action === 'create_roster_and_account') {
    const { error: upsertError } = await getServiceClient()
      .from('approved_employees')
      .upsert(
        {
          full_name: fullName.trim(),
          email,
          email_normalized: emailNormalized,
          portal_role: 'manager',
          is_active: true,
          // Every manager created through User Management submits their own
          // weekly report — explicit here, never inferred from portal_role.
          submits_weekly_report: true,
        },
        { onConflict: 'email_normalized' },
      )
    if (upsertError) {
      console.error('supabaseServiceClient: addOrCreateManagerAccount roster upsert failed:', upsertError.message)
      return { status: 'error' }
    }
  }

  const result = await createAccountAndMarkRoster(emailNormalized, email)
  if (result.status === 'error') return { status: 'error' }
  if (result.status === 'already_created') return { status: 'already_created' }
  return { status: 'created' }
}

export type CreateAccountForExistingOutcome =
  | { status: 'created' }
  | { status: 'not_found' }
  | { status: 'already_registered' }
  | { status: 'already_created' }
  | { status: 'inactive' }
  | { status: 'error' }

// The per-row "Create Account" action in User Management — Admin-only, from
// api/admin/users/create-account.ts. Never creates a roster row and never
// sets/changes a role; only creates the Auth account (shared temporary
// password) for an existing, active, not-yet-created roster entry — Manager
// or Admin alike.
export async function createAccountForExistingEmployee(email: string): Promise<CreateAccountForExistingOutcome> {
  const emailNormalized = normalizeEmail(email)
  const snapshots = await fetchRosterAndProfileSnapshots(emailNormalized)
  if ('error' in snapshots) return { status: 'error' }

  const decision = decideCreateAccountForExistingAction(snapshots.roster, snapshots.profile)
  if (decision.action === 'not_found') return { status: 'not_found' }
  if (decision.action === 'inactive') return { status: 'inactive' }
  if (decision.action === 'already_registered') return { status: 'already_registered' }
  if (decision.action === 'already_created') return { status: 'already_created' }

  const result = await createAccountAndMarkRoster(emailNormalized, email)
  if (result.status === 'error') return { status: 'error' }
  if (result.status === 'already_created') return { status: 'already_created' }
  return { status: 'created' }
}

export type SetManagedUserActiveOutcome = { status: 'ok' } | { status: 'not_found' } | { status: 'error' }

// Deactivate/reactivate — Admin-only, from api/admin/users/set-active.ts.
// Updates approved_employees.is_active immediately (the roster is the
// source of truth Admin User Management manages directly) and, if a
// profile already exists, profiles.is_active too, in the same call — this
// takes effect immediately regardless of EMPLOYEE_ROSTER_SYNC_ENABLED,
// which gates a completely separate mechanism (automatic login-time
// reconciliation), not direct Admin action. Never touches role/portal_role
// — role is always preserved across a deactivate/reactivate cycle.
export async function setManagedUserActive(email: string, isActive: boolean): Promise<SetManagedUserActiveOutcome> {
  const emailNormalized = normalizeEmail(email)
  const client = getServiceClient()

  const { data: rosterRow, error: rosterSelectError } = await client
    .from('approved_employees')
    .select('id')
    .eq('email_normalized', emailNormalized)
    .maybeSingle()

  if (rosterSelectError) {
    console.error('supabaseServiceClient: setManagedUserActive roster lookup failed:', rosterSelectError.message)
    return { status: 'error' }
  }
  if (!rosterRow) return { status: 'not_found' }

  const { error: rosterUpdateError } = await client
    .from('approved_employees')
    .update({ is_active: isActive })
    .eq('email_normalized', emailNormalized)

  if (rosterUpdateError) {
    console.error('supabaseServiceClient: setManagedUserActive roster update failed:', rosterUpdateError.message)
    return { status: 'error' }
  }

  const profileLookup = await findProfileByEmail(emailNormalized)
  if (profileLookup.status === 'error') return { status: 'error' }
  if (profileLookup.status === 'found') {
    const { error: profileUpdateError } = await client
      .from('profiles')
      .update({ is_active: isActive })
      .eq('id', profileLookup.profile.id)

    if (profileUpdateError) {
      console.error('supabaseServiceClient: setManagedUserActive profile update failed:', profileUpdateError.message)
      return { status: 'error' }
    }
  }

  return { status: 'ok' }
}
