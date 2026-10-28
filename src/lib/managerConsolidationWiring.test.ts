// Run with: node --test src/lib/managerConsolidationWiring.test.ts
//
// Phase 1C — Sales Rep report consolidation into the manager's own Weekly
// Leadership Update. React components here import the real browser Supabase
// client transitively, so this follows the repo's established source-
// inspection convention (see dualRoleRoutingWiring.test.ts,
// salesRepDashboardWiring.test.ts) rather than executing them directly.
//
// The real, REPEATABLE database behavioral assertions (approved-only,
// current-assignment authorization, same-week matching, idempotent
// double-click, a distinct field selection, and a genuine source revision
// each producing a legitimately separate importable row, direct-write
// denial) live in supabase/migrations/20261028090000_manager_report_rep_consolidation.sql's
// own self-test, run via `bash supabase/phase1a-behavioral-tests/run.sh`.
// This file verifies the CLIENT-SIDE wiring: the merge never overwrites the
// manager's own content, the existing save/Friday-4PM-cutoff path is never
// bypassed, and the read-side UI filter matches what the server will
// actually accept.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const reportFormSrc = readFileSync(path.join(dir, '..', 'components', 'ReportForm.tsx'), 'utf8')
const panelSrc = readFileSync(path.join(dir, '..', 'components', 'ImportRepReportsPanel.tsx'), 'utf8')
const serviceSrc = readFileSync(path.join(dir, 'managerConsolidationService.ts'), 'utf8')
const mergeSrc = readFileSync(path.join(dir, 'repReportConsolidationMerge.ts'), 'utf8')
const managerEditLockSrc = readFileSync(path.join(dir, 'managerEditLock.ts'), 'utf8')
const migrationSrc = readFileSync(
  path.join(dir, '..', '..', 'supabase', 'migrations', '20261028090000_manager_report_rep_consolidation.sql'),
  'utf8',
)

describe('1. existing manager-authored content is never overwritten — imported content is strictly appended', () => {
  test('handleApplyImportedContent appends to the EXISTING otherNotableItems value, mirroring handleVoiceResult\'s own established append pattern — never a direct assignment that would replace it', () => {
    const fnMatch = reportFormSrc.match(/const handleApplyImportedContent = \(text: string\) => \{([\s\S]*?)\n  \}/)
    assert.ok(fnMatch, 'could not locate handleApplyImportedContent')
    assert.match(fnMatch[1], /const current = prev\.otherNotableItems\.trim\(\)/)
    assert.match(fnMatch[1], /current \? `\$\{current\}\\n\\n\$\{text\}` : text/)
    assert.doesNotMatch(fnMatch[1], /otherNotableItems:\s*text\s*[,}]/)
  })

  test('the Import panel never writes to any other ManagerReportSectionsV2 field — only otherNotableItems is ever touched by the apply callback', () => {
    assert.doesNotMatch(reportFormSrc, /handleApplyImportedContent[\s\S]{0,40}(whatMattersNow|lookingAroundCorner|nextWeekPriorities|okrNotes)/)
  })

  test('the panel itself never mutates ReportForm state directly — it only calls back via onApply with the already-deduplicated new content, keeping the actual merge entirely in ReportForm\'s own hands', () => {
    assert.doesNotMatch(panelSrc, /setData/)
    assert.match(panelSrc, /onApply\(repBlocks\.join\('\\n\\n'\)\)/)
  })

  test('the actual merge reads the LATEST ReportForm state via the functional setData(prev => ...) form, not a value captured once when the panel opened — so an edit made anywhere else in the form cannot be overwritten by an Apply that was already in flight', () => {
    const fnMatch = reportFormSrc.match(/const handleApplyImportedContent = \(text: string\) => \{([\s\S]*?)\n  \}/)
    assert.ok(fnMatch)
    assert.match(fnMatch[1], /setData\(\(prev\) => \{/)
    assert.doesNotMatch(fnMatch[1], /setData\(\{/, 'must never pass a plain object literal — only the updater-function form reads the truly latest state')
  })
})

describe('1b. duplicate-text prevention is checked against the CURRENT report content, never the import ledger alone (the actual acceptance-round fix)', () => {
  test('ReportForm passes its OWN live data.otherNotableItems into the panel — not initialData, not a value captured once — so the check always reflects what is actually in the report right now, including after an earlier Apply in the same session', () => {
    assert.match(reportFormSrc, /currentOtherNotableItems=\{data\.otherNotableItems\}/)
  })

  test('ImportRepReportsPanel computes both its preview and its applied content via newFieldBlocksForSelection, passing currentOtherNotableItems through — never its own ad hoc duplicate check', () => {
    assert.match(panelSrc, /from '\.\.\/lib\/repReportConsolidationMerge'/)
    const previewCall = panelSrc.match(/const newBlocks = newFieldBlocksForSelection\(report\.content, fields, currentOtherNotableItems\)/g) ?? []
    assert.ok(previewCall.length >= 2, 'expected newFieldBlocksForSelection(..., currentOtherNotableItems) to be called in both the preview computation and the apply handler')
  })

  test('a selection with nothing genuinely new to add never calls onApply, and surfaces an explicit message instead of silently closing as if it had applied', () => {
    const fnMatch = panelSrc.match(/const handleApply = async \(\) => \{([\s\S]*?)\n  \}/)
    assert.ok(fnMatch)
    assert.match(fnMatch[1], /if \(repBlocks\.length === 0\) \{\s*\n\s*setApplyError\('This content is already in your report — nothing new to add\.'\)\s*\n\s*return\s*\n\s*\}/)
  })

  test('the merge decision logic itself (repReportConsolidationMerge.ts) is a plain, import-free module, directly unit-tested with real executions (see repReportConsolidationMerge.test.ts) rather than only source-inspected', () => {
    assert.doesNotMatch(mergeSrc, /^import /m)
    assert.match(mergeSrc, /export function newFieldBlocksForSelection/)
  })

  test('the duplicate check operates at FIELD granularity (one block per field), never per-rep or per-whole-selection — so a new field from a rep whose other fields were already applied is still added, and an already-applied field is never silently dropped by rejecting the whole batch', () => {
    assert.match(mergeSrc, /CONSOLIDATION_FIELD_LABELS\.filter\(\(f\) => selectedFields\.has\(f\.key\) && fieldHasContent\(content, f\.key\)\)/)
    assert.match(mergeSrc, /\.filter\(\(block\) => !currentOtherNotableItems\.includes\(block\)\)/)
  })

  test('the import RPC is still called for the full selection the manager checked even when some of its fields turn out to already be present — the audit trail is never conflated with whether new text was actually merged', () => {
    const fnMatch = panelSrc.match(/const handleApply = async \(\) => \{([\s\S]*?)\n  \}/)
    assert.ok(fnMatch)
    const rpcCallIndex = fnMatch[1].indexOf('await importRepReportForConsolidation')
    const dedupCallIndex = fnMatch[1].indexOf('const newBlocks = newFieldBlocksForSelection')
    assert.ok(rpcCallIndex > -1 && dedupCallIndex > -1 && rpcCallIndex < dedupCallIndex, 'the RPC (ledger write) must run regardless of, and before, the dedup check that decides what text to merge')
  })
})

describe('2. consolidation never bypasses the existing save path — the Friday 4:00 PM manager cutoff is structurally unaffected', () => {
  test('ImportRepReportsPanel and managerConsolidationService never call saveReportV2, updateReportSectionsV2, or any direct write to the `reports` table — applying is a pure local state change in ReportForm, which still only persists through the existing Save Draft/Submit/Save Changes buttons and their existing lock checks', () => {
    for (const src of [panelSrc, serviceSrc]) {
      assert.doesNotMatch(src, /saveReportV2|updateReportSectionsV2/)
      assert.doesNotMatch(src, /\.from\(['"]reports['"]\)/)
    }
  })

  test('managerConsolidationService never imports managerEditLock or checks/bypasses the cutoff itself — the lock is enforced exactly once, at save time, by the code that already enforced it before Phase 1C', () => {
    assert.doesNotMatch(serviceSrc, /managerEditLock/)
  })

  test('managerEditLock.ts itself is untouched by Phase 1C — still a single Friday 4:00 PM Eastern cutoff, EDIT_CUTOFF_HOUR = 16', () => {
    assert.match(managerEditLockSrc, /export const EDIT_CUTOFF_HOUR = 16/)
    assert.match(managerEditLockSrc, /export const EDIT_CUTOFF_MINUTE = 0/)
  })

  test('the Import button is only ever rendered in the NOT-yet-submitted draft flow (!isEditingSubmitted) — never on an already-submitted report, which is a separate, later workflow concern out of scope for this integration', () => {
    assert.match(reportFormSrc, /\{!isEditingSubmitted && \(\s*\n\s*<button type="button" className="link-btn" onClick=\{\(\) => setImportPanelOpen\(true\)\}>/)
    assert.match(reportFormSrc, /\{!isEditingSubmitted && \(\s*\n\s*<ImportRepReportsPanel/)
  })
})

describe('2b. the manager\'s OWN Friday 4:00 PM edit cutoff is independently re-verified server-side before any import ledger row can be created', () => {
  test('a standalone manager_report_edit_cutoff_passed predicate mirrors the exact 16:00 America/New_York idiom already proven by reports_enforce_manager_edit_cutoff(), added alongside it rather than touching that trigger', () => {
    assert.match(
      migrationSrc,
      /CREATE OR REPLACE FUNCTION public\.manager_report_edit_cutoff_passed\(\s*\n\s*p_week_start_date date,\s*\n\s*p_now timestamptz DEFAULT clock_timestamp\(\)\s*\n\)/,
    )
    assert.match(migrationSrc, /SELECT p_now >= \(\(p_week_start_date \+ 4 \+ time '16:00'\) AT TIME ZONE 'America\/New_York'\);/)
  })

  test('import_rep_report_for_consolidation checks manager_report_edit_cutoff_passed immediately after the role check, before looking up the target rep report at all — a closed window refuses the action regardless of which report was targeted', () => {
    const fnMatch = migrationSrc.match(/CREATE OR REPLACE FUNCTION public\.import_rep_report_for_consolidation\([\s\S]*?\n\$\$;/)
    assert.ok(fnMatch)
    const roleCheckIndex = fnMatch[0].indexOf("RAISE EXCEPTION 'FORBIDDEN: Only an active manager")
    const cutoffCheckIndex = fnMatch[0].indexOf('public.manager_report_edit_cutoff_passed(p_week_start_date)')
    const lookupIndex = fnMatch[0].indexOf('SELECT * INTO v_rep_report')
    assert.ok(roleCheckIndex > -1 && cutoffCheckIndex > -1 && lookupIndex > -1 && roleCheckIndex < cutoffCheckIndex && cutoffCheckIndex < lookupIndex)
    assert.match(fnMatch[0], /RAISE EXCEPTION 'MANAGER_EDIT_LOCKED: Your own report edit window for this week has closed/)
  })

  test('the self-test proves a closed manager edit window refuses the import AND that no ledger row is created as a result — a misleading, unusable record is never produced', () => {
    assert.match(migrationSrc, /PASSED: the import RPC refuses to create a ledger record once the manager''s OWN Friday 4:00 PM edit window/)
    assert.match(migrationSrc, /FAILED: a ledger row was recorded despite the manager edit cutoff check refusing the import\./)
  })
})

describe('2c. the import ledger is explicitly documented, on the database object itself, as never proof of successful manager report persistence', () => {
  test('manager_report_rep_imports carries a durable COMMENT ON TABLE stating this explicitly, discoverable from the schema itself, not only from frontend code comments', () => {
    assert.match(migrationSrc, /COMMENT ON TABLE public\.manager_report_rep_imports IS/)
    assert.match(migrationSrc, /This is NOT proof the resulting text was ever saved into reports\.other_notable_items/)
  })
})

describe('3. the read-side picker filter matches exactly what the server will accept — approved-only, same week', () => {
  test('fetchApprovedRepReportsForWeek filters explicitly on status=submitted AND review_status=approved for the given week — client-side defense in depth, never relied on as the sole gate (the RPC re-verifies independently)', () => {
    const fnMatch = serviceSrc.match(/export async function fetchApprovedRepReportsForWeek\([\s\S]*?\n\}/)
    assert.ok(fnMatch)
    assert.match(fnMatch[0], /\.eq\('week_start_date', weekStartDate\)/)
    assert.match(fnMatch[0], /\.eq\('status', 'submitted'\)/)
    assert.match(fnMatch[0], /\.eq\('review_status', 'approved'\)/)
  })

  test('importRepReportForConsolidation sends the week explicitly as p_week_start_date, never trusting the server to infer it — same-week matching is wired through from the client, not merely assumed', () => {
    const fnMatch = serviceSrc.match(/export async function importRepReportForConsolidation\([\s\S]*?\n\}/)
    assert.ok(fnMatch)
    assert.match(fnMatch[0], /p_week_start_date: weekStartDate/)
    assert.match(fnMatch[0], /p_rep_report_id: repReportId/)
    assert.match(fnMatch[0], /p_selected_fields: selectedFields/)
  })

  test('the RPC call site uses the exact same week the ReportForm itself is editing (week.weekStartDate), never a separately-tracked or user-editable week value', () => {
    assert.match(reportFormSrc, /weekStartDate=\{week\.weekStartDate\}/)
  })
})

describe('4. errors from the server-side authorization recheck are surfaced, never swallowed into a false "success"', () => {
  test('ManagerConsolidationError is caught and its message shown — a FORBIDDEN/NOT_APPROVED/WEEK_MISMATCH response never silently no-ops as if it had applied', () => {
    assert.match(panelSrc, /err instanceof ManagerConsolidationError/)
    assert.match(panelSrc, /setApplyError\(err\.message\)/)
  })

  test('onApply (which merges the text into the manager\'s report) is only called AFTER every selected import call has resolved without throwing — a partial failure never applies a partial, misleading preview', () => {
    const fnMatch = panelSrc.match(/const handleApply = async \(\) => \{([\s\S]*?)\n  \}/)
    assert.ok(fnMatch)
    const tryIndex = fnMatch[1].indexOf('try {')
    const onApplyIndex = fnMatch[1].indexOf("onApply(repBlocks.join('\\n\\n'))")
    const catchIndex = fnMatch[1].indexOf('} catch')
    assert.ok(tryIndex > -1 && onApplyIndex > -1 && catchIndex > -1 && tryIndex < onApplyIndex && onApplyIndex < catchIndex)
  })
})

describe('5. this integration never touches the Leadership Report feature or any of its own code', () => {
  test('none of the new Phase 1C files import or reference any Leadership Report component or service', () => {
    for (const src of [panelSrc, serviceSrc, reportFormSrc, mergeSrc]) {
      assert.doesNotMatch(src, /LeadershipReport/)
    }
  })
})
