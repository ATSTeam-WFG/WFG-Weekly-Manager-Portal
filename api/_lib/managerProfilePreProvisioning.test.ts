// Run with: node --test api/_lib/managerProfilePreProvisioning.test.ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { decideManagerPreProvisioningAction, type ManagerPreProvisioningSnapshot } from './managerProfilePreProvisioning.ts'

function snap(overrides: Partial<ManagerPreProvisioningSnapshot> = {}): ManagerPreProvisioningSnapshot {
  return {
    employeeAuthUserId: 'auth-id',
    employeePortalRole: 'manager',
    employeeIsActive: true,
    profileLookup: { status: 'not_found' },
    ...overrides,
  }
}

describe('decideManagerPreProvisioningAction', () => {
  test('eligible manager, no profile yet: create', () => {
    assert.deepEqual(decideManagerPreProvisioningAction(snap()), { action: 'create_profile' })
  })

  test('profile already exists: skip, idempotent', () => {
    assert.deepEqual(decideManagerPreProvisioningAction(snap({ profileLookup: { status: 'found' } })), { action: 'skip_already_done' })
  })

  test('lookup failed: skip, never creates on an unknown state', () => {
    const result = decideManagerPreProvisioningAction(snap({ profileLookup: { status: 'lookup_failed' } }))
    assert.equal(result.action, 'skip_lookup_failed')
  })

  test('lookup_failed takes priority even over a disqualifying role', () => {
    const result = decideManagerPreProvisioningAction(snap({ employeePortalRole: 'sales_rep', profileLookup: { status: 'lookup_failed' } }))
    assert.equal(result.action, 'skip_lookup_failed')
  })

  test('no Auth account yet: skip', () => {
    const result = decideManagerPreProvisioningAction(snap({ employeeAuthUserId: null }))
    assert.equal(result.action, 'skip_not_found_or_ineligible')
  })

  test('roster role is not manager: skip', () => {
    const result = decideManagerPreProvisioningAction(snap({ employeePortalRole: 'admin' }))
    assert.equal(result.action, 'skip_not_found_or_ineligible')
  })

  test('roster entry inactive: skip', () => {
    const result = decideManagerPreProvisioningAction(snap({ employeeIsActive: false }))
    assert.equal(result.action, 'skip_not_found_or_ineligible')
  })
})
