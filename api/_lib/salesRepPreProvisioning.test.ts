// Run with: node --test api/_lib/salesRepPreProvisioning.test.ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { decidePreProvisioningAction, type PreProvisioningSnapshot } from './salesRepPreProvisioning.ts'

function snap(overrides: Partial<PreProvisioningSnapshot> = {}): PreProvisioningSnapshot {
  return {
    repEmail: 'rep@wfgtitle.com',
    repAuthUserId: 'rep-auth-id',
    repPortalRole: 'sales_rep',
    repIsActive: true,
    repProfileExists: false,
    managerEmail: 'manager@wfgtitle.com',
    managerProfileId: 'manager-profile-id',
    managerRole: 'manager',
    managerIsActive: true,
    activeAssignmentToThisManagerExists: false,
    ...overrides,
  }
}

describe('decidePreProvisioningAction', () => {
  test('fresh rep, eligible manager: create profile and assign', () => {
    assert.deepEqual(decidePreProvisioningAction(snap()), { action: 'create_profile_and_assign' })
  })

  test('profile already exists, assignment does not: assign only', () => {
    assert.deepEqual(decidePreProvisioningAction(snap({ repProfileExists: true })), { action: 'assign_only' })
  })

  test('profile and active assignment to this exact manager both already exist: skip, fully idempotent', () => {
    assert.deepEqual(
      decidePreProvisioningAction(snap({ repProfileExists: true, activeAssignmentToThisManagerExists: true })),
      { action: 'skip_already_done' },
    )
  })

  test('no approved_employees/Auth account for this rep email at all: skip, never crashes', () => {
    const result = decidePreProvisioningAction(snap({ repAuthUserId: null }))
    assert.equal(result.action, 'skip_rep_not_found_or_ineligible')
  })

  test('roster role is not sales_rep (e.g. already something else): skip, never silently reassigns', () => {
    const result = decidePreProvisioningAction(snap({ repPortalRole: 'manager' }))
    assert.equal(result.action, 'skip_rep_not_found_or_ineligible')
  })

  test('roster entry is inactive: skip', () => {
    const result = decidePreProvisioningAction(snap({ repIsActive: false }))
    assert.equal(result.action, 'skip_rep_not_found_or_ineligible')
  })

  test('manager has no profile at all yet: create the rep profile anyway, never block it on the manager', () => {
    assert.deepEqual(decidePreProvisioningAction(snap({ managerProfileId: null })), { action: 'create_profile_only' })
  })

  test('manager profile exists but role is not manager: create the rep profile anyway', () => {
    assert.deepEqual(decidePreProvisioningAction(snap({ managerRole: 'admin' })), { action: 'create_profile_only' })
  })

  test('manager profile exists but is inactive: create the rep profile anyway', () => {
    assert.deepEqual(decidePreProvisioningAction(snap({ managerIsActive: false })), { action: 'create_profile_only' })
  })

  test('profile already exists, manager is ineligible: skip the assignment specifically, do not re-attempt profile creation', () => {
    const result = decidePreProvisioningAction(snap({ repProfileExists: true, managerRole: 'admin' }))
    assert.equal(result.action, 'skip_manager_not_found_or_ineligible')
  })

  test('profile exists, an assignment exists but to a DIFFERENT manager than requested: still assign to the requested one (not skipped)', () => {
    // activeAssignmentToThisManagerExists is specifically scoped to THIS
    // manager email in the snapshot contract — a caller checking against a
    // different manager's assignment would correctly report false here,
    // and this function has no way to see "assigned elsewhere" separately.
    // This test locks in that the function only ever reasons about the
    // exact (rep, manager) pair it was given, never a broader rep-wide assignment state.
    assert.deepEqual(
      decidePreProvisioningAction(snap({ repProfileExists: true, activeAssignmentToThisManagerExists: false })),
      { action: 'assign_only' },
    )
  })
})
