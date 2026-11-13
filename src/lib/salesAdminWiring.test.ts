// Run with: node --test src/lib/salesAdminWiring.test.ts
//
// The Sales Admin role spans React components with no rendering harness and
// serverless api/*.ts handlers that import the real browser/service
// Supabase clients — neither is safe to import and execute directly here,
// the established pattern throughout this project (see
// dualRoleRoutingWiring.test.ts, salesRepManagementWiring.test.ts). This
// verifies the Sales Admin wiring via source inspection instead: the
// routing decision in App.tsx, the restricted shell's composition, the
// restricted-prop behavior on the reused SalesRepManagement screen, which
// shared endpoints use the new authenticateAdminOrSalesAdmin path (and
// which still use the original, untouched authenticateAdmin), and that
// set-active.ts threads a sales_rep-only restriction for a sales_admin
// caller.
//
// The actual authorization boundaries this role depends on — is_admin()
// staying admin-only, is_sales_admin() being a new, separate check, the
// profiles/rep_reports RLS policies, and assign_sales_rep/unassign_sales_rep
// accepting sales_admin — are independently re-verified by the migration's
// own embedded self-test (supabase/migrations/20261103090000_sales_admin_role.sql),
// run via the local disposable-Postgres harness, not here.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const appSrc = readFileSync(path.join(dir, '..', 'App.tsx'), 'utf8')
const salesAdminShellSrc = readFileSync(path.join(dir, '..', 'components', 'SalesAdminShell.tsx'), 'utf8')
const salesAdminReportsSrc = readFileSync(path.join(dir, '..', 'components', 'SalesAdminReports.tsx'), 'utf8')
const salesRepManagementSrc = readFileSync(path.join(dir, '..', 'components', 'SalesRepManagement.tsx'), 'utf8')
const typesSrc = readFileSync(path.join(dir, '..', 'types.ts'), 'utf8')
const adminAuthSrc = readFileSync(path.join(dir, '..', '..', 'api', '_lib', 'adminAuth.ts'), 'utf8')
const apiUsersDir = path.join(dir, '..', '..', 'api', 'admin', 'users')
const inviteSalesRepSrc = readFileSync(path.join(apiUsersDir, 'invite-sales-rep.ts'), 'utf8')
const listSalesRepsSrc = readFileSync(path.join(apiUsersDir, 'list-sales-reps.ts'), 'utf8')
const listManagersSrc = readFileSync(path.join(apiUsersDir, 'list-managers.ts'), 'utf8')
const setActiveSrc = readFileSync(path.join(apiUsersDir, 'set-active.ts'), 'utf8')
const updateSrc = readFileSync(path.join(apiUsersDir, 'update.ts'), 'utf8')
const invokeManagerOnlySrc = readFileSync(path.join(apiUsersDir, 'invite.ts'), 'utf8')
const listSrc = readFileSync(path.join(apiUsersDir, 'list.ts'), 'utf8')
const supabaseServiceClientSrc = readFileSync(path.join(dir, '..', '..', 'api', '_lib', 'supabaseServiceClient.ts'), 'utf8')

describe('src/types.ts — ProfileRole recognizes sales_admin', () => {
  test('ProfileRole includes sales_admin alongside the three existing roles', () => {
    assert.match(typesSrc, /export type ProfileRole = 'manager' \| 'admin' \| 'sales_rep' \| 'sales_admin'/)
  })
})

describe('App.tsx — routing never lets a sales_admin profile fall through to an unauthorized branch', () => {
  test('isSalesAdmin is derived directly from profile.role, never inferred from isAdmin', () => {
    assert.match(appSrc, /const isSalesAdmin = profile\?\.role === 'sales_admin'/)
  })

  test('the isSalesAdmin branch renders SalesAdminShell, and is checked before the isAdmin branch', () => {
    // isSalesAdmin is additionally ANDed with !managerReportingViewOpen (a
    // dual-role Sales-Admin-Manager-Reporting toggle, additive and opt-in —
    // see managerReportingEnabledWiring.test.ts) — still the same isSalesAdmin
    // check, still gating the same SalesAdminShell render, still checked
    // before isAdmin.
    const salesAdminBranchIndex = appSrc.indexOf('isSalesAdmin && !managerReportingViewOpen ? (')
    const salesAdminShellIndex = appSrc.indexOf('<SalesAdminShell')
    const isAdminBranchIndex = appSrc.indexOf('isAdmin && !myReportOpen ? (')
    assert.ok(salesAdminBranchIndex !== -1, 'isSalesAdmin branch must exist')
    assert.ok(salesAdminShellIndex !== -1 && salesAdminShellIndex > salesAdminBranchIndex, 'SalesAdminShell must be rendered inside the isSalesAdmin branch')
    assert.ok(salesAdminBranchIndex < isAdminBranchIndex, 'isSalesAdmin must be checked before isAdmin, so a sales_admin profile is never routed into the Admin-only shell')
  })

  test('roleLabel recognizes Sales Admin as its own distinct label, not falling back to Manager or Admin', () => {
    assert.match(appSrc, /isSalesAdmin \? 'Sales Admin'/)
  })
})

describe('SalesAdminShell.tsx — only the two authorized destinations are reachable', () => {
  test('renders SalesRepManagement restricted, and SalesAdminReports — nothing else', () => {
    assert.match(salesAdminShellSrc, /<SalesRepManagement[\s\S]*restricted/)
    assert.match(salesAdminShellSrc, /<SalesAdminReports/)
  })

  test('never imports AdminShell, AdminDashboard, UserManagement, WeeklySummary, LeadershipReportGate, VideoCreation, or ReportsAnalytics — no path to any Full-Admin-only or Manager-only screen', () => {
    // Matched as an actual import statement, not a bare substring — "AdminShell"
    // is itself a substring of this file's own name/component identifier
    // (SalesAdminShell), so a bare .includes() check would false-positive on
    // the file referencing itself.
    for (const forbidden of ['AdminShell', 'AdminDashboard', 'UserManagement', 'WeeklySummary', 'LeadershipReportGate', 'VideoCreation', 'ReportsAnalytics', 'ManagerReportView', 'Dashboard']) {
      const importPattern = new RegExp(`from '\\./${forbidden}'`)
      assert.equal(importPattern.test(salesAdminShellSrc), false, `SalesAdminShell.tsx must never import ${forbidden}`)
    }
  })
})

describe('SalesAdminReports.tsx — read-only, no review/approve/reject action exists', () => {
  test('never calls review_rep_report, reviewRepReport, or any approve/reject RPC wrapper (the function body text may still explain the RPC by name in a comment)', () => {
    for (const forbidden of ['review_rep_report(', "'review_rep_report'", 'reviewRepReport(', 'approveReport(', 'rejectReport(']) {
      assert.equal(salesAdminReportsSrc.includes(forbidden), false, `SalesAdminReports.tsx must never call ${forbidden}`)
    }
  })

  test('never imports or calls grantLateSubmissionException — Sales Admin cannot grant exceptions', () => {
    assert.equal(salesAdminReportsSrc.includes('grantLateSubmissionException'), false)
  })

  test('fetches reports via the same RLS-scoped fetchRepReport every other screen uses, not a new privileged path', () => {
    assert.match(salesAdminReportsSrc, /import \{ fetchRepReport(, type RepReport)? \} from '\.\.\/lib\/repReportsService'/)
  })
})

describe('SalesRepManagement.tsx — restricted prop hides the one action Sales Admin must never have', () => {
  test('accepts an optional restricted prop, defaulting to false (Full Admin\'s existing behavior is unchanged)', () => {
    assert.match(salesRepManagementSrc, /restricted\?: boolean/)
    assert.match(salesRepManagementSrc, /restricted = false/)
  })

  test('the Grant Late Exception button is conditionally rendered on !restricted', () => {
    const buttonIndex = salesRepManagementSrc.indexOf('Grant Late Exception')
    const guardIndex = salesRepManagementSrc.lastIndexOf('{!restricted && (', buttonIndex)
    assert.ok(guardIndex !== -1 && guardIndex < buttonIndex, 'the Grant Late Exception button must be wrapped in a {!restricted && (...)} guard')
  })

  test('the "Back to Admin Dashboard" link is also conditionally rendered on !restricted — meaningless outside the Full Admin shell', () => {
    // The LAST occurrence, not the first — the file's own doc comment near
    // the top also mentions "Back to Admin Dashboard" in prose, before the
    // actual rendered button further down.
    const linkIndex = salesRepManagementSrc.lastIndexOf('Back to Admin Dashboard')
    const guardIndex = salesRepManagementSrc.lastIndexOf('{!restricted && (', linkIndex)
    assert.ok(guardIndex !== -1 && guardIndex < linkIndex, 'the back link must be wrapped in a {!restricted && (...)} guard')
  })
})

describe('Shared Admin/Sales-Admin endpoints use authenticateAdminOrSalesAdmin, not the original admin-only authenticateAdmin', () => {
  test('invite-sales-rep.ts', () => {
    assert.match(inviteSalesRepSrc, /import \{ authenticateAdminOrSalesAdmin \} from/)
    assert.match(inviteSalesRepSrc, /authenticateAdminOrSalesAdmin\(\{/)
    assert.equal(/\bauthenticateAdmin\(/.test(inviteSalesRepSrc), false, 'must not also call the original, stricter authenticateAdmin')
  })

  test('list-sales-reps.ts', () => {
    assert.match(listSalesRepsSrc, /import \{ authenticateAdminOrSalesAdmin \} from/)
    assert.match(listSalesRepsSrc, /authenticateAdminOrSalesAdmin\(\{/)
  })

  test('list-managers.ts', () => {
    assert.match(listManagersSrc, /import \{ authenticateAdminOrSalesAdmin \} from/)
    assert.match(listManagersSrc, /authenticateAdminOrSalesAdmin\(\{/)
  })

  test('set-active.ts', () => {
    assert.match(setActiveSrc, /import \{ authenticateAdminOrSalesAdmin \} from/)
    assert.match(setActiveSrc, /authenticateAdminOrSalesAdmin\(\{/)
  })
})

describe('Manager/Admin-roster-only endpoints are untouched — still authenticateAdmin-only, never reachable by a sales_admin caller', () => {
  test('invite.ts (Add Manager) still uses the original authenticateAdmin only', () => {
    assert.match(invokeManagerOnlySrc, /authenticateAdmin\(\{/)
    assert.equal(invokeManagerOnlySrc.includes('authenticateAdminOrSalesAdmin'), false)
  })

  test('list.ts (Manager/Admin roster) still uses the original authenticateAdmin only — must never expose Manager/Admin account detail to a sales_admin caller', () => {
    assert.match(listSrc, /authenticateAdmin\(\{/)
    assert.equal(listSrc.includes('authenticateAdminOrSalesAdmin'), false)
  })

  test('update.ts (Edit Employee, Manager/Admin only) still uses the original authenticateAdmin only', () => {
    assert.match(updateSrc, /authenticateAdmin\(\{/)
    assert.equal(updateSrc.includes('authenticateAdminOrSalesAdmin'), false)
  })
})

describe('set-active.ts — a sales_admin caller is restricted to sales_rep targets only', () => {
  test('passes restrictToPortalRole: \'sales_rep\' when, and only when, the authenticated caller is sales_admin', () => {
    assert.match(setActiveSrc, /setManagedUserActive\(email, isActive, auth\.role === 'sales_admin' \? 'sales_rep' : undefined\)/)
  })

  test('handles the forbidden outcome with a 403, never silently succeeding or falling through to the generic 500', () => {
    assert.match(setActiveSrc, /case 'forbidden':\s*\n\s*return sendError\(res, 403,/)
  })
})

describe('supabaseServiceClient.ts — setManagedUserActive enforces the role restriction server-side, before any write', () => {
  test('checks the target\'s portal_role and returns forbidden before the approved_employees UPDATE, when a restriction is given', () => {
    const fnStart = supabaseServiceClientSrc.indexOf('export async function setManagedUserActive')
    const forbiddenCheckIndex = supabaseServiceClientSrc.indexOf("return { status: 'forbidden' }", fnStart)
    const updateIndex = supabaseServiceClientSrc.indexOf(".from('approved_employees')\n    .update({ is_active: isActive })", fnStart)
    assert.ok(forbiddenCheckIndex !== -1, 'the forbidden check must exist')
    assert.ok(updateIndex !== -1, 'the approved_employees update must exist')
    assert.ok(forbiddenCheckIndex < updateIndex, 'the role restriction must be checked BEFORE the write, not after')
  })
})

describe('adminAuth.ts — authenticateAdminOrSalesAdmin is additive, never a modification of the original authenticateAdmin', () => {
  test('authenticateAdmin\'s own role check is unchanged: still role !== \'admin\' only', () => {
    assert.match(adminAuthSrc, /if \(!profile \|\| profile\.role !== 'admin'\) \{/)
  })

  test('authenticateAdminOrSalesAdmin accepts admin OR sales_admin, and reports back which one matched', () => {
    assert.match(adminAuthSrc, /profile\.role !== 'admin' && profile\.role !== 'sales_admin'/)
    assert.match(adminAuthSrc, /role: profile\.role/)
  })
})
