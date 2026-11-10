// Run with: node --test api/_lib/preProvisionSalesRepsWiring.test.ts
//
// api/admin/users/pre-provision-sales-reps.ts has a real @supabase/supabase-js
// import (via adminAuth.ts/supabaseServiceClient.ts), so it isn't safe to
// execute directly here — same established pattern as
// completeProfileWiring.test.ts/adminUserManagementWiring.test.ts. This
// verifies the pre-provisioning endpoint's authorization boundary, its
// dry-run safety, and which Supabase client it uses for assign_sales_rep,
// via source inspection. The genuinely behavioral logic — conflict
// detection, lookup-failure handling, and post-assignment verification —
// is independently, directly unit-tested in salesRepPreProvisioning.test.ts
// instead (decidePreProvisioningAction / isAssignmentVerified), not just
// asserted here via regex.
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

describe('scenario 1 (conflict): an existing assignment to a different manager is wired through to a skip, never through to the rpc call', () => {
  test('skip_assignment_conflict_different_manager is handled in the same skip branch as the other no-write decisions, before any write code', () => {
    const skipBlockMatch = endpointSrc.match(/if \(\s*\n\s*decision\.action === 'skip_rep_not_found_or_ineligible' \|\|\s*\n\s*decision\.action === 'skip_manager_not_found_or_ineligible' \|\|\s*\n\s*decision\.action === 'skip_assignment_conflict_different_manager'\s*\n\s*\) \{([\s\S]*?continue\n\s*\})/)
    assert.ok(skipBlockMatch, 'could not locate the combined skip branch covering skip_assignment_conflict_different_manager')
    assert.doesNotMatch(skipBlockMatch[1], /createProfileFromApprovedEmployee|\.rpc\(/)
  })

  test('the existing-assignment lookup is never pre-filtered to the requested manager — findActiveAssignmentForRep takes only a rep id, so the endpoint cannot silently assume "no conflict"', () => {
    assert.match(endpointSrc, /findActiveAssignmentForRep\(rep\.authUserId\)/)
    assert.match(serviceClientSrc, /export async function findActiveAssignmentForRep\(repProfileId: string\)/)
    assert.doesNotMatch(serviceClientSrc, /function findActiveAssignmentForRep\([^)]*managerProfileId/)
  })
})

describe('scenario 2 (lookup failures): every lookup result is passed through as found/not_found/lookup_failed, never collapsed to null before reaching the decision function', () => {
  test('the rep profile lookup maps the \'error\' status to lookup_failed, not to not_found', () => {
    const block = endpointSrc.match(/const repProfileResult = await findProfileByUserId\(rep\.authUserId\)([\s\S]*?)\n\s*\}\n\s*\}/)
    assert.ok(block, 'could not locate the rep profile lookup mapping')
    assert.match(block[1], /repProfileResult\.status === 'error'[\s\S]*?status: 'lookup_failed'/)
  })

  test('the manager profile lookup maps the \'error\' status to lookup_failed, not to not_found', () => {
    const declIndex = endpointSrc.indexOf('const managerProfileResult = await findProfileByEmail(managerEmailNormalized)')
    assert.ok(declIndex >= 0, 'could not locate the manager profile lookup')
    const block = endpointSrc.slice(declIndex, declIndex + 600)
    assert.match(block, /: managerProfileResult\.status === 'error'\s*\n\s*\? \{ status: 'lookup_failed' \}/)
  })

  test('skip_lookup_failed is reported with status \'error\' (not \'skipped\') so it is never mistaken for an ordinary, expected skip', () => {
    assert.match(endpointSrc, /if \(decision\.action === 'skip_lookup_failed'\) \{[\s\S]*?status: 'error'/)
  })
})

describe('scenario 3 (post-assignment verification): full_success is never reported from the rpc call\'s absence-of-error alone', () => {
  test('after a successful rpc call, findActiveAssignmentForRep is called again (a fresh, independent read) before isAssignmentVerified is checked', () => {
    const rpcIndex = endpointSrc.lastIndexOf(".rpc('assign_sales_rep'")
    const verifyCallIndex = endpointSrc.indexOf('findActiveAssignmentForRep(rep?.authUserId as string)')
    const isVerifiedIndex = endpointSrc.indexOf('isAssignmentVerified(verification, expectedManagerProfileId)')
    assert.ok(rpcIndex >= 0 && verifyCallIndex > rpcIndex && isVerifiedIndex > verifyCallIndex)
  })

  test('an unverified assignment is reported as assignment_unverified, never full_success', () => {
    const match = endpointSrc.match(/if \(!isAssignmentVerified\(verification, expectedManagerProfileId\)\) \{([\s\S]*?continue\n\s*\})/)
    assert.ok(match, 'could not locate the verification-failure branch')
    assert.match(match[1], /status: 'assignment_unverified'/)
    assert.doesNotMatch(match[1], /status: 'full_success'/)
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

describe('api/_lib/supabaseServiceClient.ts — findActiveAssignmentForRep is a narrow, purpose-built read, not a generic client export', () => {
  test('getServiceClient itself is still never exported', () => {
    assert.doesNotMatch(serviceClientSrc, /export function getServiceClient/)
    assert.doesNotMatch(serviceClientSrc, /export \{ getServiceClient \}/)
  })

  test('findActiveAssignmentForRep queries rep_manager_assignments scoped to one rep, distinguishing found/none/lookup_failed', () => {
    assert.match(serviceClientSrc, /export async function findActiveAssignmentForRep/)
    assert.match(serviceClientSrc, /\.eq\('rep_id', repProfileId\)/)
    assert.match(serviceClientSrc, /\.is\('unassigned_at', null\)/)
    assert.match(serviceClientSrc, /status: 'lookup_failed'/)
  })
})
