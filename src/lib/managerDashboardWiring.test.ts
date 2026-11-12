import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const appSrc = readFileSync(path.join(dir, '..', 'App.tsx'), 'utf8')
const shellSrc = readFileSync(path.join(dir, '..', 'components', 'ManagerPortalShell.tsx'), 'utf8')
const rosterComponentSrc = readFileSync(path.join(dir, '..', 'components', 'ManagerMySalesReps.tsx'), 'utf8')
const reportsComponentSrc = readFileSync(path.join(dir, '..', 'components', 'ManagerSalesRepReports.tsx'), 'utf8')
const managerServiceSrc = readFileSync(path.join(dir, 'managerSalesRepService.ts'), 'utf8')
const repReportServiceSrc = readFileSync(path.join(dir, 'repReportsService.ts'), 'utf8')
const managerAuthSrc = readFileSync(path.join(dir, '..', '..', 'api', '_lib', 'managerAuth.ts'), 'utf8')
const unassignEndpointSrc = readFileSync(path.join(dir, '..', '..', 'api', 'manager', 'sales-reps', 'unassign.ts'), 'utf8')
const unassignSqlDraft = readFileSync(path.join(dir, '..', '..', 'supabase', 'drafts', '20261110_manager_owned_sales_rep_unassignment.sql'), 'utf8')
const assignmentsSql = readFileSync(path.join(dir, '..', '..', 'supabase', 'migrations', '20261027140200_rep_manager_assignments.sql'), 'utf8')
const assignedProfilesSql = readFileSync(path.join(dir, '..', '..', 'supabase', 'migrations', '20261102090000_profiles_select_assigned_rep_for_manager.sql'), 'utf8')
const assignedReportsSql = readFileSync(path.join(dir, '..', '..', 'supabase', 'migrations', '20261104120000_rep_reports_assigned_manager_historical_scope.sql'), 'utf8')
const salesAdminShellSrc = readFileSync(path.join(dir, '..', 'components', 'SalesAdminShell.tsx'), 'utf8')

describe('ManagerPortalShell — exactly three primary destinations', () => {
  test('exposes only Manager Dashboard, My Sales Reps, and Sales Rep Reports as tabs', () => {
    assert.match(shellSrc, /'dashboard' \| 'my-sales-reps' \| 'sales-rep-reports'/)
    assert.equal((shellSrc.match(/key: 'dashboard'|key: 'my-sales-reps'|key: 'sales-rep-reports'/g) ?? []).length, 3)
    for (const label of ['Manager Dashboard', 'My Sales Reps', 'Sales Rep Reports']) assert.ok(shellSrc.includes(label))
    assert.match(shellSrc, /role="tablist"/)
    assert.match(shellSrc, /role="tabpanel"/)
  })

  test('Sales Admin and Sales Rep screens remain routed to their existing shells/components', () => {
    assert.match(appSrc, /isSalesRep \? \(\s*<SalesRepDashboard/)
    assert.match(appSrc, /isSalesAdmin \? \(\s*<SalesAdminShell/)
    assert.doesNotMatch(shellSrc, /SalesAdminShell|SalesRepDashboard/)
    assert.ok(salesAdminShellSrc.includes('Sales Representatives'))
    assert.match(appSrc, /import SalesRepDashboard from '\.\/components\/SalesRepDashboard'/)
  })

  test('App renders the Manager shell only in the Manager role branch and preserves the original report workspace', () => {
    assert.match(appSrc, /profile\?\.role === 'manager' \?\s*\(\s*<ManagerPortalShell/)
    assert.match(appSrc, /view === 'dashboard'/)
    assert.match(appSrc, /onSaveDraft=\{handleSaveDraft\}/)
    assert.match(appSrc, /onSubmit=\{handleSubmit\}/)
    assert.match(appSrc, /onSaveChanges=\{handleSaveChanges\}/)
    assert.match(appSrc, /<HistoricalReportView/)
  })

  test('tab changes hide rather than unmount panels, preserving report editing state and pending autosave', () => {
    assert.match(shellSrc, /\{DESTINATIONS\.map\(\(\{ key \}\) => \(/)
    assert.match(shellSrc, /hidden=\{current !== key\}/)
    assert.match(shellSrc, /panels\[key\]/)
  })

  test('existing Manager Approve/Reject review remains reachable only as the secondary Review Reports view', () => {
    assert.match(rosterComponentSrc, /onReviewReports/)
    assert.match(rosterComponentSrc, /Review Reports/)
    assert.match(appSrc, /managerReviewReports|myRepsOpen \?\s*\(/)
    assert.match(appSrc, /<MyReps managerId=\{managerId \?\? ''\} onBack=\{\(\) => setMyRepsOpen\(false\)\} \/>/)
    assert.match(appSrc, /onReviewReports=\{\(\) => \{\s*setManagerTab\('my-sales-reps'\)\s*setMyRepsOpen\(true\)/)
  })
})

describe('Manager roster reads — authenticated user identity and existing RLS-scoped sources only', () => {
  test('derives identity from auth.getUser, verifies active manager role, and requests current assignments only', () => {
    assert.match(managerServiceSrc, /supabase\.auth\.getUser\(\)/)
    assert.match(managerServiceSrc, /profile\.role !== 'manager' \|\| profile\.is_active !== true/)
    assert.match(managerServiceSrc, /\.eq\('manager_id', userData\.user\.id\)/)
    assert.match(managerServiceSrc, /\.is\('unassigned_at', null\)/)
    assert.match(managerServiceSrc, /\.select\('id, full_name, email, is_active'\)/)
  })

  test('does not call global Admin/Sales Admin roster APIs or import a service-role credential', () => {
    assert.doesNotMatch(managerServiceSrc, /fetchSalesReps|list-sales-reps|SUPABASE_SECRET_KEY|service_role/i)
    assert.match(managerServiceSrc, /fetchRepReportWithOutcome/)
  })

  test('existing database policies scope assignment/profile reads to auth.uid and the current assignment', () => {
    assert.match(assignmentsSql, /CREATE POLICY rep_manager_assignments_select_own_manager[\s\S]*?USING \(manager_id = auth\.uid\(\)\)/)
    assert.match(assignedProfilesSql, /role = 'sales_rep'[\s\S]*?manager_id = auth\.uid\(\)[\s\S]*?unassigned_at IS NULL/)
    assert.match(assignedReportsSql, /public\.is_assigned_manager_of\(rep_id\)/)
  })

  test('account actions are visible but disabled pending backend authorization approval', () => {
    assert.match(rosterComponentSrc, /\+ Add Sales Rep[\s\S]*?disabled/)
    for (const action of ['Edit', 'Deactivate', 'Reactivate', 'Remove Assignment']) {
      assert.match(rosterComponentSrc, new RegExp(`<button[^>]*disabled[^>]*>[\\s\\S]*?${action}`))
    }
  })
})

describe('Manager Sales Rep Reports — current-assignment RLS and read-only report viewing', () => {
  test('exposes week/status controls and fetches only through the Manager-scoped report service', () => {
    assert.match(reportsComponentSrc, /Filter by reporting week/)
    assert.match(reportsComponentSrc, /Filter by report status/)
    assert.match(reportsComponentSrc, /fetchManagerSalesRepReports\(week\.weekStartDate\)/)
    assert.match(managerServiceSrc, /fetchMyCurrentReps|\.eq\('manager_id', userData\.user\.id\)/)
  })

  test('View Report requires a submitted report and the dialog renders content only, with no review decision controls', () => {
    assert.match(reportsComponentSrc, /disabled=\{!row\.report \|\| row\.report\.status !== 'submitted'\}/)
    assert.match(reportsComponentSrc, /Read-only report/)
    assert.doesNotMatch(reportsComponentSrc, /reviewSalesRepReport/)
    assert.doesNotMatch(reportsComponentSrc, />\s*Approve\s*</)
    assert.doesNotMatch(reportsComponentSrc, />\s*Reject\s*</)
  })

  test('the report service surfaces query errors separately from missing rows and retains existing RLS-based fetch', () => {
    assert.match(repReportServiceSrc, /export async function fetchRepReportWithOutcome/)
    assert.match(repReportServiceSrc, /\.from\('rep_reports'\)/)
    assert.match(repReportServiceSrc, /\{ status: 'not_found' \}/)
    assert.match(repReportServiceSrc, /\{ status: 'error' \}/)
  })
})

describe('Draft Manager unassignment backend — fail-closed and not enabled by default', () => {
  test('Manager API independently verifies active Manager auth and cannot run in Production', () => {
    assert.match(managerAuthSrc, /profile\.role !== 'manager' \|\| profile\.is_active !== true/)
    assert.match(unassignEndpointSrc, /MANAGER_ACCOUNT_ACTIONS_ENABLED !== 'true'/)
    assert.match(unassignEndpointSrc, /VERCEL_ENV === 'production'/)
    assert.match(unassignEndpointSrc, /auth\.supabase\.rpc\('unassign_own_sales_rep'/)
  })

  test('draft RPC checks active manager and current assignment ownership, uses the assignment lock, and never deletes data', () => {
    assert.match(unassignSqlDraft, /p\.role = 'manager' AND p\.is_active = true/)
    assert.match(unassignSqlDraft, /pg_advisory_xact_lock\(hashtext\(p_rep_id::text\)\)/)
    assert.match(unassignSqlDraft, /public\.is_assigned_manager_of\(p_rep_id\)/)
    assert.match(unassignSqlDraft, /manager_id = v_caller/)
    assert.match(unassignSqlDraft, /unassigned_at = clock_timestamp\(\)/)
    assert.doesNotMatch(unassignSqlDraft, /DELETE FROM|\.delete\(/i)
  })

  test('REVIEW FIX: the draft RPC has its own database-level kill switch, independent of the Node API\'s MANAGER_ACCOUNT_ACTIONS_ENABLED env var — a GRANT to `authenticated` alone must never expose this capability directly via supabase.rpc(), bypassing the Node wrapper entirely', () => {
    const killSwitchIndex = unassignSqlDraft.indexOf("current_setting('app.manager_account_actions_enabled', true)")
    const forbiddenCheckIndex = unassignSqlDraft.indexOf("RAISE EXCEPTION 'FORBIDDEN: An active Manager session is required.'")
    assert.ok(killSwitchIndex >= 0, 'could not find the database-level kill switch')
    assert.ok(killSwitchIndex < forbiddenCheckIndex, 'the kill switch must be checked before any other authorization logic')
    // Fails closed: coalesce(..., 'false') means an unset GUC is always
    // treated as disabled, never as "safe to proceed".
    assert.match(unassignSqlDraft, /coalesce\(current_setting\('app\.manager_account_actions_enabled', true\), 'false'\) <> 'true'/)
  })

  test('Manager account endpoints are not generalized Admin/Sales Admin routes and do not accept forged Manager identities', () => {
    assert.match(managerAuthSrc, /supabase\.auth\.getUser\(token\)/)
    assert.match(managerAuthSrc, /if \(!profile \|\| profile\.role !== 'manager' \|\| profile\.is_active !== true\)/)
    assert.doesNotMatch(unassignEndpointSrc, /authenticateAdminOrSalesAdmin|authenticateAdmin\(/)
    assert.doesNotMatch(unassignEndpointSrc, /managerId|manager_id\?:/)
    assert.match(unassignEndpointSrc, /body = \(req\.body \?\? \{\}\) as \{ repId\?: unknown \}/)
  })
})
