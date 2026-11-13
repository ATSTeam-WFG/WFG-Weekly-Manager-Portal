// Run with: node --test api/_lib/managerPendingAssignmentWiring.test.ts
//
// Positive/negative authorization and wiring coverage for Manager "Add
// Sales Rep" (pending-assignment claim + finalize-on-provisioning). Same
// source-inspection pattern as adminUserManagementWiring.test.ts, for the
// same reason: these files have real @supabase/supabase-js dependencies
// unsafe to execute directly here. The pure decision logic each delegates
// to (decidePendingAssignmentCreation, decideFinalizePendingAssignment) is
// exhaustively, dynamically tested in managerPendingAssignment.test.ts.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const serviceClientSrc = readFileSync(path.join(dir, 'supabaseServiceClient.ts'), 'utf8')
const inviteEndpointSrc = readFileSync(path.join(dir, '..', 'admin', 'users', 'invite-sales-rep.ts'), 'utf8')
const completeProfileSrc = readFileSync(path.join(dir, '..', 'onboarding', 'complete-profile.ts'), 'utf8')
const preProvisionRepsSrc = readFileSync(path.join(dir, '..', 'admin', 'users', 'pre-provision-sales-reps.ts'), 'utf8')
const preProvisionManagerSrc = readFileSync(path.join(dir, '..', 'admin', 'users', 'pre-provision-manager-profile.ts'), 'utf8')
const draftMigrationSrc = readFileSync(
  path.join(dir, '..', '..', 'supabase', 'drafts', '20261112_manager_sales_rep_pending_assignment.sql'),
  'utf8',
)

describe('invite-sales-rep.ts — Admin/Sales Admin path is completely untouched for a non-Manager caller', () => {
  test('authenticateAdminOrSalesAdmin is tried first; addOrCreateSalesRepAccount (no pending-assignment side effect) is still the call for that path', () => {
    assert.match(inviteEndpointSrc, /authenticateAdminOrSalesAdmin\(/)
    assert.match(inviteEndpointSrc, /await addOrCreateSalesRepAccount\(fullName, email\)/)
  })

  test('falls through to Manager auth only on a FORBIDDEN result from Admin/Sales Admin auth, same convention as update-sales-rep.ts', () => {
    const fnMatch = inviteEndpointSrc.match(/export default async function handler\([\s\S]*?\n\}/)
    assert.ok(fnMatch)
    const body = fnMatch[0]
    const adminAuthIndex = body.indexOf('await authenticateAdminOrSalesAdmin(')
    const forbiddenCheckIndex = body.indexOf("adminAuth.code !== 'FORBIDDEN'")
    const managerAuthIndex = body.indexOf('await authenticateManager(')
    assert.ok(adminAuthIndex >= 0 && forbiddenCheckIndex >= 0 && managerAuthIndex >= 0)
    assert.ok(adminAuthIndex < forbiddenCheckIndex && forbiddenCheckIndex < managerAuthIndex)
  })

  test('the Manager path is gated behind the same kill switch / Production guard as every other Manager account action', () => {
    assert.match(inviteEndpointSrc, /process\.env\.MANAGER_ACCOUNT_ACTIONS_ENABLED !== 'true' \|\| process\.env\.VERCEL_ENV === 'production'/)
  })

  test('a Manager caller routes to inviteSalesRepAsManager with their own verified id, never a client-supplied manager id', () => {
    assert.match(inviteEndpointSrc, /await inviteSalesRepAsManager\(fullName, email, managerId\)/)
    assert.match(inviteEndpointSrc, /managerId = managerAuth\.userId/)
  })
})

describe('inviteSalesRepAsManager — additive only; never touches an already-registered (already-onboarded) rep', () => {
  test('delegates entirely to the unmodified addOrCreateSalesRepAccount for the account-creation decision itself', () => {
    const fnMatch = serviceClientSrc.match(/export async function inviteSalesRepAsManager\([\s\S]*?\n\}/)
    assert.ok(fnMatch)
    assert.match(fnMatch[0], /await addOrCreateSalesRepAccount\(fullName, email\)/)
  })

  test('never creates a pending assignment for already_registered — this is the explicit "do not build a browse-unassigned-reps surface" boundary', () => {
    const fnMatch = serviceClientSrc.match(/export async function inviteSalesRepAsManager\([\s\S]*?\n\}/)
    assert.ok(fnMatch)
    const body = fnMatch[0]
    const registeredCheckIndex = body.indexOf("accountOutcome.status === 'already_registered'")
    const pendingCallIndex = body.indexOf('await createManagerPendingAssignment(')
    assert.ok(registeredCheckIndex >= 0 && pendingCallIndex >= 0)
    assert.ok(registeredCheckIndex < pendingCallIndex, 'already_registered must return before any pending-assignment call')
  })
})

describe('createManagerPendingAssignment — atomic insert-or-read, never a racy check-then-insert', () => {
  test('attempts the insert first and only reads on a unique-constraint (23505) failure', () => {
    const fnMatch = serviceClientSrc.match(/async function createManagerPendingAssignment\([\s\S]*?\n\}/)
    assert.ok(fnMatch)
    const body = fnMatch[0]
    const insertIndex = body.indexOf(".insert({ rep_auth_user_id: repAuthUserId, manager_id: managerId, expires_at: expiresAt })")
    const codeCheckIndex = body.indexOf("insertError.code !== '23505'")
    assert.ok(insertIndex >= 0 && codeCheckIndex >= 0 && insertIndex < codeCheckIndex)
  })

  test('the conflict decision is delegated to decidePendingAssignmentCreation, not re-implemented inline', () => {
    assert.match(serviceClientSrc, /decidePendingAssignmentCreation\(existingPending, managerId\)/)
  })
})

describe('finalizePendingManagerAssignment — the one place a pending claim becomes a real assignment', () => {
  test('is a no-op when no pending row exists for this rep — the common case', () => {
    const fnMatch = serviceClientSrc.match(/export async function finalizePendingManagerAssignment\([\s\S]*?\n\}/)
    assert.ok(fnMatch)
    assert.match(fnMatch[0], /if \(!pendingRow\) return \{ status: 'noop' \}/)
  })

  test('revalidates the manager is STILL an active manager, and revalidates the rep has no conflicting active assignment, before finalizing — never trusting the state at invite time', () => {
    const fnMatch = serviceClientSrc.match(/export async function finalizePendingManagerAssignment\([\s\S]*?\n\}/)
    assert.ok(fnMatch)
    const body = fnMatch[0]
    assert.match(body, /managerProfile\?\.role === 'manager' && managerProfile\?\.is_active === true/)
    assert.match(body, /\.from\('rep_manager_assignments'\)\.select\('id'\)\.eq\('rep_id', repProfileId\)\.is\('unassigned_at', null\)/)
    assert.match(body, /decideFinalizePendingAssignment\(pending, new Date\(\)\.toISOString\(\), managerStillActive, !!activeAssignment\)/)
  })

  test('writes the real assignment directly (service-role), never via assign_sales_rep/assign_own_sales_rep — both require an auth.uid() this server-only context does not have', () => {
    const fnMatch = serviceClientSrc.match(/export async function finalizePendingManagerAssignment\([\s\S]*?\n\}/)
    assert.ok(fnMatch)
    const body = fnMatch[0]
    assert.match(body, /\.from\('rep_manager_assignments'\)\s*\n\s*\.insert\(\{ rep_id: repProfileId, manager_id: decision\.managerId, assigned_by: decision\.managerId \}\)/)
    assert.equal(/\.rpc\('assign_sales_rep'|\.rpc\('assign_own_sales_rep'/.test(body), false)
  })

  test('a failed assignment insert due to a race (23505) is recorded as a conflict, never left as a silent failure or a thrown exception', () => {
    const fnMatch = serviceClientSrc.match(/export async function finalizePendingManagerAssignment\([\s\S]*?\n\}/)
    assert.ok(fnMatch)
    const body = fnMatch[0]
    assert.match(body, /const conflict = assignError\.code === '23505'/)
    assert.match(body, /return \{ status: 'already_assigned' \}/)
  })

  test('is called (best-effort, never throwing past its own catch) from all three places a Sales Rep profile can be created', () => {
    assert.match(completeProfileSrc, /await finalizePendingManagerAssignment\(userData\.user\.id\)/)
    assert.match(preProvisionRepsSrc, /await finalizePendingManagerAssignment\(rep\.authUserId as string\)/)
    // pre-provision-manager-profile.ts provisions MANAGER profiles, never
    // Sales Reps, so a pending Sales-Rep-assignment claim could never match
    // one — correctly NOT wired in there.
    assert.equal(preProvisionManagerSrc.includes('finalizePendingManagerAssignment'), false)
  })
})

describe('Draft migration — manager_sales_rep_pending_assignments is RLS-locked to SELECT-only, own-rows-only for a Manager', () => {
  test('no INSERT/UPDATE/DELETE grant to authenticated or anon — every write goes through the service-role Node layer above', () => {
    assert.match(
      draftMigrationSrc,
      /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN\s*\nON public\.manager_sales_rep_pending_assignments\s*\nFROM authenticated, anon;/,
    )
  })

  test('a Manager can SELECT only rows where they are the manager_id — never another Manager\'s pending invites', () => {
    assert.match(draftMigrationSrc, /USING \(manager_id = auth\.uid\(\)\)/)
  })

  test('the partial unique index enforces at most one OPEN pending claim per rep at the database level, independent of the Node layer', () => {
    assert.match(
      draftMigrationSrc,
      /CREATE UNIQUE INDEX manager_sales_rep_pending_assignments_one_open_per_rep\s*\n\s*ON public\.manager_sales_rep_pending_assignments \(rep_auth_user_id\)\s*\n\s*WHERE resolved_at IS NULL;/,
    )
  })
})
