// Run with: node --test api/_lib/managerSalesRepAuthorizationWiring.test.ts
//
// Positive/negative authorization coverage for Manager Sales Rep
// management (Add via self-assignment, Edit, Remove Assignment). Same
// source-inspection pattern as adminUserManagementWiring.test.ts, for the
// same reason: these files have real @supabase/supabase-js dependencies
// unsafe to execute directly here. The pure decision logic each delegates
// to (decideSalesRepProfileUpdate) is exhaustively, dynamically tested in
// salesRepProfileUpdate.test.ts.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const serviceClientSrc = readFileSync(path.join(dir, 'supabaseServiceClient.ts'), 'utf8')
const updateSalesRepEndpointSrc = readFileSync(path.join(dir, '..', 'admin', 'users', 'update-sales-rep.ts'), 'utf8')
const assignEndpointSrc = readFileSync(path.join(dir, '..', 'manager', 'sales-reps', 'assign.ts'), 'utf8')
const unassignEndpointSrc = readFileSync(path.join(dir, '..', 'manager', 'sales-reps', 'unassign.ts'), 'utf8')
const assignOwnDraftSrc = readFileSync(
  path.join(dir, '..', '..', 'supabase', 'drafts', '20261112_manager_owned_sales_rep_self_assignment.sql'),
  'utf8',
)
const unassignOwnDraftSrc = readFileSync(
  path.join(dir, '..', '..', 'supabase', 'drafts', '20261110_manager_owned_sales_rep_unassignment.sql'),
  'utf8',
)
const correctiveAllowlistMigrationSrc = readFileSync(
  path.join(dir, '..', '..', 'supabase', 'drafts', '20261115_manager_account_actions_allowlist_fail_closed.sql'),
  'utf8',
)

describe('Edit Sales Rep — a Manager may edit only a rep CURRENTLY assigned to them', () => {
  test('updateSalesRepProfile accepts a callerRole parameter, defaulting to admin (every pre-existing call site is unaffected)', () => {
    const fnMatch = serviceClientSrc.match(/export async function updateSalesRepProfile\(([\s\S]*?)\): Promise<UpdateSalesRepProfileOutcome>/)
    assert.ok(fnMatch)
    assert.match(fnMatch[1], /callerRole: 'admin' \| 'sales_admin' \| 'manager' = 'admin'/)
  })

  test('a Manager caller is checked against rep_manager_assignments, keyed by the already-authenticated actorUserId — never a client-supplied id', () => {
    const fnMatch = serviceClientSrc.match(/export async function updateSalesRepProfile\([\s\S]*?\n\}/)
    assert.ok(fnMatch)
    const body = fnMatch[0]
    assert.match(body, /callerRole === 'manager'/)
    assert.match(body, /\.from\('rep_manager_assignments'\)/)
    assert.match(body, /\.eq\('rep_id', existingProfile\.id\)/)
    assert.match(body, /\.eq\('manager_id', actorUserId\)/)
    assert.match(body, /\.is\('unassigned_at', null\)/)
  })

  test('isAuthorizedCaller defaults to true for any non-manager callerRole (Admin/Sales Admin remain unrestricted) and only becomes conditional for manager', () => {
    const fnMatch = serviceClientSrc.match(/export async function updateSalesRepProfile\([\s\S]*?\n\}/)
    assert.ok(fnMatch)
    assert.match(fnMatch[0], /let isAuthorizedCaller = callerRole !== 'manager'/)
  })

  test('the authorization decision is made before the email-change/Auth-update branch, so a forbidden Manager edit never reaches auth.admin.updateUserById', () => {
    const fnMatch = serviceClientSrc.match(/export async function updateSalesRepProfile\([\s\S]*?\n\}/)
    assert.ok(fnMatch)
    const body = fnMatch[0]
    const decisionIndex = body.indexOf('decideSalesRepProfileUpdate(target, emailNormalized, emailConflictExists, isAuthorizedCaller)')
    const authUpdateIndex = body.indexOf('client.auth.admin.updateUserById(authUserId!')
    assert.ok(decisionIndex >= 0 && authUpdateIndex >= 0)
    assert.ok(decisionIndex < authUpdateIndex, 'the authorization decision must be made before any Auth email mutation')
  })

  test('update-sales-rep.ts tries Admin-or-Sales-Admin first and only falls through to Manager auth on a FORBIDDEN result — any other failure (bad token, server misconfiguration) is reported as-is', () => {
    assert.match(updateSalesRepEndpointSrc, /import \{ authenticateAdminOrSalesAdmin \} from '\.\.\/\.\.\/_lib\/adminAuth\.js'/)
    assert.match(updateSalesRepEndpointSrc, /import \{ authenticateManager \} from '\.\.\/\.\.\/_lib\/managerAuth\.js'/)
    const fnMatch = updateSalesRepEndpointSrc.match(/export default async function handler\([\s\S]*?\n\}/)
    assert.ok(fnMatch)
    const body = fnMatch[0]
    const adminAuthIndex = body.indexOf('await authenticateAdminOrSalesAdmin(')
    const forbiddenCheckIndex = body.indexOf("adminAuth.code === 'FORBIDDEN'")
    const managerAuthIndex = body.indexOf('await authenticateManager(')
    assert.ok(adminAuthIndex >= 0 && forbiddenCheckIndex >= 0 && managerAuthIndex >= 0)
    assert.ok(adminAuthIndex < forbiddenCheckIndex && forbiddenCheckIndex < managerAuthIndex)
  })

  test('callerRole is threaded through to updateSalesRepProfile, not left at its admin default, whichever role actually authenticated', () => {
    assert.match(updateSalesRepEndpointSrc, /updateSalesRepProfile\(id, \{ fullName, email \}, userId, callerRole\)/)
  })
})

describe('Add Sales Rep (self-assignment) — a Manager may claim only an UNASSIGNED rep, only for themselves', () => {
  test('assign.ts authenticates via authenticateManager and gates on the same kill switch / Production guard as unassign.ts', () => {
    assert.match(assignEndpointSrc, /import \{ authenticateManager \} from '\.\.\/\.\.\/_lib\/managerAuth\.js'/)
    assert.match(assignEndpointSrc, /process\.env\.MANAGER_ACCOUNT_ACTIONS_ENABLED !== 'true' \|\| process\.env\.VERCEL_ENV === 'production'/)
  })

  test('assign.ts calls assign_own_sales_rep with only a rep id — no manager id is ever accepted from the request body', () => {
    assert.match(assignEndpointSrc, /auth\.supabase\.rpc\('assign_own_sales_rep', \{ p_rep_id: repId \}\)/)
    assert.equal(/managerId|p_manager_id/.test(assignEndpointSrc), false)
  })

  test('the draft RPC itself has no manager_id parameter — it is structurally impossible for a Manager to name a different manager as the target', () => {
    const fnMatch = assignOwnDraftSrc.match(/CREATE OR REPLACE FUNCTION public\.assign_own_sales_rep\(([\s\S]*?)\)/)
    assert.ok(fnMatch)
    assert.match(fnMatch[1].trim(), /^p_rep_id uuid$/)
  })

  test('the draft RPC raises ALREADY_ASSIGNED (not a silent reassignment) when the rep already belongs to a different manager', () => {
    assert.match(assignOwnDraftSrc, /RAISE EXCEPTION 'ALREADY_ASSIGNED: This Sales Rep is already assigned to a different Manager\./)
  })

  test('the draft RPC shares the same database-level kill switch and advisory lock key as the companion unassignment draft', () => {
    assert.match(assignOwnDraftSrc, /current_setting\('app\.manager_account_actions_enabled', true\)/)
    assert.match(assignOwnDraftSrc, /pg_advisory_xact_lock\(hashtext\(p_rep_id::text\)\)/)
  })

  test('SECURITY FIX — both RPCs require a mandatory, fail-closed allowlist via the shared helper, checked AFTER the boolean kill switch but BEFORE any ownership logic (superseding the earlier "optional allowlist" design)', () => {
    for (const src of [assignOwnDraftSrc, unassignOwnDraftSrc]) {
      const killSwitchIndex = src.indexOf("current_setting('app.manager_account_actions_enabled', true)")
      const allowlistIndex = src.indexOf('public.manager_account_action_allowlist_permits(v_caller) IS NOT TRUE')
      assert.ok(killSwitchIndex >= 0, 'expected the boolean kill switch check')
      assert.ok(allowlistIndex >= 0, 'expected a call to the shared allowlist helper')
      assert.ok(killSwitchIndex < allowlistIndex, 'the kill switch must be checked before the allowlist')
      // Neither draft re-implements the parsing inline any more — both
      // delegate to the one shared helper so the fail-closed logic can
      // never drift between them.
      assert.doesNotMatch(src, /NOT \(v_caller = ANY \(string_to_array/)
    }
  })

  test('SECURITY FIX — the shared allowlist helper itself fails closed: no path returns anything other than an explicit boolean, and it has no EXECUTE grant to authenticated/anon/PUBLIC', () => {
    // Defined once, in the unassignment draft (applied first); the
    // self-assignment draft only calls it.
    const fnMatch = unassignOwnDraftSrc.match(
      /CREATE OR REPLACE FUNCTION public\.manager_account_action_allowlist_permits\(p_caller uuid\)[\s\S]*?\$\$;/,
    )
    assert.ok(fnMatch, 'expected manager_account_action_allowlist_permits to be defined in the unassignment draft')
    const body = fnMatch[0]

    assert.match(body, /IF p_caller IS NULL THEN[\s\S]{0,20}RETURN false;/)
    assert.match(body, /IF v_raw IS NULL OR trim\(v_raw\) = '' THEN[\s\S]{0,20}RETURN false;/)
    assert.match(body, /IF v_part = '' THEN[\s\S]{0,400}RETURN false;/)
    assert.match(body, /EXCEPTION WHEN OTHERS THEN[\s\S]{0,400}RETURN false;/)
    assert.match(body, /IF array_length\(v_ids, 1\) IS NULL THEN[\s\S]{0,20}RETURN false;/)
    assert.match(body, /RETURN p_caller = ANY \(v_ids\);/)
    // Exactly five RETURN false paths and one RETURN <boolean-expression>
    // path — no sixth, silent "fall through to true" branch anywhere.
    assert.equal((body.match(/RETURN false;/g) ?? []).length, 5)

    assert.match(
      unassignOwnDraftSrc,
      /REVOKE ALL ON FUNCTION public\.manager_account_action_allowlist_permits\(uuid\) FROM PUBLIC, authenticated, anon;/,
    )
    assert.doesNotMatch(unassignOwnDraftSrc, /GRANT EXECUTE ON FUNCTION public\.manager_account_action_allowlist_permits/)

    // Both RPCs call it with IS NOT TRUE (not bare NOT ...), so a NULL
    // result (e.g. a NULL caller) is treated as a denial too, never as an
    // implicit pass-through.
    for (const src of [assignOwnDraftSrc, unassignOwnDraftSrc]) {
      assert.match(src, /public\.manager_account_action_allowlist_permits\(v_caller\) IS NOT TRUE/)
    }
  })

  test('the corrective migration patches both already-deployed RPCs plus the new helper, and does not touch Production', () => {
    assert.match(correctiveAllowlistMigrationSrc, /CREATE OR REPLACE FUNCTION public\.manager_account_action_allowlist_permits\(p_caller uuid\)/)
    assert.match(correctiveAllowlistMigrationSrc, /CREATE OR REPLACE FUNCTION public\.unassign_own_sales_rep\(p_rep_id uuid\)/)
    assert.match(correctiveAllowlistMigrationSrc, /CREATE OR REPLACE FUNCTION public\.assign_own_sales_rep\(p_rep_id uuid\)/)
    assert.doesNotMatch(correctiveAllowlistMigrationSrc, /sfkscotirqwlbdaeywii/)
    assert.doesNotMatch(correctiveAllowlistMigrationSrc, /CREATE TABLE|DROP TABLE|DROP FUNCTION/)
  })
})

describe('Remove Assignment — unchanged from its original review; re-asserted here alongside its new siblings', () => {
  test('unassign.ts calls unassign_own_sales_rep with only a rep id, under the same kill switch / Production guard', () => {
    assert.match(unassignEndpointSrc, /auth\.supabase\.rpc\('unassign_own_sales_rep', \{ p_rep_id: repId \}\)/)
    assert.match(unassignEndpointSrc, /process\.env\.MANAGER_ACCOUNT_ACTIONS_ENABLED !== 'true' \|\| process\.env\.VERCEL_ENV === 'production'/)
  })
})
