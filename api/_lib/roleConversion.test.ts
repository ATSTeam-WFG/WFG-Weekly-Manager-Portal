// Run with: node --test api/_lib/roleConversion.test.ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { decideRoleConversionAction, type RoleConversionSnapshot } from './roleConversion.ts'

function snap(overrides: Partial<RoleConversionSnapshot> = {}): RoleConversionSnapshot {
  return {
    rosterPortalRole: 'manager',
    expectedCurrentPortalRole: 'manager',
    newPortalRole: 'sales_admin',
    profileLookup: { status: 'found', role: 'manager' },
    ...overrides,
  }
}

describe('decideRoleConversionAction', () => {
  test('roster and profile both still in the expected current role: convert', () => {
    assert.deepEqual(decideRoleConversionAction(snap()), { action: 'convert' })
  })

  test('roster and profile both already show the new role: skip, idempotent no-op', () => {
    const result = decideRoleConversionAction(
      snap({ rosterPortalRole: 'sales_admin', profileLookup: { status: 'found', role: 'sales_admin' } }),
    )
    assert.deepEqual(result, { action: 'skip_already_converted' })
  })

  test('roster role differs from expected (not yet converted, not the expected starting role either): refuse, never guess', () => {
    const result = decideRoleConversionAction(snap({ rosterPortalRole: 'admin' }))
    assert.equal(result.action, 'skip_unexpected_current_role')
  })

  test('profile role differs from expected even though roster matches: refuse (stores disagree)', () => {
    const result = decideRoleConversionAction(snap({ profileLookup: { status: 'found', role: 'sales_rep' } }))
    assert.equal(result.action, 'skip_unexpected_current_role')
  })

  test('no profile exists yet: refuse, nothing to convert', () => {
    const result = decideRoleConversionAction(snap({ profileLookup: { status: 'not_found' } }))
    assert.equal(result.action, 'skip_no_profile_yet')
  })

  test('profile lookup failed: refuse, never convert on an unknown state', () => {
    const result = decideRoleConversionAction(snap({ profileLookup: { status: 'lookup_failed' } }))
    assert.equal(result.action, 'skip_lookup_failed')
  })

  test('lookup_failed takes priority even when the roster already looks converted', () => {
    const result = decideRoleConversionAction(snap({ rosterPortalRole: 'sales_admin', profileLookup: { status: 'lookup_failed' } }))
    assert.equal(result.action, 'skip_lookup_failed')
  })

  test('partially converted (roster updated, profile not yet) is never treated as fully already-converted', () => {
    const result = decideRoleConversionAction(snap({ rosterPortalRole: 'sales_admin', profileLookup: { status: 'found', role: 'manager' } }))
    // Roster says sales_admin (new role) but profile still says manager
    // (expected current role) — this is a genuine split-brain state, not a
    // clean "convert" or "already done". It must be surfaced, not silently
    // re-converted as if nothing had happened.
    assert.notEqual(result.action, 'skip_already_converted')
    assert.notEqual(result.action, 'convert')
  })
})
