// Run with: node --test api/_lib/salesRepPreProvisioning.test.ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { decidePreProvisioningAction, isAssignmentVerified, type PreProvisioningSnapshot } from './salesRepPreProvisioning.ts'

function snap(overrides: Partial<PreProvisioningSnapshot> = {}): PreProvisioningSnapshot {
  return {
    repEmail: 'rep@wfgtitle.com',
    repAuthUserId: 'rep-auth-id',
    repPortalRole: 'sales_rep',
    repIsActive: true,
    repProfileLookup: { status: 'not_found' },
    managerEmail: 'manager@wfgtitle.com',
    managerProfileLookup: { status: 'found', profileId: 'manager-profile-id', role: 'manager', isActive: true },
    existingAssignmentLookup: { status: 'none' },
    ...overrides,
  }
}

describe('decidePreProvisioningAction', () => {
  test('fresh rep, eligible manager: create profile and assign', () => {
    assert.deepEqual(decidePreProvisioningAction(snap()), { action: 'create_profile_and_assign' })
  })

  test('profile already exists, no existing assignment: assign only', () => {
    assert.deepEqual(decidePreProvisioningAction(snap({ repProfileLookup: { status: 'found' } })), { action: 'assign_only' })
  })

  test('profile exists, active assignment already to this exact manager: skip, fully idempotent', () => {
    assert.deepEqual(
      decidePreProvisioningAction(
        snap({ repProfileLookup: { status: 'found' }, existingAssignmentLookup: { status: 'found', managerProfileId: 'manager-profile-id' } }),
      ),
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
    assert.deepEqual(decidePreProvisioningAction(snap({ managerProfileLookup: { status: 'not_found' } })), { action: 'create_profile_only' })
  })

  test('manager profile exists but role is not manager: create the rep profile anyway', () => {
    assert.deepEqual(
      decidePreProvisioningAction(snap({ managerProfileLookup: { status: 'found', profileId: 'manager-profile-id', role: 'admin', isActive: true } })),
      { action: 'create_profile_only' },
    )
  })

  test('manager profile exists but is inactive: create the rep profile anyway', () => {
    assert.deepEqual(
      decidePreProvisioningAction(snap({ managerProfileLookup: { status: 'found', profileId: 'manager-profile-id', role: 'manager', isActive: false } })),
      { action: 'create_profile_only' },
    )
  })

  test('profile already exists, manager is ineligible: skip the assignment specifically, do not re-attempt profile creation', () => {
    const result = decidePreProvisioningAction(
      snap({ repProfileLookup: { status: 'found' }, managerProfileLookup: { status: 'found', profileId: 'manager-profile-id', role: 'admin', isActive: true } }),
    )
    assert.equal(result.action, 'skip_manager_not_found_or_ineligible')
  })

  describe('lookup failures are never treated as "not found" / "none" — never silently proceed on an unknown state', () => {
    test('rep profile lookup failed: skip, do not create a possibly-duplicate profile', () => {
      const result = decidePreProvisioningAction(snap({ repProfileLookup: { status: 'lookup_failed' } }))
      assert.equal(result.action, 'skip_lookup_failed')
    })

    test('manager profile lookup failed: skip, even though the rep profile lookup succeeded', () => {
      const result = decidePreProvisioningAction(snap({ managerProfileLookup: { status: 'lookup_failed' } }))
      assert.equal(result.action, 'skip_lookup_failed')
    })

    test('existing-assignment lookup failed: skip, never assign without knowing the current state', () => {
      const result = decidePreProvisioningAction(snap({ repProfileLookup: { status: 'found' }, existingAssignmentLookup: { status: 'lookup_failed' } }))
      assert.equal(result.action, 'skip_lookup_failed')
    })

    test('a lookup_failed takes priority even over an otherwise-disqualifying rep ineligibility', () => {
      const result = decidePreProvisioningAction(snap({ repAuthUserId: null, managerProfileLookup: { status: 'lookup_failed' } }))
      assert.equal(result.action, 'skip_lookup_failed')
    })
  })

  describe('assignment conflicts: an existing active assignment to a DIFFERENT manager is never overwritten', () => {
    test('profile exists, active assignment to a different (eligible) manager: conflict, not reassigned', () => {
      const result = decidePreProvisioningAction(
        snap({ repProfileLookup: { status: 'found' }, existingAssignmentLookup: { status: 'found', managerProfileId: 'some-other-manager-id' } }),
      )
      assert.equal(result.action, 'skip_assignment_conflict_different_manager')
      assert.equal((result as { conflictingManagerProfileId: string }).conflictingManagerProfileId, 'some-other-manager-id')
    })

    test('profile exists, active assignment exists but the requested manager has no profile at all: still a conflict, never treated as assign_only', () => {
      const result = decidePreProvisioningAction(
        snap({
          repProfileLookup: { status: 'found' },
          managerProfileLookup: { status: 'not_found' },
          existingAssignmentLookup: { status: 'found', managerProfileId: 'some-other-manager-id' },
        }),
      )
      assert.equal(result.action, 'skip_assignment_conflict_different_manager')
    })
  })
})

describe('isAssignmentVerified — never reports success without an independent, matching re-read', () => {
  test('a fresh read confirming the exact expected manager: verified', () => {
    assert.equal(isAssignmentVerified({ status: 'found', managerProfileId: 'manager-profile-id' }, 'manager-profile-id'), true)
  })

  test('a fresh read showing a DIFFERENT manager than expected: not verified', () => {
    assert.equal(isAssignmentVerified({ status: 'found', managerProfileId: 'someone-else' }, 'manager-profile-id'), false)
  })

  test('a fresh read showing no active assignment at all (RPC claimed success, but nothing stuck): not verified', () => {
    assert.equal(isAssignmentVerified({ status: 'none' }, 'manager-profile-id'), false)
  })

  test('the independent re-read itself failed: not verified — never trust an unknown state as success', () => {
    assert.equal(isAssignmentVerified({ status: 'lookup_failed' }, 'manager-profile-id'), false)
  })

  test('no expected manager id was ever resolved: not verified, regardless of what the re-read shows', () => {
    assert.equal(isAssignmentVerified({ status: 'found', managerProfileId: 'manager-profile-id' }, null), false)
  })
})
