// Phase 1C — pure merge/duplicate-prevention logic for consolidating Sales
// Rep report fields into a manager's own report. Deliberately import-free
// (no React, no Supabase, no local type import — a local structural shape
// mirrors SalesRepReportSections instead, the same convention
// reportValidation.ts/managerEditLock.ts already use) so this is directly,
// exhaustively unit-testable with a bare `node --test`, unlike
// ImportRepReportsPanel.tsx itself, which transitively imports the real
// Supabase client and can only be covered by source inspection.
//
// The core guarantee under test here: duplicate-text prevention is decided
// against the manager's CURRENT otherNotableItems text — never against the
// import ledger (manager_report_rep_imports), which only proves an import
// action was taken, not that the resulting content was ever actually saved.
// See ImportRepReportsPanel.tsx's own currentOtherNotableItems prop comment
// for the full reasoning (duplicate re-apply within a session, and safe
// retry after a failed save, both fall out of this one rule).

export interface SalesRepReportSectionsShape {
  accomplishments: string[]
  salesMetrics: string[]
  pipelineUpdates: string[]
  blockers: string[]
  nextWeekPriorities: string[]
  managerSupportNeeded: string
}

export type ConsolidationFieldKey = keyof SalesRepReportSectionsShape

export const CONSOLIDATION_FIELD_LABELS: { key: ConsolidationFieldKey; label: string }[] = [
  { key: 'accomplishments', label: 'Accomplishments' },
  { key: 'salesMetrics', label: 'Sales Metrics' },
  { key: 'pipelineUpdates', label: 'Pipeline Updates' },
  { key: 'blockers', label: 'Blockers / Challenges' },
  { key: 'nextWeekPriorities', label: 'Next Week Priorities' },
  { key: 'managerSupportNeeded', label: 'Manager Support Needed' },
]

export function fieldHasContent(content: SalesRepReportSectionsShape, key: ConsolidationFieldKey): boolean {
  const value = content[key]
  return Array.isArray(value) ? value.some((v) => v.trim().length > 0) : value.trim().length > 0
}

export function formatConsolidationField(content: SalesRepReportSectionsShape, key: ConsolidationFieldKey): string {
  const value = content[key]
  const label = CONSOLIDATION_FIELD_LABELS.find((f) => f.key === key)!.label
  if (Array.isArray(value)) {
    const bullets = value.filter((v) => v.trim().length > 0)
    return `${label}:\n${bullets.map((b) => `• ${b}`).join('\n')}`
  }
  return `${label}:\n${value.trim()}`
}

export function formatRepBlock(repName: string, fieldBlocks: string[]): string {
  return `— From ${repName} —\n${fieldBlocks.join('\n\n')}`
}

// THE duplicate-prevention decision, at field granularity (never per-rep,
// never per-whole-selection): a field block already present VERBATIM in
// currentOtherNotableItems is treated as already applied and excluded,
// regardless of what any ledger/database record claims — this is what lets
// a manager add a NEW field from a rep whose OTHER fields were already
// applied earlier without re-duplicating those, and what lets a retry after
// a failed save proceed normally (a freshly-reloaded report that never
// actually got the text saved simply won't contain it, so re-import is not
// wrongly blocked).
export function newFieldBlocksForSelection(
  content: SalesRepReportSectionsShape,
  selectedFields: ReadonlySet<ConsolidationFieldKey>,
  currentOtherNotableItems: string,
): string[] {
  return CONSOLIDATION_FIELD_LABELS.filter((f) => selectedFields.has(f.key) && fieldHasContent(content, f.key))
    .map((f) => formatConsolidationField(content, f.key))
    .filter((block) => !currentOtherNotableItems.includes(block))
}
