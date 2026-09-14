// Extracted from api/auto-submit.ts's core logic specifically so it's
// directly unit-testable with an injected fake — auto-submit.ts itself has
// a deep transitive import graph that Node's bare runtime can't resolve
// directly (see api/scheduler-endpoints.test.ts). This is a pure relocation
// of the exact existing semantics, not a redesign: same filters (week +
// status='draft' only), same SET payload on a real run, same read-only
// behavior on a dry run.

export interface AutoSubmitReportRow {
  id: string
  manager_id: string
  status: string
  submitted_at?: string | null
  submission_source?: string | null
}

export interface AutoSubmitQueryResult {
  data: AutoSubmitReportRow[] | null
  error: { message: string } | null
}

export interface AutoSubmitQuery {
  // PromiseLike, not Promise: Supabase's query builder is thenable at
  // runtime (awaiting it works exactly like a promise) but isn't
  // structurally typed as a full Promise (it doesn't declare .catch/
  // .finally) — PromiseLike is the accurate, minimal contract this actually
  // needs, and what the real adapter in auto-submit.ts returns unchanged.
  selectDraftReports(weekStartDate: string): PromiseLike<AutoSubmitQueryResult>
  updateDraftReportsToSubmitted(weekStartDate: string, submittedAt: string): PromiseLike<AutoSubmitQueryResult>
}

export type AutoSubmitOutcome =
  | { ok: true; dryRun: boolean; count: number; reports: AutoSubmitReportRow[] }
  | { ok: false; error: string }

// Dry run: reads only currently-draft rows for the week — never mutates
// anything. Real run: updates only currently-draft rows for the week to
// status='submitted', submission_source='automatic', submitted_at=now.
// Already-submitted rows — whether submission_source is 'manual' or
// 'automatic' — are excluded by the query filter itself (status='draft'),
// so this can never overwrite either, and re-running it for a week that's
// already fully submitted correctly updates zero additional rows:
// idempotent by construction (the filter), not by an extra guard clause.
export async function runAutoSubmit(
  query: AutoSubmitQuery,
  weekStartDate: string,
  dryRun: boolean,
  now: () => string = () => new Date().toISOString(),
): Promise<AutoSubmitOutcome> {
  if (dryRun) {
    const { data, error } = await query.selectDraftReports(weekStartDate)
    if (error) return { ok: false, error: error.message }
    return { ok: true, dryRun: true, count: (data ?? []).length, reports: data ?? [] }
  }

  const { data, error } = await query.updateDraftReportsToSubmitted(weekStartDate, now())
  if (error) return { ok: false, error: error.message }
  return { ok: true, dryRun: false, count: (data ?? []).length, reports: data ?? [] }
}
