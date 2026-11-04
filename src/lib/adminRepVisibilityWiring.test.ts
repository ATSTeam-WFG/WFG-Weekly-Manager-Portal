// Run with: node --test src/lib/adminRepVisibilityWiring.test.ts
//
// adminRepVisibilityService.ts, repReportsService.ts, and
// AdminManagerRepOverview.tsx all transitively import the real Supabase
// client (via supabaseClient.ts, which reads import.meta.env and throws
// outside a real Vite/browser context) — not safe to import and execute
// directly here, the same limitation documented throughout this codebase
// (see salesRepDashboardWiring.test.ts, autosaveWiring.test.ts). This
// verifies Phase 2's wiring via source inspection instead. The bucket
// CALCULATION logic itself (deriveRepReportBucket) has zero such dependency
// and is unit-tested for real in repReportBucket.test.ts.
//
// What this covers:
// - Permissions: the two new bulk fetchers have no manager_id/rep_id filter
//   (they rely entirely on the pre-existing is_admin() RLS policies, never
//   a client-side filter that could be tampered with), and the whole
//   feature is structurally unreachable from the Sales Admin surface
//   (SalesAdminShell/SalesAdminReports never reference it; only
//   AdminDashboard does).
// - Reporting-week filtering: weekStartDate is threaded into both the bulk
//   overview fetch and every per-rep drill-down fetch — never hardcoded,
//   never the Manager's own currently-open week by accident.
// - Manager drill-down: reuses fetchMyCurrentReps/fetchProfilesByIds/
//   fetchRepReport unchanged, never reimplements assignment/profile
//   lookups, and handles the empty-assignment case without a wasted fetch.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const serviceSrc = readFileSync(path.join(dir, 'adminRepVisibilityService.ts'), 'utf8')
const repReportsServiceSrc = readFileSync(path.join(dir, 'repReportsService.ts'), 'utf8')
const adminDashboardSrc = readFileSync(path.join(dir, '..', 'components', 'AdminDashboard.tsx'), 'utf8')
const salesAdminShellSrc = readFileSync(path.join(dir, '..', 'components', 'SalesAdminShell.tsx'), 'utf8')
const salesAdminReportsSrc = readFileSync(path.join(dir, '..', 'components', 'SalesAdminReports.tsx'), 'utf8')

describe('repReportsService.ts — fetchAllCurrentAssignments / fetchAllRepReportsForWeek have no client-side identity filter (permissions rely on RLS alone)', () => {
  test('fetchAllCurrentAssignments filters only by unassigned_at IS NULL, never by manager_id or rep_id', () => {
    const match = repReportsServiceSrc.match(/export async function fetchAllCurrentAssignments\(\): Promise<RepManagerAssignment\[\]> \{[\s\S]*?\n\}/)
    assert.ok(match, 'could not locate fetchAllCurrentAssignments')
    const body = match[0]
    assert.match(body, /\.is\('unassigned_at', null\)/)
    assert.doesNotMatch(body, /\.eq\('manager_id'/)
    assert.doesNotMatch(body, /\.eq\('rep_id'/)
  })

  test('fetchAllRepReportsForWeek filters only by week_start_date, never by rep_id', () => {
    const match = repReportsServiceSrc.match(/export async function fetchAllRepReportsForWeek\(weekStartDate: string\): Promise<RepReport\[\]> \{[\s\S]*?\n\}/)
    assert.ok(match, 'could not locate fetchAllRepReportsForWeek')
    const body = match[0]
    assert.match(body, /\.eq\('week_start_date', weekStartDate\)/)
    assert.doesNotMatch(body, /\.eq\('rep_id'/)
  })

  test('both fail soft (empty array on error), never throw — consistent with every other read in this file', () => {
    for (const fnName of ['fetchAllCurrentAssignments', 'fetchAllRepReportsForWeek']) {
      const match = repReportsServiceSrc.match(new RegExp(`export async function ${fnName}\\([^)]*\\): Promise<\\w+\\[\\]> \\{[\\s\\S]*?\\n\\}`))
      assert.ok(match, `could not locate ${fnName}`)
      assert.match(match[0], /if \(error\) \{[\s\S]*?return \[\]\s*\n\s*\}/)
      assert.doesNotMatch(match[0], /throw/)
    }
  })
})

describe('Phase 2 is structurally unreachable from the Sales Admin surface', () => {
  test('SalesAdminShell.tsx and SalesAdminReports.tsx never reference adminRepVisibilityService or AdminManagerRepOverview', () => {
    for (const src of [salesAdminShellSrc, salesAdminReportsSrc]) {
      assert.doesNotMatch(src, /adminRepVisibilityService/)
      assert.doesNotMatch(src, /AdminManagerRepOverview/)
    }
  })

  test('AdminDashboard.tsx (Admin-only — never rendered for sales_admin, per App.tsx role routing) is the only place that renders AdminManagerRepOverview', () => {
    assert.match(adminDashboardSrc, /import AdminManagerRepOverview from '\.\/AdminManagerRepOverview'/)
    assert.match(adminDashboardSrc, /<AdminManagerRepOverview weekStartDate=\{week\.weekStartDate\} weekLabel=\{week\.label\} \/>/)
  })
})

describe('adminRepVisibilityService.ts — reporting-week filtering', () => {
  test('fetchManagerRepOverview threads weekStartDate into fetchAllRepReportsForWeek, never a hardcoded/current week', () => {
    const match = serviceSrc.match(/export async function fetchManagerRepOverview\(weekStartDate: string\): Promise<ManagerRepOverviewRow\[\]> \{[\s\S]*?\n\}/)
    assert.ok(match, 'could not locate fetchManagerRepOverview')
    assert.match(match[0], /fetchAllRepReportsForWeek\(weekStartDate\)/)
    assert.doesNotMatch(match[0], /getCurrentReportingWeek/)
  })

  test('fetchManagerRepDrillDown threads weekStartDate into every per-rep fetchRepReport call', () => {
    const match = serviceSrc.match(/export async function fetchManagerRepDrillDown\(managerId: string, weekStartDate: string\): Promise<ManagerRepDrillDownRow\[\]> \{[\s\S]*?\n\}/)
    assert.ok(match, 'could not locate fetchManagerRepDrillDown')
    assert.match(match[0], /fetchRepReport\(a\.repId, weekStartDate\)/)
  })
})

describe('adminRepVisibilityService.ts — Manager drill-down reuses existing primitives, never reimplements them', () => {
  test('fetchManagerRepDrillDown calls fetchMyCurrentReps(managerId) for the roster, never a new query against rep_manager_assignments', () => {
    const match = serviceSrc.match(/export async function fetchManagerRepDrillDown\(managerId: string, weekStartDate: string\): Promise<ManagerRepDrillDownRow\[\]> \{[\s\S]*?\n\}/)
    assert.ok(match)
    assert.match(match[0], /fetchMyCurrentReps\(managerId\)/)
    assert.doesNotMatch(match[0], /\.from\('rep_manager_assignments'\)/)
  })

  test('fetchManagerRepDrillDown returns early with an empty array when the Manager has zero assigned reps, without calling fetchProfilesByIds/fetchRepReport', () => {
    const match = serviceSrc.match(/export async function fetchManagerRepDrillDown\(managerId: string, weekStartDate: string\): Promise<ManagerRepDrillDownRow\[\]> \{[\s\S]*?\n\}/)
    assert.ok(match)
    assert.match(match[0], /if \(assignments\.length === 0\) return \[\]/)
  })

  test('fetchManagerRepDrillDown resolves rep names/emails via the existing fetchProfilesByIds, never a new profiles query', () => {
    const match = serviceSrc.match(/export async function fetchManagerRepDrillDown\(managerId: string, weekStartDate: string\): Promise<ManagerRepDrillDownRow\[\]> \{[\s\S]*?\n\}/)
    assert.ok(match)
    assert.match(match[0], /fetchProfilesByIds\(assignments\.map\(\(a\) => a\.repId\)\)/)
    assert.doesNotMatch(match[0], /\.from\('profiles'\)/)
  })

  test('drill-down rows are sorted by name for stable display', () => {
    const match = serviceSrc.match(/export async function fetchManagerRepDrillDown\(managerId: string, weekStartDate: string\): Promise<ManagerRepDrillDownRow\[\]> \{[\s\S]*?\n\}/)
    assert.ok(match)
    assert.match(match[0], /\.sort\(\(a, b\) => \(a\.fullName \?\? ''\)\.localeCompare\(b\.fullName \?\? ''\)\)/)
  })
})

describe('adminRepVisibilityService.ts — overview reuses fetchActiveManagers (the already-allowlist-filtered real 10 Managers), never its own Manager query', () => {
  test('fetchManagerRepOverview calls fetchActiveManagers, never queries profiles directly for Managers', () => {
    const match = serviceSrc.match(/export async function fetchManagerRepOverview\(weekStartDate: string\): Promise<ManagerRepOverviewRow\[\]> \{[\s\S]*?\n\}/)
    assert.ok(match)
    assert.match(match[0], /fetchActiveManagers\(\)/)
    assert.doesNotMatch(match[0], /\.from\('profiles'\)/)
  })

  test('submittedCount is computed as pending + approved + rejected, never an independent count', () => {
    assert.match(serviceSrc, /submittedCount: pendingCount \+ approvedCount \+ rejectedCount,/)
  })
})
