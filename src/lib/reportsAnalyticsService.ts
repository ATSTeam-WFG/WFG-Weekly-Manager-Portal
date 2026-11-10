import type { SupabaseClient } from '@supabase/supabase-js'
import type { ReportContent } from '../types.js'
import { rowToContent } from './reportContentMapping.js'
import { getReportingWeekFromStartDate } from '../utils/week.js'

export interface PeriodManagerWeekEntry {
  weekStartDate: string
  weekLabel: string
  content: ReportContent
}

export interface PeriodManagerEntry {
  managerId: string
  managerName: string
  weeks: PeriodManagerWeekEntry[]
}

// A manager who has not fully submitted every week of the selected period —
// 'draft' if they have at least one draft row anywhere in the period,
// otherwise 'not_started'. A best-effort single status for a whole period,
// not a week-by-week breakdown.
export interface PendingManager {
  managerId: string
  managerName: string
  status: 'draft' | 'not_started'
}

export interface PeriodReportStats {
  uniqueManagers: number
  expectedReports: number
  submittedReports: number
  draftReports: number
  missingReports: number
  completionPct: number
  entries: PeriodManagerEntry[]
  pendingManagers: PendingManager[]
}

const EMPTY_STATS: PeriodReportStats = {
  uniqueManagers: 0,
  expectedReports: 0,
  submittedReports: 0,
  draftReports: 0,
  missingReports: 0,
  completionPct: 0,
  entries: [],
  pendingManagers: [],
}

// Aggregates weekly report rows across a period — one week (Weekly) or many
// (Bi-Weekly, Monthly, Quarterly, Half-Yearly, Yearly) — without ever
// treating a manager's several weekly reports as several managers. "Missing"
// reports are computed here (expected − submitted − draft) rather than read
// from Supabase — no placeholder rows are ever created for weeks a manager
// didn't submit. Takes the Supabase client as a parameter (rather than
// importing the browser singleton) so this same function can run from the
// browser or from a server-side handler using a request-scoped client bound
// to the caller's own access token.
export async function fetchPeriodReportStats(
  supabaseClient: SupabaseClient,
  weekStartDates: string[],
): Promise<PeriodReportStats> {
  if (weekStartDates.length === 0) return EMPTY_STATS

  const { data: profiles, error: profilesError } = await supabaseClient
    .from('profiles')
    .select('id, full_name')
    .eq('submits_weekly_report', true)
    .order('full_name', { ascending: true })

  if (profilesError) {
    console.error('Failed to fetch manager profiles from Supabase:', profilesError.message)
    return EMPTY_STATS
  }

  const { data: reports, error: reportsError } = await supabaseClient
    .from('reports')
    .select(
      'manager_id, week_start_date, status, top_priorities, wins, challenges, next_week_priorities, what_matters_now, looking_around_corner, other_notable_items, okr_notes',
    )
    .in('week_start_date', weekStartDates)

  if (reportsError) {
    console.error('Failed to fetch reports from Supabase:', reportsError.message)
  }

  const profileList = profiles ?? []
  const nameById = new Map(profileList.map((p) => [p.id, p.full_name ?? 'Unnamed Manager']))
  // Only count rows belonging to a current weekly-report submitter
  // (submits_weekly_report = true) — a report row can exist for an account
  // that isn't (or no longer is) a submitter, and that must not be counted
  // as a submitter's expected/submitted/draft report, exactly as
  // fetchWeeklySummary already avoids this by iterating profiles rather
  // than raw report rows. This set drives the KPI math below ONLY —
  // uniqueManagers/expectedReports/submittedReports/draftReports/
  // completionPct must stay internally consistent (a manager excluded from
  // the denominator must also be excluded from the numerator), so this
  // stays scoped to current submitters exactly as before.
  const reportRows = (reports ?? []).filter((r) => nameById.has(r.manager_id))

  const uniqueManagers = profileList.length
  const expectedReports = uniqueManagers * weekStartDates.length
  const submittedReports = reportRows.filter((r) => r.status === 'submitted').length
  const draftReports = reportRows.filter((r) => r.status === 'draft').length
  const missingReports = Math.max(0, expectedReports - submittedReports - draftReports)
  const completionPct = expectedReports > 0 ? Math.round((submittedReports / expectedReports) * 100) : 0

  // Historical visibility (separate from the KPI math above): a manager's
  // own already-submitted report content must remain viewable in the
  // drill-down below even after a later role change makes them no longer a
  // current submitter (e.g. Manager -> Sales Admin) — their report rows
  // are never deleted, only excluded from reportRows above, which would
  // otherwise silently hide their content here too. Resolve names for any
  // report-row manager_id not already covered by the current submitter
  // list via one additional query, bounded to exactly those ids.
  const reportManagerIds = Array.from(new Set((reports ?? []).map((r) => r.manager_id)))
  const historicalOnlyIds = reportManagerIds.filter((id) => !nameById.has(id))
  const historicalNameById = new Map(nameById)
  if (historicalOnlyIds.length > 0) {
    const { data: historicalProfiles, error: historicalProfilesError } = await supabaseClient
      .from('profiles')
      .select('id, full_name')
      .in('id', historicalOnlyIds)
    if (historicalProfilesError) {
      console.error('Failed to fetch historical manager profiles from Supabase:', historicalProfilesError.message)
    }
    for (const p of historicalProfiles ?? []) historicalNameById.set(p.id, p.full_name ?? 'Unnamed Manager')
  }
  const historicalReportRows = (reports ?? []).filter((r) => historicalNameById.has(r.manager_id))

  const weeksByManager = new Map<string, PeriodManagerWeekEntry[]>()
  for (const row of historicalReportRows) {
    if (row.status !== 'submitted') continue
    const list = weeksByManager.get(row.manager_id) ?? []
    list.push({
      weekStartDate: row.week_start_date,
      weekLabel: getReportingWeekFromStartDate(row.week_start_date).label,
      content: rowToContent(row),
    })
    weeksByManager.set(row.manager_id, list)
  }

  const entries: PeriodManagerEntry[] = Array.from(weeksByManager.keys())
    .map((managerId) => ({
      managerId,
      managerName: historicalNameById.get(managerId) ?? 'Unnamed Manager',
      weeks: (weeksByManager.get(managerId) ?? []).sort((a, b) => a.weekStartDate.localeCompare(b.weekStartDate)),
    }))
    .sort((a, b) => a.managerName.localeCompare(b.managerName))

  // Derived from the same reportRows already fetched above — no new query.
  // A manager is "pending" unless every week in the period is submitted.
  const rowsByManager = new Map<string, typeof reportRows>()
  for (const row of reportRows) {
    const list = rowsByManager.get(row.manager_id) ?? []
    list.push(row)
    rowsByManager.set(row.manager_id, list)
  }

  const pendingManagers: PendingManager[] = profileList
    .map((p) => {
      const rows = rowsByManager.get(p.id) ?? []
      const submittedCount = rows.filter((r) => r.status === 'submitted').length
      if (submittedCount === weekStartDates.length) return null
      const hasDraft = rows.some((r) => r.status === 'draft')
      return {
        managerId: p.id,
        managerName: nameById.get(p.id) ?? 'Unnamed Manager',
        status: hasDraft ? ('draft' as const) : ('not_started' as const),
      }
    })
    .filter((m): m is PendingManager => m !== null)

  return {
    uniqueManagers,
    expectedReports,
    submittedReports,
    draftReports,
    missingReports,
    completionPct,
    entries,
    pendingManagers,
  }
}
