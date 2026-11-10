// Run with: node --test api/_lib/salesRepRotation.test.ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { decideSalesRepRotation, type RotationSnapshot } from './supabaseServiceClient.ts'

function snap(overrides: Partial<RotationSnapshot> = {}): RotationSnapshot {
  return {
    rosterFound: true,
    rosterPortalRole: 'sales_rep',
    rosterIsActive: true,
    authUserId: 'auth-id',
    authLookupFailed: false,
    passwordChangeRequired: true,
    lastSignInAt: null,
    currentAppMetadata: { password_change_required: true },
    ...overrides,
  }
}

describe('decideSalesRepRotation', () => {
  test('a pre-provisioned Sales Rep who has never signed in, with password_change_required=true: rotate', () => {
    assert.deepEqual(decideSalesRepRotation(snap()), { action: 'rotate' })
  })

  test('REGRESSION: having a profiles row is irrelevant to this decision — only Auth state matters. A pre-provisioned rep (profile exists, never logged in) must still be eligible', () => {
    // This snapshot has no "profile exists" field at all — decideSalesRepRotation
    // never looks at profiles. This test exists specifically because the
    // original (buggy) implementation used profile existence as its
    // already-onboarded signal, which would have refused every single
    // pre-provisioned Sales Rep.
    assert.deepEqual(decideSalesRepRotation(snap()), { action: 'rotate' })
  })

  test('an account that has already signed in at least once: refuse, regardless of the flag', () => {
    const result = decideSalesRepRotation(snap({ lastSignInAt: '2026-09-22T14:21:00Z', passwordChangeRequired: true }))
    assert.equal(result.action, 'already_onboarded')
  })

  test('password_change_required explicitly false: refuse — this employee already set their own password', () => {
    const result = decideSalesRepRotation(snap({ passwordChangeRequired: false }))
    assert.equal(result.action, 'already_onboarded')
  })

  test('password_change_required missing (null): fail CLOSED — never assume it is safe to rotate on an ambiguous state', () => {
    const result = decideSalesRepRotation(snap({ passwordChangeRequired: null }))
    assert.equal(result.action, 'cannot_verify_state')
  })

  test('the Auth user lookup itself failed: fail CLOSED', () => {
    const result = decideSalesRepRotation(snap({ authLookupFailed: true, passwordChangeRequired: null, lastSignInAt: null }))
    assert.equal(result.action, 'cannot_verify_state')
  })

  test('no roster entry found at all: not_found', () => {
    const result = decideSalesRepRotation(snap({ rosterFound: false, rosterPortalRole: null, rosterIsActive: null, authUserId: null }))
    assert.equal(result.action, 'not_found')
  })

  test('roster entry is a Manager, not a Sales Rep: not_found (this endpoint only ever targets Sales Reps)', () => {
    const result = decideSalesRepRotation(snap({ rosterPortalRole: 'manager' }))
    assert.equal(result.action, 'not_found')
  })

  test('roster entry has no Auth account yet: not_found', () => {
    const result = decideSalesRepRotation(snap({ authUserId: null }))
    assert.equal(result.action, 'not_found')
  })

  test('roster entry is inactive: not_found', () => {
    const result = decideSalesRepRotation(snap({ rosterIsActive: false }))
    assert.equal(result.action, 'not_found')
  })

  test('last_sign_in_at takes priority even when the flag still (incorrectly) claims password_change_required=true', () => {
    const result = decideSalesRepRotation(snap({ lastSignInAt: '2026-11-01T00:00:00Z', passwordChangeRequired: true }))
    assert.equal(result.action, 'already_onboarded')
  })
})
