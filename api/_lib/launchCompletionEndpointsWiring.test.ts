// Run with: node --test api/_lib/launchCompletionEndpointsWiring.test.ts
//
// Both api/admin/users/pre-provision-manager-profile.ts and
// api/admin/users/convert-role.ts import real @supabase/supabase-js
// dependencies, so they aren't safe to execute directly here — same
// established pattern as preProvisionSalesRepsWiring.test.ts. The pure
// decision logic (decideManagerPreProvisioningAction, decideRoleConversionAction)
// is independently, directly unit-tested in its own test files instead.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const managerProfileEndpointSrc = readFileSync(path.join(dir, '..', 'admin', 'users', 'pre-provision-manager-profile.ts'), 'utf8')
const convertRoleEndpointSrc = readFileSync(path.join(dir, '..', 'admin', 'users', 'convert-role.ts'), 'utf8')
const serviceClientSrc = readFileSync(path.join(dir, 'supabaseServiceClient.ts'), 'utf8')

describe('pre-provision-manager-profile.ts — Admin-ONLY, fixed single target, never a client-supplied email', () => {
  test('imports and calls authenticateAdmin, never authenticateAdminOrSalesAdmin', () => {
    assert.match(managerProfileEndpointSrc, /import \{ authenticateAdmin \} from '\.\.\/\.\.\/_lib\/adminAuth\.js'/)
    assert.match(managerProfileEndpointSrc, /await authenticateAdmin\(/)
    assert.doesNotMatch(managerProfileEndpointSrc, /authenticateAdminOrSalesAdmin/)
  })

  test('TARGET_EMAIL is a fixed constant, never read from req.body', () => {
    assert.match(managerProfileEndpointSrc, /const TARGET_EMAIL = 'rbauchle@wfgtitle\.com'/)
    assert.doesNotMatch(managerProfileEndpointSrc, /body\.email/)
  })

  test('dry-run (!execute) never reaches createProfileFromApprovedEmployee', () => {
    const dryRunIndex = managerProfileEndpointSrc.indexOf('if (!execute) {')
    const createIndex = managerProfileEndpointSrc.indexOf('createProfileFromApprovedEmployee(employee!.authUserId')
    assert.ok(dryRunIndex >= 0 && createIndex > dryRunIndex)
    const dryRunBlock = managerProfileEndpointSrc.slice(dryRunIndex, managerProfileEndpointSrc.indexOf('\n    }', dryRunIndex))
    assert.doesNotMatch(dryRunBlock, /createProfileFromApprovedEmployee/)
  })

  test('only ever creates a profile — never calls assign_sales_rep or any assignment helper (a prose mention in its own explanatory comment is fine, an actual call is not)', () => {
    assert.doesNotMatch(managerProfileEndpointSrc, /\.rpc\('assign_sales_rep'/)
    assert.doesNotMatch(managerProfileEndpointSrc, /findActiveAssignmentForRep\(/)
  })
})

describe('convert-role.ts — Admin-ONLY, fixed roster, never a client-supplied email/role', () => {
  test('imports and calls authenticateAdmin, never authenticateAdminOrSalesAdmin', () => {
    assert.match(convertRoleEndpointSrc, /import \{ authenticateAdmin \} from '\.\.\/\.\.\/_lib\/adminAuth\.js'/)
    assert.match(convertRoleEndpointSrc, /await authenticateAdmin\(/)
    assert.doesNotMatch(convertRoleEndpointSrc, /authenticateAdminOrSalesAdmin/)
  })

  test('imports APPROVED_ROLE_CONVERSIONS from the dedicated roster module, never reads a role/email from the request body', () => {
    assert.match(convertRoleEndpointSrc, /import \{ APPROVED_ROLE_CONVERSIONS \} from '\.\.\/\.\.\/_lib\/roleConversionRoster\.js'/)
    assert.match(convertRoleEndpointSrc, /for \(const entry of APPROVED_ROLE_CONVERSIONS\)/)
    assert.match(convertRoleEndpointSrc, /const body = \(req\.body \?\? \{\}\) as \{ execute\?: unknown \}/)
  })

  test('dry-run (!execute) never reaches convertManagedEmployeeRole or assign_sales_rep', () => {
    const dryRunIndex = convertRoleEndpointSrc.indexOf('if (!execute) {')
    const convertIndex = convertRoleEndpointSrc.indexOf('await convertManagedEmployeeRole(')
    const rpcIndex = convertRoleEndpointSrc.indexOf(".rpc('assign_sales_rep'")
    assert.ok(dryRunIndex >= 0 && convertIndex > dryRunIndex && rpcIndex > dryRunIndex)
  })

  test('the assign_sales_rep call for Austin\'s entry uses the caller\'s own admin-scoped client (auth.supabase), never the service-role client', () => {
    assert.match(convertRoleEndpointSrc, /auth\.supabase\.rpc\('assign_sales_rep'/)
    assert.doesNotMatch(convertRoleEndpointSrc, /getServiceClient\(\)\.rpc/)
  })

  test('full_success for the assignment step is only reported after isAssignmentVerified confirms the independent re-read', () => {
    const rpcIndex = convertRoleEndpointSrc.lastIndexOf(".rpc('assign_sales_rep'")
    const verifyIndex = convertRoleEndpointSrc.indexOf('isAssignmentVerified(verification, expectedManagerProfileId)')
    const fullSuccessIndex = convertRoleEndpointSrc.lastIndexOf("status: 'full_success'")
    assert.ok(rpcIndex >= 0 && verifyIndex > rpcIndex && fullSuccessIndex > verifyIndex)
  })

  test('a converted role is never reported full_success while its required assignment failed — converted_assignment_failed is distinct', () => {
    assert.match(convertRoleEndpointSrc, /status: 'converted_assignment_failed'/)
  })
})

describe('api/_lib/roleConversionRoster.ts — exactly the two approved launch-completion conversions', () => {
  const rosterSrc = readFileSync(path.join(dir, 'roleConversionRoster.ts'), 'utf8')

  test('Joey Grampa converts manager -> sales_admin, no assignment', () => {
    const match = rosterSrc.match(/\{\s*email: 'jgrampa@wfgtitle\.com',[\s\S]*?\},/)
    assert.ok(match, 'could not locate Joey Grampa\'s roster entry')
    assert.match(match[0], /expectedCurrentPortalRole: 'manager'/)
    assert.match(match[0], /newPortalRole: 'sales_admin'/)
    assert.doesNotMatch(match[0], /assignToManagerEmail/)
  })

  test('Austin Rozier converts manager -> sales_rep, assigned to Robert Bauchle', () => {
    const match = rosterSrc.match(/\{\s*email: 'arozier@wfgtitle\.com',[\s\S]*?\},/)
    assert.ok(match, 'could not locate Austin Rozier\'s roster entry')
    assert.match(match[0], /expectedCurrentPortalRole: 'manager'/)
    assert.match(match[0], /newPortalRole: 'sales_rep'/)
    assert.match(match[0], /assignToManagerEmail: 'rbauchle@wfgtitle\.com'/)
  })

  test('exactly two entries — never a client-extendable list', () => {
    const entryCount = (rosterSrc.match(/email: '[^']+@wfgtitle\.com'/g) ?? []).length
    assert.equal(entryCount, 2)
  })
})

describe('api/_lib/supabaseServiceClient.ts — convertManagedEmployeeRole updates both stores, reverts on partial failure', () => {
  test('exists, separate from updateManagedEmployee (which is typed manager|admin only and cannot target sales_rep/sales_admin)', () => {
    assert.match(serviceClientSrc, /export async function convertManagedEmployeeRole/)
    const updateIface = serviceClientSrc.match(/export interface UpdateManagedEmployeeInput \{[\s\S]*?\n\}/)
    assert.ok(updateIface)
    assert.match(updateIface[0], /role: 'manager' \| 'admin'/)
  })

  test('refuses to convert when the roster or profile role differs from expectedCurrentPortalRole', () => {
    const fnMatch = serviceClientSrc.match(/export async function convertManagedEmployeeRole[\s\S]*?\n\}\n/)
    assert.ok(fnMatch)
    assert.match(fnMatch[0], /status: 'unexpected_current_role'/)
  })

  test('on a profile-update failure after the roster update succeeded, attempts to revert the roster back to its original values', () => {
    const fnMatch = serviceClientSrc.match(/export async function convertManagedEmployeeRole[\s\S]*?\n\}\n/)
    assert.ok(fnMatch)
    assert.match(fnMatch[0], /reverting roster/)
    assert.match(fnMatch[0], /portal_role: originalRosterPortalRole, submits_weekly_report: originalRosterSubmitsWeeklyReport/)
    assert.match(fnMatch[0], /status: 'partial_failure'/)
  })
})
