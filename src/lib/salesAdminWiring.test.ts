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
const repReportsServiceSrc = readFileSync(path.join(dir, 'repReportsService.ts'), 'utf8')
const salesRepManagementSrc = readFileSync(path.join(dir, '..', 'components', 'SalesRepManagement.tsx'), 'utf8')
const typesSrc = readFileSync(path.join(dir, '..', 'types.ts'), 'utf8')
const adminAuthSrc = readFileSync(path.join(dir, '..', '..', 'api', '_lib', 'adminAuth.ts'), 'utf8')
const apiUsersDir = path.join(dir, '..', '..', 'api', 'admin', 'users')
const inviteSalesRepSrc = readFileSync(path.join(apiUsersDir, 'invite-sales-rep.ts'), 'utf8')
const updateSalesRepSrc = readFileSync(path.join(apiUsersDir, 'update-sales-rep.ts'), 'utf8')
const listSalesRepsSrc = readFileSync(path.join(apiUsersDir, 'list-sales-reps.ts'), 'utf8')
const listManagersSrc = readFileSync(path.join(apiUsersDir, 'list-managers.ts'), 'utf8')
const setActiveSrc = readFileSync(path.join(apiUsersDir, 'set-active.ts'), 'utf8')
const updateSrc = readFileSync(path.join(apiUsersDir, 'update.ts'), 'utf8')
const invokeManagerOnlySrc = readFileSync(path.join(apiUsersDir, 'invite.ts'), 'utf8')
const listSrc = readFileSync(path.join(apiUsersDir, 'list.ts'), 'utf8')
const supabaseServiceClientSrc = readFileSync(path.join(dir, '..', '..', 'api', '_lib', 'supabaseServiceClient.ts'), 'utf8')
const salesRepManagementServiceSrc = readFileSync(path.join(dir, 'salesRepManagementService.ts'), 'utf8')

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
    const salesAdminBranchIndex = appSrc.indexOf('isSalesAdmin ? (')
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
  test('renders exactly two accessible tabs: Sales Representatives and Report Status', () => {
    assert.match(salesAdminShellSrc, /type SalesAdminDestination = 'sales-reps' \| 'reports'/)
    assert.equal((salesAdminShellSrc.match(/role="tab"/g) ?? []).length, 2)
    assert.match(salesAdminShellSrc, /Sales Representatives/)
    assert.match(salesAdminShellSrc, /Report Status/)
    assert.doesNotMatch(salesAdminShellSrc, /Reporting by Manager|by-manager|SalesAdminManagerOverview/)
  })

  test('renders SalesRepManagement restricted, and SalesAdminReports inside their tab panels', () => {
    assert.match(salesAdminShellSrc, /<SalesRepManagement[\s\S]*restricted/)
    assert.match(salesAdminShellSrc, /<SalesAdminReports/)
    assert.match(salesAdminShellSrc, /role="tabpanel"/)
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
  test('loads current-week rep reports through the existing RLS-scoped client query and supports manager/week/status filters', () => {
    assert.match(salesAdminReportsSrc, /fetchRepReportsForWeek\(week\.weekStartDate\)/)
    assert.match(repReportsServiceSrc, /rep_reports_select_sales_admin/)
    assert.match(salesAdminReportsSrc, /aria-label="Filter by Manager"/)
    assert.match(salesAdminReportsSrc, /aria-label="Filter by reporting week"/)
    assert.match(salesAdminReportsSrc, /aria-label="Filter by report status"/)
    assert.match(salesAdminReportsSrc, /Reporting by Manager/)
  })

  test('View Report is enabled only for submitted rows and renders a read-only report detail', () => {
    assert.match(salesAdminReportsSrc, /disabled=\{!row\.report \|\| row\.report\.status !== 'submitted'\}/)
    assert.match(salesAdminReportsSrc, /onClick=\{\(\) => setSelectedRow\(row\)\}/)
    assert.match(salesAdminReportsSrc, /role="dialog"/)
    assert.match(salesAdminReportsSrc, /Read-only report/)
    assert.match(salesAdminReportsSrc, /ReportContent report=\{selectedRow\.report\}/)
  })

  test('never calls review_rep_report, reviewRepReport, or any approve/reject RPC wrapper (the function body text may still explain the RPC by name in a comment)', () => {
    for (const forbidden of ['review_rep_report(', "'review_rep_report'", 'reviewRepReport(', 'approveReport(', 'rejectReport(']) {
      assert.equal(salesAdminReportsSrc.includes(forbidden), false, `SalesAdminReports.tsx must never call ${forbidden}`)
    }
  })

  test('never imports or calls grantLateSubmissionException — Sales Admin cannot grant exceptions', () => {
    assert.equal(salesAdminReportsSrc.includes('grantLateSubmissionException'), false)
  })

  test('fetches reports through a RLS-scoped existing rep_reports query, not a new privileged path', () => {
    assert.match(salesAdminReportsSrc, /import \{ fetchRepReportsForWeek, type RepReport \} from '\.\.\/lib\/repReportsService'/)
    assert.match(repReportsServiceSrc, /export async function fetchRepReportsForWeek/)
    assert.match(repReportsServiceSrc, /supabase\s+\.from\('rep_reports'\)/)
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

  test('Sales Admin account lifecycle actions use the existing scoped endpoint and non-destructive assignment RPC', () => {
    assert.match(salesRepManagementSrc, /setSalesRepActive\(rep\.email, action === 'reactivate'\)/)
    assert.match(salesRepManagementSrc, /await unassignSalesRep\(rep\.profileId\)/)
    assert.match(salesRepManagementSrc, /Remove Assignment/)
    assert.match(salesRepManagementSrc, /report history remain unchanged/)
    assert.doesNotMatch(salesRepManagementSrc, /deleteSalesRep|\.delete\(/)
  })

  test('activation and assignment removal require the in-app confirmation dialog', () => {
    assert.match(salesRepManagementSrc, /role="alertdialog"/)
    assert.match(salesRepManagementSrc, /Confirm Remove Manager Assignment|Remove Manager Assignment/)
    assert.match(salesRepManagementSrc, /setPendingRepAction\(\{ rep, action: rep\.isActive \? 'deactivate' : 'reactivate' \}\)/)
  })

  test('the Sales Admin activation UI preserves the server partial_failure warning and tells users not to retry', () => {
    assert.match(setActiveSrc, /case 'partial_failure':/)
    assert.match(setActiveSrc, /Do not retry; contact support for reconciliation\./)
    assert.match(salesRepManagementServiceSrc, /body\?\.error === 'PARTIAL_FAILURE' \? \{ status: 'partial_failure' \}/)
    assert.match(salesRepManagementSrc, /This status change may be incomplete\. Do not retry; contact support for reconciliation\./)
    assert.match(supabaseServiceClientSrc, /\.eq\('portal_role', rosterRow\.portal_role\)/)
    assert.match(supabaseServiceClientSrc, /profileUpdateQuery = profileUpdateQuery\.eq\('role', restrictToPortalRole\)/)
  })
})

describe('Sales Admin Sales Rep edit — a dedicated, narrowly scoped path', () => {
  test('the endpoint authenticates Admin or Sales Admin first, falling through to Manager auth only on a FORBIDDEN result, before calling the server-only update method', () => {
    assert.match(updateSalesRepSrc, /authenticateAdminOrSalesAdmin\(/)
    assert.match(updateSalesRepSrc, /authenticateManager\(/)
    assert.match(updateSalesRepSrc, /adminAuth\.code === 'FORBIDDEN'/)
    assert.match(updateSalesRepSrc, /updateSalesRepProfile\(id, \{ fullName, email \}, userId, callerRole\)/)
    assert.doesNotMatch(updateSalesRepSrc, /body\.role|submitsWeeklyReport|isActive/)
  })

  test('the privileged service targets a stable roster id (bridged from a profile id for a Manager caller), rejects non-sales_rep targets, and never writes role or activation fields', () => {
    const fnStart = supabaseServiceClientSrc.indexOf('export async function updateSalesRepProfile(')
    const fnEnd = supabaseServiceClientSrc.indexOf('\n}\n', fnStart)
    assert.ok(fnStart !== -1 && fnEnd > fnStart)
    const fn = supabaseServiceClientSrc.slice(fnStart, fnEnd)
    assert.match(fn, /\.eq\('id', id\)/)
    assert.match(fn, /decideSalesRepProfileUpdate\(target, emailNormalized, emailConflictExists, isAuthorizedCaller\)/)
    assert.match(fn, /portalRole: targetRow\.portal_role/)
    assert.match(fn, /\.eq\('portal_role', 'sales_rep'\)/)
    assert.match(fn, /\.eq\('role', 'sales_rep'\)/)
    assert.match(fn, /existingProfile\.role !== 'sales_rep'/)
    assert.doesNotMatch(fn, /portal_role:\s*['"]|role:\s*['"]|is_active|submits_weekly_report/)
  })

  test('email changes reject duplicates, use auth_user_id, and roll back every changed store', () => {
    const fnStart = supabaseServiceClientSrc.indexOf('export async function updateSalesRepProfile(')
    const fnEnd = supabaseServiceClientSrc.indexOf('\n}\n', fnStart)
    const fn = supabaseServiceClientSrc.slice(fnStart, fnEnd)
    assert.match(fn, /\.eq\('email_normalized', emailNormalized\)\s*\.neq\('id', target\.id\)/)
    assert.match(fn, /auth_identity_unresolved/)
    assert.match(fn, /rollbackProfile\(\)[\s\S]*rollbackRoster\(\)[\s\S]*rollbackAuthEmail\(\)/)
  })

  test('REVIEW FIX — email verification: a not-yet-onboarded rep (no existingProfile) still gets its Auth email confirmed immediately, exactly as before — there is no rightful owner already relying on it yet', () => {
    const fnStart = supabaseServiceClientSrc.indexOf('export async function updateSalesRepProfile(')
    const fnEnd = supabaseServiceClientSrc.indexOf('\n}\n', fnStart)
    const fn = supabaseServiceClientSrc.slice(fnStart, fnEnd)
    assert.match(fn, /const deferEmailVerification = emailChanging && accountCreated && !!existingProfile/)
    assert.match(fn, /if \(emailChanging && accountCreated && !deferEmailVerification\) \{/)
    assert.match(fn, /updateUserById\(authUserId!,\s*\{[\s\S]*?email_confirm: true/)
  })

  test('REVIEW FIX — email verification: an already-onboarded rep\'s email change is deferred, never applied to roster/profile/Auth until a link is confirmed', () => {
    const fnStart = supabaseServiceClientSrc.indexOf('export async function updateSalesRepProfile(')
    const fnEnd = supabaseServiceClientSrc.indexOf('\n}\n', fnStart)
    const fn = supabaseServiceClientSrc.slice(fnStart, fnEnd)
    assert.match(fn, /const effectiveEmail = deferEmailVerification \? originalRoster\.email : email/)
    assert.match(fn, /const effectiveEmailNormalized = deferEmailVerification \? originalRoster\.emailNormalized : emailNormalized/)
    assert.match(fn, /await requestEmailChangeVerification\(existingProfile!\.id, emailNormalized\)/)
    assert.match(fn, /return verificationRequested \? \{ status: 'pending_verification' \} : \{ status: 'ok' \}/)
  })

  test('REVIEW FIX — email verification: the verification email is sent via the existing app-wide getEmailSender(), not a new ad hoc mechanism, and a send failure never fails the whole request', () => {
    const fnMatch = supabaseServiceClientSrc.match(/async function requestEmailChangeVerification\([\s\S]*?\n\}/)
    assert.ok(fnMatch)
    const body = fnMatch[0]
    assert.match(body, /getEmailSender\(\)\.send\(/)
    assert.match(body, /subject: 'Confirm your new WFG OneReport Pulse email address'/)
    // The DB write (pending fields) is the only thing allowed to fail the
    // whole request — the function still returns true after a send failure.
    const dbWriteIndex = body.indexOf("if (error) {")
    const sendIndex = body.indexOf('getEmailSender().send(')
    assert.ok(dbWriteIndex >= 0 && sendIndex > dbWriteIndex)
  })

  test('REVIEW FIX — email verification: the token is never stored in plaintext — only its hash — and is compared in constant time at finalize', () => {
    assert.match(supabaseServiceClientSrc, /generateEmailChangeToken, hashEmailChangeToken, verifyEmailChangeToken/)
    const fnMatch = supabaseServiceClientSrc.match(/async function requestEmailChangeVerification\([\s\S]*?\n\}/)
    assert.ok(fnMatch)
    assert.match(fnMatch[0], /token_hash: tokenHash/)
    assert.doesNotMatch(fnMatch[0], /token_hash: token[,)]/)
  })

  test('REVIEW FIX 2 — email verification: pending-email data (address + token hash) lives in sales_rep_pending_email_changes, a dedicated table with NO grant to authenticated/anon at all — never a column on profiles, which RLS can only protect per-row, never per-column', () => {
    const fnMatch = supabaseServiceClientSrc.match(/async function requestEmailChangeVerification\([\s\S]*?\n\}/)
    assert.ok(fnMatch)
    assert.match(fnMatch[0], /\.from\('sales_rep_pending_email_changes'\)\.upsert\(\{/)
    assert.equal(fnMatch[0].includes(".from('profiles')\n    .update({\n      pending_email"), false)
  })

  test('REVIEW FIX — finalizeEmailChangeVerification re-checks expiry, token validity, and email conflicts fresh — never trusts anything computed at request time', () => {
    const fnMatch = supabaseServiceClientSrc.match(/export async function finalizeEmailChangeVerification\([\s\S]*?\n\}\n\n/)
    assert.ok(fnMatch)
    const body = fnMatch[0]
    assert.match(body, /verifyEmailChangeToken\(token, pendingRow\.token_hash as string\)/)
    assert.match(body, /decideEmailChangeVerification\(/)
    assert.match(body, /emailConflictExists/)
  })

  test('successful profile edits emit a server-side structured audit event with actor, target, changed fields, before/after, and timestamp', () => {
    const fnStart = supabaseServiceClientSrc.indexOf('export async function updateSalesRepProfile(')
    const fnEnd = supabaseServiceClientSrc.indexOf('\n}\n', fnStart)
    const fn = supabaseServiceClientSrc.slice(fnStart, fnEnd)
    assert.match(fn, /console\.info\([\s\S]*audit\.sales_rep_profile_updated/)
    for (const field of ['actorUserId', 'approvedEmployeeId', 'changedFields', 'before:', 'after:', 'occurredAt']) {
      assert.ok(fn.includes(field), `audit event should include ${field}`)
    }
  })

  test('the browser service sends only stable id, full name, and email to the dedicated route', () => {
    const fnStart = salesRepManagementServiceSrc.indexOf('export async function updateSalesRep(')
    const fnEnd = salesRepManagementServiceSrc.indexOf('\n}', fnStart)
    assert.ok(fnStart !== -1 && fnEnd > fnStart)
    const fn = salesRepManagementServiceSrc.slice(fnStart, fnEnd)
    assert.match(fn, /fetch\('\/api\/admin\/users\/update-sales-rep'/)
    assert.match(fn, /JSON\.stringify\(\{ id, fullName, email \}\)/)
    assert.doesNotMatch(fn, /SUPABASE_SECRET_KEY|service_role|portal_role|role:/)
    assert.match(salesRepManagementSrc, /Edit Sales Rep/)
    assert.match(salesRepManagementSrc, /Full Name/)
    assert.match(salesRepManagementSrc, /WFG Email/)
    assert.match(salesRepManagementSrc, /sends a verification link to the new address/)
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
    assert.match(listManagersSrc, /auth\.role === 'sales_admin' \? managers\.map\(\(\{ id, fullName \}\) => \(\{ id, fullName, email: '' \}\)\) : managers/)
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
