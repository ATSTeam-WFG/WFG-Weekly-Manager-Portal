import { supabase } from './supabaseClient'
import { fetchRepReportWithOutcome, type RepReport } from './repReportsService'
import type { FetchRepReportOutcome } from './repReportsService'
import { getValidAccessToken } from './sessionService'

// Keep Manager self-service Add/Edit/Remove Assignment UI disabled until the
// backend (Node endpoints, database kill switch, and allowlist) has actually
// been activated for approved Preview test accounts — see
// api/manager/sales-reps/assign.ts, unassign.ts, and the
// app.manager_account_actions_enabled / app.manager_account_actions_allowed_ids
// database GUCs, which independently re-check authorization regardless of
// this flag. This client-side flag only controls whether the UI renders live
// controls instead of the existing disabled "pending approval" buttons.
export const MANAGER_ACCOUNT_ACTIONS_UI_ENABLED =
  import.meta.env.VITE_MANAGER_ACCOUNT_ACTIONS_ENABLED === 'true'

export interface ManagerAssignedSalesRep {
  repId: string
  fullName: string | null
  email: string
  isActive: boolean | null
  // A current assignment references a profiles row, so onboarding is normally
  // complete. Null is retained as a safe fallback for a broken/legacy join.
  onboardingStatus: 'complete' | 'unavailable'
}

export interface ManagerSalesRepReport extends ManagerAssignedSalesRep {
  reportOutcome: FetchRepReportOutcome
  report: RepReport | null
}

export type ManagerSalesRepListOutcome =
  | { status: 'ok'; reps: ManagerAssignedSalesRep[] }
  | { status: 'error'; message: string }

export type ManagerSalesRepReportsOutcome =
  | { status: 'ok'; reps: ManagerSalesRepReport[] }
  | { status: 'error'; message: string }

// Read-only RLS path for the Manager tabs. Identity is obtained from the
// signed-in Supabase session (never a caller-supplied manager id), and the
// role/active check fails closed before roster reads. rep_manager_assignments
// and profiles remain queried with the user's ordinary client; RLS limits
// assignments to manager_id = auth.uid() and profiles to currently assigned
// Sales Reps. No Admin/Sales Admin roster endpoint or service-role key is used.
export async function fetchManagerAssignedSalesReps(): Promise<ManagerSalesRepListOutcome> {
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) {
    return { status: 'error', message: 'Your session could not be verified. Please sign in again.' }
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', userData.user.id)
    .maybeSingle()
  if (profileError) {
    console.error('Could not verify Manager access:', profileError.message)
    return { status: 'error', message: 'Could not verify Manager access. Please refresh and try again.' }
  }
  if (!profile || profile.role !== 'manager' || profile.is_active !== true) {
    return { status: 'error', message: 'Active Manager access is required.' }
  }

  const { data: assignments, error: assignmentError } = await supabase
    .from('rep_manager_assignments')
    .select('rep_id')
    .eq('manager_id', userData.user.id)
    .is('unassigned_at', null)
    .order('assigned_at', { ascending: true })
  if (assignmentError) {
    console.error('Could not load Manager Sales Rep assignments:', assignmentError.message)
    return { status: 'error', message: 'Could not load your Sales Reps. Please try again.' }
  }

  const repIds = (assignments ?? []).map((assignment) => assignment.rep_id as string)
  if (repIds.length === 0) return { status: 'ok', reps: [] }

  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, full_name, email, is_active')
    .in('id', repIds)
  if (profilesError) {
    console.error('Could not load assigned Sales Rep profiles:', profilesError.message)
    return { status: 'error', message: 'Could not load your Sales Reps. Please try again.' }
  }

  const profileById = new Map((profiles ?? []).map((row) => [row.id as string, row]))
  return {
    status: 'ok',
    reps: repIds.map((repId) => {
      const rep = profileById.get(repId)
      return {
        repId,
        fullName: (rep?.full_name as string | null | undefined) ?? null,
        email: (rep?.email as string | undefined) ?? '',
        isActive: (rep?.is_active as boolean | undefined) ?? null,
        onboardingStatus: rep ? 'complete' : 'unavailable',
      }
    }),
  }
}

// Per-rep report fetches are intentionally constrained to the roster returned
// by the current-assignment RLS query above. Each report read is independently
// checked by rep_reports RLS, which preserves the assignment-id historical
// visibility rules and any pending/reviewer exceptions already in force.
export async function fetchManagerSalesRepReports(weekStartDate: string): Promise<ManagerSalesRepReportsOutcome> {
  const roster = await fetchManagerAssignedSalesReps()
  if (roster.status !== 'ok') return roster

  const reportOutcomes = await Promise.all(
    roster.reps.map((rep) => fetchRepReportWithOutcome(rep.repId, weekStartDate)),
  )
  if (reportOutcomes.some((outcome) => outcome.status === 'error')) {
    return { status: 'error', message: 'Could not load report status for this week. Please try again.' }
  }

  return {
    status: 'ok',
    reps: roster.reps.map((rep, index) => {
      const outcome = reportOutcomes[index]
      return {
        ...rep,
        reportOutcome: outcome,
        report: outcome.status === 'found' ? outcome.report : null,
      }
    }),
  }
}

export type EditOwnSalesRepOutcome =
  | { status: 'ok' }
  | { status: 'pending_verification' }
  | { status: 'not_found' | 'forbidden' | 'invalid_domain' | 'email_conflict' | 'auth_identity_unresolved' | 'partial_failure' | 'error' }

const EDIT_OWN_SALES_REP_ERROR_CODES: Record<string, Exclude<EditOwnSalesRepOutcome['status'], 'ok'>> = {
  NOT_FOUND: 'not_found',
  FORBIDDEN: 'forbidden',
  INVALID_DOMAIN: 'invalid_domain',
  EMAIL_CONFLICT: 'email_conflict',
  AUTH_IDENTITY_UNRESOLVED: 'auth_identity_unresolved',
  PARTIAL_FAILURE: 'partial_failure',
}

// Reuses the existing api/admin/users/update-sales-rep.ts endpoint — it now
// also accepts a Manager caller and independently re-verifies ownership
// server-side (see managerSalesRepAuthorizationWiring.test.ts). repId here
// is the rep's PROFILE id (the only id a Manager's own RLS-scoped view ever
// has for them); the endpoint bridges it to the roster row internally.
export async function editOwnSalesRep(repId: string, fullName: string, email: string): Promise<EditOwnSalesRepOutcome> {
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
      body: JSON.stringify({ id: repId, fullName, email }),
    })
  } catch {
    return { status: 'error' }
  }

  const body = await response.json().catch(() => null)
  if (response.ok && body?.status === 'pending_verification') return { status: 'pending_verification' }
  if (response.ok) return { status: 'ok' }
  const code = body && typeof body === 'object' ? (body as Record<string, unknown>).error : null
  return { status: (typeof code === 'string' && EDIT_OWN_SALES_REP_ERROR_CODES[code]) || 'error' }
}

export type InviteOwnSalesRepOutcome =
  | { status: 'ok' }
  | { status: 'already_registered' | 'invalid_domain' | 'role_conflict' | 'inactive' | 'error' }
  | { status: 'pending_conflict'; message: string }

// "Add Sales Rep" for a Manager — a dedicated client wrapper rather than
// reusing salesRepManagementService.ts's inviteSalesRep, which has no
// pending_conflict outcome and is left completely untouched for Super
// Admin/Sales Admin. Calls the same /api/admin/users/invite-sales-rep
// endpoint — it now also accepts a Manager caller and records a pending
// assignment claim server-side (see inviteSalesRepAsManager), finalized
// automatically once the new rep completes their first login.
export async function inviteOwnSalesRep(fullName: string, email: string): Promise<InviteOwnSalesRepOutcome> {
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

  if (response.ok) return { status: 'ok' }
  const body = await response.json().catch(() => null)
  const code = body && typeof body === 'object' ? (body as Record<string, unknown>).error : null
  const message = body && typeof body === 'object' ? (body as Record<string, unknown>).message : null
  if (code === 'PENDING_CONFLICT') return { status: 'pending_conflict', message: typeof message === 'string' ? message : 'This person already has a pending invitation from another Manager.' }
  if (code === 'ALREADY_REGISTERED') return { status: 'already_registered' }
  if (code === 'INVALID_DOMAIN') return { status: 'invalid_domain' }
  if (code === 'ROLE_CONFLICT') return { status: 'role_conflict' }
  if (code === 'INACTIVE') return { status: 'inactive' }
  return { status: 'error' }
}

export type RemoveOwnAssignmentOutcome =
  | { status: 'ok' }
  | { status: 'not_found' | 'invalid_rep' | 'forbidden' | 'error' }

// Calls the draft, currently-disabled api/manager/sales-reps/unassign.ts
// endpoint. Closes only the calling Manager's own current assignment row —
// never deactivates the Sales Rep's account, never deletes assignment
// history (see the draft RPC's own review comments).
export async function removeOwnAssignment(repId: string): Promise<RemoveOwnAssignmentOutcome> {
  let accessToken: string
  try {
    accessToken = await getValidAccessToken()
  } catch {
    return { status: 'error' }
  }

  let response: Response
  try {
    response = await fetch('/api/manager/sales-reps/unassign', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ repId }),
    })
  } catch {
    return { status: 'error' }
  }

  if (response.ok) return { status: 'ok' }
  const body = await response.json().catch(() => null)
  const code = body && typeof body === 'object' ? (body as Record<string, unknown>).error : null
  if (code === 'ASSIGNMENT_NOT_FOUND') return { status: 'not_found' }
  if (code === 'INVALID_REP') return { status: 'invalid_rep' }
  if (code === 'FORBIDDEN') return { status: 'forbidden' }
  return { status: 'error' }
}
