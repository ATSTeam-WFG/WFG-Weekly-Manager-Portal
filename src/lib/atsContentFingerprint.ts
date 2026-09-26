import { hashCanonicalSource } from './executiveAnalysisFingerprint.ts'
import type { AtsReport } from './atsReport'

// A fingerprint of the ATS content itself (openingParagraph + topics) —
// deliberately distinct from executive_analyses.source_fingerprint, which
// hashes the underlying manager-report inputs the AI saw, not what it wrote.
// Two regenerations from identical inputs can legitimately produce different
// ATS wording (the AI is not deterministic), and that source_fingerprint
// would stay unchanged either way — so it cannot tell a Leadership Report
// draft whether the ATS content it was built from has since changed. This
// fingerprint reads the rendered ATS content directly, so it changes
// whenever that content does, regardless of whether the manager-report
// inputs did. Reuses hashCanonicalSource (SHA-256 hex digest, Web Crypto)
// rather than duplicating it — same hashing primitive as
// executive_analyses's own fingerprint, applied to different input.
//
// No key-sorting is needed here (unlike buildCanonicalSource, which sorts
// entries because manager/week fetch order isn't guaranteed): `topics` and
// each topic's `bullets` are JSON arrays, whose element order Postgres jsonb
// always preserves exactly as stored, and every AtsReport this app ever
// constructs (AI generation, deepCopyAtsReport, this app's own edit form)
// always builds topic objects with the same field order
// (title/statusSummary/bullets/next). Two reads of the same unchanged
// underlying content — whichever code path produced them — therefore
// serialize identically via plain JSON.stringify.
export function buildCanonicalAtsContent(report: AtsReport): string {
  return JSON.stringify(report)
}

export async function computeAtsContentFingerprint(report: AtsReport): Promise<string> {
  return hashCanonicalSource(buildCanonicalAtsContent(report))
}
