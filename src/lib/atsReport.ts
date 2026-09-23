// Shared ATS (approved written-report) format — the target shape for Weekly
// Summary's consolidated report content, Executive Analysis' future
// generated report, and the future Leadership Report's read-only source
// pane. One type, reused everywhere the ATS format is rendered, rather than
// three independent copies of the same shape.
//
// This is purely a data shape — no generation logic lives here. Topics are
// always dynamic: whoever produces an AtsReport (a future AI generator, or
// a caller building one from existing data) must derive `topics` from that
// week's actual submissions, never a fixed/hard-coded list of initiative
// names. This file makes no attempt to enforce that at the type level (it
// can't — TypeScript can't distinguish "this array was derived from real
// data" from "this array was hard-coded"), so the discipline belongs to
// whatever eventually constructs an AtsReport, not to this type.
//
// Deliberately independent of ReportingAnalysisSections
// (executiveSummaryService.ts) — the existing fixed-7-key Executive
// Analysis shape is untouched by this file and is not migrated to this
// type in this phase.
export interface AtsTopicSection {
  title: string
  statusSummary: string
  bullets: string[]
  next: string
}

export interface AtsReport {
  openingParagraph: string
  topics: AtsTopicSection[]
}
