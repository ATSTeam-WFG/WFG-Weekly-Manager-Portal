import { supabase } from './supabaseClient'
import { fetchRepReportWithOutcome, type RepReport } from './repReportsService'
import type { FetchRepReportOutcome } from './repReportsService'

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
