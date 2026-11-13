// Run with: node --test src/lib/managerReportingEnabledWiring.test.ts
//
// Source-inspection coverage for the dual-role Sales Admin + Manager
// Reporting feature (Joey Grampa's access request). These are NOT
// PostgreSQL-execution tests — the SQL draft's own embedded `DO $$ ... $$`
// self-test is what actually exercises Postgres, against a disposable
// fixture, once applied; see that file's own self-test for the live
// authorization proof (plain Sales Admin denied, flagged Sales Admin
// permitted, inactive profile denied, plain Manager unaffected). This file
// only verifies the TypeScript/React wiring and the SQL draft's shape.
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
const managerAuthSrc = readFileSync(path.join(dir, '..', '..', 'api', '_lib', 'managerAuth.ts'), 'utf8')
const draftSql = readFileSync(
  path.join(dir, '..', '..', 'supabase', 'drafts', '20261116_manager_reporting_enabled.sql'),
  'utf8',
)
const reportsRestrictSql = readFileSync(
  path.join(dir, '..', '..', 'supabase', 'migrations', '20261027140100_reports_restrict_to_manager_admin.sql'),
  'utf8',
)
const assignmentsSql = readFileSync(
  path.join(dir, '..', '..', 'supabase', 'migrations', '20261027140200_rep_manager_assignments.sql'),
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

describe('SalesAdminShell — Manager Reporting nav item is additive and opt-in only', () => {
  test('onOpenManagerReporting is an optional prop; the extra nav button only renders when it is provided', () => {
    assert.match(salesAdminShellSrc, /onOpenManagerReporting\?: \(\) => void/)
    assert.match(salesAdminShellSrc, /\{onOpenManagerReporting && \(/)
  })

  test('the two existing Sales Rep management tabs (Sales Representatives, Report Status) are untouched', () => {
    assert.match(salesAdminShellSrc, /Sales Representatives/)
    assert.match(salesAdminShellSrc, /Report Status/)
    assert.match(salesAdminShellSrc, /<SalesRepManagement onBack=\{\(\) => setDestination\('reports'\)\} restricted \/>/)
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

  test('onOpenManagerReporting is only ever passed when hasManagerReporting is true — never unconditionally, never for every Sales Admin', () => {
    assert.match(
      appSrc,
      /<SalesAdminShell onOpenManagerReporting=\{hasManagerReporting \? \(\) => setManagerReportingViewOpen\(true\) : undefined\} \/>/,
    )
  })

  test('the Manager Reporting view reuses the existing managerReportWorkspace (Dashboard/ReportForm for the caller\'s own report), never ManagerPortalShell or any Sales-Rep-roster component — no assignment/roster management is exposed', () => {
    const branchMatch = appSrc.match(
      /isSalesAdmin && managerReportingViewOpen \? \(\s*<>[\s\S]*?<\/>\s*\) : isSalesAdmin \? \(/,
    )
    assert.ok(branchMatch, 'expected the isSalesAdmin + managerReportingViewOpen branch')
    const branch = branchMatch[0]
    assert.match(branch, /\{managerReportWorkspace\}/)
    assert.match(branch, /← Back to Sales Admin/)
    assert.doesNotMatch(branch, /ManagerPortalShell|ManagerMySalesReps|ManagerSalesRepReports/)
  })

  test('isSalesRep is still checked first — a sales_rep profile can never reach the Sales Admin or Manager Reporting branches', () => {
    const salesRepIndex = appSrc.indexOf('isSalesRep ? (')
    const salesAdminIndex = appSrc.indexOf('isSalesAdmin && managerReportingViewOpen ? (')
    assert.ok(salesRepIndex >= 0 && salesAdminIndex >= 0 && salesRepIndex < salesAdminIndex)
  })
})

describe('managerAuth.ts and the Manager self-service Add/Edit/Remove Sales Rep drafts are explicitly untouched', () => {
  test('authenticateManager still checks role === \'manager\' only — not widened for this feature', () => {
    assert.match(managerAuthSrc, /profile\.role !== 'manager'/)
    assert.doesNotMatch(managerAuthSrc, /manager_reporting_enabled|managerReportingEnabled|is_manager_capable/)
  })

  test('is_assigned_manager_of is not redefined or widened by the new draft — Sales Rep roster/assignment management is out of scope for this feature', () => {
    assert.doesNotMatch(draftSql, /CREATE OR REPLACE FUNCTION public\.is_assigned_manager_of/)
    assert.doesNotMatch(assignmentsSql, /manager_reporting_enabled|is_manager_capable/)
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
    // The reports_restrict_* RESTRICTIVE policies this function gates are
    // not touched at all — only the function body changes.
    assert.doesNotMatch(draftSql, /CREATE POLICY reports_restrict/)
  })

  test('the three RESTRICTIVE policies on reports all route through is_manager_or_admin_caller(), confirming the one widened function is sufficient for Joey to complete his own report', () => {
    for (const policy of ['reports_restrict_insert_to_manager_or_admin', 'reports_restrict_update_to_manager_or_admin', 'reports_restrict_select_to_manager_or_admin']) {
      assert.match(reportsRestrictSql, new RegExp(`CREATE POLICY ${policy}[\\s\\S]*?is_manager_or_admin_caller\\(\\)`))
    }
  })
})
