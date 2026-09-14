// Pure report-row <-> ReportContent mapping, shared by reportsService.ts
// (browser singleton client), adminService.ts, and reportsAnalyticsService.ts
// (both usable with a server-side request-scoped client) — previously this
// logic was duplicated across those three files; consolidating it here means
// there is exactly one place that decides "is this row legacy or V2" and
// exactly one place that converts bullet text to/from an array. It has no
// imports of its own, so it (and its test file) can run directly via a bare
// `node --test`, with no build step.
import type { ReportContent } from '../types.js'

export interface ReportContentRow {
  top_priorities: string | null
  wins: string | null
  challenges: string | null
  next_week_priorities: string | null
  what_matters_now: string | null
  looking_around_corner: string | null
  other_notable_items: string | null
  okr_notes: string | null
}

export const REPORT_CONTENT_COLUMNS =
  'top_priorities, wins, challenges, next_week_priorities, what_matters_now, looking_around_corner, other_notable_items, okr_notes'

// A row is V2-format purely by data — any of the four new columns being
// non-null — never a separate version flag. The write side (saveReportV2)
// always includes all four new columns in its payload (as '' when empty),
// so a V2 row is reliably detected as V2 from its very first draft save,
// even before "What Matters Now" has any content in it yet.
export function isV2Row(row: ReportContentRow): boolean {
  return (
    row.what_matters_now !== null ||
    row.looking_around_corner !== null ||
    row.other_notable_items !== null ||
    row.okr_notes !== null
  )
}

// Newline-delimited bullet storage: each non-empty line is one bullet, in
// order, capped defensively at 3. A legacy free-paragraph value (should one
// ever end up here, which it should not under normal use) degrades
// gracefully into however many non-empty lines it happens to contain rather
// than throwing or losing data.
export function parseBullets(value: string | null): string[] {
  if (!value) return []
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 3)
}

export function serializeBullets(bullets: string[]): string {
  return bullets
    .map((b) => b.trim())
    .filter((b) => b.length > 0)
    .join('\n')
}

export function rowToContent(row: ReportContentRow): ReportContent {
  if (isV2Row(row)) {
    return {
      version: 'v2',
      sections: {
        whatMattersNow: parseBullets(row.what_matters_now),
        lookingAroundCorner: parseBullets(row.looking_around_corner),
        nextWeekPriorities: parseBullets(row.next_week_priorities),
        otherNotableItems: row.other_notable_items ?? '',
        okrNotes: row.okr_notes ?? '',
      },
    }
  }
  return {
    version: 'legacy',
    sections: {
      topPriorities: row.top_priorities ?? '',
      wins: row.wins ?? '',
      challenges: row.challenges ?? '',
      nextWeekPriorities: row.next_week_priorities ?? '',
    },
  }
}
