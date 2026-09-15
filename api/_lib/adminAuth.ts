import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { timingSafeEqual } from 'node:crypto'

// Shared by every admin-only api/*.ts handler so the authenticate-then-
// authorize logic (Supabase session -> profile role check) lives in exactly
// one place. A leading underscore keeps this directory out of Vercel's
// automatic api/*.ts route mapping — it's a helper module, not an endpoint.

export interface AdminAuthSuccess {
  ok: true
  supabase: SupabaseClient
  userId: string
  via: 'admin-session' | 'scheduler-bot'
}

export interface AdminAuthFailure {
  ok: false
  status: number
  code: string
  message: string
}

export type AdminAuthResult = AdminAuthSuccess | AdminAuthFailure

interface AdminAuthConfig {
  supabaseUrl: string | undefined
  supabasePublishableKey: string | undefined
  authorizationHeader: string | string[] | undefined
}

// Authenticates the caller via their own Supabase access token (never a
// service_role key) and independently verifies their profile role is
// 'admin'. This is the human-Admin path only — an interactively signed-in
// Admin's own bearer token. Unchanged from before Feature 6B.
export async function authenticateAdmin(config: AdminAuthConfig): Promise<AdminAuthResult> {
  const { supabaseUrl, supabasePublishableKey, authorizationHeader } = config

  if (!supabaseUrl || !supabasePublishableKey) {
    return { ok: false, status: 500, code: 'SERVER_MISCONFIGURED', message: 'Server is missing required configuration.' }
  }

  const authValue = Array.isArray(authorizationHeader) ? authorizationHeader[0] : authorizationHeader
  if (!authValue || !authValue.startsWith('Bearer ')) {
    return { ok: false, status: 401, code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header.' }
  }
  const accessToken = authValue.slice('Bearer '.length).trim()
  if (!accessToken) {
    return { ok: false, status: 401, code: 'UNAUTHORIZED', message: 'Missing access token.' }
  }

  // Use the caller's own access token (not a service_role key) so the
  // existing RLS policies apply exactly as they do in the browser.
  const supabase = createClient(supabaseUrl, supabasePublishableKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false },
  })

  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken)
  if (userError || !userData.user) {
    // Same server-side-only logging convention already used below for
    // profileError — this branch was previously silent, which is exactly
    // why a real "Invalid or expired session" failure couldn't be
    // classified beyond that one generic message. AuthError's own
    // name/status/code are Supabase's own fixed, safe classification
    // strings (e.g. 'bad_jwt', 'session_not_found') — never the token
    // itself, never a credential.
    console.error('adminAuth: getUser() rejected the bearer token:', {
      name: userError?.name,
      status: userError?.status,
      code: userError?.code,
      message: userError?.message,
    })
    return { ok: false, status: 401, code: 'UNAUTHORIZED', message: 'Invalid or expired session.' }
  }

  // Checked before the profile/role lookup, and before anything else this
  // caller might be trying to do: an account still on its shared temporary
  // password (see api/_lib/supabaseServiceClient.ts's createEmployeeAccount)
  // must not reach any Admin API action — including one that would otherwise
  // succeed for a fully-onboarded Admin — until they've set their own
  // password (api/onboarding/complete-profile.ts clears this marker). Read
  // live from getUser()'s own response, never from a client-supplied value;
  // app_metadata is settable only via the Admin API, never by the caller
  // themselves.
  if (userData.user.app_metadata?.password_change_required === true) {
    return {
      ok: false,
      status: 403,
      code: 'PASSWORD_CHANGE_REQUIRED',
      message: 'You must set your own password before continuing.',
    }
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', userData.user.id)
    .maybeSingle()

  if (profileError) {
    console.error('adminAuth: profile lookup failed:', profileError.message)
    return { ok: false, status: 500, code: 'PROFILE_LOOKUP_FAILED', message: 'Could not verify admin access.' }
  }
  if (!profile || profile.role !== 'admin') {
    return { ok: false, status: 403, code: 'FORBIDDEN', message: 'Admin access is required.' }
  }
  // Checked on every request, never cached — a deactivated Admin's old but
  // still-unexpired bearer token is rejected immediately, regardless of
  // what any client UI shows.
  if (!profile.is_active) {
    return { ok: false, status: 403, code: 'FORBIDDEN', message: 'Admin access is required.' }
  }

  return { ok: true, supabase, userId: userData.user.id, via: 'admin-session' }
}

// Compares two secrets in constant time regardless of length. Buffers of
// different lengths can't be passed to crypto.timingSafeEqual directly (it
// throws), so on a length mismatch we still perform an equal-cost comparison
// (the first buffer against itself) before returning false, rather than
// short-circuiting immediately on the length check.
function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA)
    return false
  }
  return timingSafeEqual(bufA, bufB)
}

interface SchedulerAuthConfig {
  supabaseUrl: string | undefined
  supabasePublishableKey: string | undefined
  authorizationHeader: string | string[] | undefined
}

// Authenticates a scheduled (cron) invocation. Never falls back to anything
// else on failure — a missing or wrong secret, or missing bot credentials,
// always ends in a failure result. Order matters: the cron secret is
// verified BEFORE the bot's own credentials are ever read or used, so an
// invalid secret can never trigger a Supabase sign-in attempt at all.
export async function authenticateSchedulerBot(config: SchedulerAuthConfig): Promise<AdminAuthResult> {
  const { supabaseUrl, supabasePublishableKey, authorizationHeader } = config

  if (!supabaseUrl || !supabasePublishableKey) {
    return { ok: false, status: 500, code: 'SERVER_MISCONFIGURED', message: 'Server is missing required configuration.' }
  }

  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('authenticateSchedulerBot: CRON_SECRET is not configured.')
    return { ok: false, status: 500, code: 'SCHEDULER_NOT_CONFIGURED', message: 'Scheduled automation is not configured on this server.' }
  }

  const authValue = Array.isArray(authorizationHeader) ? authorizationHeader[0] : authorizationHeader
  if (!authValue || !authValue.startsWith('Bearer ')) {
    return { ok: false, status: 401, code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header.' }
  }
  const suppliedSecret = authValue.slice('Bearer '.length).trim()

  if (!suppliedSecret || !timingSafeStringEqual(suppliedSecret, cronSecret)) {
    // Invalid secret: fail here. Bot credentials are never read or used
    // beyond this point for this request.
    return { ok: false, status: 401, code: 'UNAUTHORIZED', message: 'Invalid scheduler credentials.' }
  }

  // Only reachable once the cron secret has verified correctly.
  const botEmail = process.env.AUTOMATION_BOT_EMAIL
  const botPassword = process.env.AUTOMATION_BOT_PASSWORD
  if (!botEmail || !botPassword) {
    console.error('authenticateSchedulerBot: automation bot credentials are not fully configured.')
    return { ok: false, status: 500, code: 'SCHEDULER_NOT_CONFIGURED', message: 'Scheduled automation is not configured on this server.' }
  }

  // A fresh sign-in per invocation — no stored refresh token. Uses the
  // caller's (bot's) own credentials, never a service_role key, so the bot
  // is subject to the exact same RLS policies as any human Admin.
  const supabase = createClient(supabaseUrl, supabasePublishableKey, { auth: { persistSession: false } })

  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email: botEmail,
    password: botPassword,
  })

  if (signInError || !signInData.session || !signInData.user) {
    console.error('authenticateSchedulerBot: bot sign-in failed:', signInError?.message)
    return { ok: false, status: 502, code: 'BOT_AUTH_FAILED', message: 'Could not authenticate the automation account.' }
  }

  // Never assume the bot is an admin just because its credentials worked —
  // verify its profile role independently, exactly like a human caller.
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', signInData.user.id)
    .maybeSingle()

  if (profileError) {
    console.error('authenticateSchedulerBot: bot profile lookup failed:', profileError.message)
    return { ok: false, status: 500, code: 'PROFILE_LOOKUP_FAILED', message: 'Could not verify automation account access.' }
  }
  if (!profile || profile.role !== 'admin') {
    console.error('authenticateSchedulerBot: automation account does not have admin role.')
    return { ok: false, status: 403, code: 'FORBIDDEN', message: 'Automation account does not have admin access.' }
  }
  if (!profile.is_active) {
    console.error('authenticateSchedulerBot: automation account is deactivated.')
    return { ok: false, status: 403, code: 'FORBIDDEN', message: 'Automation account does not have admin access.' }
  }

  return { ok: true, supabase, userId: signInData.user.id, via: 'scheduler-bot' }
}

// The authentication-path decision. Vercel automatically sends
// `Authorization: Bearer <value>` on every cron-triggered request when an
// env var is named exactly CRON_SECRET (see
// https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs) —
// there is no custom header it can be configured to send, so this is the
// only real signal available. Fails closed: a missing or empty CRON_SECRET,
// or a missing/malformed Authorization header, is never treated as a match,
// regardless of what's presented. Uses the same timing-safe comparison as
// authenticateSchedulerBot's own (independent, still-authoritative) check —
// this function only decides which path to attempt; it grants nothing by
// itself. Exported for focused testing.
export function isSchedulerBearerToken(authorizationHeader: string | string[] | undefined): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return false

  const authValue = Array.isArray(authorizationHeader) ? authorizationHeader[0] : authorizationHeader
  if (!authValue || !authValue.startsWith('Bearer ')) return false
  const suppliedSecret = authValue.slice('Bearer '.length).trim()
  if (!suppliedSecret) return false

  return timingSafeStringEqual(suppliedSecret, cronSecret)
}

interface AuthenticateRequestConfig {
  supabaseUrl: string | undefined
  supabasePublishableKey: string | undefined
  authorizationHeader: string | string[] | undefined
}

// Single entry point every admin api/*.ts handler should call. Dispatches to
// the scheduler-bot path when the presented bearer token matches
// CRON_SECRET, otherwise to the human-Admin path — never based on a
// caller-suppliable header, which is exactly what let a genuine Vercel Cron
// call be silently misrouted before this change. Callers can tell which
// path was actually used from the result's own `via` field — see
// AdminAuthSuccess.
export async function authenticateRequest(config: AuthenticateRequestConfig): Promise<AdminAuthResult> {
  const { supabaseUrl, supabasePublishableKey, authorizationHeader } = config

  if (isSchedulerBearerToken(authorizationHeader)) {
    return authenticateSchedulerBot({ supabaseUrl, supabasePublishableKey, authorizationHeader })
  }
  return authenticateAdmin({ supabaseUrl, supabasePublishableKey, authorizationHeader })
}
