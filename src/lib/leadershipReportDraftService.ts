import { supabase } from './supabaseClient'
import type { LeadershipReportContent } from './leadershipReportContent'

// The client-side counterpart to
// supabase/migrations/20260924_leadership_report_drafts.sql. Reads go
// straight to the table (RLS-scoped, exactly like fetchPersistedAnalysis in
// executiveSummaryService.ts); the ONLY write path is the
// save_leadership_report_draft RPC — this module never issues a direct
// INSERT/UPDATE/DELETE against leadership_report_drafts, matching the
// migration's own table grants (authenticated has SELECT only; the RPC is
// SECURITY DEFINER and performs its own is_admin() check).

// `content` is typed `unknown`, not `LeadershipReportContent`, because a
// row can also be a HISTORICAL draft saved before the Word-template
// rebuild (the old AtsReport {openingParagraph, topics} shape) — callers
// must runtime-check it with isLeadershipReportContent() (see
// leadershipReportContent.ts) before treating it as the new shape, so a
// legacy row can be handled gracefully instead of crashing.
export interface LeadershipReportDraft {
  id: string
  periodStartDate: string
  periodEndDate: string
  periodLabel: string
  sourceAnalysisId: string
  sourceAtsFingerprint: string
  content: unknown
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
}

interface LeadershipReportDraftRow {
  id: string
  period_start_date: string
  period_end_date: string
  period_label: string
  source_analysis_id: string
  source_ats_fingerprint: string
  content: unknown
  created_at: string
  created_by: string
  updated_at: string
  updated_by: string
}

function fromRow(row: LeadershipReportDraftRow): LeadershipReportDraft {
  return {
    id: row.id,
    periodStartDate: row.period_start_date,
    periodEndDate: row.period_end_date,
    periodLabel: row.period_label,
    sourceAnalysisId: row.source_analysis_id,
    sourceAtsFingerprint: row.source_ats_fingerprint,
    content: row.content,
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  }
}

export type LeadershipReportDraftErrorCode = 'FORBIDDEN' | 'INVALID_SECTIONS' | 'INVALID_REQUEST' | 'UNKNOWN'

export class LeadershipReportDraftError extends Error {
  code: LeadershipReportDraftErrorCode

  constructor(code: LeadershipReportDraftErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

// The Save Draft RPC raises 'CODE: message' (see save_leadership_report_draft
// — FORBIDDEN/INVALID_SECTIONS/INVALID_REQUEST), the same convention already
// used by the Executive Analysis RPCs (executiveSummaryService.ts's own
// parseRpcError) — mirrored here rather than importing that file's private
// helper, so this module has zero dependency on Executive Analysis code.
function parseRpcError(message: string | undefined): LeadershipReportDraftError {
  const match = message?.match(/^([A-Z_]+):\s*(.*)$/)
  if (match) {
    const [, code, detail] = match
    return new LeadershipReportDraftError(code as LeadershipReportDraftErrorCode, detail || message || 'Something went wrong.')
  }
  return new LeadershipReportDraftError('UNKNOWN', message || 'Something went wrong.')
}

// Direct, RLS-scoped read — genuinely read-only, exactly mirroring
// fetchPersistedAnalysis's own pattern. Returns null if no draft has ever
// been saved for this exact reporting week yet (not an error) — merely
// fetching must never create a row, and it doesn't: this is a plain SELECT.
export async function fetchLeadershipReportDraft(periodStartDate: string): Promise<LeadershipReportDraft | null> {
  const { data, error } = await supabase
    .from('leadership_report_drafts')
    .select(
      'id, period_start_date, period_end_date, period_label, source_analysis_id, source_ats_fingerprint, content, created_at, created_by, updated_at, updated_by, is_shared',
    )
    .eq('period_start_date', periodStartDate)

  if (error) {
    console.error('Failed to fetch Leadership Report draft:', error.message)
    return null
  }
  if (!data || data.length === 0) return null

  // Priority: User's own draft > Shared draft.
  // Because of RLS, 'data' contains only the current user's draft and any shared drafts.
  // We prioritize the one that is NOT shared (the user's own).
  const userDraft = data.find((d) => !d.is_shared)
  if (userDraft) return fromRow(userDraft as LeadershipReportDraftRow)

  // Fallback to the first shared draft found.
  return fromRow(data[0] as LeadershipReportDraftRow)
}

// Read-only, RLS-scoped: "my nearest saved draft strictly before this week."
// No owner_id parameter exists here, and none is filtered client-side — RLS
// (owner_id = auth.uid()) is what makes this "mine" at all; this function
// could not return another owner's row even if it tried to.
export async function fetchPreviousLeadershipReportDraft(beforePeriodStartDate: string): Promise<LeadershipReportDraft | null> {
  const { data, error } = await supabase
    .from('leadership_report_drafts')
    .select(
      'id, period_start_date, period_end_date, period_label, source_analysis_id, source_ats_fingerprint, content, created_at, created_by, updated_at, updated_by, is_shared',
    )
    .lt('period_start_date', beforePeriodStartDate)
    .order('period_start_date', { ascending: false })

  if (error) {
    console.error('Failed to fetch previous Leadership Report draft:', error.message)
    return null
  }
  if (!data || data.length === 0) return null

  // For history, we look for the most recent draft.
  // If multiple drafts exist for the same most-recent date, prioritize the user's own.
  const mostRecentDate = data[0].period_start_date
  const candidates = data.filter((d) => d.period_start_date === mostRecentDate)

  const userDraft = candidates.find((d) => !d.is_shared)
  if (userDraft) return fromRow(userDraft as LeadershipReportDraftRow)

  return fromRow(candidates[0] as LeadershipReportDraftRow)
}

// A pure, stateless client-side check of the CURRENT caller's own
// authorization — calls the exact same is_leadership_report_authorized()
// Postgres function that the RLS policy and the Save Draft RPC both use as
// their real gate (see supabase/migrations/
// 20260924_leadership_report_private_ownership.sql). This is a UX
// convenience only (so the unlock flow can show a clean "not enabled for
// this account" state instead of an empty/broken workspace) — it is not
// itself a security boundary, and fails closed (false) on any error.
export async function fetchIsLeadershipReportAuthorized(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_leadership_report_authorized')
  if (error) {
    console.error('Failed to check Leadership Report authorization:', error.message)
    return false
  }
  return data === true
}

export interface SaveLeadershipReportDraftParams {
  periodStartDate: string
  periodEndDate: string
  periodLabel: string
  sourceAnalysisId: string
  sourceAtsFingerprint: string
  // Every NEW save always uses the current Word-template shape — only
  // historical rows (read via fetch*, never written here) can be the old
  // AtsReport shape.
  content: LeadershipReportContent
}

// The only write path for this table. created_by/updated_by/timestamps are
// never constructed or sent from here — save_leadership_report_draft derives
// them itself from auth.uid()/now() and rejects a non-admin or inactive-admin
// caller before touching anything. Inserts on the first save for a week,
// updates the same row on every later save (server-side ON CONFLICT), never
// writes to executive_analyses/executive_analysis_versions.
export async function saveLeadershipReportDraft(params: SaveLeadershipReportDraftParams): Promise<LeadershipReportDraft> {
  const { data, error } = await supabase.rpc('save_leadership_report_draft', {
    p_period_start_date: params.periodStartDate,
    p_period_end_date: params.periodEndDate,
    p_period_label: params.periodLabel,
    p_source_analysis_id: params.sourceAnalysisId,
    p_source_ats_fingerprint: params.sourceAtsFingerprint,
    p_content: params.content,
  })
  if (error) throw parseRpcError(error.message)
  return fromRow(data as LeadershipReportDraftRow)
}
