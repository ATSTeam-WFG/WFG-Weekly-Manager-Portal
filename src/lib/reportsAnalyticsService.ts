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
  // than raw report rows.
  const reportRows = (reports ?? []).filter((r) => nameById.has(r.manager_id))

  const uniqueManagers = profileList.length
  const expectedReports = uniqueManagers * weekStartDates.length
  const submittedReports = reportRows.filter((r) => r.status === 'submitted').length
  const draftReports = reportRows.filter((r) => r.status === 'draft').length
  const missingReports = Math.max(0, expectedReports - submittedReports - draftReports)
  const completionPct = expectedReports > 0 ? Math.round((submittedReports / expectedReports) * 100) : 0

  const weeksByManager = new Map<string, PeriodManagerWeekEntry[]>()
  for (const row of reportRows) {
    if (row.status !== 'submitted') continue
    const list = weeksByManager.get(row.manager_id) ?? []
    list.push({
      weekStartDate: row.week_start_date,
      weekLabel: getReportingWeekFromStartDate(row.week_start_date).label,
      content: rowToContent(row),
    })
    weeksByManager.set(row.manager_id, list)
  }

  const entries: PeriodManagerEntry[] = profileList
    .filter((p) => weeksByManager.has(p.id))
    .map((p) => ({
      managerId: p.id,
      managerName: nameById.get(p.id) ?? 'Unnamed Manager',
      weeks: (weeksByManager.get(p.id) ?? []).sort((a, b) => a.weekStartDate.localeCompare(b.weekStartDate)),
    }))

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
