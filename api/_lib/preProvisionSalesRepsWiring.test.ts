// Run with: node --test api/_lib/preProvisionSalesRepsWiring.test.ts
//
// api/admin/users/pre-provision-sales-reps.ts has a real @supabase/supabase-js
// import (via adminAuth.ts/supabaseServiceClient.ts), so it isn't safe to
// execute directly here — same established pattern as
// completeProfileWiring.test.ts/adminUserManagementWiring.test.ts. This
// verifies the pre-provisioning endpoint's authorization boundary, its
// dry-run safety, and which Supabase client it uses for assign_sales_rep,
// via source inspection. The pure decision logic
// (decidePreProvisioningAction) is independently, directly unit-tested in
// salesRepPreProvisioning.test.ts instead.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const endpointSrc = readFileSync(path.join(dir, '..', 'admin', 'users', 'pre-provision-sales-reps.ts'), 'utf8')
const serviceClientSrc = readFileSync(path.join(dir, 'supabaseServiceClient.ts'), 'utf8')

describe('api/admin/users/pre-provision-sales-reps.ts — Admin-ONLY, never Manager/Sales-Admin/Sales-Rep-usable', () => {
  test('imports and calls authenticateAdmin', () => {
    assert.match(endpointSrc, /import \{ authenticateAdmin \} from '\.\.\/\.\.\/_lib\/adminAuth\.js'/)
    assert.match(endpointSrc, /await authenticateAdmin\(/)
  })

  test('never imports or calls authenticateAdminOrSalesAdmin — a Sales Admin must never pre-provision reps', () => {
    assert.doesNotMatch(endpointSrc, /import \{[^}]*authenticateAdminOrSalesAdmin/)
    assert.doesNotMatch(endpointSrc, /await authenticateAdminOrSalesAdmin\(/)
  })
})

describe('roster is fixed and versioned, never client-supplied', () => {
  test('imports APPROVED_PRE_PROVISIONING_ROSTER from the dedicated roster module', () => {
    assert.match(endpointSrc, /import \{ APPROVED_PRE_PROVISIONING_ROSTER \} from '\.\.\/\.\.\/_lib\/salesRepPreProvisioningRoster\.js'/)
    assert.match(endpointSrc, /for \(const entry of APPROVED_PRE_PROVISIONING_ROSTER\)/)
  })

  test('never reads a roster or mapping from the request body — only an execute flag', () => {
    assert.match(endpointSrc, /const body = \(req\.body \?\? \{\}\) as \{ execute\?: unknown \}/)
    assert.doesNotMatch(endpointSrc, /body\.(roster|entries|reps|mapping)/)
  })
})

describe('dry-run mode performs zero writes', () => {
  test('the !execute branch returns before any write call reference', () => {
    const match = endpointSrc.match(/if \(!execute\) \{([\s\S]*?continue\n\s*\})/)
    assert.ok(match, 'could not locate the dry-run (!execute) branch')
    const dryRunBlock = match[1]
    assert.doesNotMatch(dryRunBlock, /createProfileFromApprovedEmployee|\.rpc\(/)
    assert.match(dryRunBlock, /status: 'preview'/)
  })

  test('createProfileFromApprovedEmployee and the assign_sales_rep rpc call are only reachable after the dry-run branch\'s continue', () => {
    const dryRunIndex = endpointSrc.indexOf("if (!execute) {")
    const createProfileIndex = endpointSrc.indexOf('createProfileFromApprovedEmployee(rep.authUserId')
    const rpcIndex = endpointSrc.indexOf(".rpc('assign_sales_rep'")
    assert.ok(dryRunIndex >= 0 && createProfileIndex > dryRunIndex && rpcIndex > dryRunIndex)
  })
})

describe('assign_sales_rep is called via the caller\'s own admin-scoped client, never the service-role client', () => {
  test('the rpc call uses auth.supabase, not a service-role client import', () => {
    assert.match(endpointSrc, /auth\.supabase\.rpc\('assign_sales_rep'/)
    assert.doesNotMatch(endpointSrc, /getServiceClient\(\)\.rpc/)
  })

  test('the endpoint itself never imports the service client directly — only narrow, purpose-built helpers', () => {
    assert.doesNotMatch(endpointSrc, /import \{[^}]*getServiceClient/)
  })
})

describe('partial failure handling: profile-created-but-assignment-failed is never reported as full success', () => {
  test('a failed or thrown assignment after profile creation reports profile_created_assignment_failed, not full_success', () => {
    assert.match(endpointSrc, /status: profileCreated \? 'profile_created_assignment_failed' : 'error'/)
  })

  test('full_success is only reported after the assignment rpc call resolves without error', () => {
    const fullSuccessIndex = endpointSrc.indexOf("status: 'full_success'")
    const rpcIndex = endpointSrc.indexOf(".rpc('assign_sales_rep'")
    assert.ok(fullSuccessIndex > rpcIndex)
  })
})

describe('concurrency safety: no duplicate profiles or assignments on a retry or a race', () => {
  test('createProfileFromApprovedEmployee is a plain create-only insert (never upsert) — profiles.id is the primary key, so a racing duplicate insert fails loudly rather than silently overwriting', () => {
    const insertBlock = serviceClientSrc.match(/export async function createProfileFromApprovedEmployee[\s\S]*?\n\}/)
    assert.ok(insertBlock, 'could not locate createProfileFromApprovedEmployee')
    assert.match(insertBlock[0], /\.insert\(\{/)
    assert.doesNotMatch(insertBlock[0], /\.upsert\(/)
    assert.match(insertBlock[0], /if \(error\) \{[\s\S]*?return null/)
  })

  test('a failed profile creation (e.g. a racing duplicate) is reported per-entry as \'error\' and does not abort the rest of the roster loop', () => {
    assert.match(endpointSrc, /if \(!createdProfile\) \{/)
    assert.doesNotMatch(endpointSrc, /throw\b/)
  })

  test('assign_sales_rep itself is documented as taking a per-rep advisory lock and returning the existing assignment unchanged when it already matches — verified against the actual migration, not assumed', () => {
    const migrationSrc = readFileSync(
      path.join(dir, '..', '..', 'supabase', 'migrations', '20261103090000_sales_admin_role.sql'),
      'utf8',
    )
    assert.match(migrationSrc, /pg_advisory_xact_lock\(hashtext\(p_rep_id::text\)\)/)
    assert.match(migrationSrc, /IF v_existing\.id IS NOT NULL AND v_existing\.manager_id = p_manager_id THEN\s*\n\s*RETURN v_existing/)
  })
})

describe('first-login compatibility: pre-provisioned profiles are indistinguishable from ones created at real first login', () => {
  test('pre-provisioning calls the exact same createProfileFromApprovedEmployee function complete-profile.ts calls, never a parallel insert path', () => {
    const completeProfileSrc = readFileSync(path.join(dir, '..', 'onboarding', 'complete-profile.ts'), 'utf8')
    assert.match(endpointSrc, /createProfileFromApprovedEmployee\(rep\.authUserId as string, rep\)/)
    assert.match(completeProfileSrc, /createProfileFromApprovedEmployee\(userData\.user\.id, employee\)/)
  })

  test('complete-profile.ts\'s own existing-profile branch is untouched by this feature, so a real first login after pre-provisioning still hits its already-idempotent success path', () => {
    const completeProfileSrc = readFileSync(path.join(dir, '..', 'onboarding', 'complete-profile.ts'), 'utf8')
    assert.match(completeProfileSrc, /existingLookup\.status === 'found'/)
  })
})

describe('api/_lib/supabaseServiceClient.ts — hasActiveAssignmentToManager is a narrow, purpose-built read, not a generic client export', () => {
  test('getServiceClient itself is still never exported', () => {
    assert.doesNotMatch(serviceClientSrc, /export function getServiceClient/)
    assert.doesNotMatch(serviceClientSrc, /export \{ getServiceClient \}/)
  })

  test('hasActiveAssignmentToManager queries rep_manager_assignments scoped to one exact (rep, manager) pair', () => {
    assert.match(serviceClientSrc, /export async function hasActiveAssignmentToManager/)
    assert.match(serviceClientSrc, /\.eq\('rep_id', repProfileId\)/)
    assert.match(serviceClientSrc, /\.eq\('manager_id', managerProfileId\)/)
    assert.match(serviceClientSrc, /\.is\('unassigned_at', null\)/)
  })
})
