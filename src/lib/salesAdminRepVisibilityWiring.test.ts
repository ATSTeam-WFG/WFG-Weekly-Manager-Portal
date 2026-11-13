// Run with: node --test src/lib/salesAdminRepVisibilityWiring.test.ts
//
// salesAdminRepVisibilityService.ts, SalesAdminManagerOverview.tsx, and
// their dependencies all transitively import the real Supabase client
// (via supabaseClient.ts, which reads import.meta.env and throws outside a
// real Vite/browser context) — not safe to import and execute directly
// here, the same limitation documented throughout this codebase (see
// adminRepVisibilityWiring.test.ts, salesRepDashboardWiring.test.ts). This
// verifies Phase 4's wiring via source inspection instead. The bucket
// CALCULATION logic itself (deriveRepReportBucket) has zero such dependency
// and is already unit-tested for real in repReportBucket.test.ts, reused
// here unchanged — see the "reuses Phase 2's bucket logic" describe block.
//
// What this covers:
// - Grouping: reps are grouped by currentManagerId, never by a new/
//   duplicated lookup.
// - Bucket calculations: a rep with no profileId yet counts as 'missing';
//   submittedCount is pending+approved+rejected, never independent.
// - Week navigation: local weekOffset state, same pattern as
//   AdminDashboard/MyReps, threaded into fetchAllRepReportsForWeek.
// - Drill-down: derived synchronously from already-fetched data, zero new
//   network call, filtered by managerId, sorted by name.
// - Role restrictions: never queries rep_manager_assignments directly
//   (the central security constraint from the Phase 4 audit — sales_admin
//   has no RLS policy on that table at all), never references any
//   write/review/assignment RPC, and is only reachable from the Sales
//   Admin shell.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const serviceSrc = readFileSync(path.join(dir, 'salesAdminRepVisibilityService.ts'), 'utf8')
const componentSrc = readFileSync(path.join(dir, '..', 'components', 'SalesAdminManagerOverview.tsx'), 'utf8')
const reportStatusComponentSrc = readFileSync(path.join(dir, '..', 'components', 'SalesAdminReports.tsx'), 'utf8')
const shellSrc = readFileSync(path.join(dir, '..', 'components', 'SalesAdminShell.tsx'), 'utf8')
const shellCssSrc = readFileSync(path.join(dir, '..', 'components', 'SalesAdminShell.css'), 'utf8')

describe('salesAdminRepVisibilityService.ts — reuses existing, already-authorized functions only', () => {
  test('imports fetchActiveManagers and fetchSalesReps from salesRepManagementService (the existing sales_admin-authorized endpoints), never a new fetch', () => {
    assert.match(serviceSrc, /import \{ fetchActiveManagers, fetchSalesReps, type SalesRep \} from '\.\/salesRepManagementService'/)
  })

  test('imports fetchAllRepReportsForWeek unchanged from repReportsService (Phase 2\'s own bulk fetch, already RLS-permitted for sales_admin via rep_reports_select_sales_admin)', () => {
    assert.match(serviceSrc, /import \{ fetchAllRepReportsForWeek, type RepReport \} from '\.\/repReportsService'/)
  })

  test('reuses deriveRepReportBucket from Phase 2\'s repReportBucket.ts, never a second independent bucket calculation', () => {
    assert.match(serviceSrc, /import \{ deriveRepReportBucket, type RepReportBucket \} from '\.\/repReportBucket'/)
    assert.doesNotMatch(serviceSrc, /function deriveRepReportBucket/)
  })

  test('NEVER queries rep_manager_assignments directly — the central Phase 4 security constraint (sales_admin has no RLS policy on that table). Mentioning it in an explanatory comment is fine; a .from(...) call or import of the admin-only assignment fetchers is not.', () => {
    assert.doesNotMatch(serviceSrc, /\.from\(['"]rep_manager_assignments['"]\)/)
    assert.doesNotMatch(serviceSrc, /import \{[^}]*fetchMyCurrentReps/)
    assert.doesNotMatch(serviceSrc, /import \{[^}]*fetchAllCurrentAssignments/)
  })

  test('never imports the supabase client directly, never issues a raw supabase.from(...) query of its own', () => {
    assert.doesNotMatch(serviceSrc, /from ['"]\.\.\/lib\/supabaseClient['"]/)
    assert.doesNotMatch(serviceSrc, /from ['"]\.\/supabaseClient['"]/)
    assert.doesNotMatch(serviceSrc, /supabase\.from\(/)
  })

  test('never references any write/review/assignment RPC (review_rep_report, assign_sales_rep, unassign_sales_rep, import_rep_report_for_consolidation) — read-only only', () => {
    for (const rpc of ['review_rep_report', 'assign_sales_rep', 'unassign_sales_rep', 'import_rep_report_for_consolidation']) {
      assert.equal(serviceSrc.includes(rpc), false, `must not reference ${rpc}`)
    }
  })
})

describe('salesAdminRepVisibilityService.ts — grouping', () => {
  test('fetchSalesAdminOverview groups reps by currentManagerId into a Map, skipping reps with no current Manager', () => {
    const match = serviceSrc.match(/export async function fetchSalesAdminOverview\(weekStartDate: string\): Promise<SalesAdminOverviewOutcome> \{[\s\S]*?\n\}/)
    assert.ok(match, 'could not locate fetchSalesAdminOverview')
    const body = match[0]
    assert.match(body, /if \(!rep\.currentManagerId\) continue/)
    assert.match(body, /repsByManagerId\.set\(rep\.currentManagerId, list\)/)
  })

  test('the overview is built from fetchActiveManagers()\'s own list (the already-allowlist-filtered real Managers), never a second Manager query', () => {
    const match = serviceSrc.match(/export async function fetchSalesAdminOverview\(weekStartDate: string\): Promise<SalesAdminOverviewOutcome> \{[\s\S]*?\n\}/)
    assert.ok(match)
    assert.match(match[0], /managers\.map\(\(manager\)/)
  })

  test('propagates fetchSalesReps()\'s own error message on failure, rather than swallowing it', () => {
    const match = serviceSrc.match(/export async function fetchSalesAdminOverview\(weekStartDate: string\): Promise<SalesAdminOverviewOutcome> \{[\s\S]*?\n\}/)
    assert.ok(match)
    assert.match(match[0], /if \(repsOutcome\.status !== 'ok'\) \{\s*\n\s*return \{ status: 'error', message: repsOutcome\.message \}/)
  })
})

describe('salesAdminRepVisibilityService.ts — bucket calculations', () => {
  test('bucketForRep treats a rep with no profileId (never completed onboarding) as "missing", without calling deriveRepReportBucket on a nonexistent report', () => {
    const match = serviceSrc.match(/function bucketForRep\([\s\S]*?\n\}/)
    assert.ok(match, 'could not locate bucketForRep')
    assert.match(match[0], /if \(!rep\.profileId\) return 'missing'/)
  })

  test('submittedCount is pending + approved + rejected, never an independent count (matches Phase 2\'s AdminManagerRepOverview identity)', () => {
    assert.match(serviceSrc, /submittedCount: pendingCount \+ approvedCount \+ rejectedCount,/)
  })

  test('each rep contributes to exactly one of the 4 mutually exclusive buckets per Manager (pending/approved/rejected/missing), summed from the same bucketForRep call', () => {
    const match = serviceSrc.match(/for \(const rep of managerReps\) \{[\s\S]*?\n {4}\}/)
    assert.ok(match, 'could not locate the per-Manager bucket-tallying loop')
    const body = match[0]
    assert.match(body, /const bucket = bucketForRep\(rep, reportByRepId\)/)
    assert.match(body, /if \(bucket === 'pending'\) pendingCount\+\+/)
    assert.match(body, /else if \(bucket === 'approved'\) approvedCount\+\+/)
    assert.match(body, /else if \(bucket === 'rejected'\) rejectedCount\+\+/)
    assert.match(body, /else missingCount\+\+/)
  })
})

describe('salesAdminRepVisibilityService.ts — drill-down is pure and synchronous, zero new network call', () => {
  test('deriveManagerDrillDown is a plain, non-async function', () => {
    assert.match(serviceSrc, /export function deriveManagerDrillDown\(managerId: string, reps: SalesRep\[\], reportByRepId: Map<string, RepReport>\): SalesAdminRepDrillDownRow\[\] \{/)
  })

  test('filters the already-fetched reps array by currentManagerId, never issuing a new fetch', () => {
    const match = serviceSrc.match(/export function deriveManagerDrillDown\([\s\S]*?\n\}/)
    assert.ok(match)
    assert.match(match[0], /\.filter\(\(rep\) => rep\.currentManagerId === managerId\)/)
  })

  test('sorts drill-down rows by name for stable display', () => {
    const match = serviceSrc.match(/export function deriveManagerDrillDown\([\s\S]*?\n\}/)
    assert.ok(match)
    assert.match(match[0], /\.sort\(\(a, b\) => a\.fullName\.localeCompare\(b\.fullName\)\)/)
  })
})

describe('SalesAdminManagerOverview.tsx — week navigation, consistent with AdminDashboard/MyReps', () => {
  test('uses getReportingWeekByOffset with local weekOffset state', () => {
    assert.match(componentSrc, /import \{ getReportingWeekByOffset \} from '\.\.\/utils\/week'/)
    assert.match(componentSrc, /const \[weekOffset, setWeekOffset\] = useState\(0\)/)
    assert.match(componentSrc, /const week = getReportingWeekByOffset\(weekOffset\)/)
  })

  test('Next is disabled at the current week and never advances past it', () => {
    assert.match(componentSrc, /const isCurrentWeek = weekOffset === 0/)
    assert.match(componentSrc, /onClick=\{\(\) => setWeekOffset\(\(o\) => Math\.min\(0, o \+ 1\)\)\}/)
    assert.match(componentSrc, /disabled=\{isCurrentWeek\}/)
  })

  test('reuses the shared, never-redefined .week-nav-btn/.week-selector-label/.week-current-badge classes', () => {
    assert.match(componentSrc, /className="week-selector-label"/)
    assert.match(componentSrc, /className="week-nav-btn"/)
    assert.match(componentSrc, /\{isCurrentWeek && <span className="week-current-badge">Current<\/span>\}/)
    const css = readFileSync(path.join(dir, '..', 'components', 'SalesAdminManagerOverview.css'), 'utf8')
    assert.equal(/^\.week-current-badge\s*\{/m.test(css), false, 'must reuse the existing shared .week-current-badge, never redefine it')
    assert.equal(/^\.week-nav-btn\s*\{/m.test(css), false, 'must reuse the existing shared .week-nav-btn, never redefine it')
  })

  test('the fetch effect depends on week.weekStartDate, so changing weeks refetches', () => {
    assert.match(componentSrc, /\}, \[week\.weekStartDate, reloadToken\]\)/)
  })

  test('selecting a Manager resets to null when the week changes (setSelected(null) inside the week-driven effect)', () => {
    const effectMatch = componentSrc.match(/useEffect\(\(\) => \{[\s\S]*?setSelected\(null\)[\s\S]*?\}, \[week\.weekStartDate, reloadToken\]\)/)
    assert.ok(effectMatch, 'the week-change effect must reset the drill-down selection')
  })
})

describe('SalesAdminManagerOverview.tsx — loading, empty, and error states', () => {
  test('renders a loading state distinct from the ready/error states', () => {
    assert.match(componentSrc, /loadState === 'loading' && <div className="samo-loading">/)
  })

  test('renders an error state with the outcome\'s own message and a Retry control', () => {
    assert.match(componentSrc, /loadState === 'error'/)
    assert.match(componentSrc, /\{loadErrorMessage \|\| 'Could not load the reporting overview\.'\}/)
    assert.match(componentSrc, /onClick=\{handleRetry\}/)
  })

  test('renders an explicit empty state when there are no real Managers', () => {
    assert.match(componentSrc, /No real Managers found\./)
  })

  test('renders an explicit empty state in the drill-down when a Manager has zero assigned reps', () => {
    assert.match(componentSrc, /No Sales Reps currently assigned to this Manager\./)
  })
})

describe('SalesAdminManagerOverview.tsx — strictly read-only, no new authorization surface', () => {
  test('never references any write/review/assignment RPC', () => {
    for (const rpc of ['review_rep_report', 'assign_sales_rep', 'unassign_sales_rep', 'import_rep_report_for_consolidation']) {
      assert.equal(componentSrc.includes(rpc), false, `must not reference ${rpc}`)
    }
  })

  test('never renders an Approve/Reject action button — "Approved"/"Needs Correction" only ever appear as read-only status labels', () => {
    assert.doesNotMatch(componentSrc, />Approve</)
    assert.doesNotMatch(componentSrc, />Reject</)
    assert.doesNotMatch(componentSrc, /onClick=\{.*approved.*\}/)
    assert.doesNotMatch(componentSrc, /onClick=\{.*rejected.*\}/)
  })

  test('never queries rep_manager_assignments directly', () => {
    assert.doesNotMatch(componentSrc, /\.from\(['"]rep_manager_assignments['"]\)/)
  })
})

describe('SalesAdminShell.tsx — exactly two destinations, with the manager rollup retained in Report Status', () => {
  test('does not expose Reporting by Manager as a separate destination', () => {
    assert.doesNotMatch(shellSrc, /SalesAdminManagerOverview|by-manager|Reporting by Manager/)
    assert.match(shellSrc, /type SalesAdminDestination = 'sales-reps' \| 'reports'/)
    assert.equal((shellSrc.match(/role="tab"/g) ?? []).length, 2)
  })

  test('the restricted SalesRepManagement and Report Status destinations remain present', () => {
    assert.match(shellSrc, /<SalesRepManagement onBack=\{\(\) => setDestination\('reports'\)\} restricted \/>/)
    assert.match(shellSrc, /<SalesAdminReports \/>/)
    assert.match(reportStatusComponentSrc, /Reporting by Manager/)
  })
})

describe('SalesAdminShell.css — nav wraps on unusually narrow screens, minimal and scoped', () => {
  test('.sales-admin-shell-nav sets flex-wrap for narrow screens', () => {
    const navRuleMatch = shellCssSrc.match(/\.sales-admin-shell-nav\s*\{[\s\S]*?\}/)
    assert.ok(navRuleMatch, 'could not locate .sales-admin-shell-nav rule')
    assert.match(navRuleMatch[0], /flex-wrap:\s*wrap/)
  })

  test('the fix is scoped to the nav rule alone — no new media query or layout rule was introduced', () => {
    assert.doesNotMatch(shellCssSrc, /@media/)
  })
})
