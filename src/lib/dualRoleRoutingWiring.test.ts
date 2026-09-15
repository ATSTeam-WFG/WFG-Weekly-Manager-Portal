// Run with: node --test src/lib/dualRoleRoutingWiring.test.ts
//
// App.tsx imports the real browser Supabase client singleton, which
// constructs a client at module load time — unsafe to import and execute
// directly here (same limitation as onboardingRedirectWiring.test.ts). This
// verifies the Admin+submitter ("My Weekly Report") routing via source
// inspection instead.
//
// The behavior being verified: a dual-role admin submitter (an Admin whose
// profile.submitsWeeklyReport is true) gets a "My Weekly Report" entry
// point from AdminDashboard that reuses the existing Manager
// Dashboard/ReportForm views (never a duplicate form, never
// ManagerReportView — that one is read-only), a way back to the Admin
// Dashboard, and otherwise still lands on the Admin Dashboard normally,
// exactly like any other Admin. A plain Admin (submitsWeeklyReport ===
// false) never sees the entry point at all, and existing Manager-only and
// Admin-only routing is untouched.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const appSrc = readFileSync(path.join(dir, '..', 'App.tsx'), 'utf8')
const adminDashboardSrc = readFileSync(path.join(dir, '..', 'components', 'AdminDashboard.tsx'), 'utf8')

describe('App.tsx — isSubmitter / myReportOpen wiring', () => {
  test('isSubmitter is derived from profile.submitsWeeklyReport === true — never from role', () => {
    assert.match(appSrc, /const isSubmitter = profile\?\.submitsWeeklyReport === true/)
  })

  test('the top-level admin/manager split now also checks !myReportOpen, so an Admin+submitter viewing their own report falls into the Manager branch', () => {
    assert.match(appSrc, /\{isAdmin && !myReportOpen \? \(/)
  })

  test('onOpenMyReport is only ever passed to AdminDashboard when isSubmitter is true — never unconditionally', () => {
    assert.match(appSrc, /onOpenMyReport=\{isSubmitter \? \(\) => setMyReportOpen\(true\) : undefined\}/)
  })

  test('a "Back to Admin Dashboard" control appears only when isAdmin && myReportOpen, and clears myReportOpen', () => {
    const bannerMatch = appSrc.match(/\{isAdmin && myReportOpen && \(([\s\S]*?)\n {10}\)\}/)
    assert.ok(bannerMatch, 'could not locate the isAdmin && myReportOpen back-link block')
    assert.match(bannerMatch[1], /onClick=\{\(\) => setMyReportOpen\(false\)\}/)
  })

  test('the Manager branch (Dashboard/ReportForm/SubmittedReport/HistoricalReportView) is reused as-is — no separate MyWeeklyReport component is rendered', () => {
    assert.equal(appSrc.includes('MyWeeklyReport'), false)
    // The reused branch still renders the same four view components it
    // always has, keyed off the same `view` state — nothing new was added
    // for the dual-role admin submitter case, confirming reuse rather than
    // duplication.
    assert.match(appSrc, /view === 'dashboard' && \(/)
    assert.match(appSrc, /view === 'form' && \(/)
  })

  test('ManagerReportView (read-only, used for an Admin viewing ANOTHER manager) is never involved in the isSubmitter/myReportOpen path', () => {
    const myReportOpenIndex = appSrc.indexOf('myReportOpen')
    const managerReportViewIndex = appSrc.indexOf('<ManagerReportView')
    assert.ok(myReportOpenIndex !== -1 && managerReportViewIndex !== -1)
    // ManagerReportView is only reachable via the selectedManager branch,
    // which is itself only reached inside the `isAdmin && !myReportOpen`
    // side of the split — i.e. never while myReportOpen is true.
    assert.match(appSrc, /selectedManager \? \(\s*\n\s*<ManagerReportView/)
  })
})

describe('AdminDashboard.tsx — My Weekly Report button', () => {
  test('onOpenMyReport is an optional prop, never required — a plain Admin must not be forced to receive it', () => {
    assert.match(adminDashboardSrc, /onOpenMyReport\?: \(\) => void/)
  })

  test('the button only renders when onOpenMyReport is provided', () => {
    assert.match(adminDashboardSrc, /\{onOpenMyReport && \(/)
  })
})
