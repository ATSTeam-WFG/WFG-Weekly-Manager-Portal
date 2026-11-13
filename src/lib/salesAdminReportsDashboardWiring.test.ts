// Run with: node --test src/lib/salesAdminReportsDashboardWiring.test.ts
//
// Source-inspection coverage for the Sales Admin "Report Status" dashboard
// — not a PostgreSQL-execution or rendered-DOM test (same constraint as
// salesAdminWiring.test.ts: SalesAdminReports.tsx transitively imports the
// real Supabase client).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const src = readFileSync(path.join(dir, '..', 'components', 'SalesAdminReports.tsx'), 'utf8')
const adminDashboardSrc = readFileSync(path.join(dir, '..', 'components', 'AdminDashboard.tsx'), 'utf8')

describe('SalesAdminReports.tsx — reuses AdminDashboard.tsx\'s own classes directly, the actual Super Admin dashboard, rather than a new design', () => {
  test('imports AdminDashboard.css (not a reinvented stylesheet) for the KPI row, filter pills, and table', () => {
    assert.match(src, /import '\.\/AdminDashboard\.css'/)
  })

  test('KPI row reuses .adp-kpi-row/.adp-kpi-card verbatim — the exact classes AdminDashboard.tsx uses for its own 5 cards', () => {
    assert.match(src, /className="adp-kpi-row"/)
    assert.match(src, /className="adp-kpi-card adp-kpi-card-total"/)
    assert.match(src, /className="adp-kpi-card adp-kpi-card-submitted"/)
    assert.match(src, /className="adp-kpi-card adp-kpi-card-draft"/)
    assert.match(src, /className="adp-kpi-card adp-kpi-card-not-started"/)
    assert.match(src, /className="adp-kpi-card adp-kpi-card-completion"/)
    // Same five card classes AdminDashboard.tsx itself uses, confirmed
    // directly against that file rather than assumed.
    for (const cls of ['adp-kpi-card-total', 'adp-kpi-card-submitted', 'adp-kpi-card-draft', 'adp-kpi-card-not-started', 'adp-kpi-card-completion']) {
      assert.match(adminDashboardSrc, new RegExp(cls))
    }
  })

  test('shows Total Sales Reps / Submitted / In Progress / Not Started / Completion — five live counts, never a hardcoded or invented number', () => {
    assert.match(src, />Total Sales Reps</)
    assert.match(src, /\{completionPct\}%/)
    const match = src.match(/const total = \(rows \?\? \[\]\)\.length[\s\S]*?const completionPct = total > 0 \? Math\.round\(\(submitted \/ total\) \* 100\) : 0/)
    assert.ok(match, 'expected the live count calculations, same shape as AdminDashboard.tsx\'s own')
  })

  test('filter pills reuse .adp-filter-row/.adp-filter-btn/.adp-filter-count verbatim, with exactly four pills: All, Submitted, In Progress, Not Started (no Pending/reminder-based pill — Sales Admin cannot send reminders)', () => {
    assert.match(src, /className="adp-filter-row"/)
    assert.match(src, /className=\{`adp-filter-btn \$\{filter === f\.key \? 'active' : ''\}`\}/)
    assert.match(src, /\{ key: 'all', label: 'All' \}/)
    assert.match(src, /\{ key: 'submitted', label: 'Submitted' \}/)
    assert.match(src, /\{ key: 'draft', label: 'In Progress' \}/)
    assert.match(src, /\{ key: 'not_started', label: 'Not Started' \}/)
    // Exactly four filter pills — no fifth "Pending" (reminder-based) pill
    // the way AdminDashboard.tsx's Managers table has. "Pending Review" may
    // still appear as an informational per-row review-status sub-label
    // (Sales Admin can see it, just never act on it) — that's a different
    // thing from a filter pill, so this checks the FILTERS array itself,
    // not the whole file.
    const filtersMatch = src.match(/const FILTERS: \{ key: StatusFilter; label: string \}\[\] = (\[[\s\S]*?\])/)
    assert.ok(filtersMatch, 'could not locate the FILTERS array')
    const arrayBody = filtersMatch[1] // capture group 1 — the array literal only, excluding the type annotation prefix (which itself contains the substring "{ key:")
    assert.equal((arrayBody.match(/\{ key:/g) ?? []).length, 4)
    assert.doesNotMatch(arrayBody, /'Pending'/)
    // "Reminder" may appear in an explanatory comment (contrasting this
    // screen with Managers' own reminder column) — the real check is that
    // no reminder-sending code path exists anywhere in the file.
    assert.doesNotMatch(src, /manager-remind-btn|setReminderTarget|getReminderTargets|ReminderPanel|Prepare Reminders/)
  })

  test('bucketOf derives its three-way split from the report\'s real status fields only — never a hardcoded or random count', () => {
    const match = src.match(/function bucketOf\(report: RepReport \| null\): StatusBucket \{[\s\S]*?\n\}/)
    assert.ok(match, 'could not locate bucketOf')
    assert.match(match[0], /if \(!report\) return 'not_started'/)
    assert.match(match[0], /if \(report\.status === 'draft'\) return 'draft'/)
    assert.match(match[0], /return 'submitted'/)
  })

  test('table reuses .adp-table/.adp-table-header-row/.adp-row/.adp-cell-manager/.adp-manager-avatar verbatim, same five-column grid rhythm as AdminDashboard.tsx\'s own Managers table', () => {
    assert.match(src, /className="adp-table"/)
    assert.match(src, /className="adp-table-header-row"/)
    assert.match(src, /className="adp-row"/)
    assert.match(src, /className="adp-cell adp-cell-manager"/)
    assert.match(src, /className="adp-manager-avatar"/)
    assert.match(src, /getInitials\(rep\.fullName\)/)
  })

  test('status badge reuses StatusBadge.css\'s .status-badge/.status-* color classes (imported directly), with Sales-Rep-appropriate labels rather than the <StatusBadge> component\'s own Admin-report-submitter-phrased labels', () => {
    assert.match(src, /import '\.\/StatusBadge\.css'/)
    assert.match(src, /className=\{`status-badge status-\$\{bucket\}`\}/)
  })

  test('"Current Manager" and "Submitted" columns replace Managers\' "Reminder" column — Sales Admin never gets a reminder action anywhere in this file', () => {
    assert.match(src, />Current Manager</)
    assert.match(src, />Submitted</)
    assert.doesNotMatch(src, /manager-remind-btn|setReminderTarget|prepare.*reminder/i)
  })

  test('the View Report action reuses .adp-view-link\'s exact text styling (a small CSS-only button reset, not a new visual treatment), right-aligned as the table\'s last column, and is unavailable (a dash) when no report exists yet for that rep', () => {
    assert.match(src, /className="adp-view-link-btn"/)
    assert.match(src, /View Report/)
    assert.match(src, /\{report \? \(/)
    assert.match(src, /<span className="adp-dash">—<\/span>/)
  })
})

describe('SalesAdminReportViewModal — read-only report content viewer, with every decision control deliberately omitted', () => {
  test('reuses .myreps-overlay/.myreps-panel (MyReps.tsx\'s own classes) rather than a new modal design', () => {
    assert.match(src, /import '\.\/MyReps\.css'/)
    assert.match(src, /className="myreps-overlay"/)
    assert.match(src, /className="myreps-panel"/)
  })

  test('never renders Review History, never an Approve/Reject button, never calls any review/decision RPC — this view has no review authority at all (mentioning review_rep_report in an explanatory comment, as the file already did before this change, is fine; calling it is not)', () => {
    assert.doesNotMatch(src, /Review History/)
    assert.doesNotMatch(src, />Approve</)
    assert.doesNotMatch(src, />Reject</)
    for (const forbidden of ['review_rep_report(', "'review_rep_report'", 'reviewRepReport(', 'handleDecision(']) {
      assert.equal(src.includes(forbidden), false, `must not call ${forbidden}`)
    }
  })

  test('the modal only ever renders when viewingRow.report is present', () => {
    assert.match(src, /\{viewingRow\?\.report && \(/)
  })
})
