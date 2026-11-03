// Run with: node --experimental-strip-types --test src/lib/salesRepManagementWiring.test.ts
//
// SalesRepManagement.tsx/salesRepManagementService.ts depend on the real
// browser Supabase client (transitively, via sessionService.ts ->
// supabaseClient.ts), so they're not safe to import and execute directly
// here — this verifies the Sales Rep provisioning wiring via source
// inspection instead, the same established pattern used elsewhere in this
// project (see editEmployeeWiring.test.ts, dualRoleRoutingWiring.test.ts).
//
// decideCreateSalesRepAccountAction itself has zero Supabase/browser
// dependency, BUT — unlike decideCreateManagerAccountAction in
// adminUserManagement.ts, which api/_lib/adminUserManagement.test.ts imports
// and executes directly because that module has NO imports of its own —
// salesRepProvisioning.ts imports isWfgEmail from './adminUserManagement.js'
// (a `.js` specifier, required by this project's nodenext TS config; see
// tsconfig.api.json). Plain `node --experimental-strip-types` cannot resolve
// that `.js` specifier to the sibling `adminUserManagement.ts` source file
// (verified: it throws ERR_MODULE_NOT_FOUND), so salesRepProvisioning.ts
// cannot be dynamically imported and executed here either — it falls under
// the same "has real imports -> source inspection only" rule every other
// file in this suite (and in adminUserManagementWiring.test.ts) already
// follows. The role_conflict behavior is therefore verified below via
// source inspection of the function body, not dynamic execution.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const apiLibDir = path.join(dir, '..', '..', 'api', '_lib')
const apiUsersDir = path.join(dir, '..', '..', 'api', 'admin', 'users')

const inviteSalesRepSrc = readFileSync(path.join(apiUsersDir, 'invite-sales-rep.ts'), 'utf8')
const listSalesRepsSrc = readFileSync(path.join(apiUsersDir, 'list-sales-reps.ts'), 'utf8')
const listManagersSrc = readFileSync(path.join(apiUsersDir, 'list-managers.ts'), 'utf8')
const salesRepProvisioningSrc = readFileSync(path.join(apiLibDir, 'salesRepProvisioning.ts'), 'utf8')
const supabaseServiceClientSrc = readFileSync(path.join(apiLibDir, 'supabaseServiceClient.ts'), 'utf8')
const salesRepManagementServiceSrc = readFileSync(path.join(dir, 'salesRepManagementService.ts'), 'utf8')
const salesRepManagementComponentSrc = readFileSync(path.join(dir, '..', 'components', 'SalesRepManagement.tsx'), 'utf8')

function getTsFunctionBody(src: string, functionName: string): string {
  const match = src.match(new RegExp(`export function ${functionName}\\([\\s\\S]*?\\n\\}`))
  assert.ok(match, `could not locate function ${functionName}`)
  return match[0]
}

describe('decideCreateSalesRepAccountAction treats an existing manager or admin roster role as role_conflict', () => {
  const fn = getTsFunctionBody(salesRepProvisioningSrc, 'decideCreateSalesRepAccountAction')

  test('role_conflict fires for an existing roster role of manager, admin, OR sales_admin (widened for the Sales Admin role — see salesAdminWiring.test.ts)', () => {
    assert.match(
      fn,
      /existingRoster\.portalRole === 'manager' \|\| existingRoster\.portalRole === 'admin' \|\| existingRoster\.portalRole === 'sales_admin'/,
    )
  })

  test('role_conflict is NOT conditioned on is_active — a deactivated manager/admin/sales_admin row still conflicts', () => {
    const conflictLine = fn.match(/if \(\s*\n?\s*existingRoster &&[\s\S]*?role_conflict' \}\s*\n\s*\}/)
    assert.ok(conflictLine)
    assert.doesNotMatch(conflictLine[0], /isActive/)
  })

  test('the invalid_domain check (isWfgEmail) runs before role_conflict', () => {
    const domainIndex = fn.indexOf("action: 'invalid_domain'")
    const roleConflictIndex = fn.indexOf("action: 'role_conflict'")
    assert.ok(domainIndex > -1 && roleConflictIndex > -1 && domainIndex < roleConflictIndex)
  })

  test('role_conflict is checked before the no-existing-roster (create_roster_and_account) branch, so a conflicting row is never bypassed just because no account/profile exists yet', () => {
    const roleConflictIndex = fn.indexOf("action: 'role_conflict'")
    const createRosterIndex = fn.indexOf("action: 'create_roster_and_account'")
    assert.ok(roleConflictIndex > -1 && createRosterIndex > -1 && roleConflictIndex < createRosterIndex)
  })

  test('an existing sales_rep roster role is never part of the role_conflict condition', () => {
    const conflictLine = fn.match(/if \(\s*\n?\s*existingRoster &&[\s\S]*?\) \{/)
    assert.ok(conflictLine)
    assert.doesNotMatch(conflictLine[0], /'sales_rep'/)
  })
})

describe('invite-sales-rep.ts requires POST + admin auth, and never reads a role from the request body', () => {
  test('requires POST', () => {
    assert.match(inviteSalesRepSrc, /req\.method !== 'POST'/)
  })

  test('calls authenticateAdminOrSalesAdmin before doing anything else (widened for the Sales Admin role — see salesAdminWiring.test.ts)', () => {
    assert.match(inviteSalesRepSrc, /authenticateAdminOrSalesAdmin\(/)
  })

  test('the request body is destructured for fullName/email only — never a role field', () => {
    const bodyMatch = inviteSalesRepSrc.match(/const body = \(req\.body[\s\S]*?\n\s*\n/)
    assert.ok(bodyMatch, 'could not locate the request body destructure')
    assert.doesNotMatch(bodyMatch[0], /\brole\b/)
  })

  test('the role is always hardcoded via addOrCreateSalesRepAccount — the function itself is never passed a role argument', () => {
    assert.match(inviteSalesRepSrc, /addOrCreateSalesRepAccount\(fullName, email\)/)
  })
})

describe('list-sales-reps.ts and list-managers.ts both require admin auth and GET', () => {
  test('list-sales-reps.ts requires GET and admin-or-sales-admin auth, and calls listSalesReps()', () => {
    assert.match(listSalesRepsSrc, /req\.method !== 'GET'/)
    assert.match(listSalesRepsSrc, /authenticateAdminOrSalesAdmin\(/)
    assert.match(listSalesRepsSrc, /listSalesReps\(\)/)
  })

  test('list-managers.ts requires GET and admin-or-sales-admin auth, and calls listActiveManagers()', () => {
    assert.match(listManagersSrc, /req\.method !== 'GET'/)
    assert.match(listManagersSrc, /authenticateAdminOrSalesAdmin\(/)
    assert.match(listManagersSrc, /listActiveManagers\(\)/)
  })
})

describe('Sales Rep provisioning is a fully separate surface — it never touches the existing Manager/Admin roster code', () => {
  const newFiles: [string, string][] = [
    ['api/admin/users/invite-sales-rep.ts', inviteSalesRepSrc],
    ['api/admin/users/list-sales-reps.ts', listSalesRepsSrc],
    ['api/admin/users/list-managers.ts', listManagersSrc],
    ['api/_lib/salesRepProvisioning.ts', salesRepProvisioningSrc],
    ['src/lib/salesRepManagementService.ts', salesRepManagementServiceSrc],
    ['src/components/SalesRepManagement.tsx', salesRepManagementComponentSrc],
  ]

  for (const [label, src] of newFiles) {
    test(`${label} never imports the UserManagement component, adminUserManagementService, or listUsersOutcome`, () => {
      // Matches an import FROM a path ending exactly in "/UserManagement"
      // (the component, always imported without an extension in this
      // project's .tsx files) — deliberately does NOT flag a prose comment
      // mentioning "UserManagement.tsx" (several of these new files
      // document their relationship to that existing, untouched screen) or
      // a "./UserManagement.css" class-sharing import, since CSS files
      // carry no behavior to couple to.
      assert.doesNotMatch(src, /from ['"][^'"]*\/UserManagement['"]/)
      assert.doesNotMatch(src, /from ['"][^'"]*adminUserManagementService['"]/)
      assert.doesNotMatch(src, /from ['"][^'"]*listUsersOutcome['"]/)
    })

    test(`${label} never references addOrCreateManagerAccount`, () => {
      assert.doesNotMatch(src, /addOrCreateManagerAccount/)
    })
  }

  test('salesRepProvisioning.ts reuses isWfgEmail from adminUserManagement.ts rather than duplicating it', () => {
    assert.match(salesRepProvisioningSrc, /import \{ isWfgEmail \} from '\.\/adminUserManagement\.js'/)
    assert.doesNotMatch(salesRepProvisioningSrc, /function isWfgEmail/)
  })

  test('the new supabaseServiceClient.ts additions reuse createAccountAndMarkRoster rather than re-implementing Auth account creation', () => {
    assert.match(supabaseServiceClientSrc, /await createAccountAndMarkRoster\(emailNormalized, email\)/)
  })

  test('SalesRepManagement.tsx is exported as a standalone component taking onBack (plus an optional restricted flag for the Sales Admin role, added later — see salesAdminWiring.test.ts), matching UserManagement.tsx\'s own prop convention', () => {
    assert.match(salesRepManagementComponentSrc, /export default function SalesRepManagement\(\{ onBack, restricted = false \}: SalesRepManagementProps\)/)
  })
})
