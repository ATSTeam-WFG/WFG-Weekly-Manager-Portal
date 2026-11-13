// Run with: node --test src/lib/salesAdminReportsDashboardWiring.test.ts
//
// Source-inspection coverage for the Sales Admin "Report Status" dashboard
// redesign — not a PostgreSQL-execution or rendered-DOM test (same
// constraint as salesAdminWiring.test.ts: SalesAdminReports.tsx
// transitively imports the real Supabase client).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const src = readFileSync(path.join(dir, '..', 'components', 'SalesAdminReports.tsx'), 'utf8')

describe('SalesAdminReports.tsx — KPI summary row reuses the existing samo-summary pattern, no invented statuses', () => {
  test('reuses .samo-summary-row/.samo-summary-card (the exact classes SalesAdminManagerOverview.tsx already uses) rather than a new CSS file', () => {
    assert.match(src, /import '\.\/SalesAdminManagerOverview\.css'/)
    assert.match(src, /className="samo-summary-row"/)
    assert.match(src, /className="samo-summary-card"/)
  })

  test('shows exactly four cards: Total Sales Reps, Not Started, In Progress, Submitted', () => {
    assert.match(src, />Total Sales Reps</)
    assert.match(src, />Not Started</)
    assert.match(src, />In Progress</)
    assert.match(src, />Submitted</)
  })

  test('bucketOf derives its three-way split from the report\'s real status fields only (no report => not_started, status==="draft" => in_progress, anything else => submitted) — never a hardcoded or random count', () => {
    const match = src.match(/function bucketOf\(report: RepReport \| null\): StatusBucket \{[\s\S]*?\n\}/)
    assert.ok(match, 'could not locate bucketOf')
    const body = match[0]
    assert.match(body, /if \(!report\) return 'not_started'/)
    assert.match(body, /if \(report\.status === 'draft'\) return 'in_progress'/)
    assert.match(body, /return 'submitted'/)
  })

  test('summaryCounts is a live tally over the already-fetched rows (useMemo over rows), never a separate fetch or a static placeholder', () => {
    const match = src.match(/const summaryCounts = useMemo\(\(\) => \{[\s\S]*?\}, \[rows\]\)/)
    assert.ok(match, 'could not locate summaryCounts useMemo')
    assert.match(match[0], /for \(const row of rows \?\? \[\]\) \{/)
    assert.match(match[0], /counts\[bucketOf\(row\.report\)\] \+= 1/)
  })
})

describe('SalesAdminReports.tsx — search/filter reuses SalesRepManagement.tsx\'s existing .srm-controls pattern', () => {
  test('a search input and a status-filter select, same class names as SalesRepManagement.tsx', () => {
    assert.match(src, /className="srm-controls"/)
    assert.match(src, /className="srm-search"/)
    assert.match(src, /className="srm-status-filter"/)
  })

  test('filteredRows filters by the same bucketOf status and by name/email search text', () => {
    const match = src.match(/const filteredRows = useMemo\(\(\) => \{[\s\S]*?\}, \[rows, search, statusFilter\]\)/)
    assert.ok(match, 'could not locate filteredRows useMemo')
    assert.match(match[0], /bucketOf\(row\.report\) !== statusFilter/)
    assert.match(match[0], /row\.rep\.fullName\.toLowerCase\(\)\.includes\(term\)/)
    assert.match(match[0], /row\.rep\.email\.toLowerCase\(\)\.includes\(term\)/)
  })
})

describe('SalesAdminReportViewModal — read-only report content viewer, reusing MyReps.tsx\'s existing dialog classes, with every decision control deliberately omitted', () => {
  test('reuses .myreps-overlay/.myreps-panel/.myreps-section (MyReps.tsx\'s own classes) rather than a new modal design', () => {
    assert.match(src, /import '\.\/MyReps\.css'/)
    assert.match(src, /className="myreps-overlay"/)
    assert.match(src, /className="myreps-panel"/)
  })

  test('renders the same five SECTION_LIST_FIELDS and Manager Support Needed as MyReps.tsx\'s dialog, in the same order', () => {
    assert.match(
      src,
      /\{ key: 'accomplishments', label: 'Accomplishments' \},\s*\n\s*\{ key: 'salesMetrics', label: 'Sales Metrics' \},\s*\n\s*\{ key: 'pipelineUpdates', label: 'Pipeline Updates' \},\s*\n\s*\{ key: 'blockers', label: 'Blockers' \},\s*\n\s*\{ key: 'nextWeekPriorities', label: 'Next Week Priorities' \},/,
    )
    assert.match(src, />Manager Support Needed</)
  })

  test('never renders Review History, never an Approve/Reject button, never calls any review/decision RPC — this view has no review authority at all (mentioning review_rep_report in an explanatory comment, as the file already did before this change, is fine; calling it is not)', () => {
    assert.doesNotMatch(src, /Review History/)
    assert.doesNotMatch(src, />Approve</)
    assert.doesNotMatch(src, />Reject</)
    for (const forbidden of ['review_rep_report(', "'review_rep_report'", 'reviewRepReport(', 'handleDecision(']) {
      assert.equal(src.includes(forbidden), false, `must not call ${forbidden}`)
    }
  })

  test('the View button is disabled when no report exists for that rep, and the modal only ever renders when viewingRow.report is present', () => {
    assert.match(src, /disabled=\{!row\.report\}/)
    assert.match(src, /\{viewingRow\?\.report && \(/)
  })
})
