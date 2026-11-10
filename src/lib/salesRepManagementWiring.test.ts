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

describe('Phase 1A real-employee onboarding — Manager dropdown shows name + email and excludes test accounts', () => {
  test('listActiveManagers selects email alongside id/full_name, not just the two original columns', () => {
    const fnMatch = supabaseServiceClientSrc.match(/export async function listActiveManagers\([\s\S]*?\n\}/)
    assert.ok(fnMatch, 'could not locate listActiveManagers')
    assert.match(fnMatch[0], /\.select\('id, full_name, email'\)/)
  })

  test('listActiveManagers filters results through an explicit allowlist, not a name or email pattern', () => {
    const fnMatch = supabaseServiceClientSrc.match(/export async function listActiveManagers\([\s\S]*?\n\}/)
    assert.ok(fnMatch)
    assert.match(fnMatch[0], /VERIFIED_REAL_MANAGER_IDS\.has\(row\.id/)
    // Never a substring/pattern check against a name or email anywhere in
    // this function — the exclusion must be identity-based, not heuristic.
    assert.doesNotMatch(fnMatch[0], /\.includes\(|\.match\(|\.test\(|startsWith|endsWith/)
  })

  test('the allowlist is a fixed Set of exactly 15 UUIDs — the current real, active production Managers (corrected 2026-11-10 from a stale 10-entry PREVIEW-id snapshot), one per entry, each labeled by name in a comment', () => {
    const setMatch = supabaseServiceClientSrc.match(/const VERIFIED_REAL_MANAGER_IDS = new Set\(\[[\s\S]*?\]\)/)
    assert.ok(setMatch, 'could not locate VERIFIED_REAL_MANAGER_IDS')
    const uuidMatches = setMatch[0].match(/'[0-9a-f-]{36}'/g) ?? []
    assert.equal(uuidMatches.length, 15)
  })

  test('the dropdown option renders the Manager\'s name AND email together, so similarly named Managers are distinguishable', () => {
    assert.match(salesRepManagementComponentSrc, /\{m\.fullName \?\? m\.id\} — \{m\.email\}/)
  })

  test('ActiveManager (the client-side type the dropdown renders from) requires email, not an optional field that could silently be missing', () => {
    const ifaceMatch = salesRepManagementServiceSrc.match(/export interface ActiveManager \{[\s\S]*?\}/)
    assert.ok(ifaceMatch)
    assert.match(ifaceMatch[0], /email: string/)
    assert.doesNotMatch(ifaceMatch[0], /email\?:|email: string \| null/)
  })

  test('this allowlist filter never touches assign_sales_rep, is_admin(), is_sales_admin(), or any RLS policy — it only narrows what the dropdown displays', () => {
    // The migration files (the actual authorization/RLS surface) have no
    // knowledge of this frontend-facing allowlist at all.
    for (const migrationFile of ['20261027140200_rep_manager_assignments.sql', '20261102090000_profiles_select_assigned_rep_for_manager.sql', '20261103090000_sales_admin_role.sql']) {
      const migrationSrc = readFileSync(path.join(dir, '..', '..', 'supabase', 'migrations', migrationFile), 'utf8')
      assert.equal(migrationSrc.includes('VERIFIED_REAL_MANAGER_IDS'), false, `${migrationFile} must not reference the frontend allowlist`)
    }
  })
})

describe('Phase 4 refinement — Sales Rep real-vs-demo/test classification, mirroring VERIFIED_REAL_MANAGER_IDS exactly', () => {
  test('listSalesReps classifies each rep through an explicit allowlist, not a name or email pattern', () => {
    const fnMatch = supabaseServiceClientSrc.match(/export async function listSalesReps\([\s\S]*?\n\}/)
    assert.ok(fnMatch, 'could not locate listSalesReps')
    assert.match(fnMatch[0], /isVerifiedReal: profileId !== null && VERIFIED_REAL_SALES_REP_IDS\.has\(profileId\)/)
    assert.doesNotMatch(fnMatch[0], /isVerifiedReal[\s\S]{0,80}(\.includes\(|\.match\(|\.test\(|startsWith|endsWith)/)
  })

  test('the allowlist is a fixed Set of exactly 29 UUIDs — the real production Sales Reps pre-provisioned via the launch rollout (corrected 2026-11-10 from a stale 33-entry PREVIEW-id snapshot), one per entry, each labeled by name in a comment', () => {
    const setMatch = supabaseServiceClientSrc.match(/const VERIFIED_REAL_SALES_REP_IDS = new Set\(\[[\s\S]*?\]\)/)
    assert.ok(setMatch, 'could not locate VERIFIED_REAL_SALES_REP_IDS')
    const uuidMatches = setMatch[0].match(/'[0-9a-f-]{36}'/g) ?? []
    assert.equal(uuidMatches.length, 29)
  })

  test('the two known demo/test accounts are not in the allowlist', () => {
    const setMatch = supabaseServiceClientSrc.match(/const VERIFIED_REAL_SALES_REP_IDS = new Set\(\[[\s\S]*?\]\)/)
    assert.ok(setMatch)
    assert.doesNotMatch(setMatch[0], /c249cccb-cd0f-4d43-9b78-5dcaff1d159a/)
    assert.doesNotMatch(setMatch[0], /f5cd3572-cd87-41b0-ac4b-612d596c8aad/)
  })

  test('SalesRepSummary and the client-side SalesRep type both carry isVerifiedReal as a required boolean, never optional', () => {
    const summaryIface = supabaseServiceClientSrc.match(/export interface SalesRepSummary \{[\s\S]*?\n\}/)
    assert.ok(summaryIface)
    assert.match(summaryIface[0], /isVerifiedReal: boolean/)
    assert.doesNotMatch(summaryIface[0], /isVerifiedReal\?:/)

    const clientIface = salesRepManagementServiceSrc.match(/export interface SalesRep \{[\s\S]*?\n\}/)
    assert.ok(clientIface)
    assert.match(clientIface[0], /isVerifiedReal: boolean/)
    assert.doesNotMatch(clientIface[0], /isVerifiedReal\?:/)
  })

  test('SalesRepManagement.tsx computes the primary Active KPI as verified-real-and-active, never the bare count of 33 hardcoded', () => {
    assert.match(salesRepManagementComponentSrc, /activeVerifiedCount = reps\.filter\(\(r\) => r\.status === 'active' && r\.isVerifiedReal\)\.length/)
    assert.doesNotMatch(salesRepManagementComponentSrc, /=== 33\b/)
    assert.doesNotMatch(salesRepManagementComponentSrc, /\b33\b/)
  })

  test('the Active KPI card shows a sublabel with the full active total (incl. demo/test) whenever any demo/test account is active — nothing is hidden', () => {
    assert.match(salesRepManagementComponentSrc, /activeDemoCount > 0 && \(/)
    assert.match(salesRepManagementComponentSrc, /\{activeCount\} total active \(\{activeDemoCount\} demo\/test\)/)
  })

  test('a demo/test row is only flagged once a profile exists — a real rep who has not onboarded yet (profileId null) is never mislabeled as demo/test', () => {
    assert.match(salesRepManagementComponentSrc, /rep\.profileId !== null && !rep\.isVerifiedReal && <span className="srm-demo-badge">Demo\/Test<\/span>/)
  })

  test('demo/test rows are never filtered out of the roster table — filteredReps only filters by status/search, never by isVerifiedReal', () => {
    const filteredRepsMatch = salesRepManagementComponentSrc.match(/const filteredReps = reps\.filter\(\(rep\) => \{[\s\S]*?\n  \}\)/)
    assert.ok(filteredRepsMatch, 'could not locate filteredReps')
    assert.doesNotMatch(filteredRepsMatch[0], /isVerifiedReal/)
  })

  test('this classification never touches assign_sales_rep, is_admin(), is_sales_admin(), or any RLS policy — it only labels existing, already-visible rows', () => {
    for (const migrationFile of ['20261027140200_rep_manager_assignments.sql', '20261102090000_profiles_select_assigned_rep_for_manager.sql', '20261103090000_sales_admin_role.sql']) {
      const migrationSrc = readFileSync(path.join(dir, '..', '..', 'supabase', 'migrations', migrationFile), 'utf8')
      assert.equal(migrationSrc.includes('VERIFIED_REAL_SALES_REP_IDS'), false, `${migrationFile} must not reference the frontend allowlist`)
    }
  })
})
