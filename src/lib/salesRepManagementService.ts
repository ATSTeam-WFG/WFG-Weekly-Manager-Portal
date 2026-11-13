import { getValidAccessToken } from './sessionService'

// Re-exported for convenience so SalesRepManagement.tsx has a single import
// for everything it needs — assignment/unassignment/exception-granting
// themselves are untouched, already-built-and-tested RPC wrappers (see
// repReportsService.ts); this file never re-implements them.
export { assignSalesRep, unassignSalesRep, grantLateSubmissionException, RepReportError, type RepReportErrorCode } from './repReportsService'

// This is a COMPLETELY SEPARATE service module from adminUserManagementService.ts
// — it is never imported by, and never imports from, that file. See
// listUsersOutcome.ts's own note: the Manager/Admin roster surface is
// deliberately narrowed on purpose, and Sales Rep provisioning gets its own
// parallel surface instead.

export interface SalesRep {
  id: string
  fullName: string
  email: string
  isActive: boolean
  status: 'pending' | 'awaiting_first_login' | 'active' | 'inactive'
  // null until this rep has completed onboarding (no profiles row yet) —
  // see api/_lib/supabaseServiceClient.ts's SalesRepSummary. The UI must
  // disable assignment/exception controls whenever this is null.
  profileId: string | null
  currentManagerId: string | null
  currentManagerName: string | null
  // true for a genuine, reconciled Phase 1A Sales Rep; false for a demo/test
  // account or a rep who hasn't completed onboarding yet. See
  // api/_lib/supabaseServiceClient.ts's VERIFIED_REAL_SALES_REP_IDS.
  isVerifiedReal: boolean
}

export type FetchSalesRepsOutcome =
  | { status: 'ok'; reps: SalesRep[] }
  // code/message are always either one of the client-side codes below, or
  // the server's own already-sanitized {error, message} — never raw
  // Supabase/service-role detail, a token, or a stack trace. Same
  // convention as FetchManagedUsersOutcome in listUsersOutcome.ts.
  | { status: 'error'; code: string; message: string }

const NO_VALID_SESSION_OUTCOME: FetchSalesRepsOutcome = {
  status: 'error',
  code: 'NO_VALID_SESSION',
  message: 'Your session could not be verified. Please sign in again.',
}

const REQUEST_FAILED_OUTCOME: FetchSalesRepsOutcome = {
  status: 'error',
  code: 'REQUEST_FAILED',
  message: 'Could not reach the server. Please check your connection and try again.',
}

// Admin-only listing — the server (api/admin/users/list-sales-reps.ts)
// independently re-verifies the caller is an active Admin on every request;
// this client service never assumes anything about the caller's own role.
export async function fetchSalesReps(): Promise<FetchSalesRepsOutcome> {
  let accessToken: string
  try {
    accessToken = await getValidAccessToken()
  } catch {
    return NO_VALID_SESSION_OUTCOME
  }

  let response: Response
  try {
    response = await fetch('/api/admin/users/list-sales-reps', {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  } catch {
    return REQUEST_FAILED_OUTCOME
  }

  const body = await response.json().catch(() => null)

  if (response.ok && body && typeof body === 'object' && Array.isArray((body as Record<string, unknown>).reps)) {
    return { status: 'ok', reps: (body as { reps: SalesRep[] }).reps }
  }
  if (
    body &&
    typeof body === 'object' &&
    typeof (body as Record<string, unknown>).error === 'string' &&
    typeof (body as Record<string, unknown>).message === 'string'
  ) {
    const typed = body as { error: string; message: string }
    return { status: 'error', code: typed.error, message: typed.message }
  }
  return REQUEST_FAILED_OUTCOME
}

export interface ActiveManager {
  id: string
  fullName: string | null
  email: string
}

// Populates the "Assign Manager" dropdown. Never itself a security
// boundary — see api/admin/users/list-managers.ts's own note. Fails soft
// (empty array) rather than throwing, since a failure here should degrade
// to "no managers available to assign" rather than block the whole screen.
export async function fetchActiveManagers(): Promise<ActiveManager[]> {
  let accessToken: string
  try {
    accessToken = await getValidAccessToken()
  } catch {
    return []
  }

  let response: Response
  try {
    response = await fetch('/api/admin/users/list-managers', {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  } catch {
    return []
  }

  const body = await response.json().catch(() => null)
  if (response.ok && body && typeof body === 'object' && Array.isArray((body as Record<string, unknown>).managers)) {
    return (body as { managers: ActiveManager[] }).managers
  }
  return []
}

export type SetSalesRepActiveOutcome = { status: 'ok'; isActive: boolean } | { status: 'partial_failure' | 'error' }

// Uses the existing Admin/Sales-Admin set-active endpoint. Its server-side
// auth checks restrict a sales_admin to sales_rep targets before any write;
// this wrapper never accepts a caller role or widens that authorization.
export async function setSalesRepActive(email: string, isActive: boolean): Promise<SetSalesRepActiveOutcome> {
  let accessToken: string
  try {
    accessToken = await getValidAccessToken()
  } catch {
    return { status: 'error' }
  }

  let response: Response
  try {
    response = await fetch('/api/admin/users/set-active', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, isActive }),
    })
  } catch {
    return { status: 'error' }
  }

  const body = await response.json().catch(() => null)
  if (!response.ok) return body?.error === 'PARTIAL_FAILURE' ? { status: 'partial_failure' } : { status: 'error' }
  if (!body || typeof body.isActive !== 'boolean') return { status: 'error' }
  return { status: 'ok', isActive: body.isActive }
}

export type UpdateSalesRepOutcome =
  | { status: 'ok' }
  // The name (if changed) was saved; the email change is pending — a
  // verification link was sent to the new address and the account keeps
  // signing in with its current email until it's confirmed.
  | { status: 'pending_verification' }
  | { status: 'not_found' | 'forbidden' | 'invalid_domain' | 'email_conflict' | 'auth_identity_unresolved' | 'partial_failure' | 'error' }

const UPDATE_SALES_REP_ERROR_CODES: Record<string, Exclude<UpdateSalesRepOutcome['status'], 'ok'>> = {
  NOT_FOUND: 'not_found',
  FORBIDDEN: 'forbidden',
  INVALID_DOMAIN: 'invalid_domain',
  EMAIL_CONFLICT: 'email_conflict',
  AUTH_IDENTITY_UNRESOLVED: 'auth_identity_unresolved',
  PARTIAL_FAILURE: 'partial_failure',
}

// Name/email-only correction. The server independently checks active Admin
// or Sales Admin authentication and the target's actual sales_rep role;
// this browser service never receives or exposes a service-role credential.
export async function updateSalesRep(id: string, fullName: string, email: string): Promise<UpdateSalesRepOutcome> {
  let accessToken: string
  try {
    accessToken = await getValidAccessToken()
  } catch {
    return { status: 'error' }
  }

  let response: Response
  try {
    response = await fetch('/api/admin/users/update-sales-rep', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, fullName, email }),
    })
  } catch {
    return { status: 'error' }
  }

  const body = await response.json().catch(() => null)
  if (response.ok && body?.status === 'ok') return { status: 'ok' }
  if (response.ok && body?.status === 'pending_verification') return { status: 'pending_verification' }
  if (body && typeof body === 'object' && typeof body.error === 'string' && UPDATE_SALES_REP_ERROR_CODES[body.error]) {
    return { status: UPDATE_SALES_REP_ERROR_CODES[body.error] }
  }
  return { status: 'error' }
}

export type InviteSalesRepOutcome =
  | { status: 'created' }
  | { status: 'already_created' }
  | { status: 'already_registered' }
  | { status: 'invalid_domain' }
  | { status: 'role_conflict' }
  | { status: 'inactive' }
  | { status: 'error' }

const INVITE_SALES_REP_ERROR_CODES: Record<string, InviteSalesRepOutcome['status']> = {
  ALREADY_CREATED: 'already_created',
  ALREADY_REGISTERED: 'already_registered',
  INVALID_DOMAIN: 'invalid_domain',
  ROLE_CONFLICT: 'role_conflict',
  INACTIVE: 'inactive',
}

// "Add Sales Rep" — creates the roster row (if needed, role: sales_rep) and
// the rep's Auth account directly with the shared temporary password. No
// email is sent by this call. Never sends a role in the request body — the
// server (api/admin/users/invite-sales-rep.ts) always hardcodes sales_rep.
export async function inviteSalesRep(fullName: string, email: string): Promise<InviteSalesRepOutcome> {
  let accessToken: string
  try {
    accessToken = await getValidAccessToken()
  } catch {
    return { status: 'error' }
  }

  let response: Response
  try {
    response = await fetch('/api/admin/users/invite-sales-rep', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName, email }),
    })
  } catch {
    return { status: 'error' }
  }

  const body = await response.json().catch(() => null)

  if (response.ok && body?.status === 'created') return { status: 'created' }
  if (body?.error && INVITE_SALES_REP_ERROR_CODES[body.error]) {
    return { status: INVITE_SALES_REP_ERROR_CODES[body.error] }
  }
  return { status: 'error' }
}
