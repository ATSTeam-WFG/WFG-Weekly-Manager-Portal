import { supabase } from './supabaseClient'

// No existing generic "fetch profiles by id list" helper was found anywhere
// under src/lib (profileService.ts only fetches a single profile by its own
// id; adminService.ts's fetchManagersForWeek filters profiles by
// submits_weekly_report, not by an id list) — so this is a small, new,
// read-only addition for My Reps to resolve a manager's assigned reps' names/
// emails from their ids. Plain RLS-scoped SELECT, no RPC: profiles SELECT
// policies already permit a manager to read their own currently-assigned
// reps' profile rows, the same access AdminDashboard's own profile lookups
// rely on.
export interface RepProfileSummary {
  id: string
  fullName: string | null
  email: string
}

interface RepProfileRow {
  id: string
  full_name: string | null
  email: string
}

export async function fetchProfilesByIds(ids: string[]): Promise<RepProfileSummary[]> {
  if (ids.length === 0) return []

  const { data, error } = await supabase.from('profiles').select('id, full_name, email').in('id', ids)

  if (error) {
    console.error('Failed to fetch profiles by id:', error.message)
    return []
  }
  return (data ?? []).map((row) => {
    const r = row as RepProfileRow
    return {
      id: r.id,
      fullName: r.full_name,
      email: r.email,
    }
  })
}
