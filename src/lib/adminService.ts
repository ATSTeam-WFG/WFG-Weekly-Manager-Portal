import type { SupabaseClient } from '@supabase/supabase-js'
import type { ReportContent, ReportStatus, SubmissionSource } from '../types.js'
import { REPORT_CONTENT_COLUMNS, rowToContent } from './reportContentMapping.js'

export interface ManagerSummary {
  id: string
  fullName: string
  email: string | null
  status: ReportStatus
  submittedAt: string | null
  submissionSource: SubmissionSource | null
}

// Takes the Supabase client as a parameter (rather than always using the
// browser singleton) so this same function can run from the browser or from
// a server-side handler using a request-scoped client bound to the caller's
// own access token — the same pattern used by fetchPeriodReportStats.
export async function fetchManagersForWeek(
  supabaseClient: SupabaseClient,
  weekStartDate: string,
): Promise<ManagerSummary[]> {
  const { data: profiles, error: profilesError } = await supabaseClient
    .from('profiles')
    .select('id, full_name, email')
    .eq('submits_weekly_report', true)
    .order('full_name', { ascending: true })

  if (profilesError) {
    console.error('Failed to fetch manager profiles from Supabase:', profilesError.message)
    return []
  }

  const { data: weekReports, error: reportsError } = await supabaseClient
    .from('reports')
    .select('manager_id, status, submitted_at, submission_source')
    .eq('week_start_date', weekStartDate)

  if (reportsError) {
    console.error('Failed to fetch reports from Supabase:', reportsError.message)
  }

  const reportsByManager = new Map((weekReports ?? []).map((report) => [report.manager_id, report]))

  return (profiles ?? []).map((profile) => {
    const report = reportsByManager.get(profile.id)
    return {
      id: profile.id,
      fullName: profile.full_name ?? 'Unnamed Manager',
      email: profile.email ?? null,
      status: report?.status ?? 'not_started',
      submittedAt: report?.submitted_at ?? null,
      submissionSource: (report?.submission_source as SubmissionSource | null) ?? null,
    }
  })
}

export interface WeeklySummaryEntry {
  managerId: string
  managerName: string
  content: ReportContent
}

export interface WeeklySummaryData {
  totalManagers: number
  submittedCount: number
  completionPct: number
  entries: WeeklySummaryEntry[]
}

export async function fetchWeeklySummary(
  supabaseClient: SupabaseClient,
  weekStartDate: string,
): Promise<WeeklySummaryData> {
  const { data: profiles, error: profilesError } = await supabaseClient
    .from('profiles')
    .select('id, full_name')
    .eq('submits_weekly_report', true)
    .order('full_name', { ascending: true })

  if (profilesError) {
    console.error('Failed to fetch manager profiles from Supabase:', profilesError.message)
    return { totalManagers: 0, submittedCount: 0, completionPct: 0, entries: [] }
  }

  const { data: submittedReports, error: reportsError } = await supabaseClient
    .from('reports')
    .select(`manager_id, ${REPORT_CONTENT_COLUMNS}`)
    .eq('week_start_date', weekStartDate)
    .eq('status', 'submitted')

  if (reportsError) {
    console.error('Failed to fetch submitted reports from Supabase:', reportsError.message)
  }

  const reportsByManager = new Map((submittedReports ?? []).map((report) => [report.manager_id, report]))
  const profileList = profiles ?? []

  const entries: WeeklySummaryEntry[] = profileList
    .filter((profile) => reportsByManager.has(profile.id))
    .map((profile) => {
      const report = reportsByManager.get(profile.id)!
      return {
        managerId: profile.id,
        managerName: profile.full_name ?? 'Unnamed Manager',
        content: rowToContent(report),
      }
    })

  const totalManagers = profileList.length
  const submittedCount = entries.length
  const completionPct = totalManagers > 0 ? Math.round((submittedCount / totalManagers) * 100) : 0

  return { totalManagers, submittedCount, completionPct, entries }
}

export async function fetchManagerReportSections(
  supabaseClient: SupabaseClient,
  managerId: string,
  weekStartDate: string,
): Promise<ReportContent | null> {
  const { data, error } = await supabaseClient
    .from('reports')
    .select(REPORT_CONTENT_COLUMNS)
    .eq('manager_id', managerId)
    .eq('week_start_date', weekStartDate)
    .maybeSingle()

  if (error) {
    console.error('Failed to fetch report sections from Supabase:', error.message)
    return null
  }
  if (!data) return null

  return rowToContent(data)
}
