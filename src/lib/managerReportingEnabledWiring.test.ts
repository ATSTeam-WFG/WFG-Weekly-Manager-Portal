// Run with: node --test src/lib/managerReportingEnabledWiring.test.ts
//
// Source-inspection coverage for the dual-role Sales Admin + Manager
// Reporting feature (Joey Grampa's access request). These are NOT
// PostgreSQL-execution tests — the SQL draft is additive-only and has
// already been applied to and verified in both Preview and Production; see
// this feature's own review history for that verification. This file only
// verifies the TypeScript/React wiring.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const appSrc = readFileSync(path.join(dir, '..', 'App.tsx'), 'utf8')
const salesAdminShellSrc = readFileSync(path.join(dir, '..', 'components', 'SalesAdminShell.tsx'), 'utf8')
const typesSrc = readFileSync(path.join(dir, '..', 'types.ts'), 'utf8')
const profileServiceSrc = readFileSync(path.join(dir, 'profileService.ts'), 'utf8')
const draftSql = readFileSync(
  path.join(dir, '..', '..', 'supabase', 'drafts', '20261116_manager_reporting_enabled.sql'),
  'utf8',
)
const reportsRestrictSql = readFileSync(
  path.join(dir, '..', '..', 'supabase', 'migrations', '20261027140100_reports_restrict_to_manager_admin.sql'),
  'utf8',
)

describe('managerReportingEnabled — Profile type and fetch wiring', () => {
  test('Profile carries managerReportingEnabled as an explicit, separately-set boolean, alongside (not replacing) submitsWeeklyReport', () => {
    assert.match(typesSrc, /managerReportingEnabled: boolean/)
    assert.match(typesSrc, /submitsWeeklyReport: boolean/)
  })

  test('fetchProfile selects and maps manager_reporting_enabled, same pattern as submits_weekly_report', () => {
    assert.match(profileServiceSrc, /\.select\('id, full_name, role, is_active, submits_weekly_report, manager_reporting_enabled'\)/)
    assert.match(profileServiceSrc, /managerReportingEnabled: data\.manager_reporting_enabled,/)
  })
})

describe('SalesAdminShell — My Reports nav item is additive and opt-in only', () => {
  test('onOpenManagerReporting is an optional prop; the extra nav button (labeled "My Reports") only renders when it is provided', () => {
    assert.match(salesAdminShellSrc, /onOpenManagerReporting\?: \(\) => void/)
    assert.match(salesAdminShellSrc, /\{onOpenManagerReporting && \(/)
    assert.match(salesAdminShellSrc, />\s*My Reports\s*</)
  })

  test('the two main Sales Admin destinations (User Management, Report Status) are present', () => {
    assert.match(salesAdminShellSrc, /User Management/)
    assert.match(salesAdminShellSrc, /Report Status/)
    assert.match(salesAdminShellSrc, /<SalesRepManagement onBack=\{\(\) => setDestination\('report-status'\)\} restricted \/>/)
    assert.match(salesAdminShellSrc, /<SalesAdminReports \/>/)
  })

  test('"Reporting by Manager" / SalesAdminManagerOverview is preserved — rendered inside Report Status, below SalesAdminReports, never removed or discarded', () => {
    assert.match(salesAdminShellSrc, /import SalesAdminManagerOverview from '\.\/SalesAdminManagerOverview'/)
    const fnMatch = salesAdminShellSrc.match(/export default function SalesAdminShell\([\s\S]*$/)
    assert.ok(fnMatch)
    const body = fnMatch[0]
    assert.match(body, /<SalesAdminManagerOverview \/>/)
    const reportsIndex = body.indexOf('<SalesAdminReports />')
    const overviewIndex = body.indexOf('<SalesAdminManagerOverview />')
    assert.ok(reportsIndex >= 0 && overviewIndex >= 0 && reportsIndex < overviewIndex, 'SalesAdminManagerOverview must render below SalesAdminReports, within the same Report Status panel')
  })
})

describe('App.tsx — hasManagerReporting is additive, never inferred from role, and gates the switcher narrowly', () => {
  test('hasManagerReporting reads profile.managerReportingEnabled directly, never role, and is independent of isSubmitter', () => {
    assert.match(appSrc, /const hasManagerReporting = profile\?\.managerReportingEnabled === true/)
    assert.match(appSrc, /const isSubmitter = profile\?\.submitsWeeklyReport === true/)
  })

  test('managerReportingViewOpen defaults to false, so every Sales Admin lands on SalesAdminShell first, same as today', () => {
    assert.match(appSrc, /const \[managerReportingViewOpen, setManagerReportingViewOpen\] = useState\(false\)/)
  })

  test('SalesAdminShell only renders while NOT viewing Manager Reporting, and onOpenManagerReporting is only ever passed when hasManagerReporting is true — never unconditionally, never for every Sales Admin', () => {
    assert.match(appSrc, /isSalesAdmin && !managerReportingViewOpen \? \(/)
    assert.match(
      appSrc,
      /<SalesAdminShell onOpenManagerReporting=\{hasManagerReporting \? \(\) => setManagerReportingViewOpen\(true\) : undefined\} \/>/,
    )
  })

  test('isSalesAdmin && managerReportingViewOpen falls through to the same shared report workspace the Manager/Admin-submitter cases already use, with its own back-link — never a Sales-Rep-management or roster-assignment component', () => {
    assert.match(appSrc, /isSalesAdmin && managerReportingViewOpen && \(/)
    assert.match(appSrc, /← Back to Sales Admin/)
    const backLinkIndex = appSrc.indexOf('← Back to Sales Admin')
    const managerShellIndex = appSrc.indexOf("profile?.role === 'manager' &&")
    assert.ok(backLinkIndex >= 0 && managerShellIndex >= 0 && backLinkIndex < managerShellIndex)
  })

  // Manager Dashboard redesign (2026-11-13): the old myRepsOpen toggle +
  // <MyReps> pairing was replaced by <ManagerShell> (its own sidebar nav,
  // reusing Dashboard.tsx/MyReps.tsx unchanged for its My Reports/Team
  // Reports destinations) — only ever rendered while view === 'dashboard',
  // so starting/editing a report or opening a history entry still falls
  // through to the same shared ReportForm/SubmittedReport/
  // HistoricalReportView flow below, unchanged.
  test('ManagerShell stays gated on the real \'manager\' role only — never widened for a Sales Admin, dual-role or not', () => {
    const managerShellBlockMatch = appSrc.match(
      /profile\?\.role === 'manager' && view === 'dashboard' \? \(\s*\n\s*<ManagerShell[\s\S]*?\/>\s*\n\s*\) : /,
    )
    assert.ok(managerShellBlockMatch, 'expected the ManagerShell conditional block')
    assert.doesNotMatch(managerShellBlockMatch[0], /isSalesAdmin|managerReportingEnabled|managerReportingViewOpen/)
  })

  test('isSalesRep is still checked first — a sales_rep profile can never reach the Sales Admin or Manager Reporting branches', () => {
    const salesRepIndex = appSrc.indexOf('isSalesRep ? (')
    const salesAdminIndex = appSrc.indexOf('isSalesAdmin && !managerReportingViewOpen ? (')
    assert.ok(salesRepIndex >= 0 && salesAdminIndex >= 0 && salesRepIndex < salesAdminIndex)
  })
})

describe('Manager self-service Add/Edit/Remove Sales Rep functionality is absent from this branch entirely', () => {
  test('api/_lib/managerAuth.ts does not exist on this branch — confirms a clean checkout from main carries none of that still-unmerged, disabled feature', () => {
    assert.throws(() => readFileSync(path.join(dir, '..', '..', 'api', '_lib', 'managerAuth.ts'), 'utf8'))
  })

  test('no draft SQL for assign_own_sales_rep/unassign_own_sales_rep/pending assignments exists on this branch', () => {
    assert.doesNotMatch(draftSql, /assign_own_sales_rep|unassign_own_sales_rep|pending_assignment|manager_account_actions/)
  })
})

describe('20261116_manager_reporting_enabled.sql — additive schema, narrowly-scoped widening', () => {
  test('adds manager_reporting_enabled to both approved_employees and profiles, NOT NULL DEFAULT false (same shape as submits_weekly_report)', () => {
    assert.match(draftSql, /ALTER TABLE approved_employees ADD COLUMN IF NOT EXISTS manager_reporting_enabled boolean NOT NULL DEFAULT false;/)
    assert.match(draftSql, /ALTER TABLE profiles ADD COLUMN IF NOT EXISTS manager_reporting_enabled boolean NOT NULL DEFAULT false;/)
  })

  test('is_manager_capable() denies by role/active-state combination, matching house style (SQL, STABLE, SECURITY DEFINER) of is_admin()/is_sales_admin()', () => {
    const fnMatch = draftSql.match(/CREATE OR REPLACE FUNCTION public\.is_manager_capable\(\)[\s\S]*?\$\$;/)
    assert.ok(fnMatch)
    const body = fnMatch[0]
    assert.match(body, /LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public/)
    assert.match(body, /p\.is_active = true/)
    assert.match(body, /p\.role = 'manager' OR \(p\.role = 'sales_admin' AND p\.manager_reporting_enabled = true\)/)
    assert.match(draftSql, /REVOKE ALL ON FUNCTION public\.is_manager_capable\(\) FROM PUBLIC;/)
    assert.match(draftSql, /REVOKE ALL ON FUNCTION public\.is_manager_capable\(\) FROM anon;/)
    assert.match(draftSql, /GRANT EXECUTE ON FUNCTION public\.is_manager_capable\(\) TO authenticated;/)
  })

  test('is_manager_or_admin_caller() is widened (CREATE OR REPLACE, same signature) to OR in is_manager_capable(), preserving the existing admin branch untouched', () => {
    const fnMatch = draftSql.match(/CREATE OR REPLACE FUNCTION public\.is_manager_or_admin_caller\(\)[\s\S]*?\$\$;/)
    assert.ok(fnMatch)
    const body = fnMatch[0]
    assert.match(body, /role = 'admin'/)
    assert.match(body, /is_active = true/)
    assert.match(body, /OR public\.is_manager_capable\(\);/)
    assert.doesNotMatch(draftSql, /CREATE POLICY reports_restrict/)
  })

  test('the three RESTRICTIVE policies on reports all route through is_manager_or_admin_caller(), confirming the one widened function is sufficient for Joey to complete his own report', () => {
    for (const policy of ['reports_restrict_insert_to_manager_or_admin', 'reports_restrict_update_to_manager_or_admin', 'reports_restrict_select_to_manager_or_admin']) {
      assert.match(reportsRestrictSql, new RegExp(`CREATE POLICY ${policy}[\\s\\S]*?is_manager_or_admin_caller\\(\\)`))
    }
  })
})
