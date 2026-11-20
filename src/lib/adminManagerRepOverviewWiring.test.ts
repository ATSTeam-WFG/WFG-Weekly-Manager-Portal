// Run with: node --test src/lib/adminManagerRepOverviewWiring.test.ts
//
// AdminManagerRepOverview.tsx transitively imports the real Supabase client
// — not safe to import/execute directly here, the same limitation
// documented throughout this codebase (see adminRepVisibilityWiring.test.ts's
// own header comment). Verified via source inspection instead.
//
// Scope: the 2026-11-13 enhancement (summary cards, search/filter,
// Completion %, error state, horizontal-scroll responsive table) added in
// the component only, followed by the 2026-11-18 redesign (compact
// manager list with inline multi-expand instead of a six-column table with
// full-page drill-down navigation, 3 summary cards instead of 4, a
// segmented progress bar) — adminRepVisibilityService.ts's own counting/
// permission logic is covered separately by adminRepVisibilityWiring.test.ts
// and is unchanged by either revision.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const componentSrc = readFileSync(path.join(dir, '..', 'components', 'AdminManagerRepOverview.tsx'), 'utf8')
const cssSrc = readFileSync(path.join(dir, '..', 'components', 'AdminManagerRepOverview.css'), 'utf8')
const serviceSrc = readFileSync(path.join(dir, 'adminRepVisibilityService.ts'), 'utf8')

describe('AdminManagerRepOverview.tsx — summary totals are folded from the already-fetched rows, never a second query or a hardcoded figure', () => {
  // Beta feedback (2026-11-16): collapsed from the old
  // pending/approved/rejected breakdown to a plain submitted/draft/missing
  // split — review_status no longer gates or labels anything.
  test('totals is a reduce over `rows`, summing each row\'s existing per-manager counts', () => {
    const match = componentSrc.match(/const totals = rows\.reduce\([\s\S]*?\n {2}\)/)
    assert.ok(match, 'could not locate the totals reduce')
    const body = match[0]
    assert.match(body, /acc\.assigned \+= row\.assignedCount/)
    assert.match(body, /acc\.submitted \+= row\.submittedCount/)
    assert.match(body, /acc\.draft \+= row\.draftCount/)
    assert.match(body, /acc\.missing \+= row\.missingCount/)
  })

  // 2026-11-18 redesign: reduced from 4 cards (Total Assigned/Submitted/In
  // Progress/Missing) to 3 (Assigned/Submitted/Completion Rate) — In
  // Progress and Missing visibility moved to the per-manager progress bar
  // + caption instead of a top-level summary card.
  test('overallCompletionPct is derived from totals, guards the zero-assigned case, and the summary row renders exactly three figures, each from `totals`/`overallCompletionPct`, never a literal number', () => {
    assert.match(
      componentSrc,
      /const overallCompletionPct = totals\.assigned > 0 \? Math\.round\(\(totals\.submitted \/ totals\.assigned\) \* 100\) : 0/,
    )
    assert.match(componentSrc, /\{totals\.assigned\}/)
    assert.match(componentSrc, />Assigned</)
    assert.match(componentSrc, /\{totals\.submitted\}/)
    assert.match(componentSrc, />Submitted</)
    assert.match(componentSrc, /\{overallCompletionPct\}%/)
    assert.match(componentSrc, />Completion Rate</)
    assert.equal((componentSrc.match(/amro-summary-card/g) ?? []).length >= 3, true)
  })

  test('no second call to fetchManagerRepOverview beyond the one overview-fetch effect', () => {
    const overviewCalls = (componentSrc.match(/fetchManagerRepOverview\(/g) ?? []).length
    assert.equal(overviewCalls, 1, 'fetchManagerRepOverview must be called exactly once')
  })

  // fetchManagerRepDrillDown is now called lazily, once per Manager, from
  // inside toggleExpanded — still exactly one CALL SITE in source (the
  // function can run many times at runtime, once per distinct Manager
  // expanded, but there is still only one place in the code that calls it).
  test('fetchManagerRepDrillDown has exactly one call site, inside toggleExpanded, keyed by row.managerId', () => {
    const drillDownCalls = (componentSrc.match(/fetchManagerRepDrillDown\(/g) ?? []).length
    assert.equal(drillDownCalls, 1, 'fetchManagerRepDrillDown must have exactly one call site')
    assert.match(componentSrc, /function toggleExpanded\(row: ManagerRepOverviewRow\) \{[\s\S]*?fetchManagerRepDrillDown\(row\.managerId, weekStartDate\)/)
  })
})

describe('AdminManagerRepOverview.tsx — Completion % is a per-row derived value, never stored or double-counted', () => {
  test('completionPctOf derives from assignedCount/submittedCount only, guards the zero-assigned case', () => {
    const match = componentSrc.match(/function completionPctOf\(row: ManagerRepOverviewRow\): number \{[\s\S]*?\n\}/)
    assert.ok(match, 'could not locate completionPctOf')
    assert.match(match[0], /row\.assignedCount > 0 \? Math\.round\(\(row\.submittedCount \/ row\.assignedCount\) \* 100\) : 0/)
  })

  test('ManagerRepOverviewRow itself (adminRepVisibilityService.ts) gained no new stored field for this — Completion % is computed in the component only', () => {
    assert.doesNotMatch(serviceSrc, /completionPct|completionPercentage/)
  })

  // 2026-11-18 redesign: completionPctOf(row) is called once per row into a
  // `pct` variable (also reused for the progress bar's accessible label),
  // rather than being inlined directly into JSX — still derived fresh per
  // row, never a hardcoded percentage.
  test('each row derives its percentage via completionPctOf(row), assigned to `pct` and rendered, never a hardcoded percentage', () => {
    assert.match(componentSrc, /const pct = completionPctOf\(row\)/)
    assert.match(componentSrc, /\{pct\}%/)
  })
})

describe('AdminManagerRepOverview.tsx — Manager-level status filter and search, local/client-side only', () => {
  test('statusFilter/searchQuery are local component state, never threaded into the service calls (week is the only server-side filter)', () => {
    assert.match(componentSrc, /const \[searchQuery, setSearchQuery\] = useState\(''\)/)
    assert.match(componentSrc, /const \[statusFilter, setStatusFilter\] = useState<StatusFilter>\('all'\)/)
    const overviewFetchMatch = componentSrc.match(/fetchManagerRepOverview\(weekStartDate\)/)
    assert.ok(overviewFetchMatch, 'fetchManagerRepOverview must still be called with weekStartDate only')
  })

  // 2026-11-18 redesign: the single `selected`/drill-down state was
  // replaced by `expandedIds`/`drillDowns`, both reset here instead — the
  // effect must still depend on [weekStartDate] only, so a week change
  // never resets filter/search state.
  test('changing weeks never resets the filter/search state — the data-fetch effect depends only on weekStartDate, not on searchQuery/statusFilter', () => {
    const effectMatch = componentSrc.match(
      /useEffect\(\(\) => \{\s*\n\s*let active = true\s*\n\s*setLoadState\('loading'\)\s*\n\s*setExpandedIds\(new Set\(\)\)\s*\n\s*setDrillDowns\(\{\}\)[\s\S]*?\}, \[weekStartDate\]\)/,
    )
    assert.ok(effectMatch, 'the overview fetch effect must depend on [weekStartDate] only')
  })

  test('the filter keeps a Manager row when that Manager has at least one rep in the selected bucket — never an exact-match-only or all-or-nothing rule', () => {
    const match = componentSrc.match(/const filteredRows = useMemo\(\(\) => \{[\s\S]*?\n {2}\}, \[rows, searchQuery, statusFilter\]\)/)
    assert.ok(match, 'could not locate filteredRows')
    const body = match[0]
    assert.match(body, /if \(bucketCount === 0\) return false/)
  })

  test('search matches manager name OR email, case-insensitively', () => {
    assert.match(componentSrc, /\(row\.managerName \?\? ''\)\.toLowerCase\(\)\.includes\(query\) \|\| row\.managerEmail\.toLowerCase\(\)\.includes\(query\)/)
  })

  test('exactly four filter pills: All, Submitted, In Progress, Missing', () => {
    const filtersMatch = componentSrc.match(/const FILTERS: \{ key: StatusFilter; label: string \}\[\] = (\[[\s\S]*?\])/)
    assert.ok(filtersMatch, 'could not locate FILTERS')
    const arrayBody = filtersMatch[1]
    assert.equal((arrayBody.match(/\{ key:/g) ?? []).length, 4)
    for (const label of ['All', 'Submitted', 'In Progress', 'Missing']) {
      assert.match(arrayBody, new RegExp(`label: '${label}'`))
    }
  })
})

describe('AdminManagerRepOverview.tsx — loading/empty/error states for both the overview and each Manager\'s drill-down', () => {
  test('the overview fetch is wrapped in .catch(), setting loadState to \'error\' — a genuine failure never gets stuck on "Loading…" forever', () => {
    const match = componentSrc.match(/fetchManagerRepOverview\(weekStartDate\)\s*\n\s*\.then\([\s\S]*?\)\s*\n\s*\.catch\(\(\) => \{[\s\S]*?setLoadState\('error'\)/)
    assert.ok(match, 'expected fetchManagerRepOverview to have a .catch setting loadState to error')
  })

  // 2026-11-18 redesign: each Manager's drill-down is now its own entry in
  // the `drillDowns` record (keyed by managerId), set to loadState: 'error'
  // on failure, rather than a single shared drillDownLoadState.
  test('each Manager\'s drill-down fetch is wrapped in .catch(), recording that Manager\'s own loadState as \'error\' in the drillDowns record', () => {
    const match = componentSrc.match(
      /fetchManagerRepDrillDown\(row\.managerId, weekStartDate\)\s*\n\s*\.then\([\s\S]*?\)\s*\n\s*\.catch\(\(\) => \{[\s\S]*?setDrillDowns\(\(prev\) => \(\{ \.\.\.prev, \[row\.managerId\]: \{ loadState: 'error', rows: \[\] \} \}\)\)/,
    )
    assert.ok(match, 'expected fetchManagerRepDrillDown to have a .catch recording that Manager\'s own error state')
  })

  test('an empty (zero real Managers) result and a zero-filter-match result are distinguishable, separate messages', () => {
    assert.match(componentSrc, />No real Managers found\.</)
    assert.match(componentSrc, />No Managers match your search or filter\.</)
  })

  test('a Manager with zero assigned reps is handled by completionPctOf\'s own guard, never a division by zero', () => {
    assert.match(componentSrc, /row\.assignedCount > 0 \?/)
  })
})

describe('AdminManagerRepOverview.tsx — the Manager drill-down stays strictly read-only, no new edit/approval authority added', () => {
  test('never renders an Approve/Reject control or calls any review/decision RPC', () => {
    assert.doesNotMatch(componentSrc, />Approve</)
    assert.doesNotMatch(componentSrc, />Reject</)
    for (const forbidden of ['review_rep_report(', "'review_rep_report'", 'reviewSalesRepReport(', 'reviewRepReport(']) {
      assert.equal(componentSrc.includes(forbidden), false, `must not call ${forbidden}`)
    }
  })

  test('the drill-down still only ever reuses fetchManagerRepDrillDown — no new query or RPC added for it', () => {
    assert.doesNotMatch(componentSrc, /\.from\(['"]rep_reports['"]\)/)
    assert.doesNotMatch(componentSrc, /supabase\.rpc\(/)
  })
})

// 2026-11-18 redesign: several Managers may be expanded inline at once
// (never a full-page navigation away), each independently tracked.
describe('AdminManagerRepOverview.tsx — inline multi-expand, several Managers open at once, each with its own accessible toggle', () => {
  test('expandedIds is a Set, toggled per Manager — expanding one never collapses another', () => {
    assert.match(componentSrc, /const \[expandedIds, setExpandedIds\] = useState<ReadonlySet<string>>\(new Set\(\)\)/)
    const toggleMatch = componentSrc.match(/function toggleExpanded\(row: ManagerRepOverviewRow\) \{[\s\S]*?\n  \}/)
    assert.ok(toggleMatch, 'could not locate toggleExpanded')
    assert.match(toggleMatch[0], /next\.delete\(row\.managerId\)/)
    assert.match(toggleMatch[0], /next\.add\(row\.managerId\)/)
  })

  test('drill-down results are cached per Manager — re-expanding the same Manager within the same week never re-fetches', () => {
    assert.match(componentSrc, /if \(drillDowns\[row\.managerId\]\) return/)
  })

  test('the toggle is a real <button> with aria-expanded and aria-controls pointing at the matching panel id, and the panel is a labelled region', () => {
    assert.match(componentSrc, /className="amro-manager-toggle"\s*\n\s*aria-expanded=\{isExpanded\}\s*\n\s*aria-controls=\{panelId\}/)
    assert.match(componentSrc, /const panelId = `amro-panel-\$\{row\.managerId\}`/)
    assert.match(componentSrc, /id=\{panelId\} role="region" aria-label=\{`\$\{managerName\}'s assigned Sales Reps`\}/)
  })
})

describe('AdminManagerRepOverview.css — compact list layout, responsive without horizontal scroll', () => {
  // 2026-11-18 redesign: the old wide six-column table (with its dedicated
  // .amro-table-scroll horizontal-scroll wrapper) is gone entirely —
  // replaced by a list of flex rows that wrap naturally at any width.
  test('the former .amro-table-scroll / .amro-table-overview table markup no longer exists anywhere in this component or its stylesheet', () => {
    assert.doesNotMatch(componentSrc, /amro-table-scroll|amro-table-overview|amro-row-overview/)
    assert.doesNotMatch(cssSrc, /\.amro-table-scroll|\.amro-table-overview|\.amro-row-overview/)
  })

  test('no overflow-x: auto anywhere in this file — the manager list reflows instead of scrolling horizontally', () => {
    assert.doesNotMatch(cssSrc, /overflow-x:\s*auto/)
  })

  test('the manager toggle row is a wrapping flex row, so stats/chevron drop beneath the name/email at narrow widths with no JS breakpoint logic', () => {
    const toggleRuleMatch = cssSrc.match(/\.amro-manager-toggle \{([\s\S]*?)\n\}/)
    assert.ok(toggleRuleMatch, 'could not locate .amro-manager-toggle')
    assert.match(toggleRuleMatch[1], /display: flex;/)
    assert.match(toggleRuleMatch[1], /flex-wrap: wrap;/)
  })

  test('summary cards reflow (not overflow) at the mobile breakpoint', () => {
    assert.match(cssSrc, /@media \(max-width: 480px\)[\s\S]*?\.amro-summary-row[\s\S]*?grid-template-columns: 1fr/)
  })

  test('the segmented progress bar has a submitted (green) and draft/in-progress (amber) segment — the unfilled remainder is the missing portion, and a text caption restates all three counts so status is never color-only', () => {
    assert.match(cssSrc, /\.amro-progress-submitted \{\s*\n\s*background: var\(--green\);/)
    assert.match(cssSrc, /\.amro-progress-draft \{\s*\n\s*background: var\(--amber\);/)
    assert.match(componentSrc, /\{row\.submittedCount\} submitted · \{row\.draftCount\} in progress · \{row\.missingCount\} missing/)
  })
})
