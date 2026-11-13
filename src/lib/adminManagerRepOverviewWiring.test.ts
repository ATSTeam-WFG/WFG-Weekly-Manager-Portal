// Run with: node --test src/lib/adminManagerRepOverviewWiring.test.ts
//
// AdminManagerRepOverview.tsx transitively imports the real Supabase client
// — not safe to import/execute directly here, the same limitation
// documented throughout this codebase (see adminRepVisibilityWiring.test.ts's
// own header comment). Verified via source inspection instead.
//
// Scope: the 2026-11-13 enhancement (summary cards, search/filter,
// Completion %, error state, horizontal-scroll responsive table) added in
// the component only — adminRepVisibilityService.ts's own counting/
// permission logic is covered separately by adminRepVisibilityWiring.test.ts
// and is unchanged here.
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
  test('totals is a reduce over `rows`, summing each row\'s existing per-manager counts', () => {
    const match = componentSrc.match(/const totals = rows\.reduce\([\s\S]*?\n {2}\)/)
    assert.ok(match, 'could not locate the totals reduce')
    const body = match[0]
    assert.match(body, /acc\.assigned \+= row\.assignedCount/)
    assert.match(body, /acc\.submitted \+= row\.submittedCount/)
    assert.match(body, /acc\.pending \+= row\.pendingCount/)
    assert.match(body, /acc\.approved \+= row\.approvedCount/)
    assert.match(body, /acc\.rejected \+= row\.rejectedCount/)
    assert.match(body, /acc\.missing \+= row\.missingCount/)
  })

  test('the summary row renders all six required figures, each from `totals`, never a literal number', () => {
    assert.match(componentSrc, /\{totals\.assigned\}/)
    assert.match(componentSrc, />Total Assigned</)
    assert.match(componentSrc, /\{totals\.submitted\}/)
    assert.match(componentSrc, />Submitted</)
    assert.match(componentSrc, /\{totals\.pending\}/)
    assert.match(componentSrc, />Pending Review</)
    assert.match(componentSrc, /\{totals\.approved\}/)
    assert.match(componentSrc, />Approved</)
    assert.match(componentSrc, /\{totals\.rejected\}/)
    assert.match(componentSrc, />Needs Correction</)
    assert.match(componentSrc, /\{totals\.missing\}/)
    assert.match(componentSrc, />Missing</)
  })

  test('no second call to fetchManagerRepOverview/fetchManagerRepDrillDown beyond the two existing effects — totals never triggers its own fetch', () => {
    const overviewCalls = (componentSrc.match(/fetchManagerRepOverview\(/g) ?? []).length
    const drillDownCalls = (componentSrc.match(/fetchManagerRepDrillDown\(/g) ?? []).length
    assert.equal(overviewCalls, 1, 'fetchManagerRepOverview must be called exactly once')
    assert.equal(drillDownCalls, 1, 'fetchManagerRepDrillDown must be called exactly once')
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

  test('the table renders completionPctOf(row), never a hardcoded percentage', () => {
    assert.match(componentSrc, /\{completionPctOf\(row\)\}%/)
  })
})

describe('AdminManagerRepOverview.tsx — Manager-level status filter and search, local/client-side only', () => {
  test('statusFilter/searchQuery are local component state, never threaded into the service calls (week is the only server-side filter)', () => {
    assert.match(componentSrc, /const \[searchQuery, setSearchQuery\] = useState\(''\)/)
    assert.match(componentSrc, /const \[statusFilter, setStatusFilter\] = useState<StatusFilter>\('all'\)/)
    const overviewFetchMatch = componentSrc.match(/fetchManagerRepOverview\(weekStartDate\)/)
    assert.ok(overviewFetchMatch, 'fetchManagerRepOverview must still be called with weekStartDate only')
  })

  test('changing weeks never resets the filter/search state — the data-fetch effect depends only on weekStartDate, not on searchQuery/statusFilter', () => {
    const effectMatch = componentSrc.match(/useEffect\(\(\) => \{\s*\n\s*let active = true\s*\n\s*setLoadState\('loading'\)\s*\n\s*setSelected\(null\)[\s\S]*?\}, \[weekStartDate\]\)/)
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

  test('exactly five filter pills: All, Pending Review, Approved, Needs Correction, Missing', () => {
    const filtersMatch = componentSrc.match(/const FILTERS: \{ key: StatusFilter; label: string \}\[\] = (\[[\s\S]*?\])/)
    assert.ok(filtersMatch, 'could not locate FILTERS')
    const arrayBody = filtersMatch[1]
    assert.equal((arrayBody.match(/\{ key:/g) ?? []).length, 5)
    for (const label of ['All', 'Pending Review', 'Approved', 'Needs Correction', 'Missing']) {
      assert.match(arrayBody, new RegExp(`label: '${label}'`))
    }
  })
})

describe('AdminManagerRepOverview.tsx — loading/empty/error states for both the overview and the drill-down', () => {
  test('the overview fetch is wrapped in .catch(), setting loadState to \'error\' — a genuine failure never gets stuck on "Loading…" forever', () => {
    const match = componentSrc.match(/fetchManagerRepOverview\(weekStartDate\)\s*\n\s*\.then\([\s\S]*?\)\s*\n\s*\.catch\(\(\) => \{[\s\S]*?setLoadState\('error'\)/)
    assert.ok(match, 'expected fetchManagerRepOverview to have a .catch setting loadState to error')
  })

  test('the drill-down fetch is also wrapped in .catch(), setting drillDownLoadState to \'error\'', () => {
    const match = componentSrc.match(/fetchManagerRepDrillDown\(selected\.managerId, weekStartDate\)\s*\n\s*\.then\([\s\S]*?\)\s*\n\s*\.catch\(\(\) => \{[\s\S]*?setDrillDownLoadState\('error'\)/)
    assert.ok(match, 'expected fetchManagerRepDrillDown to have a .catch setting drillDownLoadState to error')
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

describe('AdminManagerRepOverview.css — responsive behavior', () => {
  test('the overview table scrolls horizontally on narrow viewports (a dedicated .amro-table-scroll wrapper), rather than collapsing to stacked single-column cards', () => {
    const scrollRuleMatch = cssSrc.match(/\.amro-table-scroll\s*\{[\s\S]*?\}/)
    assert.ok(scrollRuleMatch, 'could not locate .amro-table-scroll')
    assert.match(scrollRuleMatch[0], /overflow-x:\s*auto/)
    assert.match(componentSrc, /className="amro-table-scroll"/)
  })

  test('the wrapper is the only horizontal-scroll container — no overflow-x on anything page- or sidebar-level in this file', () => {
    const overflowXRules = cssSrc.match(/[^{}]+\{[^{}]*overflow-x:\s*auto[^{}]*\}/g) ?? []
    assert.equal(overflowXRules.length, 1, 'expected exactly one overflow-x: auto rule, scoped to .amro-table-scroll')
    assert.match(overflowXRules[0], /\.amro-table-scroll/)
  })

  test('summary cards reflow (not overflow) at tablet/mobile widths', () => {
    assert.match(cssSrc, /@media \(max-width: 860px\)[\s\S]*?\.amro-summary-row[\s\S]*?grid-template-columns: repeat\(3, 1fr\)/)
    assert.match(cssSrc, /@media \(max-width: 640px\)[\s\S]*?\.amro-summary-row[\s\S]*?grid-template-columns: repeat\(2, 1fr\)/)
  })
})
